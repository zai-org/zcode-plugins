#!/usr/bin/env python3
"""Shared constants, errors and low-level helpers for the delivery-video scripts."""

from __future__ import annotations

import glob
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

W, H, FPS = 1920, 1080, 30
LEAD = 0.15
TAIL = 0.45
PROFILE = "delivery-v1"
SPEED_MIN, SPEED_MAX = 0.3, 3.0
# Playback outside this band is legal but must be called out and disclosed in the note.
SPEED_NOTICE = (0.7, 1.5)
DEFAULT_LAYOUT = "fullbleed"
LAYOUTS = ("banded", "fullbleed")
# One narration segment should carry one thought; longer text only warns.
NARRATION_SOFT_MAX = 50
LATIN_WEIGHT = 0.3
SPEECH_UNITS_PER_SECOND = 4.2
# Width of a latin character in subtitle lines, in CJK-character units.
LATIN_WIDTH = 0.55
MAX_LINE = 24
MIN_EDGE_TTS = (7, 3, 1)
INTENTS = {"delivery", "feedback"}
SEGMENT_KINDS = ("shot", "card")
# Cards are static by design: the gate exempts their intervals from the freeze and
# silence scans, within these limits.
CARD_MIN, CARD_MAX, CARD_DEFAULT = 1.0, 8.0, 2.5
CARD_TITLE_MAX = 40
# Cards may take this share of the video. A narrated opening and a closing card are
# normal even in a short video, so up to CARD_SHORT_VIDEO_ALLOWANCE seconds are accepted
# regardless of the share — as long as the footage runs at least as long as the cards.
CARD_SHARE_MAX = 0.25
CARD_SHORT_VIDEO_ALLOWANCE = 8.0
# What a visual review must score, one 0..1 number each; "pass" needs every score at
# or above CRITIC_MIN_SCORE.
CRITIC_MIN_SCORE = 0.8
DIMENSIONS = (
    "subtitle_legibility",
    "subtitle_safe_margins",
    "interface_legibility",
    "composition",
    "business_content_alignment",
)
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

BUILD_NAME = re.compile(r"^screen_demo(?:-[A-Za-z0-9_-]+)?$")
SEGMENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
RATE = re.compile(r"^[+-]\d+%$")
EVIDENCE_KINDS = {"cdp-screencast", "browser-demo"}
DEMO_STAGE_KIND = "demo-stage-recording"
ALLOWED_SOURCES = {"browser", "window", "demo-stage"}
CLIPS_DIR = "clips"
# What the renderer writes itself. A take may not sit there: the renderer would
# overwrite it. Assembly files start with "_" because a segment id never does.
OUTPUT_DIRS = ("tts", "review", CLIPS_DIR, "quality_gate")
OUTPUT_FILES = (
    "screen_demo.mp4", "screen_demo.rendering.mp4", "timeline.json", "cover.png",
    "delivery.generated.md", "feedback.json", "feedback.generated.md", "visual-critic.json",
)
# Frame-count rounding and sparse last frames may fall this short before the
# render refuses the take; beyond it the tail would silently freeze.
PAD_TOLERANCE = 0.2

FONT_CANDIDATES = [
    # macOS. PingFang first; find_font picks its Simplified face by name.
    "/System/Library/Fonts/PingFang.ttc",
    str(Path.home() / "Library/Fonts/PingFang.ttc"),
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*.asset/AssetData/PingFang.ttc",
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

# Face 0 of the macOS collections is the Traditional-Chinese one (PingFang HK, Heiti TC),
# so the Simplified face has to be chosen by name.
FACE_FAMILIES = (
    "PingFang SC", "Heiti SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC",
    "Source Han Sans SC", "WenQuanYi Zen Hei", "Microsoft YaHei", "SimHei",
)
FACE_STYLES = ("Medium", "Regular", "Normal", "Book")
MAX_FACE_INDEX = 256


class RenderError(Exception):
    pass


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


def run_json(args: list[str]) -> dict:
    try:
        data = json.loads(run(args))
    except json.JSONDecodeError as exc:
        raise RenderError(f"ffprobe returned invalid JSON for {args[-1]}: {exc}") from exc
    if not isinstance(data, dict):
        raise RenderError(f"ffprobe returned no object for {args[-1]}")
    return data


def duration(path: Path) -> float:
    value = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(path)]).strip()
    try:
        return float(value)
    except ValueError as exc:
        raise RenderError(f"no duration: {path}") from exc


def probe_json(path: Path) -> dict:
    return run_json(["ffprobe", "-v", "error", "-print_format", "json",
                     "-show_streams", "-show_format", str(path)])


def probe_video(path: Path) -> tuple[int, int, float]:
    data = run_json([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration", "-of", "json", str(path),
    ])
    streams = data.get("streams") or []
    if not streams:
        raise RenderError(f"no video stream: {path}")
    value = (data.get("format") or {}).get("duration")
    if value in (None, "N/A"):
        raise RenderError(f"no duration: {path}")
    return int(streams[0]["width"]), int(streams[0]["height"]), float(value)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_sha256(payload: object) -> str:
    """Hash a JSON payload independent of key order and whitespace."""
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def is_renderer_output(relative: Path) -> bool:
    """True for a path (relative to the build) that the renderer writes itself.

    Compared case-insensitively: on a case-insensitive disk `CLIPS/x.mp4` and
    `clips/x.mp4` are the same file, so the stricter reading is the safe one.
    """
    parts = relative.parts
    if not parts:
        return False
    files = {name.casefold() for name in OUTPUT_FILES}
    dirs = {name.casefold() for name in OUTPUT_DIRS}
    return relative.as_posix().casefold() in files or parts[0].casefold() in dirs


def same_file_key(path: Path) -> str:
    """Key equal for two spellings of one file on a case-insensitive disk."""
    return unicodedata.normalize("NFC", str(Path(path).resolve())).casefold()


def write_text_atomic(path: Path, text: str) -> None:
    """Write through a sibling temp file and rename: a killed run leaves no half file."""
    part = path.with_name(path.name + ".tmp")
    part.write_text(text, encoding="utf-8")
    os.replace(part, path)


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


def font_path() -> str:
    for pattern in FONT_CANDIDATES:
        candidates = sorted(glob.glob(pattern)) if "*" in pattern else [pattern]
        for candidate in candidates:
            if Path(candidate).is_file():
                return candidate
    raise RenderError(
        "No CJK font found for labels and subtitles; install Noto Sans CJK "
        "(Linux: fonts-noto-cjk; Windows/macOS usually provide Microsoft YaHei "
        "or PingFang), then rerun preflight"
    )


def pick_face(faces: list[tuple[int, str, str]]) -> int:
    """Return the index of the first Simplified-Chinese face, else 0."""
    for family in FACE_FAMILIES:
        for style in FACE_STYLES:
            for index, face_family, face_style in faces:
                if (face_family, face_style) == (family, style):
                    return index
    return 0


def face_index(path: str) -> int:
    from PIL import ImageFont
    faces: list[tuple[int, str, str]] = []
    for index in range(MAX_FACE_INDEX):
        try:
            family, style = ImageFont.truetype(path, 16, index=index).getname()
        except OSError:
            break
        faces.append((index, family, style))
    return pick_face(faces)


_FACE_INDEX: dict = {}


def find_font(size: int):
    try:
        from PIL import ImageFont
    except ImportError as exc:
        raise RenderError('Pillow is not installed; run: pip install Pillow') from exc
    path = font_path()
    if path not in _FACE_INDEX:
        _FACE_INDEX[path] = face_index(path)
    try:
        return ImageFont.truetype(path, size, index=_FACE_INDEX[path])
    except OSError as exc:
        raise RenderError(f"could not load the CJK font {path}: {exc}") from exc


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


def feedback_errors(episode: dict, segments: list) -> list[str]:
    """Validate the optional feedback shape; delivery episodes stay unchanged."""
    errors: list[str] = []
    intent = episode.get("intent", "delivery")
    if not isinstance(intent, str) or intent not in INTENTS:
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
        if not isinstance(phase, str) or phase not in PHASE_LABELS:
            errors.append(
                f"{segment.get('id')}: phase must be one of {sorted(PHASE_LABELS)}, got {phase!r}"
            )
            continue
        phases.append(phase)
    if "actual" not in phases:
        errors.append("feedback episode needs at least one segment with phase 'actual'")
    return errors
