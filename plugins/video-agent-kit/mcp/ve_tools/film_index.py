"""Movie indexing with concurrent, source-bound ASR and shot detection.

Uncached native ASR calls its speech service. New coarse-first movie profiles
retain candidate thumbnails during detection and checkpoint coarse boundaries.
Dialogue clusters and ASR gaps locate material; they do not establish scenes or
visual facts. container_recap samples and observes the coarse scene index;
profiles without coarse-first shots keep the window/frame planning below.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import arrange, media, shots as shots_mod
from .result import ToolResult
from .run_context import RunContext
from .recap_runtime_state import RuntimeBusy, stage_run, resource_slot
from .creation_planning import file_digest

SCHEMA_VERSION = "2.0-film-index-native-observe"
SILENT_GAP_SEC = 30.0    # 超过此秒数无台词 → 空窗(排雷区)
SUB_SPLIT_GAP = 15.0     # 事件窗内部再细分的台词间隔
MAX_WIN_SEC = 180.0      # 单窗上限, 太长一次看不完
MIN_WIN_FRAMES = 3       # 事件窗保底帧数
LONG_SHOT_SEC = 15.0     # 空窗内长镜头保底帧阈值
SILENT_DENSITY = 5.0     # 空窗密度封顶: 1 帧 / 5 秒
EVENT_DENSITY = 6.0      # 事件窗密度封顶: 1 帧 / 6 秒
MAX_FRAMES = 1200        # 全片抽帧封顶(约 50 张拼图)
BATCH_FRAMES = 40        # 观看批次帧数上限(一批一次 watch 调用)


def _load_json(path: Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _have(ctx: RunContext, rel: str) -> bool:
    p = ctx.resolve(rel)
    return p.exists() and p.stat().st_size > 0


def _cluster_windows(rows: list[dict], film_end: float) -> list[dict]:
    """台词行 → 事件窗/空窗序列(按时间, 覆盖全片有意义区段)。"""
    wins: list[dict] = []
    if not rows:
        if film_end > SILENT_GAP_SEC:
            wins.append({"kind": "silent", "t0": 0.0, "t1": film_end, "dlg": []})
        return wins
    rows = sorted(rows, key=lambda r: float(r["start"]))
    # 片头空窗
    first_t = float(rows[0]["start"])
    if first_t > SILENT_GAP_SEC:
        wins.append({"kind": "silent", "t0": 0.0, "t1": first_t, "dlg": []})
    cur = [rows[0]]
    prev_end = min(float(rows[0].get("end", rows[0]["start"])),
                   float(rows[0]["start"]) + 30.0)

    def flush(cluster: list[dict]) -> None:
        # 事件窗: 内部按 SUB_SPLIT_GAP / MAX_WIN_SEC 细分
        sub: list[dict] = [cluster[0]]
        subs: list[list[dict]] = [sub]
        for a, b in zip(cluster, cluster[1:]):
            a_end = min(float(a.get("end", a["start"])), float(a["start"]) + 30.0)
            span = float(b["start"]) - float(sub[0]["start"])
            if float(b["start"]) - a_end > SUB_SPLIT_GAP or span > MAX_WIN_SEC:
                sub = []
                subs.append(sub)
            sub.append(b)
        for s in subs:
            t0 = max(0.0, float(s[0]["start"]) - 3.0)
            t1 = min(film_end,
                     min(float(s[-1].get("end", s[-1]["start"])),
                         float(s[-1]["start"]) + 30.0) + 3.0)
            wins.append({"kind": "event", "t0": t0, "t1": max(t1, t0 + 2.0),
                         "dlg": [str(r["id"]) for r in s]})

    for r in rows[1:]:
        gap = float(r["start"]) - prev_end
        if gap > SILENT_GAP_SEC:
            flush(cur)
            wins.append({"kind": "silent", "t0": prev_end, "t1": float(r["start"]),
                         "dlg": []})
            cur = []
        cur.append(r)
        prev_end = max(prev_end, min(float(r.get("end", r["start"])),
                                     float(r["start"]) + 30.0))
    if cur:
        flush(cur)
    # 片尾空窗
    if film_end - prev_end > SILENT_GAP_SEC:
        wins.append({"kind": "silent", "t0": prev_end, "t1": film_end, "dlg": []})
    wins.sort(key=lambda w: w["t0"])
    return wins


def _evenly(items: list, k: int) -> list:
    """从有序列表均匀取 k 个(k>=len 时原样返回)。"""
    if k >= len(items) or k <= 0:
        return list(items) if k > 0 else []
    step = len(items) / k
    return [items[int(i * step)] for i in range(k)]


def _plan_frames(wins: list[dict], shot_rows: list[dict]) -> None:
    """按三层规则前两层给每窗填 frames; 就地修改 wins。

    密度设计(战狼2 实测校准): 空窗按镜头取帧但封 1 帧/SILENT_DENSITY 秒 ——
    战斗/追逐蒙太奇是每 2s 一个快切的无台词区, 逐镜取帧会一窗爆几十帧,
    而"这里在打仗"不需要每个快切都拍下来; 长镜头(>LONG_SHOT_SEC)保底 1 帧
    (长镜头常是无声叙事)。事件窗隔镜取帧再封 1 帧/EVENT_DENSITY 秒
    (台词已携带主信息)。超全局封顶时全场等比抽稀, 每窗保底。"""
    def shots_in(t0: float, t1: float) -> list[dict]:
        return [s for s in shot_rows
                if float(s["end"]) > t0 + 0.2 and float(s["start"]) < t1 - 0.2]

    def mid(s: dict, t0: float, t1: float) -> float:
        lo, hi = max(float(s["start"]), t0), min(float(s["end"]), t1)
        return round((lo + hi) / 2, 2)

    for w in wins:
        sl = shots_in(w["t0"], w["t1"])
        dur = w["t1"] - w["t0"]
        frames: list[dict] = []
        if w["kind"] == "silent":
            longs = [s for s in sl
                     if float(s["end"]) - float(s["start"]) > LONG_SHOT_SEC]
            cap = max(2, int(dur / SILENT_DENSITY), len(longs))
            for s in _evenly(sl, cap):
                frames.append({"shot_id": s["shot_id"], "t": mid(s, w["t0"], w["t1"])})
            have = {f["shot_id"] for f in frames}
            for s in longs:            # 长镜头保底, 均匀抽稀后可能被漏
                if s["shot_id"] not in have:
                    frames.append({"shot_id": s["shot_id"],
                                   "t": mid(s, w["t0"], w["t1"])})
        else:
            picked = sl[::2] if len(sl) > MIN_WIN_FRAMES else sl
            cap = max(MIN_WIN_FRAMES, int(dur / EVENT_DENSITY))
            picked = _evenly(picked, cap)
            for s in picked:
                frames.append({"shot_id": s["shot_id"], "t": mid(s, w["t0"], w["t1"])})
        frames.sort(key=lambda f: f["t"])
        w["frames"] = frames

    # 全局封顶: 全场等比抽稀, 空窗保底 2 帧、事件窗保底 MIN_WIN_FRAMES 帧
    total = sum(len(w["frames"]) for w in wins)
    if total > MAX_FRAMES:
        keep = MAX_FRAMES / total
        for w in wins:
            floor = 2 if w["kind"] == "silent" else min(MIN_WIN_FRAMES,
                                                        len(w["frames"]))
            k = max(floor, int(len(w["frames"]) * keep))
            w["frames"] = _evenly(w["frames"], k)


def _worker_context(ctx: RunContext) -> RunContext:
    """Independent worker context without mutating process-wide project settings."""
    return RunContext(ctx.session_kind, project_root=ctx.project_dir)


def build_film_index(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("input_path"):
        return ToolResult(text="[ERROR] input_path is required")
    source = ctx.resolve(args["input_path"])
    try:
        # Match the existing large-source cache convention without hashing a
        # multi-GB movie again on every short status/resume operation.
        stat = source.stat()
        version = {"path": str(source), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
        with stage_run(ctx.project_dir, "indexing", inputs={"source_signature": version, "options": args},
                       outputs=[ctx.resolve(args.get("output_json") or "out/film_index.json")]) as stage:
            result = _build_film_index(args, ctx)
            if result.text.startswith("[ERROR]") or (result.data or {}).get("warning"):
                stage.fail("indexing_incomplete")
            else:
                stage.complete()
            return result
    except RuntimeBusy as exc:
        return ToolResult(text=f"[ERROR] build_film_index busy: {exc}", data={"retryable": True})
    except (OSError, ValueError) as exc:
        return ToolResult(text=f"[ERROR] build_film_index state: {exc}")


def _build_film_index(args: dict, ctx: RunContext) -> ToolResult:
    input_path = args.get("input_path")
    if not input_path:
        return ToolResult(text="[ERROR] input_path is required")
    out_json = args.get("output_json") or "out/film_index.json"
    profile_path = ctx.resolve('out/production_profile.json')
    profile = _load_json(profile_path) if profile_path.is_file() else {}
    coarse_first = profile.get('shot_strategy') == 'coarse-first-v1'

    # ---- 子步链(产物存在即跳过 = 断点续跑) ----
    ran: list[str] = []
    r = media.probe_media({"input_path": input_path}, ctx)
    if r.text.startswith("[ERROR]"):
        return ToolResult(text="[ERROR] build_film_index/inspect: " + r.text, data=r.data)
    ran.append("inspect")
    def transcribe_source():
        t_args = {"input_path": input_path, "output_json": "out/transcript.json"}
        for k in ("language", "provider", "chunk_seconds", "work_dir"):
            if args.get(k) is not None:
                t_args[k] = args[k]
        source = ctx.resolve(input_path)
        signature = {"path": str(source), "sha256": file_digest(source)}
        transcript = ctx.resolve("out/transcript.json")
        with stage_run(ctx.project_dir, "source_asr", inputs={"source_signature": signature,
                       "options": t_args}, outputs=[transcript]) as stage:
            bound_cache = False
            if _have(ctx, "out/transcript.json"):
                try:
                    old = _load_json(transcript)
                    parameters = old.get("recognition_parameters", {})
                    bound_cache = (old.get("source_media") == str(source)
                                   and old.get("source_video_sha256") == signature["sha256"]
                                   and parameters.get("language") == t_args.get("language", "zh")
                                   and parameters.get("provider") == (t_args.get("provider") or "asr")
                                   and parameters.get("chunk_seconds") == t_args.get("chunk_seconds", media.ASR_CHUNK_SECONDS)
                                   and isinstance(old.get("segments"), list))
                except (OSError, ValueError, AttributeError):
                    pass
            if bound_cache:
                stage.complete()
                return ToolResult(text="Transcript cached", data={"reused": True})
            with resource_slot("asr"):
                result = media.transcribe(t_args, _worker_context(ctx))
            if result.failed:
                stage.fail("source_asr_failed")
            else:
                stage.complete()
            return result

    def detect_source():
        source = ctx.resolve(input_path)
        stat = source.stat()
        signature = {"path": str(source), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
        with stage_run(ctx.project_dir, "source_shots", inputs={"source_signature": signature,
                       "detection_version": (shots_mod.SEGMENT_VERSION_COARSE if coarse_first
                                             else shots_mod.SEGMENT_VERSION_REFINED)},
                       outputs=[ctx.resolve("out/shots.json")]) as stage:
            options = {'refine': False, 'min_len': 0, 'preserve_short_shots': True} if coarse_first else {}
            result = shots_mod.detect_shots({"input_path": input_path, **options}, _worker_context(ctx))
            if result.text.startswith("[ERROR]"):
                stage.fail("shot_detection_failed")
            else:
                stage.complete()
            return result

    # Cached stages retain source and option bindings. New movie profiles save
    # coarse boundaries and local candidate signals before any selected refinement.
    # ASR writes transcript.json/asr workdir; detection writes shots.json only.
    # Both readers get isolated RunContext memory. Join before dialogue indexing.
    failures = []
    with ThreadPoolExecutor(max_workers=2) as workers:
        futures = [("transcribe", workers.submit(transcribe_source)),
                   ("detect_shots", workers.submit(detect_source))]
        for name, future in futures:
            try:
                result = future.result()
            except Exception as exc:
                result = ToolResult(text=f"[ERROR] {type(exc).__name__}: {exc}")
            if result.text.startswith("[ERROR]"):
                failures.append((name, result))
            elif not (result.data or {}).get("reused"):
                ran.append(name)
    if failures:
        name, result = failures[0]
        return ToolResult(text=f"[ERROR] build_film_index/{name}: " + result.text,
                          data={**(result.data or {}), "completed_steps": ran,
                                "failed_steps": [name for name, _ in failures]})
    # Cheap deterministic derivation: always refresh it from the current ASR,
    # including resumes where detection failed after ASR had already completed.
    r = arrange.arrange_footage(
        {"action": "dialogue", "transcript_path": "out/transcript.json"}, ctx)
    if r.text.startswith("[ERROR]"):
        return ToolResult(text="[ERROR] build_film_index/dialogue: " + r.text, data=r.data)
    ran.append("dialogue")

    # ---- 看片计划 ----
    try:
        dlg = _load_json(ctx.resolve("out/dialogue_index.json"))
        timeline = _load_json(ctx.resolve("out/shots.json"))
    except Exception as exc:
        return ToolResult(text=f"[ERROR] failed to load products: {exc}")
    shot_rows = sorted(timeline.get("shots", []), key=lambda s: float(s["start"]))
    if not shot_rows:
        return ToolResult(text="[ERROR] shots.json has no shots")
    film_end = float(shot_rows[-1]["end"])
    if len(dlg) < 200 and film_end > 1800 and not coarse_first:
        # 台词驱动不适用的信号原样透传(与手册的回退规则一致)
        return ToolResult(
            text=f"[WARN] only {len(dlg)} dialogue lines for a "
                 f"{film_end / 60:.0f}-min film — dialogue-driven recap may not "
                 "apply; consider the generic video-edit-agent flow",
            data={"warning": "sparse_dialogue", "n_dlg": len(dlg)})

    wins = _cluster_windows(dlg, film_end)
    if coarse_first:
        for i, window in enumerate(wins, 1):
            window.update(win_id=f'W{i:04d}',
                          kind='asr_gap' if window['kind'] == 'silent' else 'dialogue_cluster')
        value = {'schema_version': '3.0-film-index-coarse-first', 'windows': wins,
                 'stats': {'n_shots': len(shot_rows), 'n_dlg': len(dlg), 'film_sec': film_end},
                 'candidate_cache': timeline.get('candidate_cache'),
                 'scope': 'temporal_candidates_only; organize scenes after visual observation'}
        out_path = ctx.resolve(out_json)
        shots_mod.save_json(value, out_path)
        return ToolResult(text='Coarse movie index ready. Run container_recap.py plan, then observe. '
                          'Production refines the shots it uses later.',
                          data={'stats': value['stats'], 'coarse_first': True,
                                'output': ctx.virtualize(out_path)}, artifacts=[str(out_path)])
    _plan_frames(wins, shot_rows)
    batch = 1
    batch_frames = 0
    for i, w in enumerate(wins, 1):
        w["win_id"] = f"W{i:04d}"
        w["t0"] = round(w["t0"], 2)
        w["t1"] = round(w["t1"], 2)
        # 观看批次: 连续窗口凑满 BATCH_FRAMES 帧为一批(一批一次 watch 调用),
        # 批内逐窗记笔记 —— 127 窗 127 次调用太碎, 按批看只要 ~30 次
        if batch_frames and batch_frames + len(w["frames"]) > BATCH_FRAMES:
            batch += 1
            batch_frames = 0
        w["batch"] = batch
        batch_frames += len(w["frames"])

    n_event = sum(1 for w in wins if w["kind"] == "event")
    n_silent = len(wins) - n_event
    n_frames = sum(len(w["frames"]) for w in wins)
    n_batches = max((w["batch"] for w in wins), default=0)
    silent_secs = sum(w["t1"] - w["t0"] for w in wins if w["kind"] == "silent")
    # Keep sampled frame locations as data; full-film observation uses container_recap.
    batches = []
    for bi in range(1, n_batches + 1):
        bw = [w for w in wins if w["batch"] == bi]
        batches.append({"batch": bi, "windows": [w["win_id"] for w in bw],
                        "frames": [f for w in bw for f in w['frames']]})
    stats = {"n_windows": len(wins), "n_event": n_event, "n_silent": n_silent,
             "n_frames": n_frames, "n_batches": n_batches,
             "film_sec": round(film_end, 1),
             "silent_sec": round(silent_secs, 1), "n_dlg": len(dlg),
             "n_shots": len(shot_rows)}
    out_path = ctx.resolve(out_json)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(
        {"schema_version": SCHEMA_VERSION, "windows": wins, "batches": batches,
         "stats": stats},
        ensure_ascii=False, indent=1), encoding="utf-8")

    return ToolResult(
        text=(f"Film index ready: {len(wins)} windows ({n_event} event / "
              f"{n_silent} silent, {silent_secs:.0f}s dialogue-free) · "
              f"{n_frames} planned frames in {n_batches} view batches · "
              f"{len(shot_rows)} shots · {len(dlg)} dialogue lines"
              + (f" · ran: {'+'.join(ran)}" if ran else " · all sub-products cached")
              + ". Next: follow video-recap-workflows; run container_recap.py plan/observe "
              "for full-film evidence, including silent windows. Use the native "
              "video_observe tool for local relook and save its evidence receipt."),
        data={"stats": stats, "output": ctx.virtualize(out_path)},
        artifacts=[str(out_path)])
