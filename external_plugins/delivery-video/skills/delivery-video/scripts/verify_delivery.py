#!/usr/bin/env python3
"""Verify a rendered screen_demo delivery artifact and its quality evidence.

Usage: verify_delivery.py <build-dir>

Checks the final mp4 spec (h264/1920x1080/30fps/aac), decode integrity, the
quality-gate report bindings (the script, timeline, takes and generated note),
per-shot evidence files and the visual review record. FAIL means fix the material.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import argparse
import json
import shutil
import subprocess

import dv_episode
from dv_core import (
    CRITIC_MIN_SCORE,
    DEMO_STAGE_KIND,
    DIMENSIONS,
    RenderError,
    content_sha256,
    run_json,
    sha256,
)


def probe(path: Path) -> dict:
    return run_json([
        "ffprobe", "-v", "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,avg_frame_rate:format=duration,size",
        "-of", "json", str(path),
    ])


def parse_fps(value: str) -> float:
    numerator, _, denominator = value.partition("/")
    divisor = float(denominator or 1)
    if divisor == 0:
        raise RenderError(f"invalid frame rate: {value}")
    return float(numerator) / divisor


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RenderError(f"invalid JSON in {path}: {exc}") from exc


def bound_path(build: Path, name: object, fallback: str, errors: list[str], label: str):
    """Resolve a name from a JSON file inside the build, or report it and return None."""
    if not isinstance(name, str) or not name:
        name = fallback
    path = (build / name).resolve()
    try:
        path.relative_to(build)
    except ValueError:
        errors.append(f"{label} path resolves outside the build directory: {name}")
        return None
    return path


def check_shot(prefix: str, shot: Path, evidence_path: Path, errors: list[str]) -> None:
    """The same evidence rules preflight and render applied before the take was used."""
    if not shot.is_file():
        errors.append(f"{prefix}: shot file is missing: {shot.name}")
        return
    report = dv_episode.Validation()
    evidence = dv_episode.load_evidence(prefix, evidence_path, report)
    if evidence is not None:
        if evidence.get("kind") == DEMO_STAGE_KIND:
            dv_episode.check_demo_stage_evidence(prefix, shot, report)
        else:
            dv_episode.check_browser_evidence(prefix, shot, True, report)
            try:
                width, height, _ = dv_episode.probe_video(shot)
                dv_episode.check_evidence_size(prefix, evidence, width, height, report)
            except RenderError as exc:
                report.errors.append(f"{prefix}: shot unreadable: {exc}")
    errors.extend(report.errors)


def check_shot_evidence(build: Path, errors: list[str], warnings: list[str]) -> int:
    """Per-shot evidence check: browser/stage shots need a matching evidence file."""
    episode_path = build / "episode.json"
    if not episode_path.is_file():
        errors.append(f"missing {episode_path}")
        return 0
    try:
        episode = load_json(episode_path)
    except RenderError as exc:
        errors.append(str(exc))
        return 0
    segments = episode.get("segments") if isinstance(episode, dict) else None
    if not isinstance(segments, list) or not segments:
        errors.append("episode.json has no segments")
        return 0

    checked = 0
    referenced: set[Path] = set()
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            errors.append(f"segments[{index}] must be an object")
            continue
        prefix = segment.get("id") or f"segments[{index}]"
        if segment.get("kind", "shot") == "card":
            continue
        shot_name = segment.get("shot")
        if not isinstance(shot_name, str) or not shot_name:
            errors.append(f"{prefix}: shot must be a relative path")
            continue
        shot = (build / shot_name).resolve()
        try:
            shot.relative_to(build)
        except ValueError:
            errors.append(f"{prefix}: shot resolves outside the build directory")
            continue
        evidence_path = shot.with_suffix(".evidence.json")
        if evidence_path.is_file():
            referenced.add(evidence_path.resolve())
            check_shot(prefix, shot, evidence_path, errors)
            checked += 1
        elif segment.get("source") in ("browser", "demo-stage"):
            errors.append(
                f"{prefix}: source={segment.get('source')} but {evidence_path.name} is missing"
            )
        elif not shot.is_file():
            errors.append(f"{prefix}: shot file is missing: {shot.name}")

    for evidence_path in sorted(build.rglob("*.evidence.json")):
        if evidence_path.resolve() not in referenced:
            warnings.append(f"{evidence_path.name}: evidence not referenced by episode.json")
    return checked


def check_bindings(build: Path, episode: object, gate: dict, errors: list[str]):
    """The script, timeline, takes and generated note must still be what was rendered."""
    binding = gate.get("episode")
    if not isinstance(binding, dict) or not binding.get("sha256"):
        errors.append(
            "quality report has no episode binding (rendered or re-gated before this "
            "check existed, or by the attachment gate); re-render with render.py"
        )
    elif isinstance(episode, dict) and binding["sha256"] != content_sha256(episode):
        errors.append("episode.json was edited after rendering (sha256 mismatch); re-render")

    timeline = None
    binding = gate.get("timeline")
    if not isinstance(binding, dict) or not binding.get("sha256"):
        errors.append("quality report has no timeline binding; re-render with render.py")
    else:
        path = bound_path(build, binding.get("file"), "timeline.json", errors, "timeline")
        if path is not None:
            if not path.is_file():
                errors.append(f"{path.name}: timeline is missing")
            elif sha256(path) != binding["sha256"]:
                errors.append(f"{path.name} was edited after rendering (sha256 mismatch); re-render")
            else:
                try:
                    timeline = load_json(path)
                except RenderError as exc:
                    errors.append(str(exc))
    if isinstance(timeline, list):
        for item in timeline:
            if not isinstance(item, dict) or not item.get("source_sha256"):
                continue
            name = item.get("source")
            if not isinstance(name, str) or not name:
                errors.append(f"{item.get('id')}: timeline entry names no source take")
                continue
            path = bound_path(build, name, "", errors, "take")
            if path is None:
                continue
            if not path.is_file():
                errors.append(f"{name}: take is missing")
            elif sha256(path) != item["source_sha256"]:
                errors.append(f"{name}: take changed after rendering (sha256 mismatch); "
                              "re-record or re-render")
            evidence_digest = item.get("source_evidence_sha256")
            if not evidence_digest:
                continue
            evidence_path = path.with_suffix(".evidence.json")
            if not evidence_path.is_file():
                errors.append(f"{evidence_path.name}: take evidence is missing")
            elif sha256(evidence_path) != evidence_digest:
                errors.append(f"{evidence_path.name}: take evidence changed after rendering "
                              "(sha256 mismatch)")

    feedback_bound = isinstance(gate.get("feedback"), dict) and bool(gate.get("feedback"))
    binding = gate.get("delivery")
    if isinstance(binding, dict) and binding.get("sha256"):
        path = bound_path(build, binding.get("file"), "delivery.generated.md", errors,
                          "delivery note")
        if path is not None:
            if not path.is_file():
                errors.append(f"{path.name}: delivery note is missing")
            elif sha256(path) != binding["sha256"]:
                errors.append(f"{path.name} was edited after rendering (sha256 mismatch)")
    elif not feedback_bound:
        errors.append(
            "quality report has no delivery note binding "
            "(quality_gate/report.json.delivery is missing); re-render with render.py"
        )
    return timeline if isinstance(timeline, list) else None


def check_feedback_report(build: Path, digest: str, gate: dict) -> list[str]:
    """Check feedback.json and feedback.generated.md against the gate binding."""
    errors: list[str] = []
    feedback_path = build / "feedback.json"
    if not feedback_path.is_file():
        return [f"feedback episode is missing {feedback_path.name}"]
    try:
        feedback = load_json(feedback_path)
    except RenderError as exc:
        return [str(exc)]
    if not isinstance(feedback, dict):
        return [f"feedback report must be an object: {feedback_path}"]
    if (feedback.get("artifact") or {}).get("sha256") != digest:
        errors.append("feedback report is not bound to this artifact (sha256 mismatch)")
    if (feedback.get("gate") or {}).get("status") != "pass":
        errors.append("feedback report gate status is not 'pass'")
    phases = [
        item.get("phase")
        for item in (feedback.get("segments") or [])
        if isinstance(item, dict)
    ]
    if "actual" not in phases:
        errors.append("feedback report has no 'actual' segment")

    binding = gate.get("feedback") if isinstance(gate, dict) else None
    has_binding = isinstance(binding, dict) and bool(binding)
    if not has_binding:
        errors.append(
            "quality report has no feedback report binding "
            "(quality_gate/report.json.feedback is missing); re-render the feedback episode"
        )
        binding = {}
    if binding.get("report") not in (None, feedback_path.name):
        errors.append(
            "quality report feedback binding points at "
            f"{binding.get('report')!r}, expected {feedback_path.name!r}"
        )
    markdown_name = binding.get("markdown")
    if not isinstance(markdown_name, str) or not markdown_name:
        markdown_name = "feedback.generated.md"
    markdown_path = (build / markdown_name).resolve()
    try:
        markdown_path.relative_to(build)
    except ValueError:
        errors.append(
            "feedback markdown path resolves outside the build directory: "
            f"{markdown_name}"
        )
        markdown_path = build / "feedback.generated.md"
    if not markdown_path.is_file():
        errors.append(f"feedback markdown is missing: {markdown_path.name}")
    elif has_binding and binding.get("markdown_sha256") != sha256(markdown_path):
        errors.append(
            "feedback markdown was edited after rendering "
            f"({markdown_path.name} sha256 mismatch)"
        )
    if has_binding and binding.get("sha256") != content_sha256(feedback):
        errors.append(
            "feedback report content was edited after rendering "
            "(feedback.json sha256 mismatch); re-render or restore feedback.json"
        )
    return errors


def check_critic(build: Path, digest: str, timeline: object, length: float,
                 errors: list[str]) -> None:
    """The visual review is a record, not a formality: bound to this artifact,
    attributed to a reviewer, scored at the pass floor, and covering every segment,
    the opening and the ending."""
    path = build / "visual-critic.json"
    if not path.is_file():
        errors.append(
            f"missing visual review: {path} -- look at review/sheet_*.png and "
            "review/frames/, complete review/critic.draft.json, save it as "
            "visual-critic.json"
        )
        return
    try:
        critic = load_json(path)
    except RenderError as exc:
        errors.append(str(exc))
        return
    if not isinstance(critic, dict):
        errors.append(f"visual critic must be an object: {path}")
        return
    if critic.get("status") != "pass":
        errors.append(f"visual critic status is {critic.get('status')!r}")
    if critic.get("critical"):
        errors.append(f"visual critic has {len(critic['critical'])} critical item(s)")
    if critic.get("video_sha256") != digest:
        errors.append("visual critic video_sha256 does not match the current artifact")
    reviewer = critic.get("reviewer")
    if not isinstance(reviewer, str) or not reviewer.strip():
        errors.append("visual critic names no reviewer")
    dimensions = critic.get("dimensions")
    for name in DIMENSIONS:
        score = dimensions.get(name) if isinstance(dimensions, dict) else None
        if isinstance(score, bool) or not isinstance(score, (int, float)) \
                or not 0 <= score <= 1:
            errors.append(f"visual critic dimension {name} is not scored (a 0..1 number)")
        elif score < CRITIC_MIN_SCORE:
            errors.append(
                f"visual critic dimension {name} scores {score:.2f}, below the "
                f"{CRITIC_MIN_SCORE:g} pass floor: fix the material or record the problem "
                "under critical"
            )
    frames = critic.get("reviewed_frames")
    if not isinstance(frames, list) or not frames:
        errors.append("visual critic lists no reviewed frames")
        return
    times = []
    for frame in frames:
        if not isinstance(frame, dict):
            errors.append("visual critic reviewed_frames entries must be objects")
            continue
        value = frame.get("time_s")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            times.append(float(value))
        name = frame.get("frame")
        if name is None:
            continue
        target = bound_path(build, name, "", errors, "reviewed frame")
        if target is not None and not target.is_file():
            errors.append(f"visual critic reviewed frame does not exist: {name}")
    if isinstance(timeline, list):
        for item in timeline:
            if not isinstance(item, dict):
                continue
            try:
                start, end = float(item["start"]), float(item["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if not any(start - 0.05 <= time <= end + 0.05 for time in times):
                errors.append(f"visual critic reviewed no frame inside segment {item.get('id')}")
    if length > 0 and not any(time <= 1.0 for time in times):
        errors.append("visual critic reviewed no frame in the first second")
    if length > 0 and not any(time >= length - 1.0 for time in times):
        errors.append(
            "visual critic reviewed no frame in the last second; "
            "the video must end on a result state"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path, help="screen_demo[-<slug>] build directory")
    args = parser.parse_args()

    build = args.build.expanduser().resolve()
    video = build / "screen_demo.mp4"
    errors: list[str] = []
    warnings: list[str] = []

    missing_tools = [
        name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None
    ]
    if missing_tools:
        return fail(
            [
                f"{name} is not on PATH; install ffmpeg and make sure both binaries are available"
                for name in missing_tools
            ],
            warnings,
        )

    if not video.is_file() or video.stat().st_size == 0:
        return fail([f"missing or empty artifact: {video}"], warnings)

    try:
        data = probe(video)
    except (RenderError, json.JSONDecodeError) as exc:
        return fail([str(exc)], warnings)
    streams = data.get("streams") or []
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if video_stream is None:
        errors.append("artifact has no video stream")
    else:
        if video_stream.get("codec_name") != "h264":
            errors.append(f"expected h264 video, got {video_stream.get('codec_name')}")
        if (video_stream.get("width"), video_stream.get("height")) != (1920, 1080):
            errors.append(
                "expected 1920x1080, got "
                f"{video_stream.get('width')}x{video_stream.get('height')}"
            )
        try:
            fps = parse_fps(str(video_stream.get("avg_frame_rate", "0/1")))
        except (RenderError, ValueError) as exc:
            errors.append(str(exc))
        else:
            if abs(fps - 30) > 0.01:
                errors.append(f"expected 30fps, got {fps:.3f}")
    if audio_stream is None:
        errors.append("artifact has no audio stream")
    elif audio_stream.get("codec_name") != "aac":
        warnings.append(f"audio codec is {audio_stream.get('codec_name')}, expected aac")

    duration = data.get("format", {}).get("duration")
    if duration in (None, "N/A") or float(duration) <= 1:
        errors.append(f"invalid duration: {duration}")
    try:
        decode = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(video), "-f", "null", "-"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        return fail([f"could not run ffmpeg: {exc}"], warnings)
    if decode.returncode:
        errors.append(f"decode failed: {decode.stderr.strip()[-500:]}")

    report_path = build / "quality_gate" / "report.json"
    gate: dict = {}
    notices: list[str] = []
    if not report_path.is_file():
        errors.append(f"missing quality report: {report_path}")
    else:
        try:
            gate = load_json(report_path)
        except RenderError as exc:
            errors.append(str(exc))
        if not isinstance(gate, dict):
            errors.append(f"quality report must be an object: {report_path}")
            gate = {}
        if gate.get("status") != "pass":
            errors.append(f"quality gate status is {gate.get('status')!r} in {report_path}")
        hard = gate.get("hard_failures") or []
        if hard:
            errors.append(f"quality gate has {len(hard)} hard failure(s) in {report_path}")
        if gate.get("profile") != "delivery-v1":
            errors.append(
                f"quality report profile is {gate.get('profile')!r}; "
                "rerun the gate: render.py gate --video <mp4> --work <dir>"
            )
        if (gate.get("checks") or {}).get("loudness_lufs", 0) is None:
            errors.append(
                "loudness was never measured for this artifact (loudness_lufs is null); "
                "re-render: an unmeasurable artifact now fails the gate as L102"
            )
        warnings.extend(
            f"quality warning {item.get('code')}: {item.get('message')}"
            for item in (gate.get("warnings") or [])
        )
        notices.extend(
            f"{item.get('code')}: {item.get('message')}"
            for item in (gate.get("notices") or [])
        )
    digest = sha256(video)
    if gate and gate.get("video_sha256") != digest:
        errors.append(
            "quality report is not bound to this artifact "
            "(video_sha256 missing or mismatched); rerun the gate"
        )
    episode_path = build / "episode.json"
    episode = None
    if episode_path.is_file():
        try:
            episode = load_json(episode_path)
        except RenderError as exc:
            errors.append(str(exc))
    timeline = check_bindings(build, episode, gate, errors) if gate else None
    # A feedback binding in the gate report triggers the tamper checks even when the
    # episode no longer says feedback.
    binding = gate.get("feedback") if isinstance(gate, dict) else None
    feedback_episode = isinstance(episode, dict) and episode.get("intent") == "feedback"
    if feedback_episode or (isinstance(binding, dict) and binding):
        errors.extend(check_feedback_report(build, digest, gate))
    length = 0.0 if duration in (None, "N/A") else float(duration)
    check_critic(build, digest, timeline, length, errors)

    shot_count = check_shot_evidence(build, errors, warnings)
    for notice in notices:
        print(f"NOTE: {notice}")
    for warning in warnings:
        print(f"WARN: {warning}")
    if errors:
        return fail(errors, [])
    score = (gate.get("score") or {}).get("total")
    print(
        f"DELIVERY=PASS video={video} duration={float(duration):.3f}s "
        f"sha256={digest} score={score} profile={gate.get('profile')} "
        f"shots={shot_count} report={report_path}"
    )
    return 0


def fail(errors: list[str], warnings: list[str]) -> int:
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"FAIL: {error}")
    print(f"DELIVERY=FAIL issues={len(errors)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
