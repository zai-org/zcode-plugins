#!/usr/bin/env python3
"""Verify a rendered screen_demo delivery artifact and its quality evidence.

Usage: verify_delivery.py <build-dir> [--require-critic]

Checks the final mp4 spec (h264/1920x1080/30fps/aac), decode integrity, the
quality-gate report binding (video_sha256), per-shot evidence files and the
optional independent visual review. FAIL means fix the material.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render import feedback_content_sha256  # noqa: E402


class CheckError(Exception):
    pass


def run_json(args: list[str]) -> dict:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise CheckError(f"could not run {args[0]}: {exc}") from exc
    if result.returncode:
        raise CheckError(f"ffprobe failed: {result.stderr.strip()[-500:]}")
    return json.loads(result.stdout)


def probe(path: Path) -> dict:
    return run_json([
        "ffprobe", "-v", "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,r_frame_rate:format=duration,size",
        "-of", "json", str(path),
    ])


def parse_fps(value: str) -> float:
    numerator, _, denominator = value.partition("/")
    divisor = float(denominator or 1)
    if divisor == 0:
        raise CheckError(f"invalid frame rate: {value}")
    return float(numerator) / divisor


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CheckError(f"invalid JSON in {path}: {exc}") from exc


def check_shot(prefix: str, shot: Path, evidence_path: Path, errors: list[str]) -> None:
    if not shot.is_file():
        errors.append(f"{prefix}: shot file is missing: {shot.name}")
        return
    try:
        evidence = load_json(evidence_path)
    except CheckError as exc:
        errors.append(str(exc))
        return
    if not isinstance(evidence, dict):
        errors.append(f"{prefix}: evidence must be an object: {evidence_path.name}")
        return
    kind = evidence.get("kind")
    if kind not in {"cdp-screencast", "browser-demo", "demo-stage-recording"}:
        errors.append(f"{prefix}: evidence kind {evidence.get('kind')!r} is not a browser/stage recording")
        return
    port = evidence.get("port")
    if port is not None and (not isinstance(port, int) or isinstance(port, bool) or port <= 0):
        errors.append(f"{prefix}: evidence port {port!r} must be a positive integer")
    if kind == "demo-stage-recording":
        video = evidence.get("video")
        if not isinstance(video, dict):
            errors.append(f"{prefix}: demo-stage evidence lacks video block")
            return
        if evidence.get("status") != "passed":
            errors.append(f"{prefix}: demo-stage evidence status {evidence.get('status')!r} != 'passed'")
        if video.get("sha256") != sha256(shot):
            errors.append(f"{prefix}: evidence sha256 does not match {shot.name}")
        if int(video.get("frames") or 0) < 1:
            errors.append(f"{prefix}: evidence has no captured frames")
        try:
            recorded = float(video.get("duration_s"))
        except (TypeError, ValueError):
            errors.append(f"{prefix}: demo-stage duration unreadable")
            return
    else:
        if evidence.get("video") not in (None, shot.name):
            errors.append(
                f"{prefix}: evidence video {evidence.get('video')!r} does not match {shot.name}"
            )
        if evidence.get("sha256") != sha256(shot):
            errors.append(f"{prefix}: evidence sha256 does not match {shot.name}")
        if int(evidence.get("frames") or 0) < 1:
            errors.append(f"{prefix}: evidence has no captured frames")
        try:
            recorded = float(evidence.get("video_s"))
        except (TypeError, ValueError):
            errors.append(f"{prefix}: evidence duration unreadable")
            return
    try:
        info = probe(shot)
        stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
        size = [stream.get("width"), stream.get("height")]
        actual = float(info["format"]["duration"])
    except (CheckError, KeyError, TypeError, ValueError) as exc:
        errors.append(f"{prefix}: evidence duration/size unreadable: {exc}")
        return
    if kind != "demo-stage-recording":
        if size != [1920, 1080]:
            errors.append(f"{prefix}: browser shot must be 1920x1080, got {size[0]}x{size[1]}")
        if evidence.get("size") != size:
            errors.append(f"{prefix}: evidence size {evidence.get('size')!r} != shot {size}")
    if abs(actual - recorded) > 0.2:
        errors.append(f"{prefix}: evidence duration {recorded:.2f}s != shot {actual:.2f}s")


def check_shot_evidence(build: Path, errors: list[str], warnings: list[str]) -> int:
    """Per-shot evidence check: browser/stage shots need a matching evidence file."""
    episode_path = build / "episode.json"
    if not episode_path.is_file():
        errors.append(f"missing {episode_path}")
        return 0
    try:
        episode = load_json(episode_path)
    except CheckError as exc:
        errors.append(str(exc))
        return 0
    segments = episode.get("segments") if isinstance(episode, dict) else None
    if not isinstance(segments, list) or not segments:
        errors.append("episode.json has no segments")
        return 0

    checked = 0
    referenced: set[Path] = set()
    for index, segment in enumerate(segments):
        prefix = segment.get("id") or f"segments[{index}]"
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


def check_feedback_report(build: Path, digest: str, gate: dict) -> list[str]:
    """Check feedback.json and feedback.generated.md against the gate binding."""
    errors: list[str] = []
    feedback_path = build / "feedback.json"
    if not feedback_path.is_file():
        return [f"feedback episode is missing {feedback_path.name}"]
    try:
        feedback = load_json(feedback_path)
    except CheckError as exc:
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
    if has_binding and binding.get("sha256") != feedback_content_sha256(feedback):
        errors.append(
            "feedback report content was edited after rendering "
            "(feedback.json sha256 mismatch); re-render or restore feedback.json"
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path, help="screen_demo[-<slug>] build directory")
    parser.add_argument(
        "--require-critic",
        action="store_true",
        help="fail when visual-critic.json is missing",
    )
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
    except (CheckError, json.JSONDecodeError) as exc:
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
        fps = parse_fps(str(video_stream.get("r_frame_rate", "0/1")))
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
            ["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"],
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
        except CheckError as exc:
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
        score = gate.get("score") or {}
        warnings.extend(
            f"quality warning {item.get('code')}: {item.get('message')}"
            for item in (gate.get("warnings") or [])
        )
        notices.extend(
            f"{item.get('code')}: {item.get('message')}"
            for item in (gate.get("notices") or [])
        )
    critic_path = build / "visual-critic.json"
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
        except CheckError as exc:
            errors.append(str(exc))
    # episode.json is outside every hash chain, so a feedback binding in the gate
    # report triggers the tamper checks even when the episode no longer says feedback
    binding = gate.get("feedback") if isinstance(gate, dict) else None
    feedback_episode = isinstance(episode, dict) and episode.get("intent") == "feedback"
    if feedback_episode or (isinstance(binding, dict) and binding):
        errors.extend(check_feedback_report(build, digest, gate))
    if critic_path.is_file():
        try:
            critic = load_json(critic_path)
        except CheckError as exc:
            errors.append(str(exc))
            critic = {}
        if not isinstance(critic, dict):
            errors.append(f"visual critic must be an object: {critic_path}")
            critic = {}
        if critic.get("status") != "pass":
            errors.append(f"visual critic status is {critic.get('status')!r}")
        if critic.get("critical"):
            errors.append(f"visual critic has {len(critic['critical'])} critical item(s)")
        if critic.get("video_sha256") != digest:
            errors.append("visual critic video_sha256 does not match the current artifact")
    elif args.require_critic:
        errors.append(f"missing independent visual review: {critic_path}")

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
