#!/usr/bin/env python3
"""The review packet: frames and contact sheets a reviewer looks at, plus the critic skeleton."""

from __future__ import annotations

import json
from pathlib import Path

from dv_core import DIMENSIONS, find_font, run, write_text_atomic
from dv_notes import format_clock

TILE = (480, 270)
CAPTION_H = 30
GAP = 12
ROWS_PER_SHEET = 6
FRAMES = ("start", "mid", "end")


def frame_times(item: dict) -> dict:
    """Start, middle and end of a segment; the start frame sits past the lead-in."""
    start, end = float(item["start"]), float(item["end"])
    return {"start": start + min(0.6, (end - start) / 3), "mid": (start + end) / 2,
            "end": max(start, end - 0.2)}


def caption(number: int, item: dict) -> str:
    label = item.get("label") or "-"
    text = (f"#{number} {item['id']} · {label} · "
            f"{format_clock(item['start'])}-{format_clock(item['end'])}")
    if item.get("kind") == "card":
        return text + " · card"
    return text + f" · {float(item['speed']):.2f}x"


def build_review(build: Path, video: Path, timeline: list, digest: str) -> Path:
    """Write review/frames, review/sheet_*.png and review/critic.draft.json.

    visual-critic.json at the build root is never written here: it is the
    reviewer's record, and a stale one already fails verify on video_sha256.
    """
    from PIL import Image, ImageDraw
    review = build / "review"
    frames_dir = review / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for stale in frames_dir.glob("*.png"):
        stale.unlink()
    for stale in review.glob("sheet_*.png"):
        stale.unlink()
    reviewed = []
    for item in timeline:
        for name in FRAMES:
            when = frame_times(item)[name]
            path = frames_dir / f"{item['id']}-{name}.png"
            run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", f"{when:.3f}",
                 "-i", str(video), "-frames:v", "1", str(path)])
            reviewed.append({"time_s": round(when, 3), "segment": item["id"],
                             "frame": path.relative_to(build).as_posix()})
    font = find_font(18)
    for sheet_no, first in enumerate(range(0, len(timeline), ROWS_PER_SHEET), 1):
        rows = timeline[first:first + ROWS_PER_SHEET]
        sheet = Image.new(
            "RGB",
            (GAP + len(FRAMES) * (TILE[0] + GAP), GAP + len(rows) * (CAPTION_H + TILE[1] + GAP)),
            (9, 14, 25))
        draw = ImageDraw.Draw(sheet)
        for row, item in enumerate(rows):
            top = GAP + row * (CAPTION_H + TILE[1] + GAP)
            draw.text((GAP, top), caption(first + row + 1, item), font=font,
                      fill=(190, 206, 230))
            for column, name in enumerate(FRAMES):
                tile = (Image.open(frames_dir / f"{item['id']}-{name}.png")
                        .convert("RGB").resize(TILE, Image.LANCZOS))
                sheet.paste(tile, (GAP + column * (TILE[0] + GAP), top + CAPTION_H))
        sheet.save(review / f"sheet_{sheet_no:02d}.png")
    draft = {
        "status": "pending",
        "critical": [],
        "dimensions": {name: None for name in DIMENSIONS},
        "reviewed_frames": reviewed,
        "observations": [],
        "limitations": [],
        "reviewer": "",
        "video_sha256": digest,
    }
    path = review / "critic.draft.json"
    write_text_atomic(path, json.dumps(draft, ensure_ascii=False, indent=2))
    return path
