#!/usr/bin/env python3
"""Self-contained delivery-demo renderer: episode.json -> screen_demo.mp4.

Subcommands:
  render <build-dir>                    render all segments + run the built-in gate
  gate --video <mp4> --work <dir>       run the delivery gate on any mp4 (attachment gate)

Requires: python3.9+, ffmpeg & ffprobe on PATH,
`pip install "edge-tts>=7.3.1" Pillow`.

Fail-loud by design: bad episode.json, missing recordings, out-of-range speed,
narration redline hits and gate hard failures all abort with a nonzero exit.
"""

from __future__ import annotations

import argparse
import asyncio
import bisect
import importlib.metadata
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

W, H, FPS = 1920, 1080, 30
LEAD = 0.15
TAIL = 0.45
PROFILE = "delivery-v1"
SPEED_MIN, SPEED_MAX = 0.3, 3.0
LAYOUTS = ("banded", "fullbleed")
MAX_LINE = 24
MIN_EDGE_TTS = (7, 3, 1)
INTENTS = {"delivery", "feedback"}
SEVERITIES = {
    "blocker": ("P0 BLOCKER", (220, 38, 38)),
    "critical": ("P1 CRITICAL", (234, 88, 12)),
    "major": ("P2 MAJOR", (217, 119, 6)),
    "minor": ("P3 MINOR", (71, 85, 105)),
}
PHASE_LABELS = {
    "context": "CONTEXT",
    "repro": "REPRO",
    "actual": "ACTUAL",
    "expected": "EXPECTED",
    "impact": "IMPACT",
}
MAX_REPRO_STEPS = 12
REPRO_PANEL_LIMIT = 5

BREAK_AFTER = set("。！？；!?;")
SOFT_BREAK = set("，、,")

FONT_CANDIDATES = [
    # macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    # Linux (Noto CJK / WQY)
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
    str(Path.home() / "Library/Fonts/PingFang.ttc"),
    str(Path.home() / ".local/share/fonts/NotoSansCJK-Regular.ttc"),
    str(Path.home() / ".fonts/NotoSansCJK-Regular.ttc"),
    # Windows
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
]
if os.environ.get("WINDIR"):
    windows_fonts = Path(os.environ["WINDIR"]) / "Fonts"
    FONT_CANDIDATES[:0] = [
        str(windows_fonts / "msyh.ttc"),
        str(windows_fonts / "simhei.ttf"),
    ]

# Narration red lines for external deliveries. AI-cliche patterns abort the
# render; internal-jargon terms only warn because technical acceptance videos
# may legitimately quote real commands and evidence.
INTERNAL_TERMS = (
    "工作流", "管线", "pipeline", "接口", "数据库", "后端", "前端",
    "部署", "构建", "docker", "commit", "refactor",
)
AI_CLICHE_PATTERNS = (
    ("not-x-but-x cliche",
     re.compile(r"这[^。！？；\n，,]{0,4}不是[^。！？；\n]{1,40}[，,]?\s*(?:而是|是)")),
)


class RenderError(Exception):
    pass


def feedback_errors(episode: dict, segments: list) -> list[str]:
    """Validate the optional feedback shape; delivery episodes stay unchanged."""
    errors: list[str] = []
    intent = episode.get("intent", "delivery")
    if intent not in INTENTS:
        errors.append(f"intent must be one of {sorted(INTENTS)}, got {intent!r}")
        return errors
    issue = episode.get("issue")
    if intent == "delivery":
        if issue is not None and not isinstance(issue, dict):
            errors.append("issue must be an object when present")
        for segment in segments:
            if isinstance(segment, dict) and segment.get("phase") is not None:
                errors.append(
                    f"{segment.get('id')}: phase is only valid when intent is 'feedback'"
                )
        return errors
    if not isinstance(issue, dict):
        errors.append("intent 'feedback' requires an issue object")
        return errors
    for key in ("title", "severity", "expected", "actual"):
        value = issue.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"issue.{key} must be a non-empty string")
    severity = issue.get("severity")
    if isinstance(severity, str) and severity and severity not in SEVERITIES:
        errors.append(f"issue.severity must be one of {sorted(SEVERITIES)}, got {severity!r}")
    repro = issue.get("repro", [])
    if not isinstance(repro, list) or not all(
        isinstance(item, str) and item.strip() for item in repro
    ):
        errors.append("issue.repro must be an array of non-empty strings")
    elif len(repro) > MAX_REPRO_STEPS:
        errors.append(f"issue.repro supports at most {MAX_REPRO_STEPS} steps")
    phases: list[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        phase = segment.get("phase")
        if phase is None:
            continue
        if phase not in PHASE_LABELS:
            errors.append(
                f"{segment.get('id')}: phase must be one of {sorted(PHASE_LABELS)}, got {phase!r}"
            )
            continue
        phases.append(phase)
    if "actual" not in phases:
        errors.append("feedback episode needs at least one segment with phase 'actual'")
    return errors


def run(args: list[str]) -> str:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise RenderError(f"could not run {args[0]}: {exc}") from exc
    if result.returncode:
        raise RenderError(f"{args[0]} failed:\n{result.stderr[-2000:]}")
    return result.stdout


def duration(path: Path) -> float:
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                      "-of", "csv=p=0", str(path)]).strip())


_SIZE_CACHE: dict = {}


def video_size(path: Path) -> tuple[int, int]:
    key = str(path)
    if key not in _SIZE_CACHE:
        info = probe_json(path)
        stream = next((s for s in info.get("streams") or []
                       if s.get("codec_type") == "video"), None)
        if stream is None:
            raise RenderError(f"no video stream in {path}")
        _SIZE_CACHE[key] = (int(stream["width"]), int(stream["height"]))
    return _SIZE_CACHE[key]


def segment_filter(crop: list[int] | None, layout: str, speed: float,
                   seconds: float) -> str:
    """Per-segment ffmpeg vf chain.

    crop=None shows the whole recording — frame geometry is opt-in only, so a
    missing crop can never silently hide screen edges again. "banded" fits the
    frame into the 1800x866 content box above the subtitle band; "fullbleed"
    fits it onto the full 1920x1080 canvas (16:9 sources map 1:1).
    """
    parts = []
    if crop is not None:
        x, y, w, h = crop
        parts.append(f"crop={w}:{h}:{x}:{y}")
    if layout == "fullbleed":
        box, pad = f"scale={W}:{H}", f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2"
    else:
        box, pad = "scale=1800:866", f"pad={W}:{H}:(ow-iw)/2:66"
    parts.append(
        f"setpts={speed}*(PTS-STARTPTS),{box}:force_original_aspect_ratio=decrease"
        f":flags=lanczos,eq=brightness=-0.035,{pad}:color=0x10182b")
    parts.append(f"fps={FPS},tpad=stop_mode=clone:stop_duration={seconds}")
    return ",".join(parts)


def crop_error(segment_id: str, crop: object, src_w: int, src_h: int) -> str | None:
    """Single source of crop validation, shared with preflight."""
    if (not isinstance(crop, list) or len(crop) != 4
            or not all(isinstance(v, int) and not isinstance(v, bool) for v in crop)):
        return f"{segment_id}: crop must be [x, y, w, h] integers"
    x, y, w, h = crop
    if x < 0 or y < 0 or w <= 0 or h <= 0:
        return f"{segment_id}: crop has non-positive size or negative origin {crop}"
    if x + w > src_w or y + h > src_h:
        return f"{segment_id}: crop {crop} exceeds source {src_w}x{src_h}"
    return None


def check_crop_bounds(segment_id: str, crop: object, src: Path) -> list[int]:
    """Validate an explicitly declared crop against the real source pixels."""
    src_w, src_h = video_size(src)
    error = crop_error(segment_id, crop, src_w, src_h)
    if error:
        raise RenderError(error)
    return crop


def probe_json(path: Path) -> dict:
    return json.loads(run(["ffprobe", "-v", "error", "-print_format", "json",
                           "-show_streams", "-show_format", str(path)]))


def sha256(path: Path) -> str:
    import hashlib
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def feedback_content_sha256(feedback: dict) -> str:
    """Hash the normalized report fields, independent of JSON formatting."""
    import hashlib
    canonical = json.dumps(
        feedback, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def check_tools() -> None:
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing:
        raise RenderError(
            "missing required executable(s): "
            + ", ".join(missing)
            + "; install ffmpeg and make sure both binaries are on PATH"
        )


def check_pillow() -> None:
    try:
        importlib.metadata.version("Pillow")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RenderError('Pillow is not installed; run: pip install Pillow') from exc


def font_path() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    raise RenderError(
        "No CJK font found for labels and subtitles; install Noto Sans CJK "
        "(Linux: fonts-noto-cjk; Windows/macOS usually provide Microsoft YaHei "
        "or PingFang), then rerun preflight"
    )


def find_font(size: int):
    try:
        from PIL import ImageFont
    except ImportError as exc:
        raise RenderError('Pillow is not installed; run: pip install Pillow') from exc
    path = font_path()
    try:
        return ImageFont.truetype(path, size)
    except OSError as exc:
        raise RenderError(f"could not load the CJK font {path}: {exc}") from exc


def check_narration(text: str, segment_id: str) -> None:
    cliches = [name for name, pattern in AI_CLICHE_PATTERNS if pattern.search(text)]
    if cliches:
        raise RenderError(
            f"narration red line hit on {segment_id}: AI-cliche pattern "
            + ", ".join(cliches)
            + " -- rewrite as a plain factual statement from the viewer's perspective")
    for term in INTERNAL_TERMS:
        if term in text.lower() or term in text:
            print(f"WARN: narration for {segment_id} mentions internal jargon "
                  f"'{term}' -- fine for technical acceptance, remove it for "
                  "external deliveries", flush=True)


def check_edge_tts_version() -> None:
    try:
        raw = importlib.metadata.version("edge-tts")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RenderError(
            'edge-tts is not installed; run: pip install "edge-tts>=7.3.1" Pillow'
        ) from exc
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", raw)
    if not match:
        raise RenderError(f"cannot parse edge-tts version: {raw!r}")
    installed = tuple(int(part) for part in match.groups())
    if installed < MIN_EDGE_TTS:
        minimum = ".".join(str(part) for part in MIN_EDGE_TTS)
        raise RenderError(
            f"edge-tts {raw} is too old and is known to return HTTP 403; "
            f'install edge-tts>={minimum} with: pip install "edge-tts>={minimum}"'
        )


def align_clock(text: str, words: list[dict]) -> list[dict]:
    """Expand TTS word boundaries into character clocks using the original text.

    edge-tts WordBoundary events omit punctuation. Re-threading their timings
    through the source narration preserves commas and sentence ends so subtitle
    grouping can break where a viewer expects it.
    """
    if not words:
        return []
    chars: list[dict] = []
    cursor = 0
    previous_end = 0
    for word in words:
        token = str(word.get("char") or "")
        if not token:
            continue
        index = text.find(token, cursor)
        if index < 0:
            raise RenderError(
                f"TTS word boundary {token!r} is not present in narration {text!r}"
            )
        gap = text[cursor:index]
        for char in gap:
            if char.isspace():
                continue
            chars.append({"char": char, "start_ms": previous_end, "end_ms": previous_end})
        if (
            any(char.isspace() for char in gap)
            and token[0].isascii()
            and token[0].isalnum()
        ):
            chars.append(
                {"char": " ", "start_ms": previous_end, "end_ms": previous_end}
            )

        start = int(word.get("start_ms") or 0)
        end = max(start + 1, int(word.get("end_ms") or 0))
        for offset, char in enumerate(token):
            char_start = round(start + (end - start) * offset / len(token))
            char_end = round(start + (end - start) * (offset + 1) / len(token))
            chars.append(
                {"char": char, "start_ms": char_start, "end_ms": char_end}
            )
        cursor = index + len(token)
        previous_end = end

    for char in text[cursor:]:
        if not char.isspace():
            chars.append(
                {"char": char, "start_ms": previous_end, "end_ms": previous_end}
            )
    return chars


async def synth(segment: dict, voice: str, rate: str, build: Path):
    check_edge_tts_version()
    import edge_tts
    root = build / "tts"
    root.mkdir(exist_ok=True)
    mp3, clock = root / f"{segment['id']}.mp3", root / f"{segment['id']}.json"
    contract = {"text": segment["text"], "voice": voice, "rate": rate}
    if mp3.exists() or clock.exists():
        if not (mp3.exists() and clock.exists()):
            raise RenderError(f"incomplete narration cache: {segment['id']}")
        cached = json.loads(clock.read_text(encoding="utf-8"))
        if any(cached.get(k) != v for k, v in contract.items()):
            raise RenderError(
                f"narration cache mismatch for {segment['id']}: edit episode.json "
                "and delete tts/<id>.mp3/.json to re-synthesize")
        return mp3, align_clock(segment["text"], cached["words"])
    words, content = [], bytearray()
    stream = edge_tts.Communicate(segment["text"], voice, rate=rate, boundary="WordBoundary")
    async for chunk in stream.stream():
        if chunk["type"] == "audio":
            content.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({"char": chunk["text"],
                          "start_ms": chunk["offset"] // 10000,
                          "end_ms": (chunk["offset"] + chunk["duration"]) // 10000})
    if not words or not content:
        raise RenderError(f"no audio or word boundaries from TTS: {segment['id']}")
    mp3.write_bytes(content)
    clock.write_text(
        json.dumps({**contract, "words": words}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return mp3, align_clock(segment["text"], words)


def group_lines(chars: list[dict], max_line: int = MAX_LINE) -> list[list[dict]]:
    """Split word-clock chars into subtitle lines; keep latin words unbroken."""
    lines, current = [], []
    for index, char in enumerate(chars):
        current.append(char)
        nxt = chars[index + 1]["char"] if index + 1 < len(chars) else ""
        if char["char"].isascii() and char["char"].isalnum() \
                and nxt.isascii() and nxt.isalnum():
            continue
        if (char["char"] in BREAK_AFTER
                or len(current) >= max_line + 2
                or (len(current) >= max_line and char["char"] in SOFT_BREAK)):
            lines.append(current)
            current = []
    if current:
        lines.append(current)
    return lines


def render_segment(segment: dict, mp3: Path, chars: list[dict], build: Path,
                   feedback: dict | None = None, layout: str = "banded"):
    from PIL import Image, ImageDraw
    src = build / segment["shot"]
    if not src.is_file():
        raise RenderError(f"missing real recording: {src}")
    start, end = float(segment["start"]), float(segment["end"])
    if not 0 <= start < end <= duration(src) + 0.1:
        raise RenderError(f"invalid recording interval: {segment['id']}")
    seconds = math.ceil((duration(mp3) + LEAD + TAIL) * FPS) / FPS
    frames = round(seconds * FPS)
    speed = (end - start) / seconds
    if not SPEED_MIN <= speed <= SPEED_MAX:
        raise RenderError(
            f"recording speed {speed:.2f}x outside {SPEED_MIN}x..{SPEED_MAX}x for "
            f"{segment['id']}: shorten the narration or widen the interval")
    crop = segment.get("crop")
    if crop is not None:
        crop = check_crop_bounds(segment["id"], crop, src)
    vf = segment_filter(crop, layout, seconds / (end - start), seconds)
    decode = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(end - start),
         "-i", str(src), "-vf", vf, "-frames:v", str(frames),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output = build / f"{segment['id']}.mp4"
    encode = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0", "-an", "-t", str(seconds),
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
         str(output)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    lines = group_lines(chars)
    starts = [line[0]["start_ms"] for line in lines]
    font, label_font, case_font = find_font(48), find_font(32), find_font(30)
    panel_font, panel_head_font = find_font(24), find_font(18)
    repro_steps = list((feedback or {}).get("repro") or [])
    show_repro = bool(feedback) and segment.get("phase") == "repro" and bool(repro_steps)
    case = PHASE_LABELS.get(segment.get("phase", ""), "") if feedback else segment.get("case", "")
    severity = SEVERITIES.get((feedback or {}).get("severity", ""), ("", None))
    try:
        for frame_index in range(frames):
            content = decode.stdout.read(W * H * 3)
            if len(content) != W * H * 3:
                raise RenderError(
                    f"recording decoder ended at frame {frame_index}/{frames}: "
                    "interval beyond the source")
            frame = Image.frombytes("RGB", (W, H), content)
            draw = ImageDraw.Draw(frame)
            label_x = 82
            if severity[1] is not None:
                severity_right = 56 + draw.textlength(severity[0], font=case_font) + 28
                draw.rounded_rectangle((56, 12, severity_right, 56), radius=8, fill=severity[1])
                draw.text((56 + 14, 34), severity[0], font=case_font, fill="white", anchor="lm")
                label_x = severity_right + 12
            if case:
                case_right = label_x + draw.textlength(case, font=case_font) + 28
                draw.rounded_rectangle((label_x - 4, 12, case_right, 56), radius=8,
                                       fill=(37, 99, 235))
                draw.text((label_x + 10, 34), case, font=case_font, fill="white", anchor="lm")
                label_x = case_right + 12
            draw.text((label_x, 34), segment["label"], font=label_font,
                      fill=(190, 206, 230), anchor="lm")
            if show_repro:
                draw_repro_panel(draw, repro_steps, panel_font, panel_head_font)
            t = frame_index / FPS * 1000 - LEAD * 1000
            index = bisect.bisect_right(starts, t) - 1
            if index >= 0 and t <= lines[index][-1]["end_ms"] + 180:
                text = "".join(c["char"] for c in lines[index])
                if layout == "fullbleed":
                    tw = draw.textlength(text, font=font)
                    draw.rounded_rectangle(
                        ((W - tw) / 2 - 26, 1008 - 34, (W + tw) / 2 + 26, 1008 + 34),
                        radius=12, fill=(16, 24, 43))
                draw.text((W / 2, 1008), text, font=font, fill="white", anchor="mm")
            encode.stdin.write(frame.tobytes())
    finally:
        decode.stdout.close()
        encode.stdin.close()
    decode_error = decode.stderr.read().decode()
    encode_error = encode.stderr.read().decode()
    if decode.wait() or encode.wait():
        raise RenderError(f"video encoding failed:\n{decode_error}\n{encode_error}")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3),
         "-af", "adelay=150:all=1,apad", "-t", str(seconds),
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
         str(output.with_suffix(".wav"))])
    print(f"RENDERED {segment['id']}: {seconds:.2f}s {speed:.2f}x", flush=True)
    return output, seconds


def draw_repro_panel(draw, steps: list, font, head_font) -> None:
    visible = steps[:REPRO_PANEL_LIMIT]
    omitted = len(steps) - len(visible)
    width, line_h = 520, 34
    height = 62 + line_h * len(visible) + (line_h if omitted else 0) + 10
    right, top = W - 56, 92
    left = right - width
    draw.rounded_rectangle((left, top, right, top + height), radius=10, fill=(16, 26, 46))
    draw.text((left + 18, top + 22), "REPRO STEPS", font=head_font,
              fill=(150, 176, 214), anchor="lm")
    y = top + 52
    for index, step in enumerate(visible):
        text = f"{index + 1}. {step}"
        if len(text) > 34:
            text = text[:33] + "..."
        draw.text((left + 18, y), text, font=font, fill=(236, 242, 250), anchor="lm")
        y += line_h
    if omitted:
        draw.text((left + 18, y), f"+{omitted} more", font=head_font,
                  fill=(150, 176, 214), anchor="lm")


def loudnorm_finalize(raw: Path, final: Path) -> None:
    """Two-pass loudnorm (single pass drifts 1-1.5 LU); video stream copied."""
    probe = subprocess.run(
        ["ffmpeg", "-i", str(raw), "-af",
         "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True)
    if probe.returncode:
        raise RenderError(f"loudness measurement failed:\n{probe.stderr[-1000:]}")
    meas = json.loads(probe.stderr[probe.stderr.rindex("{"):probe.stderr.rindex("}") + 1])
    af = ("loudnorm=I=-14:TP=-1.5:LRA=11:"
          f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
          f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:linear=true")
    run(["ffmpeg", "-y", "-i", str(raw), "-af", af, "-ar", "44100", "-ac", "2",
         "-c:a", "aac", "-b:a", "192k", "-c:v", "copy", str(final)])


def parse_detects(log: str, key: str) -> list[dict]:
    """Parse ffmpeg silencedetect/blackdetect/freezedetect key=value lines.

    blackdetect prints no space after the colon; silencedetect/freezedetect do.
    A span still open at EOF has *_start with no *_end (kept, closed by caller).
    """
    events, current = [], {}
    for line in log.splitlines():
        for match in re.finditer(r"(\w+)_start: ?([\d.]+)", line):
            current = {key: float(match.group(2))}
        for match in re.finditer(r"(\w+)_end: ?([\d.]+)", line):
            current["end"] = float(match.group(2))
            if "start" in current:
                events.append(current)
                current = {}
    if "start" in current:
        events.append(current)
    return events


def quality_gate(video: Path, work: Path) -> dict:
    """Deterministic delivery gate; hard failures make status=fail."""
    work.mkdir(parents=True, exist_ok=True)
    hard, warnings, notices, checks = [], [], [], {}
    info = probe_json(video)
    streams = info.get("streams") or []
    fmt = info.get("format") or {}
    total = float(fmt.get("duration") or 0)

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video_stream is None:
        hard.append({"code": "M100", "message": "no video stream"})
    else:
        wh = (video_stream.get("width"), video_stream.get("height"))
        if wh != (W, H):
            hard.append({"code": "M101", "message": f"resolution {wh}, expected {(W, H)}"})
        rate = video_stream.get("avg_frame_rate") or "0/1"
        num, _, den = rate.partition("/")
        fps = float(num) / float(den or 1)
        if abs(fps - FPS) > 0.01:
            hard.append({"code": "M102", "message": f"frame rate {fps:.3f}, expected {FPS}"})
        if video_stream.get("codec_name") != "h264":
            hard.append({"code": "M103", "message": f"codec {video_stream.get('codec_name')}, expected h264"})
        checks["spec"] = {"wh": list(wh), "fps": round(fps, 3),
                          "codec": video_stream.get("codec_name")}
    if audio_stream is None:
        hard.append({"code": "E101", "message": "no audio stream: render with narration"})
    elif audio_stream.get("codec_name") != "aac":
        warnings.append({"code": "E102",
                         "message": f"audio codec {audio_stream.get('codec_name')}, expected aac"})

    if total > 0:
        bits = int(fmt.get("size") or 0) * 8
        kbps = bits / total / 1000
        checks["bitrate_kbps"] = round(kbps)
        if kbps < 1000:
            notices.append({
                "code": "M111",
                "message": (
                    f"bitrate density {kbps:.0f} kbps is low for dense 1080p "
                    "content; inspect text at 1:1 before publishing"
                ),
            })

    if audio_stream is not None:
        ebur = subprocess.run(
            ["ffmpeg", "-i", str(video), "-filter_complex",
             "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
            capture_output=True, text=True)
        if ebur.returncode == 0 and "{" in ebur.stderr:
            meas = json.loads(ebur.stderr[ebur.stderr.rindex("{"):ebur.stderr.rindex("}") + 1])
            integrated = float(meas.get("input_i", "0") or 0)
            checks["loudness_lufs"] = integrated
            if not -30 <= integrated <= -5:
                hard.append({"code": "L101",
                             "message": f"integrated loudness {integrated:.1f} LUFS outside [-30,-5]"})
        filters = {
            "black": (["-vf", "blackdetect=d=0.5:pix_th=0.05", "-an"], 1.0, 0.3, "B101"),
            "freeze": (["-vf", "freezedetect=n=-60dB:d=0.5", "-an"], 2.0, 0.8, "T301"),
            "silence": (["-af", "silencedetect=n=-35dB:d=2", "-vn"], 5.0, 2.0, "E301"),
        }
        for name, (args, hard_s, warn_s, code) in filters.items():
            scan = subprocess.run(
                ["ffmpeg", "-v", "info", "-i", str(video), *args, "-f", "null", "-"],
                capture_output=True, text=True)
            spans = parse_detects(scan.stderr, "start")
            # freezedetect/blackdetect emit only *_start when the span runs to EOF
            if total > 0:
                for span in spans:
                    if "end" not in span:
                        span["end"] = max(span["start"], total)
            lengths = [s["end"] - s["start"] for s in spans if "end" in s]
            checks[f"{name}_spans"] = [
                {"start": round(s["start"], 2), "end": round(s.get("end", 0), 2)}
                for s in spans]
            if lengths:
                longest = max(lengths)
                if longest >= hard_s:
                    hard.append({"code": code,
                                 "message": f"longest {name} span {longest:.1f}s >= {hard_s}s at "
                                            + ", ".join(f"{s['start']:.1f}" for s in spans
                                                        if "end" in s and s["end"] - s["start"] == longest)})
                elif longest >= warn_s:
                    warnings.append({"code": code,
                                     "message": f"longest {name} span {longest:.1f}s"})
                if name == "freeze" and total > 0 and sum(lengths) / total >= 0.20:
                    hard.append({"code": "T304",
                                 "message": f"frozen frames are {sum(lengths)/total:.0%} of the video; cut waiting segments or raise playback speed"})
    status = "fail" if hard else "pass"
    score = max(0, 100 - 10 * len(hard) - 2 * len(warnings))
    report = {"profile": PROFILE, "status": status, "video": video.name,
              "video_sha256": sha256(video), "duration_s": round(total, 3),
              "hard_failures": hard, "warnings": warnings, "notices": notices,
              "score": {"total": score}, "checks": checks}
    (work / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def write_feedback_report(build: Path, issue: dict, segments: list[dict], report: dict) -> Path:
    payload = {
        "kind": "feedback",
        "issue": issue,
        "artifact": {
            "file": "screen_demo.mp4",
            "duration_s": report["duration_s"],
            "sha256": report["video_sha256"],
        },
        "gate": {
            "status": report["status"],
            "profile": report["profile"],
            "report": "quality_gate/report.json",
        },
        "segments": [
            {
                "id": segment["id"],
                "phase": segment.get("phase"),
                "shot": segment["shot"],
                "start": segment["start"],
                "end": segment["end"],
            }
            for segment in segments
        ],
    }
    path = build / "feedback.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def format_clock(seconds: float) -> str:
    total = int(round(float(seconds) * 1000))
    minutes, remainder = divmod(total, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{minutes:02d}:{secs:02d}.{millis:03d}"


def markdown_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def feedback_markdown(issue: dict, segments: list[dict], timeline: list[dict],
                      report: dict) -> str:
    issue_id = str(issue.get("id") or "").strip()
    heading = f"{issue_id} {issue['title']}".strip()
    severity = issue["severity"]
    severity_label = SEVERITIES[severity][0]
    phases = {
        segment["id"]: PHASE_LABELS.get(segment.get("phase", ""), "")
        for segment in segments
    }
    rows = []
    for item in timeline:
        rows.append(
            "| {phase} | {start}-{end} | `{source}` | {src_start:.2f}-{src_end:.2f}s |".format(
                phase=phases.get(item["id"], "") or "-",
                start=format_clock(item["start"]),
                end=format_clock(item["end"]),
                source=markdown_cell(item["source"]),
                src_start=float(item["source_start"]),
                src_end=float(item["source_end"]),
            )
        )
    repro = issue.get("repro") or []
    steps = "\n".join(f"{index + 1}. {step}" for index, step in enumerate(repro))
    environment = issue.get("environment")
    lines = [
        f"# {heading}",
        "",
        "> Draft generated by render.py from episode.json. Review it and add impact or "
        "business context before posting.",
        "",
        f"- Severity: `{severity}` ({severity_label})",
    ]
    if environment:
        lines.append(f"- Environment: {environment}")
    lines.extend([
        f"- Artifact: `screen_demo.mp4` ({report['duration_s']:.3f}s, "
        f"SHA256 `{report['video_sha256']}`)",
        f"- Quality gate: `{report['status']}` ({report['profile']}, "
        f"score {report['score']['total']})",
        "",
        "## Expected",
        "",
        issue["expected"],
        "",
        "## Actual",
        "",
        issue["actual"],
        "",
        "## Reproduction",
        "",
        steps or "No steps supplied.",
        "",
        "## Segments",
        "",
        "| Phase | In video | Source | Source range |",
        "| --- | --- | --- | --- |",
        *rows,
        "",
        "## Proven by this artifact",
        "",
        "- Every segment is a continuous take from the recording listed above.",
        "- The quality gate is bound to the artifact SHA256; the posted file must match it.",
        "",
        "## Not verified",
        "",
        "- Whether the defect is fixed in another build.",
        "- Whether other environments, accounts or data sets reproduce it.",
        "",
    ])
    return "\n".join(lines)


def write_feedback_markdown(build: Path, issue: dict, segments: list[dict],
                            timeline: list[dict], report: dict) -> Path:
    path = build / "feedback.generated.md"
    path.write_text(feedback_markdown(issue, segments, timeline, report), encoding="utf-8")
    return path


def feedback_binding(feedback: dict, markdown_path: Path) -> dict:
    return {
        "report": "feedback.json",
        "sha256": feedback_content_sha256(feedback),
        "markdown": markdown_path.name,
        "markdown_sha256": sha256(markdown_path),
    }


def bind_feedback_evidence(report_path: Path, report: dict, feedback_path: Path,
                           markdown_path: Path) -> dict:
    feedback = json.loads(feedback_path.read_text(encoding="utf-8"))
    binding = feedback_binding(feedback, markdown_path)
    report["feedback"] = binding
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return binding


def cmd_render(build: Path) -> int:
    check_tools()
    check_edge_tts_version()
    check_pillow()
    font_path()
    episode_path = build / "episode.json"
    if not episode_path.is_file():
        raise RenderError(f"missing {episode_path}")
    episode = json.loads(episode_path.read_text(encoding="utf-8"))
    segments = episode.get("segments") or []
    if not segments or len({s["id"] for s in segments}) != len(segments):
        raise RenderError("missing segments or duplicate segment IDs")
    rule_errors = feedback_errors(episode, segments)
    if rule_errors:
        raise RenderError("; ".join(rule_errors))
    feedback = episode.get("issue") if episode.get("intent") == "feedback" else None
    layout = episode.get("layout", "banded")
    if layout not in LAYOUTS:
        raise RenderError(f"episode layout must be one of {LAYOUTS}, got {layout!r}")
    for key in ("voice",):
        if not episode.get(key):
            raise RenderError(f"episode.json missing required field: {key}")
    for segment in segments:
        for key in ("id", "label", "shot", "start", "end", "text"):
            if key not in segment:
                raise RenderError(f"segment missing field {key!r}: {segment.get('id')}")
        if not isinstance(segment["text"], str) or "\n" in segment["text"]:
            raise RenderError(f"segment text must be one continuous line: {segment['id']}")
        check_narration(segment["text"], segment["id"])

    tracks, timeline, offset = [], [], 0.0
    for segment in segments:
        mp3, chars = asyncio.run(
            synth(segment, episode["voice"], episode.get("rate", "+5%"), build))
        clip, seconds = render_segment(segment, mp3, chars, build, feedback, layout)
        tracks.append(clip)
        timeline.append({"id": segment["id"], "start": round(offset, 3),
                         "end": round(offset + seconds, 3), "source": segment["shot"],
                         "source_start": segment["start"], "source_end": segment["end"]})
        offset += seconds

    concat = build / "clips.txt"
    concat.write_text("".join(f"file '{p.name}'\n" for p in tracks), encoding="utf-8")
    picture = build / "picture.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(picture)])
    voice_list = build / "voice-clips.txt"
    voice_list.write_text(
        "".join(f"file '{p.with_suffix('.wav').name}'\n" for p in tracks),
        encoding="utf-8",
    )
    voice = build / "voice.wav"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(voice_list), "-c:a", "pcm_s16le", str(voice)])
    assembled = build / "assembled.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(picture), "-i", str(voice),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
         "-ar", "44100", "-ac", "2", "-t", str(offset), str(assembled)])
    final = build / "screen_demo.mp4"
    loudnorm_finalize(assembled, final)
    if abs(duration(final) - offset) > 0.15:
        raise RenderError(f"final duration {duration(final):.3f}s != expected {offset:.3f}s")
    run(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", str(final),
         "-frames:v", "1", str(build / "cover.png")])
    for index, item in enumerate(timeline):
        run(["ffmpeg", "-y", "-v", "error",
             "-ss", str((item["start"] + item["end"]) / 2), "-i", str(final),
             "-frames:v", "1", str(build / f"preview_{index:02d}.png")])
    (build / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    report = quality_gate(final, build / "quality_gate")
    if feedback is not None:
        feedback_report_path = write_feedback_report(build, feedback, segments, report)
        markdown_path = write_feedback_markdown(build, feedback, segments, timeline, report)
        binding = bind_feedback_evidence(
            build / "quality_gate" / "report.json",
            report,
            feedback_report_path,
            markdown_path,
        )
        print(
            f"FEEDBACK {feedback_report_path} {markdown_path} "
            f"sha256={binding['sha256']} markdown_sha256={binding['markdown_sha256']}",
            flush=True,
        )
    print(f"COMPLETE {final} duration={duration(final):.3f}s "
          f"gate={report['status']} score={report['score']['total']}", flush=True)
    for notice in report["notices"]:
        print(f"NOTE {notice['code']}: {notice['message']}", flush=True)
    if report["status"] != "pass":
        for failure in report["hard_failures"]:
            print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
        return 1
    return 0


def cmd_gate(video: Path, work: Path) -> int:
    check_tools()
    if not video.is_file():
        raise RenderError(f"missing video: {video}")
    report = quality_gate(video, work)
    print(f"GATE={report['status'].upper()} video={video} "
          f"score={report['score']['total']} profile={report['profile']} "
          f"report={work / 'report.json'}", flush=True)
    for failure in report["hard_failures"]:
        print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
    for warning in report["warnings"]:
        print(f"WARN {warning['code']}: {warning['message']}", flush=True)
    for notice in report["notices"]:
        print(f"NOTE {notice['code']}: {notice['message']}", flush=True)
    return 0 if report["status"] == "pass" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    render_parser = sub.add_parser("render", help="render episode.json and run the gate")
    render_parser.add_argument("build", type=Path, help="build directory holding episode.json")
    gate_parser = sub.add_parser("gate", help="delivery gate for any mp4 (attachment gate)")
    gate_parser.add_argument("--video", type=Path, required=True)
    gate_parser.add_argument("--work", type=Path, required=True,
                             help="output directory for report.json")
    args = parser.parse_args()
    try:
        if args.command == "render":
            return cmd_render(args.build.expanduser().resolve())
        return cmd_gate(args.video.expanduser().resolve(), args.work.expanduser().resolve())
    except RenderError as exc:
        print(f"FAIL: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
