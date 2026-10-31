#!/usr/bin/env python3
"""Fail-loud preflight for a delivery-video screen_demo build directory.

Usage: preflight.py <build-dir>

Checks episode.json structure, real recordings, intervals, crops, browser
recording evidence, TTS cache contracts and narration red lines before the
render step. FAIL means fix the material, not the thresholds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

FPS = 30
LEAD_S = 0.15
TAIL_S = 0.45
DEFAULT_CROP = [260, 64, 1340, 780]
BUILD_NAME = re.compile(r"^screen_demo(?:-[A-Za-z0-9_-]+)?$")
SEGMENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
RATE = re.compile(r"^[+-]\d+%$")
EVIDENCE_KINDS = {"cdp-screencast", "browser-demo"}
DEMO_STAGE_KIND = "demo-stage-recording"
DEMO_STAGE_CROP = [0, 0, 1920, 1080]
ALLOWED_SOURCES = {"browser", "window", "demo-stage"}

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render import AI_CLICHE_PATTERNS, INTERNAL_TERMS  # noqa: E402


class CheckError(Exception):
    pass


def run_json(args: list[str]) -> dict:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise CheckError(f"ffprobe failed for {args[-1]}: {result.stderr.strip()[-500:]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise CheckError(f"ffprobe returned invalid JSON for {args[-1]}: {exc}") from exc


def probe_video(path: Path) -> tuple[int, int, float]:
    data = run_json([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json", str(path),
    ])
    streams = data.get("streams") or []
    if not streams:
        raise CheckError(f"no video stream: {path}")
    duration = data.get("format", {}).get("duration")
    if duration in (None, "N/A"):
        raise CheckError(f"no duration: {path}")
    return int(streams[0]["width"]), int(streams[0]["height"]), float(duration)


def probe_duration(path: Path) -> float:
    data = run_json([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(path),
    ])
    duration = data.get("format", {}).get("duration")
    if duration in (None, "N/A"):
        raise CheckError(f"no duration: {path}")
    return float(duration)


def load_episode(path: Path) -> dict:
    if not path.is_file():
        raise CheckError(f"missing {path}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise CheckError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise CheckError("episode.json must be an object")
    return data


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_evidence(prefix: str, source: Path, declared_browser: bool,
                   errors: list[str]) -> dict | None:
    """Browser source recordings need a matching <shot>.evidence.json."""
    before = len(errors)
    evidence_path = source.with_suffix(".evidence.json")
    if not evidence_path.is_file():
        if declared_browser:
            errors.append(
                f"{prefix}: browser shot needs {evidence_path.name}; "
                "record with a scripted browser screencast tool that writes evidence"
            )
        return None
    try:
        evidence = json.loads(evidence_path.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"{prefix}: invalid evidence JSON {evidence_path.name}: {exc}")
        return None
    if not isinstance(evidence, dict):
        errors.append(f"{prefix}: evidence must be an object: {evidence_path.name}")
        return None
    kind = evidence.get("kind")
    if kind not in EVIDENCE_KINDS:
        errors.append(f"{prefix}: evidence kind {kind!r} is not a browser recording")
    port = evidence.get("port")
    if port is not None and (not isinstance(port, int) or isinstance(port, bool) or port <= 0):
        errors.append(f"{prefix}: evidence port {port!r} must be a positive integer")
    if evidence.get("sha256") != sha256(source):
        errors.append(f"{prefix}: evidence sha256 does not match {source.name}")
    try:
        actual = probe_duration(source)
        recorded = float(evidence.get("video_s"))
    except (CheckError, TypeError, ValueError) as exc:
        errors.append(f"{prefix}: evidence duration unreadable: {exc}")
        return evidence
    if abs(actual - recorded) > 0.2:
        errors.append(
            f"{prefix}: evidence duration {recorded:.2f}s != source {actual:.2f}s"
        )
    if int(evidence.get("frames") or 0) < 1:
        errors.append(f"{prefix}: evidence has no captured frames")
    if len(errors) == before:
        print(
            f"OK {prefix}: evidence kind={kind} port={evidence.get('port')} "
            f"frames={evidence.get('frames')} sha={str(evidence.get('sha256'))[:12]}"
        )
    return evidence


def check_demo_stage_evidence(prefix: str, source: Path, errors: list[str]) -> dict | None:
    """Headless stage recording: kind=demo-stage-recording, self-checks all passed."""
    before = len(errors)
    evidence_path = source.with_suffix(".evidence.json")
    if not evidence_path.is_file():
        errors.append(
            f"{prefix}: demo-stage shot needs {evidence_path.name}; "
            "record with a headless scripted-stage tool that writes evidence"
        )
        return None
    try:
        evidence = json.loads(evidence_path.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"{prefix}: invalid evidence JSON {evidence_path.name}: {exc}")
        return None
    if not isinstance(evidence, dict):
        errors.append(f"{prefix}: evidence must be an object: {evidence_path.name}")
        return None
    if evidence.get("kind") != DEMO_STAGE_KIND:
        errors.append(
            f"{prefix}: evidence kind {evidence.get('kind')!r} is not a demo-stage recording"
        )
    if evidence.get("status") != "passed":
        errors.append(f"{prefix}: demo-stage evidence status {evidence.get('status')!r} != 'passed'")

    checks = evidence.get("checks")
    if not isinstance(checks, list) or not checks:
        errors.append(f"{prefix}: demo-stage evidence has no self-checks")
    else:
        failed = [
            str(item.get("id")) for item in checks
            if not isinstance(item, dict) or item.get("passed") is not True
        ]
        if failed:
            errors.append(f"{prefix}: demo-stage self-checks failed: {', '.join(failed)}")

    capture = evidence.get("capture")
    if not isinstance(capture, dict):
        errors.append(f"{prefix}: demo-stage evidence lacks capture block")
        capture = {}
    if capture.get("headless") is not True:
        errors.append(f"{prefix}: demo-stage recording must be headless (capture.headless=true)")
    if capture.get("window_visible") is not False:
        errors.append(f"{prefix}: demo-stage window was visible; recording must not steal focus")

    video = evidence.get("video")
    if not isinstance(video, dict):
        errors.append(f"{prefix}: demo-stage evidence lacks video block")
        return None
    if video.get("sha256") != sha256(source):
        errors.append(f"{prefix}: evidence sha256 does not match {source.name}")
    if video.get("fps") != FPS:
        errors.append(f"{prefix}: demo-stage evidence fps {video.get('fps')!r} != {FPS}")
    frames = video.get("frames")
    if not isinstance(frames, int) or isinstance(frames, bool) or frames < 1:
        errors.append(f"{prefix}: demo-stage evidence has no captured frames")
    try:
        actual = probe_duration(source)
        recorded = float(video.get("duration_s"))
    except (CheckError, TypeError, ValueError) as exc:
        errors.append(f"{prefix}: demo-stage duration unreadable: {exc}")
        return None
    if abs(actual - recorded) > 0.2:
        errors.append(
            f"{prefix}: demo-stage duration {recorded:.2f}s != source {actual:.2f}s"
        )
    if len(errors) == before:
        print(
            f"OK {prefix}: demo-stage scene={evidence.get('scene', {}).get('id')} "
            f"frames={frames} sha={str(video.get('sha256'))[:12]}"
        )
    return {
        "kind": DEMO_STAGE_KIND,
        "size": video.get("size"),
        "frames": frames,
        "sha256": video.get("sha256"),
    }


def check_evidence_size(prefix: str, evidence: dict | None, width: int, height: int,
                        errors: list[str]) -> None:
    if evidence is None:
        return
    if [width, height] != [1920, 1080]:
        errors.append(f"{prefix}: browser source must be 1920x1080, got {width}x{height}")
    if evidence.get("size") != [width, height]:
        errors.append(
            f"{prefix}: evidence size {evidence.get('size')!r} != source {width}x{height}"
        )


def check_crop(segment_id: str, crop: object, width: int, height: int,
               errors: list[str], default: list[int] | None = None) -> None:
    if crop is None:
        crop = default or DEFAULT_CROP
    if (not isinstance(crop, list) or len(crop) != 4
            or not all(isinstance(v, int) and not isinstance(v, bool) for v in crop)):
        errors.append(f"{segment_id}: crop must be [x, y, w, h] integers")
        return
    x, y, w, h = crop
    if x < 0 or y < 0 or w <= 0 or h <= 0:
        errors.append(f"{segment_id}: crop has non-positive size or negative origin {crop}")
    elif x + w > width or y + h > height:
        errors.append(
            f"{segment_id}: crop {crop} exceeds source {width}x{height}"
        )


def check_tts(build: Path, segment: dict, start: float, end: float,
              voice: str, rate: str, errors: list[str]) -> bool:
    segment_id = segment["id"]
    mp3 = build / "tts" / f"{segment_id}.mp3"
    clock = build / "tts" / f"{segment_id}.json"
    if not mp3.exists() and not clock.exists():
        return True
    if not mp3.is_file() or not clock.is_file():
        errors.append(f"{segment_id}: incomplete TTS cache, need both .mp3 and .json")
        return False
    try:
        cached = json.loads(clock.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"{segment_id}: invalid TTS clock JSON: {exc}")
        return False
    if not isinstance(cached, dict):
        errors.append(f"{segment_id}: TTS clock must be a JSON object")
        return False
    expected = {"text": segment["text"], "voice": voice, "rate": rate}
    for key, value in expected.items():
        if cached.get(key) != value:
            errors.append(
                f"{segment_id}: TTS cache mismatch for {key}; "
                "delete the stale tts/<id>.mp3 and .json, then rerender"
            )
    try:
        audio_duration = probe_duration(mp3)
    except CheckError as exc:
        errors.append(str(exc))
        return False
    seconds = math.ceil((audio_duration + LEAD_S + TAIL_S) * FPS) / FPS
    speed = (end - start) / seconds if seconds else 0.0
    if not 0.3 <= speed <= 3.0:
        errors.append(
            f"{segment_id}: recording speed {speed:.2f}x outside 0.3x..3x "
            f"(interval {end - start:.2f}s, narration {seconds:.2f}s)"
        )
    return False


def check_redline(texts: list[str], errors: list[str], warnings: list[str]) -> None:
    for index, text in enumerate(texts, 1):
        for name, pattern in AI_CLICHE_PATTERNS:
            if pattern.search(text):
                errors.append(
                    f"narration {index}: AI-cliche pattern {name}; "
                    "write a plain factual statement from the viewer's perspective"
                )
        lowered = text.lower()
        for term in INTERNAL_TERMS:
            if term in lowered:
                warnings.append(
                    f"narration {index}: internal jargon '{term}' is fine for technical "
                    "acceptance; remove it for external deliveries"
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path, help="screen_demo[-<slug>] build directory")
    args = parser.parse_args()

    build_path = args.build.expanduser()
    build = build_path.resolve()
    episode_path = build / "episode.json"
    errors: list[str] = []
    warnings: list[str] = []

    if not build.is_dir():
        errors.append(f"missing build directory: {build}")
        return report(errors, warnings)
    if not BUILD_NAME.match(build_path.name):
        errors.append(
            f"build directory {build_path.name!r} is not accepted by render.py; "
            "use screen_demo or screen_demo-<slug>"
        )
    try:
        episode = load_episode(episode_path)
    except CheckError as exc:
        errors.append(str(exc))
        return report(errors, warnings)

    voice_value = episode.get("voice")
    rate_value = episode.get("rate", "+5%")
    voice_ok = isinstance(voice_value, str) and bool(voice_value.strip())
    rate_ok = isinstance(rate_value, str) and bool(RATE.match(rate_value))
    if not voice_ok:
        errors.append("voice must be a non-empty string")
    if not rate_ok:
        errors.append(f"rate must look like +5% or -10%, got {rate_value!r}")

    segments = episode.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments must be a non-empty array")
        return report(errors, warnings)

    seen_ids: set[str] = set()
    texts: list[str] = []
    tts_missing: list[str] = []
    tts_voice = voice_value if voice_ok else ""
    tts_rate = rate_value if rate_ok else "+5%"
    for index, segment in enumerate(segments):
        prefix = f"segments[{index}]"
        if not isinstance(segment, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not SEGMENT_ID.match(segment_id):
            errors.append(f"{prefix}: id must be ASCII letters/digits/_/- and start alphanumeric")
            continue
        if segment_id in seen_ids:
            errors.append(f"{segment_id}: duplicate id")
            continue
        seen_ids.add(segment_id)
        prefix = segment_id

        label = segment.get("label")
        if not isinstance(label, str) or not label.strip():
            errors.append(f"{prefix}: label must be a non-empty string")
        text = segment.get("text")
        text_ok = isinstance(text, str) and bool(text.strip()) and "\n" not in text and "\r" not in text
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{prefix}: text must be a non-empty string")
        elif "\n" in text or "\r" in text:
            errors.append(f"{prefix}: text must be one paragraph without newlines")
        else:
            texts.append(text)

        shot = segment.get("shot")
        if not isinstance(shot, str) or not shot.strip():
            errors.append(f"{prefix}: shot must be a relative path")
            continue
        shot_path = Path(shot)
        if shot_path.is_absolute() or ".." in shot_path.parts:
            errors.append(f"{prefix}: shot must stay inside the build directory")
            continue
        source_kind = segment.get("source")
        if source_kind is not None and source_kind not in ALLOWED_SOURCES:
            errors.append(
                f"{prefix}: source must be one of {sorted(ALLOWED_SOURCES)}, got {source_kind!r}"
            )
            continue
        source = (build / shot_path).resolve()
        try:
            source.relative_to(build)
        except ValueError:
            errors.append(f"{prefix}: shot resolves outside the build directory")
            continue
        if not source.is_file() or source.stat().st_size == 0:
            errors.append(f"{prefix}: missing or empty recording {source}")
            continue
        if source_kind == "demo-stage":
            evidence = check_demo_stage_evidence(prefix, source, errors)
        else:
            evidence = check_evidence(prefix, source, source_kind == "browser", errors)

        start = segment.get("start")
        end = segment.get("end")
        if (not isinstance(start, (int, float)) or isinstance(start, bool)
                or not isinstance(end, (int, float)) or isinstance(end, bool)):
            errors.append(f"{prefix}: start and end must be numbers")
            continue
        if start < 0 or end <= start:
            errors.append(f"{prefix}: require 0 <= start < end, got {start}..{end}")
            continue

        try:
            width, height, duration = probe_video(source)
        except CheckError as exc:
            errors.append(str(exc))
            continue
        check_evidence_size(prefix, evidence, width, height, errors)
        if end > duration + 0.1:
            errors.append(
                f"{prefix}: interval ends at {end:.2f}s beyond source duration {duration:.2f}s"
            )
            continue
        check_crop(
            prefix, segment.get("crop"), width, height, errors,
            default=DEMO_STAGE_CROP if source_kind == "demo-stage" else None,
        )
        print(
            f"OK {prefix}: {shot} {start:.2f}-{end:.2f}s "
            f"source={width}x{height} duration={duration:.2f}s"
        )
        if voice_ok and rate_ok and text_ok:
            if check_tts(build, segment, float(start), float(end),
                         tts_voice, tts_rate, errors):
                tts_missing.append(prefix)

    if texts:
        check_redline(texts, errors, warnings)
    if tts_missing:
        warnings.append(
            f"{len(tts_missing)} segment(s) have no cached TTS; speed range not checked: "
            + ", ".join(tts_missing)
        )
    return report(errors, warnings)


def report(errors: list[str], warnings: list[str]) -> int:
    for warning in warnings:
        print(f"WARN: {warning}")
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        print(f"PREFLIGHT=FAIL issues={len(errors)}")
        return 1
    print(f"PREFLIGHT=PASS warnings={len(warnings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
