"""Name and place cards: 【角色名】【身份】 fading in over the cut, in a serif face.

Two things made this a tool rather than a line in a prompt.

The first is that the generator cannot be trusted with text in frame. v45_b put a
prescription in close-up and filled it with characters that are not characters — argon
called it out twice, independently, as 「AI 生成的无意义乱码」. In-frame text has to be
composited after the fact, with a real font and real glyph coverage, or it is noise.

The second is placement. A card is only useful if it does not sit on the face, the prop the
shot is about, or the burnt-in dialogue. Where that is depends on the actual frame, so this
tool will not let a caller place a card blind: `action=plan` measures each candidate box
against the frames it would cover and renders a preview with the box drawn on the real
picture, and `action=render` refuses a placement that `plan` scored as occluding. The
decision stays with whoever looks at the previews; what is enforced is that someone looked.

Timing is in seconds on the rendered cut's own clock, and the fade is ASS `\\fad`, so a card
costs one filter pass over the video and nothing in generation budget.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from . import subtitle_style as sty
from .result import ToolResult
from .run_context import RunContext

ACTIONS = ("plan", "render")

# A card is name + optional qualifier (「沈紫言」/「沈府二小姐」), held long enough to read
# twice and no longer: these are an aid, not a chapter heading.
MIN_SECONDS = 1.2
MAX_SECONDS = 4.0
DEFAULT_SECONDS = 2.2
FADE_MS = 420

# Serif, not sans: a period drama's name card is set in 宋体 far more often than in brush
# script, and brush script stops being legible at the size a phone needs. The family is a
# default, not a rule — drop another face into <assets>/fonts and name it in style.font_family.
DEFAULT_FAMILY = "Source Han Serif SC"
FALLBACK_FAMILY = "Noto Sans CJK SC"

# Where a card may sit, as fractions of the frame. Each is a box the card is centred in;
# the dialogue band owns the bottom sixth, so nothing here reaches into it.
ZONES: dict[str, tuple[float, float, float, float]] = {
    "upper_left":   (0.06, 0.10, 0.52, 0.26),
    "upper_right":  (0.42, 0.10, 0.94, 0.26),
    "mid_left":     (0.06, 0.34, 0.52, 0.52),
    "mid_right":    (0.42, 0.34, 0.94, 0.52),
    "lower_left":   (0.06, 0.58, 0.52, 0.76),
    "lower_right":  (0.42, 0.58, 0.94, 0.76),
}
DEFAULT_ZONE = "lower_left"

# Above this, the box has too much going on to put text over it. Calibrated against frames
# from v46: flat wall/sky reads 0.01-0.04, a face in close-up 0.10-0.18, a crowd or a
# patterned robe 0.20+. The number is a screen, not a verdict — the previews decide.
BUSY_EDGE_DENSITY = 0.085


def _probe(path: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise ValueError(f"ffprobe failed on {path.name}: {out.stderr.strip()[:200]}")
    d = json.loads(out.stdout)
    st = (d.get("streams") or [{}])[0]
    w, h = int(st.get("width") or 0), int(st.get("height") or 0)
    dur = float((d.get("format") or {}).get("duration") or 0.0)
    if not (w and h and dur):
        raise ValueError(f"{path.name} has no usable video stream")
    return w, h, dur


def _zone_box(zone: str, w: int, h: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = ZONES[zone]
    return round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)


def _edge_density(img, box: tuple[int, int, int, int]) -> float:
    """Fraction of pixels in `box` that sit on an edge — a stand-in for "is something here".

    Deliberately crude and deliberately cheap: a gradient magnitude over a greyscale crop.
    It is here to stop a card landing on a face without anyone noticing, not to understand
    the shot.
    """
    import numpy as np

    crop = img.convert("L").crop(box)
    a = np.asarray(crop, dtype=np.float32)
    if a.size == 0:
        return 0.0
    gx = np.abs(np.diff(a, axis=1))[:-1, :]
    gy = np.abs(np.diff(a, axis=0))[:, :-1]
    mag = np.hypot(gx, gy)
    return float((mag > 28.0).mean())


def _frames(video: Path, at: float, seconds: float, work: Path, n: int = 3) -> list[Path]:
    out = []
    span = max(seconds, 0.1)
    for i in range(n):
        t = at + span * (i + 0.5) / n
        p = work / f"f{i}.png"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}",
                            "-i", str(video), "-frames:v", "1", str(p)],
                           capture_output=True, text=True, timeout=300)
        if r.returncode == 0 and p.is_file():
            out.append(p)
    return out


def _covers(font_file: str | None, text: str) -> bool:
    """Whether this font file actually has glyphs for the card text."""
    if not font_file or not text:
        return False
    try:
        return not sty.uncovered_characters(text, {"font_file": font_file})
    except Exception:  # noqa: BLE001 — an unreadable font is simply not a candidate
        return False


def _in_injected_dirs(family: str) -> str | None:
    """Find `family` among the font directories the pipeline injected.

    `resolve_font_file` only walks a hardcoded pair of system directories and then asks
    fc-match, and fc-match answers from fontconfig's own cache — neither of which knows
    about VE_FONT_DIRS. A font we mount specifically for this job is therefore invisible to
    a lookup by name: asking for Source Han Serif SC returned Noto Sans CJK JP, the first
    covering face fontconfig happened to have.
    """
    want = family.replace(" ", "").lower()
    for d in sty.font_dirs_from_env():
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if p.suffix.lower() not in (".otf", ".ttf", ".ttc"):
                continue
            # Match on the file's declared family when fc-scan is available, and on the
            # filename otherwise, so this still works in a container without fontconfig.
            declared = (sty.font_family_of(p) or "").replace(" ", "").lower()
            if want and (want in declared or want in p.stem.replace(" ", "").lower()):
                return str(p)
    return None


def _resolve_family(explicit: object, text: str = "") -> tuple[str, str | None, list[str]]:
    """(family name ass will ask for, font file if we found one, notes).

    Coverage is checked, not assumed. fontconfig answers a request for a family it does not
    have with whatever it considers closest: asking for Source Han Serif SC on a host that
    lacks it returns DejaVuSans, which has no Han glyphs at all and renders 沈紫言 as three
    tofu boxes. A card that silently becomes tofu is worse than one that refuses to render.
    """
    notes: list[str] = []
    probe = text or "沈紫言金陵"
    want = str(explicit or "").strip() or DEFAULT_FAMILY
    for family in (want, FALLBACK_FAMILY):
        for f in (_in_injected_dirs(family), sty.resolve_font_file(family)):
            if _covers(f, probe):
                if family != want:
                    notes.append(f"{want!r} is not installed; used {family}")
                return family, f, notes
        notes.append(f"{family!r} has no covering font in the font dirs or fontconfig")
    found = sty.find_cjk_font(probe)
    if not found.startswith("[ERROR]") and _covers(found, probe):
        fam = sty.font_family_name(found) or FALLBACK_FAMILY
        notes.append(f"fell back to the first face with full coverage: {fam}")
        return fam, found, notes
    notes.append("no installed font covers this text; cards would render as tofu")
    return want, None, notes


def _card_rows(card: dict) -> list[str]:
    rows = [str(card.get("text") or "").strip()]
    sub = str(card.get("subtext") or "").strip()
    if sub:
        rows.append(sub)
    return [r for r in rows if r]


def _validate(cards: object, duration: float) -> list[dict]:
    if not isinstance(cards, list) or not cards:
        raise ValueError("cards must be a non-empty array of {text, at, zone?, subtext?, seconds?}")
    out = []
    for i, c in enumerate(cards):
        if not isinstance(c, dict):
            raise ValueError(f"cards[{i}] must be an object")
        rows = _card_rows(c)
        if not rows:
            raise ValueError(f"cards[{i}].text is required")
        try:
            at = float(c.get("at"))
        except (TypeError, ValueError):
            raise ValueError(f"cards[{i}].at must be a time in seconds on the cut's own clock")
        if not 0.0 <= at < duration:
            raise ValueError(f"cards[{i}].at={at} is outside the cut (0-{duration:.2f}s)")
        secs = c.get("seconds", DEFAULT_SECONDS)
        try:
            secs = float(secs)
        except (TypeError, ValueError):
            raise ValueError(f"cards[{i}].seconds must be a number")
        if not MIN_SECONDS <= secs <= MAX_SECONDS:
            raise ValueError(f"cards[{i}].seconds={secs} outside [{MIN_SECONDS}, {MAX_SECONDS}]")
        zone = str(c.get("zone") or DEFAULT_ZONE)
        if zone not in ZONES:
            raise ValueError(f"cards[{i}].zone={zone!r} unknown (one of {sorted(ZONES)})")
        out.append({"id": str(c.get("id") or f"card{i + 1}"), "rows": rows,
                    "at": at, "seconds": min(secs, max(0.2, duration - at)), "zone": zone})
    return out


def _plan(video: Path, cards: list[dict], w: int, h: int, ctx: RunContext,
          out_dir: Path, family: object = None) -> list[dict]:
    import tempfile

    from PIL import Image, ImageDraw, ImageFont

    # The preview exists to be read, so it draws the card in the face it will actually be
    # rendered in. PIL's built-in bitmap font has no CJK coverage and would show a row of
    # tofu — which looks like a placement you can judge and is not one.
    _probe_text = "".join("".join(c["rows"]) for c in cards)
    _fam, font_file, _notes = _resolve_family(family, _probe_text)
    name_px, sub_px = max(18, round(h * 0.052)), max(14, round(h * 0.030))
    if font_file:
        f_name = ImageFont.truetype(font_file, name_px)
        f_sub = ImageFont.truetype(font_file, sub_px)
    else:
        f_name = f_sub = ImageFont.load_default()

    rows = []
    for c in cards:
        box = _zone_box(c["zone"], w, h)
        with tempfile.TemporaryDirectory(prefix="cardplan-") as tmp:
            frames = _frames(video, c["at"], c["seconds"], Path(tmp))
            if not frames:
                rows.append({**c, "box": box, "edge_density": None, "occluding": None,
                             "preview": None, "note": "could not extract frames at this time"})
                continue
            dens = []
            preview = None
            for i, f in enumerate(frames):
                with Image.open(f) as im:
                    im.load()
                    dens.append(_edge_density(im, box))
                    if i == len(frames) // 2:
                        shot = im.convert("RGB")
                        d = ImageDraw.Draw(shot)
                        d.rectangle(box, outline=(255, 64, 64), width=max(2, h // 360))
                        cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
                        n = len(c["rows"])
                        for j, text in enumerate(c["rows"]):
                            fnt = f_name if j == 0 else f_sub
                            step = name_px if j == 0 else sub_px
                            y = cy + round((j - (n - 1) / 2) * step * 1.35)
                            d.text((cx, y), text, font=fnt, fill=(255, 255, 255),
                                   anchor="mm", stroke_width=max(2, round(h * 0.003)),
                                   stroke_fill=(32, 32, 32))
                        preview = out_dir / f"preview_{c['id']}.jpg"
                        preview.parent.mkdir(parents=True, exist_ok=True)
                        shot.save(preview, quality=88)
            worst = max(dens)
            rows.append({**c, "box": box, "edge_density": round(worst, 4),
                         "occluding": bool(worst > BUSY_EDGE_DENSITY),
                         "busy_above": BUSY_EDGE_DENSITY,
                         "preview": ctx.virtualize(preview) if preview else None})
    return rows


def _ass(cards: list[dict], w: int, h: int, family: str) -> str:
    name_size = max(18, round(h * 0.052))
    sub_size = max(14, round(h * 0.030))
    outline = max(2, round(h * 0.0030))
    head = f"""[Script Info]
Title: title cards
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {w}
PlayResY: {h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CardName,{family},{name_size},&H00FFFFFF,&H00FFFFFF,&H00202020,&H00000000,0,0,0,0,100,100,{max(1, round(name_size * 0.10))},0,1,{outline},0,5,0,0,0,1
Style: CardSub,{family},{sub_size},&H00E8E8E8,&H00E8E8E8,&H00202020,&H00000000,0,0,0,0,100,100,{max(1, round(sub_size * 0.14))},0,1,{max(1, outline - 1)},0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [head]
    for c in cards:
        x0, y0, x1, y1 = c["box"]
        cx = (x0 + x1) // 2
        start, end = c["at"], c["at"] + c["seconds"]
        n = len(c["rows"])
        for j, text in enumerate(c["rows"]):
            # Rows stack downwards from the box's vertical centre, so one-row and two-row
            # cards both read as centred in the zone the previews showed.
            step = name_size if j == 0 else sub_size
            cy = (y0 + y1) // 2 + round((j - (n - 1) / 2) * step * 1.35)
            style = "CardName" if j == 0 else "CardSub"
            lines.append(
                f"Dialogue: 0,{sty.ass_timestamp(start)},{sty.ass_timestamp(end)},{style},,0,0,0,,"
                f"{{\\pos({cx},{cy})\\fad({FADE_MS},{FADE_MS})}}{text}")
    return "\n".join(lines) + "\n"


def title_cards(args: dict, ctx: RunContext) -> ToolResult:
    """Place 【name】/【place】 cards over a rendered cut. action=plan, then action=render."""
    try:
        action = str(args.get("action") or "").strip().lower()
        if action not in ACTIONS:
            raise ValueError(f"action must be one of {ACTIONS}")
        video = ctx.resolve(str(args.get("video") or ""))
        if not video.is_file():
            raise ValueError(f"video not found: {video}")
        w, h, dur = _probe(video)
        cards = _validate(args.get("cards"), dur)

        if action == "plan":
            out_dir = ctx.resolve(str(args.get("output_dir") or "out/creation/title_cards"))
            rows = _plan(video, cards, w, h, ctx, out_dir, (args.get('style') or {}).get('font_family'))
            busy = [r["id"] for r in rows if r.get("occluding")]
            text = (f"{len(rows)} card(s) measured against {video.name} ({w}x{h}, {dur:.1f}s). "
                    f"Look at every preview before rendering: the box is drawn on the real frame.")
            if busy:
                text += (f" {len(busy)} would sit on a busy area ({', '.join(busy)}) — "
                         "move them to another zone or change `at`.")
            return ToolResult(text=text, data={
                "action": "plan", "video": ctx.virtualize(video),
                "video_size": [w, h], "duration": round(dur, 3),
                "zones": {k: list(v) for k, v in ZONES.items()},
                "cards": rows, "occluding": busy})

        plan_rows = args.get("placement_checked")
        if not isinstance(plan_rows, list) or not plan_rows:
            raise ValueError(
                "render needs placement_checked: the card ids from action=plan whose previews "
                "you actually looked at. A card placed without looking at the frame it covers "
                "is how text lands on a face.")
        checked = {str(x) for x in plan_rows}
        missing = [c["id"] for c in cards if c["id"] not in checked]
        if missing:
            raise ValueError(f"these cards are not in placement_checked: {missing}")

        probe_text = "".join("".join(c["rows"]) for c in cards)
        family, font_file, notes = _resolve_family(
            (args.get("style") or {}).get("font_family"), probe_text)
        if font_file is None:
            return ToolResult(text="[ERROR] " + "; ".join(notes), is_error=True,
                              data={"font_notes": notes})
        for c in cards:
            c["box"] = _zone_box(c["zone"], w, h)
        ass_text = _ass(cards, w, h, family)
        out_video = ctx.resolve(str(args.get("output_path") or "out/preview_cards.mp4"))
        ass_path = out_video.with_suffix(".cards.ass")
        out_video.parent.mkdir(parents=True, exist_ok=True)
        ass_path.write_text(ass_text, encoding="utf-8")
        esc = str(ass_path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
        fontsdir = str(Path(font_file).parent).replace("\\", "/").replace(":", r"\:")
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(video),
             "-vf", f"ass='{esc}':fontsdir='{fontsdir}'",
             "-c:a", "copy", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
             str(out_video)],
            capture_output=True, text=True, timeout=3600)
        if r.returncode != 0 or not out_video.is_file():
            return ToolResult(text=f"[ERROR] burning cards failed: {r.stderr.strip()[:400]}",
                              is_error=True)
        return ToolResult(
            text=(f"{len(cards)} card(s) burned into {ctx.virtualize(out_video)} "
                  f"in {family}, {FADE_MS}ms fade each."
                  + (" " + "; ".join(notes) if notes else "")),
            data={"action": "render", "output_path": ctx.virtualize(out_video),
                  "ass_path": ctx.virtualize(ass_path), "font_family": family,
                  "font_file": font_file, "font_notes": notes,
                  "cards": [{k: v for k, v in c.items()} for c in cards]},
            artifacts=[str(out_video)])
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return ToolResult(text=f"[ERROR] {exc}", data={"param_error": True}, is_error=True)
