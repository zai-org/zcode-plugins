"""Shared video decoding and timed transcript helpers for video observation."""
from __future__ import annotations

import concurrent.futures as cf
import json
import math
import re
import shutil
import subprocess
import threading
from pathlib import Path

SPARSE_FPS = 0.5
SPARSE_MAX_FRAMES = 12
SEEK_THREADS = 8
ASR_LINE_SEC = 10.0
_probe_cache = {}
_sub_cache = {}
_cache_lock = threading.Lock()
_SRT_TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")


def _file_key(path: Path) -> tuple:
    st = path.stat()
    return (str(path.resolve()), st.st_size, st.st_mtime_ns, st.st_ctime_ns)

def fmt_ts(sec: float, ms: bool = False) -> str:
    sec = max(0.0, float(sec))
    whole = int(sec)
    h, r = divmod(whole, 3600)
    m, s = divmod(r, 60)
    core = f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"
    if not ms:
        return core
    frac = int(round((sec - whole) * 1000))
    if frac >= 1000:  # 四舍五入进位到下一秒
        return fmt_ts(whole + 1, ms=True)
    return f"{core}.{frac:03d}"


def probe(path: Path) -> dict:
    """时长 / 分辨率 / 有无音轨 / 文本字幕流序号（同一文件只 ffprobe 一次）。"""
    key = _file_key(path)
    with _cache_lock:
        if key in _probe_cache:
            return _probe_cache[key]
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate,sample_rate,channels"
         ":stream_tags=rotate:stream_side_data=rotation", "-of", "json", str(path)],
        capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {(r.stderr or r.stdout).strip()[-300:]}")
    d = json.loads(r.stdout or "{}")
    streams = d.get("streams") or []
    vs = [s for s in streams if s.get("codec_type") == "video"]
    subs = [s for s in streams if s.get("codec_type") == "subtitle"
            and s.get("codec_name") not in ("hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle")]
    try:
        duration = float((d.get("format") or {}).get("duration"))
    except (TypeError, ValueError):
        duration = 0.0
    rotation = _rotation(vs[0]) if vs else 0
    width, height = (vs[0].get("width"), vs[0].get("height")) if vs else (None, None)
    if rotation % 180 == 90:
        # ffmpeg autorotates on decode, so frames, filters and renders see the display
        # size; phone footage was laid out as landscape from the coded size.
        width, height = height, width
    info = {
        "duration": duration,
        "width": width,
        "height": height,
        "rotation": rotation,
        "has_video": bool(vs),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "subtitle_streams": [int(s["index"]) for s in subs if "index" in s],
        "video_streams": vs,
        "audio_streams": [s for s in streams if s.get("codec_type") == "audio"],
        "streams": streams,
        "fps": _frame_rate(vs[0]) if vs else None,
    }
    with _cache_lock:
        _probe_cache[key] = info
    return info


def _rotation(stream: dict) -> int:
    for side in stream.get("side_data_list") or []:
        if side.get("rotation") is not None:
            try:
                return int(round(float(side["rotation"]))) % 360
            except (TypeError, ValueError):
                pass
    try:
        return int(round(float((stream.get("tags") or {}).get("rotate")))) % 360
    except (TypeError, ValueError):
        return 0


def _ffmpeg(args: list[str], timeout: float = 900) -> subprocess.CompletedProcess:
    r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", *args],
                       capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors="replace")[-800:])
    return r


def _scale(width: int) -> str:
    # 不放大小视频；-2 保证高度为偶数
    return f"scale='min({width},iw)':-2"


def _one_frame(path: Path, t: float, width: int, out: Path) -> bool:
    """单次 seek 抽一帧到 out（片尾附近可能抽不到，返回 False）。"""
    try:
        _ffmpeg(["-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-update", "1", "-vf", _scale(width),
                 "-q:v", "4", str(out)], timeout=120)
    except (RuntimeError, subprocess.TimeoutExpired):
        return False
    return out.is_file() and out.stat().st_size > 0


def sample_times(start_s: float, end_s: float, fps: float) -> list[float]:
    """[start_s, end_s) 上按 fps 的采样时刻（从区间起点开始每 1/fps 秒一帧）。"""
    span = end_s - start_s
    if span <= 0 or fps <= 0:
        return []
    n = max(1, int(math.ceil(span * fps - 1e-9)))
    return [start_s + k / fps for k in range(n) if start_s + k / fps < end_s + 1e-6]


def extract_frames(path: Path, start_s: float, end_s: float, fps: float, width: int,
                   out_dir: Path) -> list[tuple[float, Path]]:
    """抽帧到 out_dir，返回 [(t_sec, jpg_path)]（文件名已带标签）。"""
    times = sample_times(start_s, end_s, fps)
    if not times:
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    label_ms = fps > 1

    def final_name(k: int, t: float) -> Path:
        return out_dir / f"{k:04d}_{fmt_ts(t, ms=label_ms).replace(':', '-')}.jpg"

    if fps < SPARSE_FPS or len(times) <= SPARSE_MAX_FRAMES:
        # 稀疏：每帧一次 seek 并行抽，远比解码整段便宜
        targets = [final_name(k, t) for k, t in enumerate(times)]
        with cf.ThreadPoolExecutor(SEEK_THREADS) as ex:
            oks = list(ex.map(lambda a: _one_frame(path, a[0], width, a[1]), zip(times, targets)))
        return [(t, p) for t, p, ok in zip(times, targets, oks) if ok]
    # 密集：-ss 放在 -i 前做关键帧 seek，再按 fps 滤镜整段解码一次
    tmp = out_dir / ".dense"
    tmp.mkdir(exist_ok=True)
    try:
        # round=up + start_time=0: output k is the source frame at or just before
        # start_s + k/fps. The filter default (round=near) emitted the frame half a
        # sampling interval later than the time each image is labelled with.
        _ffmpeg(["-ss", f"{start_s:.3f}", "-t", f"{end_s - start_s:.3f}", "-i", str(path),
                 "-vf", f"fps={fps:.6g}:round=up:start_time=0,{_scale(width)}", "-q:v", "4",
                 # The image2 muxer reads every "%" as a pattern; only the file name is one.
                 str(tmp).replace("%", "%%") + "/f%05d.jpg"])
        files = sorted(tmp.glob("f*.jpg"))[: len(times)]
        out = []
        for k, f in enumerate(files):
            t = start_s + k / fps
            dst = final_name(k, t)
            f.replace(dst)
            out.append((t, dst))
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _srt_seconds(text: str) -> float:
    m = _SRT_TIME.search(text)
    if not m:
        raise ValueError(text)
    h, mi, s, frac = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(frac.ljust(3, "0")) / 1000


def parse_srt(srt: str) -> list[dict]:
    """Parse timed subtitle text into segments."""
    items = []
    for block in re.split(r"\r?\n\s*\r?\n", srt.strip()):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            continue
        a, _, b = lines[idx].partition("-->")
        try:
            start, end = _srt_seconds(a), _srt_seconds(b)
        except ValueError:
            continue
        text = " ".join(ln.strip() for ln in lines[idx + 1:])
        text = re.sub(r"<[^>]+>|\{\\[^}]*\}", "", text).strip()
        if text:
            items.append({"text": text, "start_time": start, "end_time": end})
    return items


def subtitle_items(path: Path, info: dict) -> list[dict] | None:
    """Read the first embedded text subtitle stream."""
    if not info["subtitle_streams"]:
        return None
    key = _file_key(path)
    with _cache_lock:
        if key in _sub_cache:
            return _sub_cache[key]
    try:
        r = _ffmpeg(["-i", str(path), "-map", f"0:{info['subtitle_streams'][0]}", "-f", "srt", "pipe:1"], timeout=120)
        items = parse_srt(r.stdout.decode("utf-8", errors="replace")) or None
    except (RuntimeError, subprocess.TimeoutExpired):
        items = None
    with _cache_lock:
        _sub_cache[key] = items
    return items


def format_transcript(items: list[dict], start_s: float, end_s: float, line_sec: float = ASR_LINE_SEC) -> str:
    """约 line_sec 秒一行、行首 [MM:SS]；区间内没有内容时返回空串。"""
    sel = [w for w in items if w["end_time"] >= start_s and w["start_time"] < end_s]
    lines, cur, cur_t0 = [], [], 0.0
    for w in sel:
        if cur and w["start_time"] - cur_t0 >= line_sec:
            lines.append(f"[{fmt_ts(cur_t0)}] " + " ".join(cur))
            cur = []
        if not cur:
            cur_t0 = w["start_time"]
        cur.append(w["text"])
    if cur:
        lines.append(f"[{fmt_ts(cur_t0)}] " + " ".join(cur))
    return "\n".join(lines)



def _frame_rate(stream):
    for name in ("avg_frame_rate", "r_frame_rate"):
        try:
            value = stream.get(name) or "0/1"
            n, d = value.split("/") if "/" in value else (value, "1")
            fps = float(n) / float(d)
            if math.isfinite(fps) and fps > 0:
                return fps
        except (ValueError, ZeroDivisionError):
            pass
    return None
