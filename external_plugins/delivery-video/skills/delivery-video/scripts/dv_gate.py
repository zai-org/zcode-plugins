#!/usr/bin/env python3
"""The deterministic delivery gate; hard failures make status=fail."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from dv_core import (
    CARD_SHARE_MAX,
    CARD_SHORT_VIDEO_ALLOWANCE,
    FPS,
    H,
    PROFILE,
    W,
    probe_json,
    sha256,
    write_text_atomic,
)


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


def subtract(spans: list[dict], exempt: list[dict]) -> list[dict]:
    """Cut the exempt intervals out of every detected span."""
    kept: list[dict] = []
    for span in spans:
        pieces = [(span["start"], span["end"])]
        for interval in exempt:
            remaining = []
            for start, end in pieces:
                if interval["end"] <= start or interval["start"] >= end:
                    remaining.append((start, end))
                    continue
                if interval["start"] > start:
                    remaining.append((start, interval["start"]))
                if interval["end"] < end:
                    remaining.append((interval["end"], end))
            pieces = remaining
        kept.extend({"start": start, "end": end}
                    for start, end in pieces if end - start >= 0.05)
    return kept


def quality_gate(video: Path, work: Path, exempt: list[dict] | None = None) -> dict:
    """Deterministic delivery gate; hard failures make status=fail.

    `exempt` holds in-video intervals that are static and silent by design
    (cards); they are cut out of every detected span before thresholds apply.
    """
    work.mkdir(parents=True, exist_ok=True)
    hard, warnings, notices, checks = [], [], [], {}
    info = probe_json(video)
    streams = info.get("streams") or []
    fmt = info.get("format") or {}
    total = float(fmt.get("duration") or 0)
    cards = sorted(({"start": max(0.0, float(item["start"])),
                     "end": max(0.0, float(item["end"]))} for item in exempt or []),
                   key=lambda item: item["start"])
    card_s = sum(max(0.0, min(item["end"], total) - item["start"]) for item in cards)

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
        try:
            fps = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            fps = 0.0
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
        # A quarter of the video, or in a short video up to the allowance — but never
        # more card time than real footage.
        card_limit = max(CARD_SHARE_MAX * total,
                         min(CARD_SHORT_VIDEO_ALLOWANCE, total - card_s))
        if card_s > card_limit:
            hard.append({"code": "C301",
                         "message": f"static cards take {card_s:.1f}s of a {total:.1f}s video; "
                                    f"cards may cover {CARD_SHARE_MAX:.0%} of the video, or up "
                                    f"to {CARD_SHORT_VIDEO_ALLOWANCE:g}s in a short video when "
                                    "the footage runs longer -- cards frame the result, they "
                                    "must not carry the demo"})

    if audio_stream is not None:
        ebur = subprocess.run(
            ["ffmpeg", "-nostdin", "-i", str(video), "-filter_complex",
             "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        if ebur.returncode == 0 and "{" in ebur.stderr:
            meas = json.loads(ebur.stderr[ebur.stderr.rindex("{"):ebur.stderr.rindex("}") + 1])
            integrated = float(meas.get("input_i", "0") or 0)
            checks["loudness_lufs"] = integrated
            if not -30 <= integrated <= -5:
                hard.append({"code": "L101",
                             "message": f"integrated loudness {integrated:.1f} LUFS outside [-30,-5]"})
        else:
            checks["loudness_lufs"] = None
            hard.append({"code": "L102",
                         "message": f"loudness could not be measured (ffmpeg exit "
                                    f"{ebur.returncode}), so L101 was not evaluated: "
                                    f"{ebur.stderr.strip()[-300:]}"})
        filters = {
            "black": (["-vf", "blackdetect=d=0.5:pix_th=0.05", "-an"], 1.0, 0.3, "B101"),
            "freeze": (["-vf", "freezedetect=n=-60dB:d=0.5", "-an"], 2.0, 0.8, "T301"),
            "silence": (["-af", "silencedetect=n=-35dB:d=2", "-vn"], 5.0, 2.0, "E301"),
        }
        for name, (args, hard_s, warn_s, code) in filters.items():
            scan = subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "info", "-i", str(video), *args, "-f", "null", "-"],
                capture_output=True, text=True, encoding="utf-8", errors="replace")
            spans = parse_detects(scan.stderr, "start")
            # freezedetect/blackdetect emit only *_start when the span runs to EOF
            if total > 0:
                for span in spans:
                    if "end" not in span:
                        span["end"] = max(span["start"], total)
            spans = subtract(spans, cards)
            lengths = [s["end"] - s["start"] for s in spans]
            checks[f"{name}_spans"] = [
                {"start": round(s["start"], 2), "end": round(s["end"], 2)} for s in spans]
            if lengths:
                longest = max(lengths)
                if longest >= hard_s:
                    hard.append({"code": code,
                                 "message": f"longest {name} span {longest:.1f}s >= {hard_s}s at "
                                            + ", ".join(f"{s['start']:.1f}" for s in spans
                                                        if s["end"] - s["start"] == longest)})
                elif longest >= warn_s:
                    warnings.append({"code": code,
                                     "message": f"longest {name} span {longest:.1f}s"})
                footage = total - card_s
                if name == "freeze" and footage > 0 and sum(lengths) / footage >= 0.20:
                    hard.append({"code": "T304",
                                 "message": f"frozen frames are {sum(lengths)/footage:.0%} of the footage; cut waiting segments or raise playback speed"})
    status = "fail" if hard else "pass"
    score = max(0, 100 - 10 * len(hard) - 2 * len(warnings))
    report = {"profile": PROFILE, "status": status, "video": video.name,
              "video_sha256": sha256(video), "duration_s": round(total, 3),
              "hard_failures": hard, "warnings": warnings, "notices": notices,
              "score": {"total": score}, "checks": checks}
    if cards:
        report["exempt"] = {
            "intervals": [{"start": round(item["start"], 3), "end": round(item["end"], 3)}
                          for item in cards],
            "seconds": round(card_s, 3),
        }
    write_text_atomic(work / "report.json", json.dumps(report, ensure_ascii=False, indent=2))
    return report
