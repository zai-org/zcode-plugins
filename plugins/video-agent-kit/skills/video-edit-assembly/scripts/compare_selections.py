#!/usr/bin/env python3
"""Prepare native timelines and activity totals for two editorial selections.

Standard-library only; rendering and observation use the existing video tools.
See references/selection_comparison.md for the input contract and review method.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path


CLIP_FIELDS = {"source", "start", "end", "duration", "speed", "volume", "reason", "activity", "beat"}


def number(value, label: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    value = float(value)
    if not math.isfinite(value) or (value <= 0 if positive else value < 0):
        raise ValueError(f"{label} must be finite and {'positive' if positive else 'nonnegative'}")
    return value


def required_text(obj: dict, key: str, label: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}.{key} must be nonempty text")
    return value.strip()


def prepare(data: dict, source_root: Path) -> tuple[dict, dict]:
    """Build sequential rough cuts; reject fields that would be silently dropped."""
    if not isinstance(data, dict) or set(data) != {"sequence", "candidates"}:
        raise ValueError("input needs exactly sequence and candidates")
    sequence = data["sequence"]
    if not isinstance(sequence, dict) or set(sequence) != {"width", "height", "fps"}:
        raise ValueError("sequence needs width, height and fps")
    for key in ("width", "height"):
        value = sequence[key]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value % 2:
            raise ValueError(f"sequence.{key} must be a positive even integer")
    fps = number(sequence["fps"], "sequence.fps", positive=True)
    candidates = data["candidates"]
    if not isinstance(candidates, dict) or set(candidates) != {"current", "tighter"}:
        raise ValueError("candidates needs current and tighter selections")

    timelines, summaries = {}, {}
    for name in ("current", "tighter"):
        selection = candidates[name]
        if not isinstance(selection, list) or not selection:
            raise ValueError(f"{name} must be a nonempty list of clips")
        clips, rows, groups = [], [], {}
        cursor = 0.0
        for index, item in enumerate(selection):
            label = f"{name}[{index}]"
            if not isinstance(item, dict) or set(item) - CLIP_FIELDS:
                raise ValueError(f"{label}: use only {', '.join(sorted(CLIP_FIELDS))}; "
                                 "this helper prepares sequential cuts, not a finished multitrack edit")
            activity = required_text(item, "activity", label)
            reason = required_text(item, "reason", label)
            source = Path(required_text(item, "source", label))
            source = (source_root / source).resolve()
            if not source.is_file():
                raise ValueError(f"{label}: source not found: {source}")
            start = number(item.get("start"), f"{label}.start")
            if "end" in item:
                end = number(item["end"], f"{label}.end")
                if end <= start:
                    raise ValueError(f"{label}: end must be greater than start")
                if "duration" in item:
                    duration = number(item["duration"], f"{label}.duration", positive=True)
                    if abs(duration - (end - start)) > 0.05:
                        raise ValueError(f"{label}: duration does not match end-start")
            else:
                end = start + number(item.get("duration"), f"{label}.duration", positive=True)
            speed = number(item.get("speed", 1), f"{label}.speed", positive=True)
            volume = number(item.get("volume", 1), f"{label}.volume")
            duration = (end - start) / speed
            if not math.isfinite(duration) or not math.isfinite(cursor + duration):
                raise ValueError(f"{label}: output duration must be finite")
            if duration < 1 / fps:
                raise ValueError(f"{label}: selection is shorter than one output frame")
            clip = {"source": str(source), "start": start, "end": end, "speed": speed,
                    "volume": volume, "timeline_start": cursor, "reason": reason}
            if "beat" in item:
                clip["beat"] = required_text(item, "beat", label)
            clips.append(clip)
            rows.append({**clip, "index": index, "activity": activity,
                         "output_start": cursor, "output_end": cursor + duration,
                         "output_seconds": duration})
            group = groups.setdefault(activity, {"output_seconds": 0.0, "source_seconds": 0.0,
                                                 "clip_indices": [], "sources": []})
            group["output_seconds"] += duration
            group["source_seconds"] += end - start
            group["clip_indices"].append(index)
            if str(source) not in group["sources"]:
                group["sources"].append(str(source))
            cursor += duration
        for group in groups.values():
            group["output_fraction"] = group["output_seconds"] / cursor
        timelines[name] = {
            "project": {"task": f"Selection comparison: {name}"},
            "sequence": dict(sequence, duration=cursor),
            "assets": [{"source": source} for source in dict.fromkeys(c["source"] for c in clips)],
            "tracks": [{"type": "video", "clips": clips}],
        }
        summaries[name] = {
            "duration_seconds": cursor, "activities": groups, "clips": rows,
            "cut_windows": [{"cut_s": row["output_start"],
                             "start_s": max(0.0, row["output_start"] - 0.25),
                             "end_s": min(cursor, row["output_start"] + 0.25),
                             "left_clip": i - 1, "right_clip": i}
                            for i, row in enumerate(rows) if i],
        }
    return timelines, summaries


def cell(value) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def report(summaries: dict) -> str:
    lines = ["# Selection comparison", "",
             "These are sequential rough cuts of the supplied ranges, with source sound and speed. "
             "Activity totals cover these inputs only; later returns must be included explicitly. "
             "No quality score or preferred candidate is inferred.", "",
             "Render each timeline with `video_render(kind=\"timeline\", ...)`, then inspect both outputs "
             "with `video_observe` at the same sampling fps and around the listed cuts. "
             "These cut windows locate edit boundaries only; expand them to cover action setups, "
             "the last retained outcome and its response. "
             "Use continuous playback/listening when available. "
             "Record what the shorter selection loses or preserves in the project notes.", "",
             "| Activity | Current output seconds | Tighter output seconds | Difference |",
             "| --- | ---: | ---: | ---: |"]
    activities = dict.fromkeys(key for variant in summaries.values() for key in variant["activities"])
    for activity in activities:
        a, b = [summaries[name]["activities"].get(activity, {}).get("output_seconds", 0)
                for name in ("current", "tighter")]
        lines.append(f"| {cell(activity)} | {a:.3f} | {b:.3f} | {b-a:+.3f} |")
    a, b = [summaries[name]["duration_seconds"] for name in ("current", "tighter")]
    lines.append(f"| **Total** | **{a:.3f}** | **{b:.3f}** | **{b-a:+.3f}** |")
    for name, summary in summaries.items():
        lines += ["", f"## {name}", "", f"Timeline: `{name}.timeline.json`", "",
                  "| Clip | Activity / beat | Source | Source range | Preview range | Contribution |",
                  "| ---: | --- | --- | --- | --- | --- |"]
        for row in summary["clips"]:
            lines.append(f"| {row['index']} | {cell(row['activity'])} / {cell(row.get('beat', ''))} "
                         f"| {cell(row['source'])} | {row['start']:.3f}–{row['end']:.3f} "
                         f"| {row['output_start']:.3f}–{row['output_end']:.3f} | {cell(row['reason'])} |")
        lines += ["", "Cut windows (preview seconds): " + ", ".join(
            f"{w['start_s']:.3f}–{w['end_s']:.3f}" for w in summary["cut_windows"])]
    return "\n".join(lines) + "\n"


def write_comparison(input_path: Path, output_dir: Path, source_root: Path | None = None) -> dict:
    raw = input_path.read_bytes()
    root = (source_root or input_path.parent).resolve()
    timelines, summaries = prepare(json.loads(raw), root)
    # Validate all input before creating output. A new directory avoids stale comparisons.
    output_dir.mkdir(parents=True, exist_ok=False)
    summary = {"input_path": str(input_path.resolve()),
               "input_sha256": hashlib.sha256(raw).hexdigest(), "source_root": str(root),
               "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "scope": "Sequential selections only; no final transitions, overlays or separate audio beds.",
               "candidates": summaries}
    for name, timeline in timelines.items():
        (output_dir / f"{name}.timeline.json").write_text(
            json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "comparison.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "comparison.md").write_text(report(summaries), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Selection manifest JSON")
    parser.add_argument("--output-dir", type=Path, required=True, help="New directory for the comparison")
    parser.add_argument("--source-root", type=Path, help="Base for relative sources; defaults to manifest directory")
    args = parser.parse_args()
    try:
        summary = write_comparison(args.input, args.output_dir, args.source_root)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Selection comparison failed: {exc}\n")
    print(json.dumps({"output_dir": str(args.output_dir.resolve()),
                      "duration_seconds": {k: v["duration_seconds"] for k, v in summary["candidates"].items()}},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
