"""镜头切分: PySceneDetect 跑全片, 把切点写成 shots.json 时间轴缓存。

从 movie_cut/pipeline/step_vis_segment.py 移植。输出 JSON 契约与 movie_cut
的 timeline.json 逐字段一致 (video/duration/video_signature/segment_version/
threshold/min_len/frame_skip/fps/n_shots/shots[]), 下游工具靠这个契约互通,
不要增删改字段名。

refine=true(默认)在检测之后逐边界做帧级精修: ContentDetector 给出的切点
系统性早 1~2 帧(老炮儿 1441 边界中 1417 个早 2 帧), 直接拿去切片会把上一
镜头的尾帧带进新镜头开头, 成片上就是"闪一下"。精修在边界 ±REFINE_RADIUS 帧
内找帧间差最大处作为新镜头首帧; 找不到明显跳变的边界(渐变/运动切)保留原
时刻并标 soft。shots[] 每条多出 boundary_in 字段(hard/soft/unknown, 首镜头无),
顶层多出 refine 统计块; 精修版 segment_version 为 cover-all-v3-frame。
"""
from __future__ import annotations

import json
import hashlib
import math
import os
import shutil
import subprocess
import time
import tempfile
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext
from .recap_runtime_state import DEFAULT_LIMITS, RuntimeBusy, resource_slot

# 与 movie_cut 保持同一版本串: 两边产物可互相复用缓存, 改合并算法时必须换版本号
SEGMENT_VERSION = "cover-all-v2"
# 帧级精修后的版本串(movie_cut 不认, 只在 kit 内部复用)
SEGMENT_VERSION_REFINED = "cover-all-v3-frame"
SEGMENT_VERSION_COARSE = "cover-all-v4-coarse-short-inserts"
REFINEMENT_VERSION = "frame-diff-checkpoint-v1"

PROBE_TIMEOUT_SECONDS = 60

# --- 边界精修参数 ---
REFINE_RADIUS = 6            # 边界两侧各搜多少帧
REFINE_MIN_JUMP = 8.0        # 64x36 灰度帧间平均绝对差低于此值 = 没有可钉的硬切点
REFINE_PRESEEK = 12.0        # 输入端 -ss 先粗跳到关键帧, 再输出端 -ss 精切(与 render_narrated.cut_clip 同款)
REFINE_TIMEOUT_SECONDS = 120
REFINE_WORKERS = int(os.environ.get("VE_SHOT_REFINE_WORKERS", "0") or 0) \
    or min(32, os.cpu_count() or 8)


def _all_boundaries_unknown(timeline: dict) -> bool:
    stats = timeline.get("refine") or {}
    count = stats.get("n_boundaries", 0)
    return count > 0 and stats.get("n_unknown", 0) >= count


def detect_shots(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("input_path"):
        return ToolResult(text="[ERROR] input_path is required")
    input_path = ctx.resolve(args["input_path"])
    if not input_path.is_file():
        return ToolResult(text=f"[ERROR] File not found: {input_path}")
    if not shutil.which("ffprobe"):
        return ToolResult(text="[ERROR] ffprobe not found on PATH")

    output_path = ctx.resolve(args.get("output_json") or "out/shots.json")
    threshold = _number_arg(args, "threshold", 27.0)
    if isinstance(threshold, ToolResult):
        return threshold
    min_len = _number_arg(args, "min_len", 0.8)
    if isinstance(min_len, ToolResult):
        return min_len
    frame_skip = _int_arg(args, "frame_skip", 0)
    if isinstance(frame_skip, ToolResult):
        return frame_skip
    force = args.get("force", False)
    if not isinstance(force, bool):
        return ToolResult(text="[ERROR] force must be a boolean", data={"force": force})
    refine = args.get("refine", True)
    if not isinstance(refine, bool):
        return ToolResult(text="[ERROR] refine must be a boolean", data={"refine": refine})
    preserve_short = args.get('preserve_short_shots', False)
    if not isinstance(preserve_short, bool) or preserve_short and (min_len != 0 or frame_skip != 0):
        return ToolResult(text='[ERROR] preserving short inserts requires min_len=0 and frame_skip=0')
    if threshold <= 0:
        return ToolResult(text="[ERROR] threshold must be positive", data={"threshold": threshold})
    if min_len < 0:
        return ToolResult(text="[ERROR] min_len must be >= 0", data={"min_len": min_len})
    if frame_skip < 0:
        return ToolResult(text="[ERROR] frame_skip must be >= 0", data={"frame_skip": frame_skip})
    raw_version = SEGMENT_VERSION_COARSE if preserve_short else SEGMENT_VERSION
    want_version = SEGMENT_VERSION_REFINED if refine else raw_version
    raw_path = output_path.with_name(output_path.stem + '.raw.json')

    # 缓存复用: 输出已存在且 视频指纹+全部切分参数 都对上才复用。指纹是
    # path|size|mtime, 视频被覆盖/替换后 mtime 变化即失效。缓存文件本身
    # 读不出来 (损坏/半截) 不算错, 走重切分覆盖它。
    # 要精修而缓存是未精修版(v2)时, 检测结果本身仍有效: 直接在其上精修,
    # 省掉几分钟的全片 ContentDetector 重跑。
    signature = file_signature(input_path)
    unrefined_base: dict | None = None
    for cached_path in (output_path, raw_path) if not force else ():
        if not cached_path.is_file():
            continue
        try:
            tl = load_json(cached_path)
        except Exception:
            tl = None
        if (isinstance(tl, dict)
                and tl.get("video") == str(input_path)
                and tl.get("video_signature") == signature
                and _same_number(tl.get("threshold", threshold), threshold)
                and _same_number(tl.get("min_len", min_len), min_len)
                and _same_int(tl.get("frame_skip", frame_skip), frame_skip)
                and bool(tl.get('preserve_short_shots')) == preserve_short):
            failed_refinement = refine and _all_boundaries_unknown(tl)
            if tl.get("segment_version") == want_version and not failed_refinement:
                if cached_path != output_path:
                    save_json(tl, output_path)
                return ToolResult(
                    text=f"Reused cached shots: {ctx.virtualize(output_path)} ({tl.get('n_shots', 0)} shots)",
                    data=_summary(tl, output_path, reused=True, elapsed=0.0),
                    artifacts=[str(output_path)],
                )
            if refine and (tl.get("segment_version") == raw_version or failed_refinement) \
                    and isinstance(tl.get("shots"), list) and tl["shots"]:
                unrefined_base = tl
                # Prefer the immutable coarse boundaries over an earlier partial pass.
                if cached_path == raw_path:
                    break

    try:
        meta = probe(input_path)
    except Exception as exc:
        return ToolResult(text=f"[ERROR] ffprobe failed: {exc}", data={"input_path": str(input_path)})

    started = time.time()
    if unrefined_base is not None:
        shots = [{"shot_id": s["shot_id"], "start": float(s["start"]),
                  "end": float(s["end"]), "dur": float(s["dur"])}
                 for s in unrefined_base["shots"]]
    else:
        try:
            with resource_slot("prepare", timeout=600):
                if preserve_short:
                    from .movie_sampling import CandidateRecorder
                    sampler = CandidateRecorder(output_path.parent / 'frame_candidates',
                        input_path, meta, threshold=threshold)
                    detected = _detect_raw(input_path, threshold, min_len, frame_skip,
                                           preserve_short=True, sampler=sampler)
                    if not isinstance(detected, ToolResult):
                        sampler.finish()
                else:
                    sampler = None
                    detected = _detect_raw(input_path, threshold, min_len, frame_skip)
        except RuntimeBusy as exc:
            return ToolResult(text=f"[ERROR] shot detection busy: {exc}", data={"retryable": True})
        if isinstance(detected, ToolResult):
            return detected
        shots = detected

    tl = {"video": str(input_path), "duration": meta["duration"],
          "video_signature": signature,
          "segment_version": raw_version, "threshold": threshold,
          "min_len": min_len, "frame_skip": frame_skip,
          "fps": meta["fps"], "fps_num": meta.get('fps_num'), "fps_den": meta.get('fps_den'),
          "n_shots": len(shots), "shots": shots}
    if preserve_short:
        tl['preserve_short_shots'] = True
        tl['candidate_cache'] = (unrefined_base.get('candidate_cache') if unrefined_base is not None
                                 else sampler.reference())
    # Coarse output survives a missing decoder, interrupted refinement or worker exit.
    save_json(tl, raw_path)
    save_json(tl, output_path)
    if refine:
        if not shutil.which("ffmpeg"):
            return ToolResult(text="[ERROR] ffmpeg not found on PATH (needed for boundary refine)")
        try:
            import numpy  # noqa: F401
        except ImportError:
            return ToolResult(
                text="[ERROR] numpy is not installed (needed for boundary refine). Run: pip install numpy",
                data={"missing_dependency": "numpy"},
            )
        fps_exact = (meta["fps_num"] / meta["fps_den"]
                     if meta.get("fps_num") and meta.get("fps_den") else meta["fps"])
        tl["refine"] = refine_boundaries(input_path, shots, fps_exact,
            checkpoint=output_path.with_name(output_path.stem + '.refinement.json'))
        tl['segment_version'] = want_version
        if _all_boundaries_unknown(tl):
            tl["segment_version"] = raw_version
    try:
        save_json(tl, output_path)
    except OSError as exc:
        return ToolResult(text=f"[ERROR] failed to write {output_path}: {exc}")

    if refine and _all_boundaries_unknown(tl):
        return ToolResult(text="[ERROR] boundary refinement decoded no usable boundaries; "
                          "raw detection is cached for retry after repairing FFmpeg",
                          data={"refine": tl["refine"]}, artifacts=[str(output_path)])

    elapsed = round(time.time() - started, 3)
    how = "refined cached v2 shots" if unrefined_base is not None else "Detected"
    return ToolResult(
        text=f"{how} {len(shots)} shots in {meta['duration']:.1f}s video -> {ctx.virtualize(output_path)} ({elapsed}s)"
             + (f"; boundaries refined: {tl['refine']['n_hard']} hard / {tl['refine']['n_soft']} soft"
                if refine else ""),
        data=_summary(tl, output_path, reused=False, elapsed=elapsed),
        artifacts=[str(output_path)],
    )


def _detect_raw(input_path: Path, threshold: float, min_len: float,
                frame_skip: int, *, preserve_short=False, sampler=None) -> list[dict] | ToolResult:
    """跑 ContentDetector 并把短镜头并入邻镜, 返回全片连续覆盖的 shots 表。"""
    try:
        from scenedetect import ContentDetector
    except ImportError:
        return ToolResult(
            text="[ERROR] scenedetect is not installed. Run: pip install scenedetect",
            data={"missing_dependency": "scenedetect"},
        )

    class RecordingDetector(ContentDetector):
        def process_frame(self, frame_num, frame_img):
            cuts = super().process_frame(frame_num, frame_img)
            if sampler is not None:
                sampler.observe(frame_num, frame_img, cut=bool(cuts))
            return cuts

    detector = RecordingDetector if sampler is not None else ContentDetector
    det = detector(threshold=threshold, **({'min_scene_len': 1} if preserve_short else {}))
    try:
        if frame_skip > 0:
            # 隔帧检测: 解码量减少, 提速全片切分; 代价是切点精度下降(可能漏快切),
            # 默认关闭。SceneManager 默认 auto_downscale=True, 检测本身已在缩小帧上做。
            from scenedetect import SceneManager, open_video
            v = open_video(str(input_path))
            sm = SceneManager()
            sm.add_detector(det)
            sm.detect_scenes(v, frame_skip=frame_skip, show_progress=False)
            scenes = sm.get_scene_list()
        else:
            from scenedetect import detect
            scenes = detect(str(input_path), det, show_progress=False)
    except Exception as exc:
        return ToolResult(
            text=f"[ERROR] scene detection failed: {exc}",
            data={"input_path": str(input_path), "threshold": threshold, "frame_skip": frame_skip},
        )

    # SceneDetect 的 scene_list 覆盖整片。短镜头不能直接 continue，否则时间轴会
    # 出现洞（旧样片累计漏掉约70秒）；把它并入相邻镜头，同时保持全片连续覆盖。
    merged: list[list[float]] = []
    pending_first: list[float] | None = None
    for s, e in scenes:
        st, en = round(s.get_seconds(), 3), round(e.get_seconds(), 3)
        if en - st < min_len:
            if merged:
                merged[-1][1] = en
            elif pending_first is None:
                pending_first = [st, en]
            else:
                pending_first[1] = en
            continue
        if pending_first is not None:
            st = pending_first[0]
            pending_first = None
        merged.append([st, en])
    if pending_first is not None:
        merged.append(pending_first)
    if not merged:
        # PySceneDetect's default (start_in_scene=False) returns an empty list
        # for a video with no cut at all; the whole video is then one shot.
        duration = float(probe(input_path).get("duration") or 0.0)
        if duration <= 0:
            return ToolResult(
                text=f"[ERROR] no shots detected and duration unknown for {input_path}; nothing cached",
                data={"input_path": str(input_path), "threshold": threshold},
            )
        merged = [[0.0, round(duration, 3)]]

    return [{"shot_id": f"shot_{i:04d}", "start": st, "end": en,
             "dur": round(en - st, 3)} for i, (st, en) in enumerate(merged)]


# ---------------------------------------------------------------------------
# 边界帧级精修
# ---------------------------------------------------------------------------

def _boundary_frames(video: Path, f0: int, n: int, fps: float, *, accurate: bool | None = None) -> "numpy.ndarray | None":
    """解码源帧 [f0, f0+n) 为 64x36 灰度小图。起点按帧号对齐(f0/fps), 输入端
    -ss 粗跳 + 输出端 -ss 精切; 输入端 -ss/-to 一把切实测会多带 1~2 帧。"""
    import numpy as np
    if not math.isfinite(fps) or fps <= 0 or f0 < 0 or n <= 0:
        raise ValueError("boundary frame range and fps must be valid")
    # FFmpeg's accurate input seek decodes from the preceding keyframe itself.
    # Opt in only after checking frame identity for the deployment's sources;
    # keep the established lookback method as the default compatibility path.
    if accurate is None:
        accurate = os.getenv("VE_SHOT_REFINE_ACCURATE_SEEK", "0") == "1"
    lookback = 0.0 if accurate else REFINE_PRESEEK
    ss = max(0.0, f0 / fps - lookback)
    off = f0 / fps - ss
    with resource_slot("prepare", timeout=600):
        r = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-threads", "1",
             "-ss", f"{ss:.6f}", "-i", str(video),
             "-ss", f"{off:.6f}", "-fps_mode", "passthrough", "-frames:v", str(n),
             "-vf", "scale=64:36,format=gray", "-threads", "1", "-f", "rawvideo", "-"],
            capture_output=True, stdin=subprocess.DEVNULL, timeout=REFINE_TIMEOUT_SECONDS)
    if r.returncode != 0:
        return None
    buf = np.frombuffer(r.stdout, dtype=np.uint8)
    got = len(buf) // (64 * 36)
    if got < 4:
        return None
    return buf[:got * 64 * 36].reshape(got, 36, 64).astype(np.int16)


def refine_one_boundary(video: Path, t: float, fps: float, *, accurate: bool | None = None,
                        frame_decoder=None, prefer_existing: bool = False,
                        allowed_frame_range: tuple[int, int] | None = None) -> tuple[float, int, str]:
    """精修单个边界。返回 (新时刻, 位移帧数, hard|soft|unknown)。
    输出帧 i 对应源帧 f0+i; 最大帧间差在 k→k+1 之间 → 新镜头首帧 = f0+k+1。
    新时刻三位小数, 且保证 round(new_t*fps) 落回同一帧号(旧脚本半帧起点
    导致取整奇偶随机、444/1441 边界仍早 1 帧, 这里断言杜绝)。"""
    import numpy as np
    fc = round(t * fps)
    f0 = max(0, fc - REFINE_RADIUS)
    try:
        fr = (frame_decoder or _boundary_frames)(video, f0, 2 * REFINE_RADIUS + 1, fps, accurate=accurate)
    except (subprocess.TimeoutExpired, OSError, RuntimeBusy):
        fr = None
    if fr is None:
        return t, 0, "unknown"
    diffs = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    left, right = 0, len(diffs)-1
    if allowed_frame_range is not None:
        left = max(left, allowed_frame_range[0]-f0-1)
        right = min(right, allowed_frame_range[1]-f0-1)
    if left > right:
        return t, 0, "unknown"
    k = left + int(np.argmax(diffs[left:right+1]))
    existing = fc - f0 - 1
    if prefer_existing and left <= existing <= right and diffs[existing] >= REFINE_MIN_JUMP:
        # A verified jump at the proposed cut remains valid even when a nearby
        # flash has a larger jump. Preserve distinct one-frame inserts.
        k = existing
    if diffs[k] < REFINE_MIN_JUMP:
        return t, 0, "soft"
    nf = f0 + k + 1
    new_t = round(nf / fps, 3)
    if round(new_t * fps) != nf:
        # 只在 fps 极不规则时才可能出现; 宁可保留原边界也不写入对不上帧的时刻
        return t, 0, "unknown"
    return new_t, nf - fc, "hard"


def refine_boundaries(video: Path, shots: list[dict], fps: float, *, checkpoint: Path | None = None,
                      boundary_indices: set[int] | None = None, accurate: bool | None = None,
                      on_progress=None, frame_decoder=None, decoder_binding: dict | None = None,
                      prefer_existing: bool = False, bound_to_neighbors: bool = False) -> dict:
    """原地精修 shots 表全部内部边界(首镜头起点/末镜头终点不动), 返回统计块。
    相邻边界至少隔 min_len(默认 0.8s≈19 帧)而搜索半径 6 帧, 不会交叉;
    仍做单调性保护, 精修后若倒挂则放弃该边界的位移。"""
    shots.sort(key=lambda s: float(s["start"]))
    bounds = [float(s["start"]) for s in shots[1:]]
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError('refinement requires a positive finite FPS')
    selected = set(range(1, len(shots))) if boundary_indices is None else set(boundary_indices)
    if any(type(i) is not int or not 1 <= i < len(shots) for i in selected):
        raise ValueError('unknown refinement boundary')
    binding = {'version': REFINEMENT_VERSION, 'source': file_signature(video), 'fps': fps,
               'bounds': bounds, 'radius': REFINE_RADIUS, 'min_jump': REFINE_MIN_JUMP,
               'accurate_seek': accurate if accurate is not None else
                   os.getenv('VE_SHOT_REFINE_ACCURATE_SEEK', '0') == '1'}
    if frame_decoder is not None:
        if not decoder_binding:
            raise ValueError('custom frame decoder requires a cache binding')
        binding['frame_decoder'] = decoder_binding
    if prefer_existing:
        binding['prefer_existing_verified_jump'] = True
    if bound_to_neighbors:
        binding['nonoverlapping_neighbor_windows'] = True
    identity = hashlib.sha256(json.dumps(binding, sort_keys=True).encode()).hexdigest()
    record = {'schema': REFINEMENT_VERSION, 'binding': binding, 'binding_id': identity, 'results': {}}
    if checkpoint is not None and checkpoint.exists():
        previous = load_json(checkpoint)
        if previous.get('binding_id') != identity or previous.get('binding') != binding:
            raise ValueError('refinement checkpoint inputs changed')
        record = previous
    saved = record['results']
    for key, result in saved.items():
        if (not key.isdigit() or not 1 <= int(key) < len(shots)
                or not isinstance(result, list) or len(result) != 3
                or result[2] not in ('hard', 'soft', 'unknown')
                or not isinstance(result[0], (float, int)) or not math.isfinite(result[0])
                or type(result[1]) is not int
                or abs(result[0] - bounds[int(key)-1]) > (REFINE_RADIUS + 1) / fps):
            raise ValueError('invalid boundary checkpoint')
    pending = [i for i in sorted(selected) if str(i) not in saved or saved[str(i)][2] == 'unknown']
    reused = len(selected) - len(pending)
    prepare_limit = max(1, int(os.getenv("VE_RECAP_LIMIT_PREPARE") or DEFAULT_LIMITS["prepare"]))
    with ThreadPoolExecutor(max_workers=min(REFINE_WORKERS, prepare_limit)) as ex:
        options = {'accurate': accurate}
        if frame_decoder is not None:
            options['frame_decoder'] = frame_decoder
        if prefer_existing:
            options['prefer_existing'] = True
        def options_for(index):
            if not bound_to_neighbors:
                return options
            centers = (round(float(shots[index-1]['start'])*fps), round(bounds[index-1]*fps),
                       round(float(shots[index]['end'])*fps))
            # Adjacent windows have no shared integer cut position. Even one
            # frame flashes can be measured without both cuts choosing one peak.
            allowed = ((centers[0]+centers[1])//2+1, (centers[1]+centers[2])//2)
            return {**options, 'allowed_frame_range': allowed}
        futures = {ex.submit(refine_one_boundary, video, bounds[i-1], fps, **options_for(i)): i for i in pending}
        for future in as_completed(futures):
            i = futures[future]
            saved[str(i)] = list(future.result())
            record.update(updated_at=time.time(), selected_boundaries=sorted(selected))
            if checkpoint is not None:
                save_json(record, checkpoint)
            if on_progress:
                on_progress({'stage': 'refine_boundaries', 'done': sum(str(i) in saved for i in selected),
                             'total': len(selected), 'reused': reused})
    results = [saved.get(str(i), [bounds[i-1], 0, 'unknown']) if i in selected
               else [bounds[i-1], 0, 'unknown'] for i in range(1, len(shots))]
    shift_hist: Counter = Counter()
    kinds: Counter = Counter()
    reverted = 0
    for i, (new_t, shift, kind) in enumerate(results):
        prev_start = float(shots[i]["start"])
        next_end = float(shots[i + 1]["end"])
        # Short inserts can have overlapping search radii. Never collapse a shot,
        # even if both searches happen to choose the same stronger nearby cut.
        raw_next = bounds[i+1] if i+1 < len(bounds) else next_end
        if kind == "hard" and not (prev_start < new_t < min(next_end, raw_next)):
            new_t, shift, kind = bounds[i], 0, "unknown"
            reverted += 1
        shots[i + 1]["start"] = new_t
        shots[i]["end"] = new_t
        shots[i + 1]["boundary_in"] = kind
        kinds[kind] += 1
        if kind == "hard":
            shift_hist[shift] += 1
    for s in shots:
        s["dur"] = round(float(s["end"]) - float(s["start"]), 3)
    return {
        "method": ("frame-diff-local-jump-v1" if bound_to_neighbors else
                   "frame-diff-existing-jump-v1" if prefer_existing else "frame-diff-argmax-v2"),
        "radius_frames": REFINE_RADIUS,
        "min_jump": REFINE_MIN_JUMP,
        "fps_used": round(fps, 6),
        "n_boundaries": len(bounds),
        "n_hard": kinds.get("hard", 0),
        "n_soft": kinds.get("soft", 0),
        "n_unknown": kinds.get("unknown", 0),
        "n_reverted": reverted,
        "shift_hist": {str(k): v for k, v in sorted(shift_hist.items())},
        "selected_boundaries": sorted(selected), "reused_boundaries": reused,
        "checkpoint_binding_id": identity,
    }


def _summary(tl: dict, output_path: Path, *, reused: bool, elapsed: float) -> dict:
    # data 只放摘要不放整张 shots 表: 全片级时间轴动辄上千镜头, 塞进 MCP
    # 响应会撑爆上下文; 下游按契约读 output_json 文件。
    shots = tl.get("shots") or []
    return {
        "output_json": str(output_path),
        "reused": reused,
        "video": tl.get("video"),
        "duration": tl.get("duration"),
        "fps": tl.get("fps"),
        "segment_version": tl.get("segment_version"),
        "threshold": tl.get("threshold"),
        "min_len": tl.get("min_len"),
        "frame_skip": tl.get("frame_skip"),
        "n_shots": tl.get("n_shots"),
        "coverage_start": shots[0]["start"] if shots else None,
        "coverage_end": shots[-1]["end"] if shots else None,
        "refine": tl.get("refine"),
        "elapsed_seconds": elapsed,
    }


def _same_number(cached, requested: float) -> bool:
    # 缓存里的参数可能是 int/float/字符串混着来 (手编 JSON), 转不成数字按不匹配处理
    try:
        return float(cached) == float(requested)
    except (TypeError, ValueError):
        return False


def _same_int(cached, requested: int) -> bool:
    try:
        return int(cached) == int(requested)
    except (TypeError, ValueError):
        return False


def _number_arg(args: dict, name: str, default: float) -> float | ToolResult:
    value = args.get(name, default)
    # bool 是 int 子类, true 会被 float() 悄悄转成 1.0 — 显式拒绝
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return ToolResult(text=f"[ERROR] {name} must be a number", data={name: value})
    return float(value)


def _int_arg(args: dict, name: str, default: int) -> int | ToolResult:
    value = args.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        return ToolResult(text=f"[ERROR] {name} must be an integer", data={name: value})
    return value


# ---------------------------------------------------------------------------
# 以下辅助函数抄自 movie_cut pipeline/common.py 与 event_common.py
# (kit 不依赖 movie_cut 包, 语义保持一致)
# ---------------------------------------------------------------------------

def probe(path: str | Path) -> dict:
    """返回视频的 duration/width/height/fps 等元信息。"""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "format=duration:stream=width,height,r_frame_rate,codec_name",
        "-of", "json", str(path),
    ]
    # ffprobe 不认 -nostdin (那是 ffmpeg 的选项), 用 DEVNULL 达到同样效果:
    # MCP 走 stdio, 子进程绝不能碰继承的 stdin
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL, timeout=PROBE_TIMEOUT_SECONDS)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"ffprobe failed for {path}")
    info = json.loads(proc.stdout)
    streams = info.get("streams") or []
    if not streams:
        raise RuntimeError(f"no video stream in {path} (audio-only or unreadable container)")
    stream = streams[0]
    num, den = (stream.get("r_frame_rate", "30/1").split("/") + ["1"])[:2]
    fps = float(num) / float(den) if float(den) else 30.0
    return {
        "duration": float(info.get("format", {}).get("duration", 0.0)),
        "width": stream.get("width"),
        "height": stream.get("height"),
        "fps": round(fps, 3),
        # 帧号换算要用精确分数(23.976 三位小数在两小时片尾差 0.14 帧)
        "fps_num": int(num) if num.isdigit() else None,
        "fps_den": int(den) if den.isdigit() and int(den) else None,
        "codec": stream.get("codec_name"),
    }


def file_signature(path: str | Path | None) -> dict:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {"path": str(p), "missing": True}
    st = p.stat()
    return {"path": str(p.resolve()), "size": st.st_size,
            "mtime_ns": st.st_mtime_ns}


def load_json(path: str | Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(obj, path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                     prefix='.' + target.name + '-', delete=False) as f:
        temporary = Path(f.name)
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    try:
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
