"""Subtitle style presets, font resolution, text measurement and ASS emission.

Everything here is deterministic and font-aware: cue widths are measured in real
pixels with the same font file libass will use at render time, so the segmenter
and the QC check agree with what actually lands on the frame. Falling back to
character counting is only a last resort when Pillow cannot open the font.
"""
from __future__ import annotations

import functools
import math
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any

from .run_context import clean_env, project_dir

# Preset defaults are expressed as ratios of the video height/width so one
# preset works for 1080x1920 shorts and 1920x1080 landscape alike.
PRESETS: dict[str, dict[str, Any]] = {
    # Vertical short-form look: one big bold line hugging the lower third,
    # punctuation stripped, sized so a phrase is readable on a phone.
    "shortform_zh": {
        "font_family": "Noto Sans SC",
        "font_weight": "bold",
        "font_size_ratio": 0.0330,
        "bold": True,
        "primary_colour": "&H00FFFFFF",
        "outline_colour": "&H00000000",
        "back_colour": "&H80000000",
        "border_style": 1,
        "outline_ratio": 0.0028,
        "shadow_ratio": 0.0012,
        "alignment": 2,
        "margin_h_ratio": 0.060,
        "margin_v_ratio": 0.150,
        "max_lines": 1,
        "max_cps": 9.0,
        "target_fill": 0.86,
        "min_duration": 0.70,
        "max_duration": 5.0,
        "min_gap": 0.06,
        "strip_end_punctuation": True,
        "keep_inner_punctuation": False,
        "shrink_floor": 0.90,
        "max_chars_per_line": 18,
    },
    # Conventional two-line broadcast/OTT subtitle: smaller, centred low,
    # punctuation preserved, stricter reading-speed budget.
    "broadcast": {
        "font_family": "Noto Sans SC",
        "font_weight": "medium",
        "font_size_ratio": 0.0260,
        "bold": False,
        "primary_colour": "&H00FFFFFF",
        "outline_colour": "&H00000000",
        "back_colour": "&H80000000",
        "border_style": 1,
        "outline_ratio": 0.0020,
        "shadow_ratio": 0.0010,
        "alignment": 2,
        "margin_h_ratio": 0.070,
        "margin_v_ratio": 0.055,
        "max_lines": 2,
        "max_cps": 9.0,
        "target_fill": 0.90,
        "min_duration": 0.85,
        "max_duration": 6.0,
        "min_gap": 0.08,
        "strip_end_punctuation": False,
        "keep_inner_punctuation": True,
        "shrink_floor": 1.0,
        "max_chars_per_line": 20,
    },
    # Latin-script two-line subtitle. The differences from `broadcast` are not
    # cosmetic: English reads far faster per character than Chinese (~14
    # non-space chars/s vs ~9) and a line is capped by *character count* long
    # before it is capped by pixel width — a 1920 px frame would otherwise fit
    # over a hundred characters on one unreadable line.
    "broadcast_en": {
        "font_family": "Noto Sans SC",
        "font_weight": "medium",
        "font_size_ratio": 0.0380,
        "bold": False,
        "primary_colour": "&H00FFFFFF",
        "outline_colour": "&H00000000",
        "back_colour": "&H80000000",
        "border_style": 1,
        "outline_ratio": 0.0022,
        "shadow_ratio": 0.0010,
        "alignment": 2,
        "margin_h_ratio": 0.100,
        "margin_v_ratio": 0.070,
        "max_lines": 2,
        "max_cps": 14.0,
        "target_fill": 0.88,
        "min_duration": 0.85,
        "max_duration": 6.0,
        "min_gap": 0.08,
        "strip_end_punctuation": False,
        "keep_inner_punctuation": True,
        "shrink_floor": 1.0,
        "max_chars_per_line": 42,
    },
}
DEFAULT_PRESET = "shortform_zh"

# Style keys a caller may override individually on top of a preset.
OVERRIDABLE = set(PRESETS[DEFAULT_PRESET]) | {
    "font_file",
    "font_size",
    "outline",
    "shadow",
    "margin_l",
    "margin_r",
    "margin_v",
    "readability",
    # --- advanced features (all off by default, backward compatible) ---
    "karaoke",              # bool: sweep each cue's text word-by-word as it is spoken
    "karaoke_sung_colour",  # ASS &HAABBGGRR of already-spoken text
    "karaoke_unsung_colour",# ASS colour of not-yet-spoken text
    "speaker_labels",       # bool: prefix each cue with its speaker's name/label
    "speaker_colours",      # dict speaker-key -> ASS colour, or "auto"
    "bilingual_scale",      # float: translation line size relative to the caption
    "bilingual_colour",     # ASS colour of the translation line
    "annotation_scale",     # float: note size relative to the caption
    "annotation_colour",    # ASS colour of the explanatory note text
}

# A colourblind-safe, high-contrast palette assigned to speakers in first-seen
# order when speaker_colours="auto". Values are ASS &HBBGGRR (no alpha = opaque).
SPEAKER_PALETTE = [
    "&H00FFFFFF",  # white
    "&H0066D9FF",  # amber
    "&H0080FF80",  # green
    "&H00FF9E6E",  # sky blue
    "&H00C0A0FF",  # pink
    "&H00E0E000",  # cyan
]

# `readability` is a one-word macro for the contrast treatment behind the text.
# It exists because a good box needs four coordinated ASS fields (border style,
# a semi-transparent outline colour, box padding scaled to the font, and the
# drop shadow turned off); a caller who sets only border_style=3 gets a heavy,
# cramped, fully-opaque slab. Naming the treatment lets subtitle_scout recommend
# it as one value and keeps the four fields consistent. Any field the caller
# also sets explicitly still wins over the macro.
READABILITY_MODES = ("outline", "heavy_outline", "box", "opaque_box")

# Weight name -> the font files we ship/expect, best match first. These are the
# Linux batch-image files the presets are tuned against; keep them first so an
# already-provisioned box resolves to the same file (and the same measured line
# breaks) as before.
_FONT_FILE_HINTS = {
    "black": ["NotoSansSC-900.ttf"],
    "bold": ["NotoSansSC-700.ttf"],
    "medium": ["NotoSansSC-500.ttf"],
    "regular": ["NotoSansSC-400.ttf", "PingFang.ttf"],
}
_FONT_DIRS = [Path("/root/.fonts"), Path("/usr/share/fonts")]

# --- platform font dirs -----------------------------------------------------
# macOS only has fontconfig if the user installed it by hand (and a conda
# fontconfig on PATH typically knows *no* fonts at all, so `fc-match` answers
# with an empty string); Windows has none. Both ship perfectly good CJK faces
# that the Linux-only lookup above never looked at, so `subtitle_build` failed
# with "no font file found for family 'Noto Sans SC'" on a machine with
# PingFang / 微软雅黑 sitting right there.
_OS = "macos" if sys.platform == "darwin" else "windows" if os.name == "nt" else "linux"


def _windows_font_dirs() -> list[Path]:
    dirs = [Path(os.environ.get("SystemRoot") or r"C:\Windows") / "Fonts"]
    local = os.environ.get("LOCALAPPDATA")
    if local:  # per-user installs (Windows 10+ "Install for me only")
        dirs.append(Path(local) / "Microsoft" / "Windows" / "Fonts")
    return dirs


_PLATFORM_FONT_DIRS: dict[str, list[Path]] = {
    "linux": [Path("/usr/local/share/fonts"), Path.home() / ".fonts", Path.home() / ".local/share/fonts"],
    "macos": [Path("/System/Library/Fonts"), Path("/System/Library/Fonts/Supplemental"),
              Path("/Library/Fonts"), Path.home() / "Library/Fonts"],
    "windows": _windows_font_dirs(),
}

# Stock CJK faces per weight on macOS / Windows (plus the distro Noto/Source Han
# packages), best first. Only consulted after the shipped hints and fontconfig
# have failed, so Linux resolution order is unchanged. .ttc collections hold
# every weight; libass picks the closest face to the requested Bold flag.
_PLATFORM_FONT_FILES = {
    "black": ["NotoSansCJK-Black.ttc", "NotoSansCJKsc-Black.otf", "SourceHanSansSC-Heavy.otf",
              "PingFang.ttc", "Hiragino Sans GB.ttc", "STHeiti Medium.ttc", "msyhbd.ttc", "simhei.ttf"],
    "bold": ["NotoSansCJK-Bold.ttc", "NotoSansCJKsc-Bold.otf", "SourceHanSansSC-Bold.otf",
             "PingFang.ttc", "Hiragino Sans GB.ttc", "STHeiti Medium.ttc", "msyhbd.ttc", "simhei.ttf"],
    "medium": ["NotoSansCJK-Medium.ttc", "NotoSansCJKsc-Medium.otf", "SourceHanSansSC-Medium.otf",
               "PingFang.ttc", "Hiragino Sans GB.ttc", "STHeiti Medium.ttc", "msyh.ttc", "simhei.ttf"],
    "regular": ["NotoSansCJK-Regular.ttc", "NotoSansCJKsc-Regular.otf", "NotoSansSC-Regular.otf",
                "SourceHanSansSC-Regular.otf", "PingFang.ttc", "Hiragino Sans GB.ttc",
                "STHeiti Light.ttc", "msyh.ttc", "simhei.ttf", "simsun.ttc", "Deng.ttf",
                "wqy-microhei.ttc", "wqy-zenhei.ttc", "DroidSansFallbackFull.ttf"],
}

# A libass `fontsdir=` is read file-by-file into memory. Beyond this much font
# data (or this many files) the directory is a platform font dir, not one of
# ours, and the selected font gets linked into a private dir instead — see
# libass_fontsdir.
_FONTSDIR_MAX_BYTES = 96 * 1024 * 1024
_FONTSDIR_MAX_FILES = 32

STRONG_PUNCT = "。！？!?…."
WEAK_PUNCT = "，、；：,;:—～~"
CLOSING_PUNCT = "”’）】》」』)]}"
ALL_PUNCT = STRONG_PUNCT + WEAK_PUNCT + CLOSING_PUNCT + "“‘（【《「『([{\"'"


def resolve_style(
    preset_name: str | None,
    overrides: dict[str, Any] | None,
    *,
    video_width: int,
    video_height: int,
) -> dict[str, Any]:
    """Merge preset + overrides and turn every ratio into an absolute pixel
    value against the real video size."""
    name = (preset_name or DEFAULT_PRESET).strip()
    if name not in PRESETS:
        raise ValueError(f"unknown subtitle preset: {name!r} (known: {sorted(PRESETS)})")
    style: dict[str, Any] = {"preset": name, **PRESETS[name]}
    explicit: set[str] = set()
    for key, value in (overrides or {}).items():
        if key not in OVERRIDABLE:
            raise ValueError(f"unknown style override: {key!r}")
        if value is not None:
            style[key] = value
            explicit.add(key)

    readability = style.get("readability")
    if readability is not None and str(readability) not in READABILITY_MODES:
        raise ValueError(
            f"unknown readability mode: {readability!r} (known: {list(READABILITY_MODES)})"
        )

    # Ratios resolve against height so the look is resolution-independent;
    # explicit absolute overrides always win.
    style.setdefault("font_size", max(12, round(video_height * float(style["font_size_ratio"]))))
    style.setdefault("outline", round(video_height * float(style["outline_ratio"]), 2))
    style.setdefault("shadow", round(video_height * float(style["shadow_ratio"]), 2))
    margin_h = round(video_width * float(style["margin_h_ratio"]))
    style.setdefault("margin_l", margin_h)
    style.setdefault("margin_r", margin_h)
    style.setdefault("margin_v", round(video_height * float(style["margin_v_ratio"])))

    # The readability macro runs after font_size exists (box padding scales to it)
    # but only fills fields the caller did not set by hand.
    _apply_readability(style, explicit)

    _validate_style_fields(style)
    style["font_size"] = int(style["font_size"])
    style["outline"] = float(style["outline"])
    style["shadow"] = float(style["shadow"])
    for key in ("margin_l", "margin_r", "margin_v"):
        style[key] = int(style[key])
    style["max_lines"] = int(style["max_lines"])
    style["max_chars_per_line"] = int(style.get("max_chars_per_line") or 0)

    if style.get("font_file") and not Path(str(style["font_file"])).is_file():
        # 此前不存在的 font_file 也能 build 成功 (cmap 读不到当 "未知=通过"), render 时
        # libass 用 fontconfig 兜底画别的字体, Style 行却写着请求的家族名
        raise ValueError(f"style.font_file does not exist: {style['font_file']}")
    font_file = style.get("font_file") or resolve_font_file(style["font_family"], style.get("font_weight"))
    if not font_file:
        raise ValueError(
            f"no font file found for family {style['font_family']!r}; "
            "install a CJK font or pass style.font_file explicitly"
        )
    style["font_file"] = str(font_file)
    # font_face reads nameID 16/1 via fontTools — of the Simplified-Chinese face
    # when the file is a collection (PingFang.ttc opens with "PingFang HK",
    # STHeiti with "Heiti TC"); the fc-scan route glued every face of a .ttc
    # together ("AR PL UMing CNAR PL UMing HK...") and libass then silently
    # dropped the whole subtitle track. The face index keeps PIL measuring the
    # same face libass will draw.
    face_index, family = font_face(str(font_file))
    style["font_family_resolved"] = family or style["font_family"]
    style["font_face_index"] = face_index
    style["video_width"] = int(video_width)
    style["video_height"] = int(video_height)
    # Horizontal room a line may occupy before it collides with the margins.
    style["usable_width_px"] = max(1, int(video_width) - style["margin_l"] - style["margin_r"])
    return style


def _apply_readability(style: dict[str, Any], explicit: set[str]) -> None:
    """Expand the `readability` macro into the concrete ASS contrast fields.

    Only fills a field the caller did not set by hand (tracked in `explicit`), so
    `{"readability":"box","outline":12}` yields a box with 12px padding, and a
    plain `border_style` override is never silently overwritten. `outline` here is
    box padding (BorderStyle 3 draws the fill in OutlineColour, `Outline` px of
    padding around the glyphs); the shadow is dropped so no BackColour slab trails
    the box.
    """
    mode = str(style.get("readability") or "outline")
    if mode == "outline":
        return
    font_size = float(style["font_size"])

    def put(key: str, value: Any) -> None:
        if key not in explicit:
            style[key] = value

    if mode in ("box", "opaque_box"):
        # Draw a clean vector rectangle behind the text (see _band_dialogue),
        # NOT BorderStyle 3: libass's BorderStyle-3 box hugs each glyph outline,
        # so the band's edges come out ragged/uneven (a notch at the right end,
        # wavy top where ascenders vary), which reads as "the black box looks
        # broken". A pixel-sized drawn rectangle is perfectly even every time.
        # The text keeps a thin outline (BorderStyle 1) so it stays crisp on the
        # band, and the drop shadow is dropped so nothing trails the box.
        put("border_style", 1)
        put("outline", max(1.5, round(font_size * 0.05, 2)))
        put("shadow", 0.0)
        # Band fill: semi-transparent black for `box` (footage reads through),
        # solid black for `opaque_box`. Consumed by _band_dialogue in build_ass.
        style["readability_band"] = "&H000000&"  # BGR black
        style["readability_band_alpha"] = "&H00&" if mode == "opaque_box" else "&H40&"
        put("outline_colour", "&H00000000")
    elif mode == "heavy_outline":
        # Keep the clean outline look but thicken the rim and add a shadow floor
        # so a white glyph never floats free on a mid-bright band.
        put("outline", round(float(style["outline"]) * 1.6, 2))
        put("shadow", round(max(float(style["shadow"]), font_size * 0.03), 2))


_ASS_COLOUR_RE = re.compile(r"^&H[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
_NUMERIC_FIELDS = {
    # 字段: (最小值, 最大值 或 None, 是否整数)
    "font_size": (8, 400, True),
    "outline": (0, 100, False),
    "shadow": (0, 100, False),
    "margin_l": (0, 4000, True),
    "margin_r": (0, 4000, True),
    "margin_v": (0, 4000, True),
    "max_lines": (1, 6, True),
    "max_chars_per_line": (0, 200, True),
    "alignment": (1, 9, True),
    "border_style": (1, 4, True),
    "max_cps": (1, 60, False),
    "min_duration": (0, 30, False),
}
_COLOUR_FIELDS = ("primary_colour", "outline_colour", "back_colour", "secondary_colour",
                  "karaoke_sung_colour", "karaoke_unsung_colour", "bilingual_colour", "annotation_colour")
_BOOLEAN_FIELDS = ("karaoke", "speaker_labels")


def _validate_style_fields(style: dict[str, Any]) -> None:
    """范围/类型校验并带字段名报错: 此前 font_size=0、max_lines=0、alignment=99、
    primary_colour="red" 都能 build 成功并产出异常 ASS; "big" 这类字符串只得到裸的
    `invalid literal for int()`。"""
    for key, (lo, hi, is_int) in _NUMERIC_FIELDS.items():
        if key not in style or style[key] is None:
            continue
        value = style[key]
        if isinstance(value, bool):
            raise ValueError(f"style.{key} must be a number, not a boolean")
        try:
            num = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"style.{key} must be a number, got {value!r}") from None
        if not math.isfinite(num):
            raise ValueError(f"style.{key} must be finite")
        if is_int and num != int(num):
            raise ValueError(f"style.{key} must be an integer, got {value!r}")
        if num < lo or (hi is not None and num > hi):
            raise ValueError(f"style.{key} must be in [{lo}, {hi}], got {value!r}")
        style[key] = int(num) if is_int else num
    for key in _COLOUR_FIELDS:
        if style.get(key) is None:
            continue
        if not isinstance(style[key], str) or not _ASS_COLOUR_RE.match(style[key].strip()):
            raise ValueError(f"style.{key} must be an ASS colour like &HAABBGGRR, got {style[key]!r}")
        style[key] = style[key].strip().upper().replace("&H", "&H", 1)
    # These values are written into ASS Style lines / override blocks verbatim.
    for key in _BOOLEAN_FIELDS:
        if style.get(key) is not None and not isinstance(style[key], bool):
            raise ValueError(f"style.{key} must be a boolean, got {style[key]!r}")
    scale = style.get("bilingual_scale")
    if scale is not None:
        if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 < scale <= 3:
            raise ValueError(f"style.bilingual_scale must be a number in (0, 3], got {scale!r}")
    colours = style.get("speaker_colours")
    if isinstance(colours, dict):
        for speaker, colour in colours.items():
            if not isinstance(colour, str) or not _ASS_COLOUR_RE.match(colour.strip()):
                raise ValueError(f"style.speaker_colours[{speaker!r}] must be an ASS colour like &HBBGGRR, got {colour!r}")
    elif colours is not None and colours != "auto":
        raise ValueError("style.speaker_colours must be an object of ASS colours or \"auto\"")


def _find_font_named(name: str, dirs: list[Path]) -> str | None:
    """Locate one filename: direct child first, then a recursive walk (distro
    packages bury the file under truetype/noto/..., the batch images drop it
    flat into /root/.fonts). Unreadable dirs are skipped, never raised."""
    for directory in dirs:
        candidate = directory / name
        if candidate.is_file():
            return str(candidate)
        if directory.is_dir():
            try:
                hit = next(directory.rglob(name), None)
            except OSError:
                continue
            if hit is not None and hit.is_file():
                return str(hit)
    return None


def _platform_font_dirs() -> list[Path]:
    """VE_FONT_DIRS -> this platform's font dirs -> the legacy Linux dirs, deduplicated."""
    seen: set[str] = set()
    out: list[Path] = []
    for d in [*font_dirs_from_env(), *_PLATFORM_FONT_DIRS[_OS], *_SYSTEM_FONT_DIRS, *_FONT_DIRS]:
        if str(d) not in seen:
            seen.add(str(d))
            out.append(d)
    return out


def _platform_cjk_font(weight: str) -> str | None:
    """The platform's own CJK face for `weight`, falling through to the regular
    list (a machine with one CJK face should still render bold text — libass
    synthesises the weight — rather than fail), then to the cmap-verified scan."""
    names = list(_PLATFORM_FONT_FILES.get(weight) or [])
    names += [n for n in _PLATFORM_FONT_FILES["regular"] if n not in names]
    dirs = _platform_font_dirs()
    for name in names:
        hit = _find_font_named(name, dirs)
        if hit and font_covers_text(hit, CJK_PROBE_TEXT):
            return hit
    found = find_cjk_font()
    return None if found.startswith("[ERROR]") else found


def resolve_font_file(family: str, weight: str | None = None) -> str | None:
    """Locate a concrete font file: shipped weight hints first (so we pick the
    intended weight rather than whatever fontconfig aliases to), then fc-match,
    then the platform's own CJK faces.

    The last step is what makes this work off Linux: macOS only has fontconfig
    if the user installed it, Windows never does, and both ship a CJK font the
    first two steps cannot see. The order is deliberate — an already-provisioned
    Linux box still resolves through the hints/fc-match it always did, so the
    measured line breaks do not shift under existing traces."""
    weight_key = (weight or "regular").lower()
    for name in _FONT_FILE_HINTS.get(weight_key, []):
        hit = _find_font_named(name, [*font_dirs_from_env(), *_FONT_DIRS])
        if hit:
            return hit
    if shutil.which("fc-match"):
        query = f"{family}:weight={weight}" if weight else family
        try:
            proc = subprocess.run(
                ["fc-match", "-f", "%{file}", query], capture_output=True, text=True, timeout=15
            )
            path = proc.stdout.strip()
        except Exception:
            path = ""
        # fc-match never fails: ask for an uninstalled Chinese family and it
        # hands back DejaVu Sans, which has no CJK glyphs at all (a conda
        # fontconfig with no fonts answers with nothing). Every preset here is
        # a Chinese subtitle preset, so a zero-CJK answer only stands when the
        # machine has no CJK face at all.
        if path and Path(path).is_file():
            if font_covers_text(path, CJK_PROBE_TEXT):
                return path
            return _platform_cjk_font(weight_key) or path
    return _platform_cjk_font(weight_key)


def font_family_of(font_file: Path) -> str | None:
    if not shutil.which("fc-scan"):
        return None
    try:
        proc = subprocess.run(
            ["fc-scan", "-f", "%{family[0]}\n", str(font_file)], capture_output=True, text=True, timeout=15
        )
    except Exception:
        return None
    # One line per face for a .ttc; the first face is the one libass matches.
    first = proc.stdout.strip().splitlines()[:1]
    return first[0].strip() if first and first[0].strip() else None


def _dir_font_load(directory: Path) -> tuple[int, int]:
    """(file count, total bytes) of the font files libass would read from
    `directory` as a fontsdir (direct children only, like libass itself)."""
    count = total = 0
    try:
        with os.scandir(directory) as it:
            for entry in it:
                if entry.name.startswith(".") or not entry.is_file():
                    continue
                if Path(entry.name).suffix.lower() not in _FONT_SUFFIXES:
                    continue
                count += 1
                total += entry.stat().st_size
    except OSError:
        return 0, 0
    return count, total


def libass_fontsdir(font_file: str | Path) -> str:
    """Directory to hand libass as `fontsdir=` so it can see `font_file`.

    libass reads *every* file in that directory into memory. That is fine for
    the kit's private font dirs (a handful of Noto weights) but not for a
    platform font dir: /System/Library/Fonts is ~470 MB in 80 files — measured
    at 1.9 s and 1 GB RSS per ffmpeg run — and C:\\Windows\\Fonts is larger.
    For a heavy directory the font is linked (copied where links are not
    allowed, e.g. Windows without developer mode) into
    <project>/.video_agent/fonts/<stem>/ and that directory is returned.
    Never raises: on any failure the parent directory is returned as before."""
    font = Path(font_file)
    parent = font.parent
    count, total = _dir_font_load(parent)
    if count <= _FONTSDIR_MAX_FILES and total <= _FONTSDIR_MAX_BYTES:
        return str(parent)
    try:
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", font.stem).strip("_") or "font"
        private = project_dir() / ".video_agent" / "fonts" / safe_stem
        private.mkdir(parents=True, exist_ok=True)
        link = private / font.name
        target = font.resolve()
        if link.is_symlink() and link.resolve() == target:
            return str(private)
        if link.exists() and not link.is_symlink() and link.stat().st_size == target.stat().st_size:
            return str(private)
        if link.exists() or link.is_symlink():
            link.unlink()
        try:
            os.symlink(target, link)
        except OSError:
            shutil.copy2(target, link)
        return str(private)
    except Exception:
        return str(parent)


@functools.lru_cache(maxsize=16)
def _pil_font(font_file: str, size: int, index: int = 0):
    try:
        from PIL import ImageFont

        return ImageFont.truetype(font_file, size, index=index)
    except Exception:
        return None


def text_width_px(text: str, style: dict[str, Any]) -> float:
    """Rendered width of one line in pixels, including the outline that libass
    draws outside the glyph box on both sides."""
    if not text:
        return 0.0
    font = _pil_font(str(style["font_file"]), int(style["font_size"]), int(style.get("font_face_index") or 0))
    if font is not None:
        try:
            glyph_width = float(font.getlength(text))
        except Exception:
            glyph_width = _fallback_width(text, style)
    else:
        glyph_width = _fallback_width(text, style)
    return glyph_width + 2.0 * float(style.get("outline") or 0.0)


def _fallback_width(text: str, style: dict[str, Any]) -> float:
    """Font-free estimate: full-width glyphs occupy one em, the rest ~half."""
    size = float(style["font_size"])
    return sum(size if is_wide(ch) else size * 0.52 for ch in text)


def is_wide(ch: str) -> bool:
    return unicodedata.east_asian_width(ch) in ("W", "F")


def display_units(text: str) -> float:
    """Speech-time weight of a string. CJK glyphs are roughly one syllable each;
    Latin letters are much faster per character; punctuation carries no speech
    but does buy a small pause."""
    total = 0.0
    for ch in text:
        if ch in ALL_PUNCT:
            total += 0.35
        elif is_wide(ch):
            total += 1.0
        elif ch.isspace():
            total += 0.15
        else:
            total += 0.38
    return total


def visible_char_count(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace() and ch not in ALL_PUNCT)


# --- ASS emission ---------------------------------------------------------

def ass_timestamp(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    centis = int(round(seconds * 100))
    hours, rest = divmod(centis, 360000)
    minutes, rest = divmod(rest, 6000)
    secs, cs = divmod(rest, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{cs:02d}"


# libass skips U+2060 (word joiner) when shaping, so it separates a literal backslash
# from the character that would otherwise complete a control sequence.
_WORD_JOINER = "\u2060"


def ass_escape(text: str) -> str:
    """Escape dialogue text: braces start override blocks, a backslash before
    N/n/h is a line break or hard space, and a leading space would be swallowed.

    libass has no escaped backslash: "\\\\" printed two backslashes and still turned
    "C:\\New" into "C:\\" + line break + "ew". A literal backslash is kept as typed and
    only detached from a following N/n/h/brace."""
    # A trailing backslash is detached too: callers append override blocks ("{\\kf..}"
    # between karaoke words) and "\\{" would turn that block into literal text.
    text = re.sub(r"\\(?=[Nnh{}]|$)", lambda _: "\\" + _WORD_JOINER, text)
    text = text.replace("{", "\\{").replace("}", "\\}")
    text = text.replace("\r", "").replace("\n", "\\N")
    if text.startswith(" "):
        text = "\\h" + text[1:]
    return text


def build_ass(cues: list[dict[str, Any]], style: dict[str, Any], *, title: str = "video-agent-kit") -> str:
    """Emit an ASS file for the cue list.

    A cue is a dict with `lines` (list of strings) plus `start`/`end`. Beyond
    that, four optional groups of fields unlock the advanced looks, and every
    one of them is ignored when absent, so a plain caption cue renders exactly
    as before:

    - `role: "annotation"` renders under a separate top-of-frame Note style
      instead of the bottom caption style — used for glossary / context notes.
    - `speaker_prefix` / `speaker_colour` prepend a name tag and tint the cue,
      for multi-speaker dialogue.
    - `translation_lines` render a second, smaller block under the caption, for
      bilingual subtitles that stay locked to the same time window. Each line is
      wrapped to the usable width at word boundaries (measured at the smaller
      translation font, capped at the caption's max_lines) by
      `translation_display_lines`, so a long translation reflows instead of
      overflowing the frame.
    - `karaoke` (a list of {text, cs}) sweeps the cue word-by-word as it is
      spoken, using the Karaoke style's two colours.
    """
    bold = -1 if style.get("bold") else 0
    karaoke_on = bool(style.get("karaoke"))
    sung = style.get("karaoke_sung_colour") or style.get("primary_colour") or "&H00FFFFFF"
    unsung = style.get("karaoke_unsung_colour") or "&H00B0B0B0"

    # Caption style is the baseline. When karaoke is on, PrimaryColour is the
    # "sung" colour and SecondaryColour the "unsung" one, which is what the ASS
    # \kf sweep interpolates between; otherwise both equal the fill colour.
    primary = sung if karaoke_on else style["primary_colour"]
    secondary = unsung if karaoke_on else style["primary_colour"]

    # A top-anchored Note style for annotations: smaller, tinted, its own box so
    # it never blends into the dialogue at the bottom.
    note_size = max(10, round(int(style["font_size"]) * float(style.get("annotation_scale") or 0.62)))
    note_colour = style.get("annotation_colour") or "&H0066D9FF"  # amber
    note_margin_v = max(int(style["video_height"] * 0.045), 20)

    header = f"""[Script Info]
Title: {title}
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {style['video_width']}
PlayResY: {style['video_height']}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style['font_family_resolved']},{style['font_size']},{primary},{secondary},{style['outline_colour']},{style['back_colour']},{bold},0,0,0,100,100,0,0,{style['border_style']},{style['outline']},{style['shadow']},{style['alignment']},{style['margin_l']},{style['margin_r']},{style['margin_v']},1
Style: Note,{style['font_family_resolved']},{note_size},{note_colour},{note_colour},&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,{max(3, round(note_size*0.18))},0,8,{style['margin_l']},{style['margin_r']},{note_margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for cue in cues:
        band = _band_dialogue(cue, style) if style.get("readability_band") and str(cue.get("role") or "") != "annotation" else None
        if band:
            lines.append(band)
        lines.append(_dialogue_line(cue, style, karaoke_on))
    return "\n".join(lines) + "\n"


def _band_dialogue(cue: dict[str, Any], style: dict[str, Any]) -> str | None:
    """A Layer-0 filled rectangle behind one caption cue.

    Sized to the widest rendered line (caption + speaker tag, plus any
    translation block at its smaller size) with padding, and positioned to sit
    exactly under the text that alignment 2 (bottom-centre) will place at
    MarginV. Drawn with ASS vector graphics so the edges are always a clean
    rectangle — unlike BorderStyle 3, which hugs the glyphs and looks ragged.
    """
    caption_lines = _as_lines(cue, style)
    if not any(str(l).strip() for l in caption_lines):
        return None
    fs = int(style["font_size"])
    scale = float(cue.get("font_scale") or 1.0)

    # Widest caption line in pixels (speaker tag rides the first line).
    widths = []
    for i, line in enumerate(caption_lines):
        measure = str(line)
        if i == 0 and cue.get("speaker_prefix"):
            measure = f"{cue['speaker_prefix']} {measure}"
        widths.append(text_width_px(measure, style) * scale)
    n_lines = len(caption_lines)
    line_h = fs * 1.25

    # Translation block, if any, is rendered smaller directly under the caption.
    trans = cue.get("translation_lines")
    if trans:
        tscale = float(style.get("bilingual_scale") or 0.78)
        tsize = max(8, round(fs * tscale))
        tstyle = {**style, "font_size": tsize}
        for line in trans:
            widths.append(text_width_px(str(line), tstyle))
        n_lines += len(trans)
        block_h = line_h * len(caption_lines) + tsize * 1.25 * len(trans)
    else:
        block_h = line_h * n_lines

    pad_x = max(10.0, fs * 0.45)
    pad_y = max(6.0, fs * 0.28)
    box_w = max(widths) + 2 * pad_x

    # Co-anchor the band with the text instead of computing an absolute \pos:
    # both this Dialogue and the caption use the Default style's alignment 2
    # (bottom-centre) and MarginV, so their bottom-centre anchor points are
    # identical. Drawing upward from that shared anchor guarantees the box lands
    # exactly behind the text regardless of libass's exact line-height maths.
    # In ASS drawing space +y is downward, so the box floor sits pad_y *below*
    # the anchor and its ceiling block_h+pad_y *above* it.
    #
    # x MUST start at 0, never at -box_w/2. libass sizes a drawing's layout box
    # from the path bounding box, but then puts the path *origin* at that box's
    # left edge — so every negative x escapes to the left and the whole band
    # shifts by |min_x|. With the symmetric form the band ended up half a box
    # left of the text ("a black slab hanging off the left"), its right edge
    # cutting through the middle of the caption. Measured on a grey plate at
    # 854x480, box_w=320: symmetric -> x 107..426 (centre 266.5); this form ->
    # x 267..586 (centre 426.5, frame centre 427). y is unaffected either way.
    floor = pad_y
    ceil = -(block_h + pad_y)
    draw = f"m 0 {floor:.0f} l {box_w:.0f} {floor:.0f} {box_w:.0f} {ceil:.0f} 0 {ceil:.0f}"
    band = style["readability_band"]
    alpha = style.get("readability_band_alpha") or "&H40&"
    override = "{\\an2\\bord0\\shad0\\1c%s\\1a%s\\p1}" % (band, alpha)
    return f"Dialogue: 0,{ass_timestamp(cue['start'])},{ass_timestamp(cue['end'])},Default,,0,0,0,,{override}{draw}{{\\p0}}"


def _dialogue_line(cue: dict[str, Any], style: dict[str, Any], karaoke_on: bool) -> str:
    start, end = ass_timestamp(cue["start"]), ass_timestamp(cue["end"])
    if str(cue.get("role") or "") == "annotation":
        body = ass_escape("\n".join(_as_lines(cue, style)))
        return f"Dialogue: 0,{start},{end},Note,,0,0,0,,{body}"

    caption_lines = _as_lines(cue, style)
    # Karaoke sweep replaces the plain caption text when timing units are present.
    karaoke = cue.get("karaoke")
    if karaoke_on and karaoke and _squash_ws("".join(str(u.get("text") or "") for u in karaoke)) == _squash_ws("".join(caption_lines)):
        text = _karaoke_text(karaoke)
    else:
        # Also the path for a hand-edited `text` whose karaoke units are stale.
        text = ass_escape("\n".join(caption_lines))

    prefix = ""
    # Per-cue horizontal condense so a whole phrase fits without being split.
    scale = float(cue.get("font_scale") or 1.0)
    if scale < 0.999:
        prefix += "{\\fscx%d}" % round(scale * 100)
    # Speaker tint applies to the whole cue (prefix + words).
    colour = cue.get("speaker_colour")
    if colour:
        if not isinstance(colour, str) or not _ASS_COLOUR_RE.match(colour.strip()):
            raise ValueError(f"cue {cue.get('index')} speaker_colour must be an ASS colour like &HBBGGRR, got {colour!r}")
        prefix += "{\\c%s}" % colour.strip()
    # Speaker name tag, rendered bold ahead of the words.
    tag = str(cue.get("speaker_prefix") or "").strip()
    if tag:
        text = "{\\b1}" + ass_escape(tag + " ") + "{\\b0}" + text

    # Bilingual second block: smaller, dimmer, on the same time window so it is
    # always in sync with the caption above it.
    trans = cue.get("translation_lines")
    if trans:
        _, tsize = translation_render_style(style)
        tcolour = style.get("bilingual_colour") or "&H00D8D8D8"
        # Reflow the translation to the usable width at the smaller font before
        # emitting, so a line the model left too long wraps at a word boundary
        # instead of overflowing the frame (see translation_display_lines).
        disp = translation_display_lines(cue, style)
        # Escape each line, then join with the literal \N override. (Escaping a
        # string that already contains \N would double the backslash and print a
        # stray "\" on screen.)
        block = "\\N".join(ass_escape(str(l)) for l in disp)
        text = text + "\\N" + "{\\fs%d\\c%s}" % (tsize, tcolour) + block

    return f"Dialogue: 0,{start},{end},Default,,0,0,0,,{prefix}{text}"


def _as_lines(cue: dict[str, Any], style: dict[str, Any] | None = None) -> list[str]:
    text = str(cue.get("text") or "")
    lines = cue.get("lines")
    if isinstance(lines, list) and lines:
        lines = [str(l) for l in lines]
        # `lines` is a cache of the wrapped `text`. When someone hand-edits
        # `text` in subtitles.json the cache is stale; re-wrap from the text
        # (or fall back to it) so the edit actually reaches the screen.
        if not text or _squash_ws(text) == _squash_ws("".join(lines)):
            return lines
        if style is not None and style.get("usable_width_px") and style.get("font_file"):
            try:
                return wrap_lines(text, style)
            except Exception:
                return [text]
        return [text]
    return [text]


def _squash_ws(text: str) -> str:
    return "".join(text.split())


def _karaoke_text(units: list[dict[str, Any]]) -> str:
    """Build the `{\\kf<cs>}word` run for a karaoke sweep. Each unit is
    {"text":..,"cs":centiseconds}; a newline unit becomes a hard line break."""
    out = []
    for u in units:
        piece = str(u.get("text") or "")
        if piece == "\n":
            out.append("\\N")
            continue
        cs = max(1, int(round(float(u.get("cs") or 0))))
        out.append("{\\kf%d}%s" % (cs, ass_escape(piece)))
    return "".join(out)


def srt_timestamp(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    millis = int(round(seconds * 1000))
    hours, rest = divmod(millis, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, ms = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _srt_literal(line: str) -> str:
    """Keep cue text literal for SRT readers that honour ASS syntax (ffmpeg's decoder and
    many players turn "{\\...}" into an override tag and "\\N"/"\\h" into a break/space, which
    dropped or rewrote the words in the muxed track)."""
    line = re.sub(r"\\(?=[Nnh])", lambda _: "\\" + _WORD_JOINER, str(line))
    return line.replace("{\\", "{" + _WORD_JOINER + "\\")


def build_srt(cues: list[dict[str, Any]], style: dict[str, Any] | None = None) -> str:
    """Plain SRT: no colour/karaoke (SRT cannot express them), but the speaker
    tag and the translation line are kept as plain text so the sidecar is still
    a faithful readable transcript."""
    blocks = []
    idx = 0
    for cue in cues:
        if str(cue.get("role") or "") == "annotation":
            continue  # notes are an on-screen overlay, not part of the dialogue track
        idx += 1
        body_lines = _as_lines(cue, style)
        tag = str(cue.get("speaker_prefix") or "").strip()
        if tag and body_lines:
            body_lines = [f"{tag} {body_lines[0]}"] + body_lines[1:]
        if cue.get("translation_lines"):
            body_lines = body_lines + [str(l) for l in cue["translation_lines"]]
        body = "\n".join(_srt_literal(line) for line in body_lines)
        blocks.append(f"{idx}\n{srt_timestamp(cue['start'])} --> {srt_timestamp(cue['end'])}\n{body}\n")
    return "\n".join(blocks)


def ffmpeg_filter_escape(path: str) -> str:
    """Escape a path (or any option value) for use *unquoted* inside an ffmpeg
    filter graph, e.g. ``ass=filename=<esc>:fontsdir=<esc>``.

    ffmpeg unescapes twice: once when the graph parser splits filters
    (``\\ ' [ ] , ;`` are special) and once when the filter's option parser
    splits ``key=value:key=value`` (``\\ ' :`` are special). A single layer is
    therefore not enough — ``/tmp/colon:dir`` came out as ``dir`` ("Unable to
    parse option value") and ``/tmp/apos'dir`` lost its apostrophe ("Could not
    create a libass track"). Do not wrap the result in quotes: inside ``'...'``
    the graph parser copies backslashes literally, which re-introduces the bug.
    """
    level1 = re.sub(r"([\\':])", r"\\\1", path)          # option-value layer
    return re.sub(r"([\\'\[\],;])", r"\\\1", level1)   # filter-graph layer


def drawtext_escape(text: str) -> str:
    """Escape free text for ``drawtext=text=<esc>`` (use unquoted).

    Three layers, innermost first: drawtext's own text expansion (``%`` must
    start ``%{...}`` and ``\\`` escapes, so a literal ``%`` is ``\\%``), then the
    two ffmpeg layers of :func:`ffmpeg_filter_escape`. A bare ``'`` in a quoted
    ``text='...'`` closes the quote early: "45'" merged two drawtext filters
    into one and "it's" rendered as "its".
    """
    level0 = text.replace("\\", "\\\\").replace("%", "\\%")      # drawtext expansion layer
    level1 = re.sub(r"([\\':])", r"\\\1", level0)                  # option-value layer
    return re.sub(r"([\\'\[\],;])", r"\\\1", level1)            # filter-graph layer


# --- CJK font discovery -----------------------------------------------------
#
# Shared by the drawtext-based recap tools (soccer/lol) and the libass-based
# narrated render: one lookup order, one coverage check, one error string.

CJK_PROBE_TEXT = "中文字幕测试全场结束"
_FONT_SUFFIXES = {".ttf", ".ttc", ".otf", ".otc"}
# Filename fragments that usually mean "has Han glyphs"; used to pick likely
# files when scanning system font dirs (fc-match is not trustworthy, see below).
_CJK_FILE_HINTS = ("cjk", "sourcehan", "source-han", "wqy", "wenquanyi", "uming", "ukai",
                   "droidsansfallback", "simsun", "simhei", "simkai", "simfang", "msyh", "msjh",
                   "yahei", "deng", "fangsong", "kaiti", "pingfang", "hiragino", "stheiti",
                   "songti", "hei", "song", "arialunicode", "arial unicode", "unifont")
_CJK_KNOWN_FILES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSans-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "/usr/share/fonts/truetype/droid/DroidSansFallback.ttf",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/truetype/arphic/ukai.ttc",
    # macOS stock faces (Sonoma ships real files here, not stubs)
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
] + ([
    # Windows stock faces (微软雅黑 / 黑体 / 宋体 / 等线), under %SystemRoot%\Fonts
    str(_PLATFORM_FONT_DIRS["windows"][0] / name)
    for name in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc", "Deng.ttf", "msjh.ttc")
] if _OS == "windows" else [])
_SYSTEM_FONT_DIRS = [Path("/root/.fonts"), Path.home() / ".fonts", Path("/usr/local/share/fonts"),
                     Path("/usr/share/fonts"), *_PLATFORM_FONT_DIRS[_OS]]


def _is_han(ch: str) -> bool:
    return "一" <= ch <= "鿿" or "㐀" <= ch <= "䶿" or "豈" <= ch <= "﫿"


def font_dirs_from_env() -> list[Path]:
    """Font directories injected by the pipeline (VE_FONT_DIRS / VIDEO_EDIT_FONT_DIRS,
    os.pathsep separated); read through clean_env so .env layers work too."""
    raw = clean_env("VE_FONT_DIRS", "VIDEO_EDIT_FONT_DIRS") or ""
    return [Path(p.strip()) for p in raw.split(os.pathsep) if p.strip()]


def _fc_query(args: list[str]) -> list[str]:
    if not shutil.which(args[0]):
        return []
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except Exception:
        return []
    return [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]


def cjk_font_candidates() -> list[str]:
    """Candidate font files in lookup order: pipeline font dirs -> fontconfig
    (fc-match / fc-list :lang=zh) -> well-known Noto/Source Han/WenQuanYi/arphic
    files -> name-hinted files under the system font dirs. Existing files only."""
    seen: set[str] = set()
    out: list[str] = []

    def add(path: str | Path) -> None:
        try:
            p = Path(path)
            if p.suffix.lower() not in _FONT_SUFFIXES or not p.is_file():
                return
            key = str(p.resolve())
        except OSError:
            return
        if key not in seen:
            seen.add(key)
            out.append(str(p))

    for d in font_dirs_from_env():
        if d.is_dir():
            for f in sorted(d.rglob("*")):
                add(f)
    for line in _fc_query(["fc-match", "-f", "%{file}\n", ":lang=zh"]):
        add(line)
    for line in _fc_query(["fc-list", ":lang=zh", "file"]):
        add(line.rstrip(":").strip())
    for f in _CJK_KNOWN_FILES:
        add(f)
    for d in _SYSTEM_FONT_DIRS:
        if not d.is_dir():
            continue
        try:
            files = sorted(d.rglob("*"))
        except OSError:
            continue
        for f in files:
            if any(h in f.name.lower() for h in _CJK_FILE_HINTS):
                add(f)
    return out


def font_covers_text(font_file: str, text: str) -> bool:
    """True when the font's cmap has a glyph for every Han character in `text`.
    Degrades to a plain existence check when fontTools cannot read the font
    (or is not installed) — coverage is then unknown rather than false."""
    han = {ch for ch in text if _is_han(ch)}
    charset = _font_charset(str(font_file))
    if charset is None:
        return Path(font_file).is_file()
    return all(ord(ch) in charset for ch in han)


_CJK_FONT_CACHE: dict[str, str] = {}   # han-set -> font file; misses are not cached


def find_cjk_font(text: str = CJK_PROBE_TEXT) -> str:
    """Path of the first candidate font whose cmap covers every Han character in
    `text` (a probe string is used when `text` has none). Never raises: when
    nothing qualifies, returns a ``"[ERROR] no CJK-capable font ..."`` string
    (the MCP tool convention), so callers can pass it straight through.

    `fc-match :lang=zh` is consulted but not trusted — with no CJK font installed
    it happily answers with Noto Sans / DejaVu, which is why every candidate is
    checked against its cmap instead of taken at face value.
    """
    han = "".join(sorted({ch for ch in text if _is_han(ch)})) or CJK_PROBE_TEXT
    hit = _CJK_FONT_CACHE.get(han)
    if hit and Path(hit).is_file():
        return hit
    candidates = cjk_font_candidates()
    for cand in candidates:
        if font_covers_text(cand, han):
            _CJK_FONT_CACHE[han] = cand
            return cand
    env_dirs = [str(d) for d in font_dirs_from_env()]
    platform_dirs = [str(d) for d in _PLATFORM_FONT_DIRS[_OS]]
    return (f"[ERROR] no CJK-capable font found covering {len(han)} Han characters "
            f"(sample: {han[:12]}); checked {len(candidates)} font file(s) from "
            f"VE_FONT_DIRS/VIDEO_EDIT_FONT_DIRS={env_dirs or 'unset'}, fontconfig (:lang=zh) and "
            f"the {_OS} font dirs {platform_dirs}. Install e.g. Noto Sans CJK SC or point VE_FONT_DIRS at a "
            f"directory containing a .ttf/.ttc/.otf with Han glyphs.")


@functools.lru_cache(maxsize=32)
def font_face(font_file: str) -> tuple[int, str | None]:
    """(face index, family name) libass/fontconfig should be asked for.

    Family is the typographic family (nameID 16) if present, else nameID 1.
    For a collection the Simplified-Chinese face is preferred over face 0:
    PingFang.ttc opens with "PingFang HK", STHeiti with "Heiti TC", Noto's
    CJK TTC with the JP face — every preset here is a Chinese subtitle preset,
    and libass matches the family name we write into the Style line, so the
    name decides which regional glyph shapes land on the frame. Falls back to
    (0, fc-scan family), then (0, None)."""
    try:
        from fontTools.ttLib import TTCollection, TTFont

        def _family(font) -> str | None:
            name = font["name"]
            for nid in (16, 1):
                val = name.getDebugName(nid)
                if val:
                    return str(val).strip()
            return None

        if Path(font_file).suffix.lower() in {".ttc", ".otc"}:
            with TTCollection(font_file, lazy=True) as collection:
                faces = [(i, _family(f)) for i, f in enumerate(collection.fonts)]
            for idx, fam in faces:
                if fam and not fam.startswith(".") and re.search(r"\bSC\b", fam):
                    return idx, fam
            if faces and faces[0][1]:
                return faces[0]
        else:
            with TTFont(font_file, fontNumber=0, lazy=True) as font:
                fam = _family(font)
            if fam:
                return 0, fam
    except Exception:
        pass
    return 0, font_family_of(Path(font_file))


def font_family_name(font_file: str) -> str | None:
    """Family name libass/fontconfig will match for `font_file` — see font_face."""
    return font_face(font_file)[1]


@functools.lru_cache(maxsize=8)
def _font_charset(font_file: str) -> frozenset[int] | None:
    """Codepoints the font actually has glyphs for, read from its cmap. None
    when the font cannot be parsed, in which case coverage is simply unknown."""
    try:
        from fontTools.ttLib import TTFont

        with TTFont(font_file, fontNumber=0, lazy=True) as font:
            return frozenset(font.getBestCmap())
    except Exception:
        return None


def uncovered_characters(text: str, style: dict[str, Any], limit: int = 12) -> list[str]:
    """Characters the resolved font has no glyph for.

    This check exists because `fc-match` never fails: ask it for a Chinese
    family that is not installed and it cheerfully returns DejaVu Sans, which
    has no CJK glyphs at all. libass then renders blanks or tofu boxes and the
    burn-in *succeeds* — a silent, total failure. Reading the font's cmap
    catches it before we encode anything.
    """
    charset = _font_charset(str(style["font_file"]))
    if charset is None:
        return []
    missing: list[str] = []
    seen: set[str] = set()
    for ch in text:
        if ch in seen or ch.isspace():
            continue
        seen.add(ch)
        if ord(ch) not in charset:
            missing.append(ch)
        if len(missing) >= limit:
            break
    return missing


def normalize_asr_text(text: str) -> str:
    """Whitespace normalisation only. Punctuation is deliberately kept:
    it is the strongest signal we have about where a cue may end, and it must
    survive until after segmentation. Use `to_display_text` for what the viewer
    actually sees.

    Note this does *not* run NFKC. NFKC folds the full-width CJK marks ，。！？
    onto their ASCII counterparts, which is simply wrong typography in a Chinese
    subtitle — the half-width comma sits on the baseline with no ideographic
    spacing around it.
    """
    text = str(text or "").replace("　", " ").replace("﻿", "").strip()
    # ASR often emits a space between CJK glyphs; it reads as a typo on screen.
    text = re.sub(r"(?<=[㐀-鿿])\s+(?=[㐀-鿿])", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def to_display_text(text: str, style: dict[str, Any]) -> str:
    """Turn a piece of transcript into what is drawn on the frame."""
    if not style.get("keep_inner_punctuation"):
        # Short-form captions drop commas; a thin gap reads better than the mark.
        text = re.sub(f"[{re.escape(WEAK_PUNCT)}]", " ", text)
        text = re.sub(r"\s{2,}", " ", text)
    if style.get("strip_end_punctuation"):
        text = re.sub(f"[{re.escape(STRONG_PUNCT)}]", " ", text)
        text = re.sub(r"\s{2,}", " ", text)
    return text


# Part-of-speech prefixes a cue or line must not end on. A conjunction,
# preposition, particle, adverb, numeral or classifier binds forward to the word
# it governs, so breaking after one strands it: "心思和 / 精力" and "相对 / 低一
# 级别" are both wrong even though jieba considers them word boundaries.
TRAILING_TABOO_POS = ("c", "p", "u", "d", "m", "q")
# Determiners share the "r" (pronoun) tag with perfectly breakable pronouns.
TRAILING_TABOO_WORDS = frozenset({"这", "那", "这个", "那个", "每", "某", "各", "本", "上述", "以下"})

# jieba tags every Latin token "eng", so the Chinese part-of-speech taboo is
# blind to English function words and would happily end a line on "the" or
# "of". These lists restore the same rule for Latin script: a word that governs
# what follows it must not be the last thing on the line.
TRAILING_TABOO_EN = frozenset("""
a an the this that these those my your his her its our their
of in on at to for with from by as into onto than about across through
during before after between among against toward towards over under within
and or but nor so yet plus versus
is are was were be been being am
has have had do does did
will would can could may might must shall should
no not very more most less least such another each every either neither
""".split())

# Words that must not *open* a cue: a leading conjunction has been cut out of
# the phrase it joins, and a leading possessive/infinitive marker is orphaned.
LEADING_TABOO_EN = frozenset("""
and or but nor so yet plus of to
""".split())


def _is_latin_word(word: str, pos: str) -> bool:
    if str(pos or "").startswith("eng"):
        return True
    stripped = word.strip().strip(ALL_PUNCT)
    return bool(stripped) and all(ch.isascii() and (ch.isalpha() or ch in "'-") for ch in stripped)


def is_trailing_taboo(word: str, pos: str) -> bool:
    """True when a break immediately after this word would strand it."""
    bare = word.strip().strip(ALL_PUNCT)
    if not bare:
        return False
    if _is_latin_word(word, pos):
        return bare.lower() in TRAILING_TABOO_EN
    if bare in TRAILING_TABOO_WORDS:
        return True
    return str(pos or "").startswith(TRAILING_TABOO_POS)


# Part-of-speech prefixes a cue must not *begin* on. This is the mirror of the
# trailing taboo and catches a different defect: breaking 心思和精力 after 心思
# satisfies the trailing rule (心思 is a noun) but opens the next cue with a bare
# 和, splitting a coordinate structure across the cut. Particles are included
# because a cue can never legitimately open with 的 or 了.
LEADING_TABOO_POS = ("c", "u")


def is_leading_taboo(word: str, pos: str) -> bool:
    """True when starting a cue with this word would orphan it from the phrase
    it belongs to."""
    bare = word.strip().strip(ALL_PUNCT)
    if not bare:
        return False
    if _is_latin_word(word, pos):
        return bare.lower() in LEADING_TABOO_EN
    return str(pos or "").startswith(LEADING_TABOO_POS)


def cut_words_tagged(text: str) -> list[tuple[str, str]]:
    """Word tokens with part-of-speech tags. Falls back to untagged
    per-character tokens when jieba is unavailable — worse breaks, but still
    functional."""
    try:
        import logging

        import jieba
        import jieba.posseg as pseg

        jieba.setLogLevel(logging.ERROR)
        tokens = [(w, f) for w, f in pseg.cut(text) if w]
    except Exception:
        tokens = [(t, "") for t in _fallback_cut(text)]
    return _glue_hyphens(tokens)


def _glue_hyphens(tokens: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Rejoin `real` `-` `time` into a single token.

    jieba splits on the ASCII hyphen, and the hyphen is not sentence
    punctuation, so without this a cue break can land inside a hyphenated
    compound: "uses real" / "-time satellite data".
    """
    out: list[tuple[str, str]] = []
    idx = 0
    while idx < len(tokens):
        word, pos = tokens[idx]
        if (
            word == "-"
            and out
            and idx + 1 < len(tokens)
            and _is_latin_word(out[-1][0], out[-1][1])
            and _is_latin_word(tokens[idx + 1][0], tokens[idx + 1][1])
        ):
            prev_word, prev_pos = out[-1]
            out[-1] = (prev_word + "-" + tokens[idx + 1][0], prev_pos or "eng")
            idx += 2
            continue
        out.append((word, pos))
        idx += 1
    return out


def cut_words(text: str) -> list[str]:
    return [w for w, _ in cut_words_tagged(text)]


def _fallback_cut(text: str) -> list[str]:
    tokens: list[str] = []
    buffer = ""
    for ch in text:
        if is_wide(ch) or ch in ALL_PUNCT or ch.isspace():
            if buffer:
                tokens.append(buffer)
                buffer = ""
            tokens.append(ch)
        else:
            buffer += ch
    if buffer:
        tokens.append(buffer)
    return tokens


def translation_render_style(style: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """The style used to lay out the bilingual translation block: the caption
    style scaled down to the translation font size. Width measurement and line
    wrapping for the translation must use this, not the caption size. Returns
    (translation_style, translation_font_size)."""
    tscale = float(style.get("bilingual_scale") or 0.78)
    tsize = max(8, round(int(style["font_size"]) * tscale))
    tstyle = {**style, "font_size": tsize}
    # The character-count cap is calibrated to the caption size; the smaller
    # translation glyphs fit proportionally more per line, so relax it in step
    # with the font, letting the pixel-width budget be the real constraint.
    max_chars = int(style.get("max_chars_per_line") or 0)
    if max_chars and tscale > 0:
        tstyle["max_chars_per_line"] = max(1, round(max_chars / tscale))
    return tstyle, tsize


def _join_translation_lines(lines: list[str]) -> str:
    """Reflow the model's translation lines back into a single string so it can
    be re-wrapped to the budget. Join with a space only where a space belongs
    (Latin word boundary); adjacent CJK glyphs are concatenated directly so no
    stray space appears mid-sentence."""
    out = ""
    for line in lines:
        line = str(line).strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        sep = "" if (is_wide(out[-1]) or is_wide(line[0])) else " "
        out += sep + line
    return out


def translation_display_lines(cue: dict[str, Any], style: dict[str, Any]) -> list[str]:
    """The translation lines as they should actually render: the model's
    `translation_lines`, but with any line wider than the usable width wrapped
    at word boundaries (measured at the smaller translation font). Lines that
    already fit are left exactly as given. If wrapping overflows the caption's
    max_lines budget, the whole translation is reflowed into balanced lines
    within that budget."""
    trans = cue.get("translation_lines")
    if not trans:
        return []
    tstyle, _ = translation_render_style(style)
    usable = float(tstyle.get("usable_width_px") or 0)
    max_lines = int(tstyle.get("max_lines") or 1)
    raw = [str(l) for l in trans]
    wrapped: list[str] = []
    for line in raw:
        if usable and text_width_px(line, tstyle) > usable + 1.0:
            wrapped.extend(wrap_lines(line, tstyle))
        else:
            wrapped.append(line)
    if max_lines and len(wrapped) > max_lines:
        wrapped = wrap_lines(_join_translation_lines(raw), tstyle)
    return wrapped


def wrap_lines(text: str, style: dict[str, Any]) -> list[str]:
    """Break a cue into at most max_lines visually balanced lines."""
    max_lines = int(style["max_lines"])
    usable = float(style["usable_width_px"])
    max_chars = int(style.get("max_chars_per_line") or 0)
    if max_lines <= 1 or (text_width_px(text, style) <= usable and fits_chars(text, max_chars)):
        return [text]
    breaks = _break_candidates(text)
    best: tuple[float, list[str]] | None = None
    # A wrap that lands on punctuation is worth this much line-width of
    # imbalance; without it the wrapper chases symmetry straight through the
    # middle of a phrase.
    punct_bonus = usable * 0.35
    for pos in breaks:
        head, tail = text[:pos].strip(), text[pos:].strip()
        if not head or not tail:
            continue
        head_w, tail_w = text_width_px(head, style), text_width_px(tail, style)
        overflow = max(0.0, head_w - usable) + max(0.0, tail_w - usable)
        # A line that is short enough in pixels can still be too long to read.
        if max_chars:
            per_char = usable / max_chars
            overflow += per_char * (
                max(0, line_char_count(head) - max_chars) + max(0, line_char_count(tail) - max_chars)
            )
        # Prefer two lines of similar length once both fit.
        cost = overflow * 100.0 + abs(head_w - tail_w)
        if head[-1] not in STRONG_PUNCT + WEAK_PUNCT:
            cost += punct_bonus
        if best is None or cost < best[0]:
            best = (cost, [head, tail])
    if best is None:
        return [text]
    if max_lines == 2:
        return best[1]
    # More than two lines: recurse on the longer half.
    head, tail = best[1]
    sub_style = {**style, "max_lines": max_lines - 1}
    return [head, *wrap_lines(tail, sub_style)]


def _break_candidates(text: str) -> list[int]:
    """Indices where a line break is typographically acceptable.

    Word boundaries only — the same reason cue segmentation needs jieba applies
    to line wrapping: breaking 评论区 into 评论 / 区 across two lines is just as
    wrong as breaking it across two cues. Positions that would strand a
    conjunction or particle at the end of a line are dropped outright, unless
    that would leave nowhere to break at all.
    """
    positions: list[int] = []
    fallback: list[int] = []
    cursor = 0
    for word, pos in cut_words_tagged(text):
        cursor += len(word)
        if cursor >= len(text):
            break
        # Never start a line with punctuation: a break belongs after the mark,
        # not before it.
        if text[cursor].isspace() or text[cursor] in ALL_PUNCT:
            continue
        # Never break inside a contraction or hyphenated word: "NASA's" and
        # "real-time" must not split at the apostrophe/hyphen (jieba tokenizes
        # them into pieces, which would otherwise look like a legal boundary).
        if cursor >= 1 and text[cursor - 1] in "'’-" and text[cursor].isalnum():
            continue
        fallback.append(cursor)
        if is_trailing_taboo(word, pos):
            continue
        positions.append(cursor)
    return positions or fallback


def line_char_count(text: str) -> int:
    """Characters a reader has to take in on one line. Spaces are excluded so
    the same limit is meaningful for Chinese (no spaces) and English."""
    return sum(1 for ch in text if not ch.isspace())


def fits_chars(text: str, max_chars: int) -> bool:
    return not max_chars or line_char_count(text) <= max_chars


def estimate_cps(text: str, duration: float) -> float:
    if duration <= 0:
        return math.inf
    return visible_char_count(text) / duration
