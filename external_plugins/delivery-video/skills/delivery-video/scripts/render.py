#!/usr/bin/env python3
"""Self-contained delivery-demo renderer: episode.json -> screen_demo.mp4.

Subcommands:
  render <build-dir>                    render all segments + run the built-in gate
  gate --video <mp4> --work <dir>       run the delivery gate on any mp4 (attachment gate)

Requires: python3.9+, ffmpeg & ffprobe on PATH,
`pip install "edge-tts>=7.3.1" Pillow`.

Fail-loud by design: preflight violations, missing recordings, out-of-range speed
and gate hard failures all abort with a nonzero exit.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import argparse
import asyncio
import bisect
import dataclasses
import json
import os
import subprocess
import tempfile
from collections.abc import Callable, Iterator

from dv_core import (
    CARD_DEFAULT,
    CLIPS_DIR,
    FPS,
    H,
    LEAD,
    OUTPUT_DIRS,
    PAD_TOLERANCE,
    PHASE_LABELS,
    SEVERITIES,
    SPEED_NOTICE,
    W,
    RenderError,
    check_tools,
    content_sha256,
    crop_error,
    duration,
    run,
    same_file_key,
    sha256,
    write_text_atomic,
)
from dv_draw import card_frame, header, load_fonts, repro_panel, subtitle
from dv_episode import Source, speed_error, validate
from dv_gate import quality_gate
from dv_notes import (
    bind_feedback_evidence,
    write_delivery_note,
    write_feedback_markdown,
    write_feedback_report,
    write_report,
)
from dv_review import build_review
from dv_tts import Narration, cache_files, group_lines, synth

STAGING_ARTIFACT = "screen_demo.rendering.mp4"


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
    # speed > 1 fast-forwards: output timestamps are the source ones divided by speed
    parts.append(
        f"setpts=(PTS-STARTPTS)/{speed:.6f},{box}:force_original_aspect_ratio=decrease"
        f":flags=lanczos,eq=brightness=-0.035,{pad}:color=0x10182b")
    # tpad only covers frame-count rounding and a sparse last frame; a take that ends
    # early still falls short here
    parts.append(f"fps={FPS},tpad=stop_mode=clone:stop_duration={PAD_TOLERANCE}")
    return ",".join(parts)


def narration_filter() -> str:
    return f"adelay={round(LEAD * 1000)}:all=1,apad"


@dataclasses.dataclass
class Planned:
    """One segment with its narration synthesized and its timing already legal."""
    segment: dict
    seconds: float
    source: Source | None = None
    narration: Narration | None = None
    speed: float | None = None
    take_digest: str | None = None
    evidence_digest: str | None = None

    @property
    def kind(self) -> str:
        return self.segment.get("kind", "shot")


def plan_segments(build: Path, segments: list, sources: dict, voice: str,
                  rate: str) -> list:
    """Phase 1: every narration is synthesized and every duration rule checked
    before a single frame is rendered, so a bad segment costs no render time.
    Take fingerprints are taken here, before anything could touch a take."""
    planned, problems = [], []
    take_digests: dict = {}
    for segment in segments:
        narration = None
        if segment.get("text"):
            narration = asyncio.run(synth(segment, voice, rate, build))
        if segment.get("kind", "shot") == "card":
            seconds = narration.seconds if narration else float(
                segment.get("duration", CARD_DEFAULT))
            planned.append(Planned(segment, seconds, narration=narration))
            continue
        error = speed_error(segment, narration.seconds)
        if error:
            problems.append(error)
            continue
        source = sources[segment["id"]]
        if source.path not in take_digests:
            evidence = source.path.with_suffix(".evidence.json")
            take_digests[source.path] = (
                sha256(source.path), sha256(evidence) if evidence.is_file() else None)
        take_digest, evidence_digest = take_digests[source.path]
        span = float(segment["end"]) - float(segment["start"])
        planned.append(Planned(segment, narration.seconds, source, narration,
                               span / narration.seconds, take_digest, evidence_digest))
    if problems:
        raise RenderError(
            "nothing rendered yet; fix these segments first:\n"
            + "\n".join(f"  - {problem}" for problem in problems)
        )
    return planned


def chips(item: Planned, feedback: dict | None) -> tuple:
    segment = item.segment
    case = (PHASE_LABELS.get(segment.get("phase", ""), "") if feedback
            else segment.get("case", ""))
    return SEVERITIES.get((feedback or {}).get("severity", ""), ("", None)), case


def subtitle_state(lines: list, starts: list, frame_index: int):
    """The subtitle line on screen and how many of its chars have been spoken."""
    t = frame_index / FPS * 1000 - LEAD * 1000
    index = bisect.bisect_right(starts, t) - 1
    if index < 0 or t > lines[index][-1]["end_ms"] + 180:
        return None
    return lines[index], sum(1 for char in lines[index] if char["start_ms"] <= t)


def encode_frames(build: Path, segment_id: str, seconds: float, frames: Iterator[bytes],
                  decode_error: Callable[[], str]) -> Path:
    """Feed raw RGB frames to one ffmpeg encoder, writing clips/<id>.mp4.

    stderr goes to a temp file: an unread stderr PIPE deadlocks past 64KB.
    A failure inside the frame source is reported together with both ffmpeg logs.
    """
    clips = build / CLIPS_DIR
    clips.mkdir(exist_ok=True)
    output = clips / f"{segment_id}.mp4"
    encode_log = tempfile.TemporaryFile()
    encode = subprocess.Popen(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0", "-an", "-t", str(seconds),
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
         str(output)],
        stdin=subprocess.PIPE, stderr=encode_log)
    failure, broken = "", False
    try:
        for content in frames:
            encode.stdin.write(content)
    except RenderError as exc:
        failure = str(exc)
    except BrokenPipeError:
        broken = True
    finally:
        try:
            encode.stdin.close()
        except BrokenPipeError:
            broken = True
        encode.wait()
        encode_log.seek(0)
        error = encode_log.read().decode(errors="replace")
        encode_log.close()
    if failure or broken or encode.returncode or decode_error():
        parts = [failure or "video encoding failed:", decode_error(), error]
        raise RenderError("\n".join(part for part in parts if part))
    return output


def shot_frames(item: Planned, build: Path, feedback: dict | None, layout: str,
                log: dict) -> Iterator[bytes]:
    from PIL import Image, ImageDraw
    segment, source = item.segment, item.source
    start, end = float(segment["start"]), float(segment["end"])
    if not 0 <= start < end <= source.duration + 0.1:
        raise RenderError(f"invalid recording interval: {segment['id']}")
    crop = segment.get("crop")
    if crop is not None:
        error = crop_error(segment["id"], crop, source.width, source.height)
        if error:
            raise RenderError(error)
    vf = segment_filter(crop, layout, item.speed, item.seconds)
    fonts = load_fonts()
    severity, case = chips(item, feedback)
    lines = group_lines(item.narration.chars)
    starts = [line[0]["start_ms"] for line in lines]
    repro_steps = list((feedback or {}).get("repro") or [])
    show_repro = bool(feedback) and segment.get("phase") == "repro" and bool(repro_steps)
    decode_log = tempfile.TemporaryFile()
    decode = subprocess.Popen(
        ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-t", str(end - start),
         "-i", str(source.path), "-vf", vf, "-frames:v", str(round(item.seconds * FPS)),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE, stderr=decode_log)
    frame_count = round(item.seconds * FPS)
    try:
        for frame_index in range(frame_count):
            content = decode.stdout.read(W * H * 3)
            if len(content) != W * H * 3:
                raise RenderError(
                    f"{segment['id']}: recording ends after {frame_index} of {frame_count} "
                    "frames; the take delivers less than its header promises (truncated "
                    f"recording, or a last frame gap over {PAD_TOLERANCE:g}s) -- re-record "
                    "the take or end the segment earlier")
            frame = Image.frombytes("RGB", (W, H), content)
            draw = ImageDraw.Draw(frame)
            header(draw, fonts, severity, case, segment["label"])
            if show_repro:
                repro_panel(draw, fonts, repro_steps)
            state = subtitle_state(lines, starts, frame_index)
            if state is not None:
                subtitle(draw, fonts, state[0], layout, state[1])
            yield frame.tobytes()
    finally:
        decode.stdout.close()
        failed = decode.wait()
        decode_log.seek(0)
        if failed:
            log["decode"] = decode_log.read().decode(errors="replace")
        decode_log.close()


def card_frames(item: Planned, feedback: dict | None) -> Iterator[bytes]:
    from PIL import ImageDraw
    segment = item.segment
    fonts = load_fonts()
    severity, case = chips(item, feedback)
    title = segment.get("title") or segment["text"]
    base = card_frame(fonts, title, severity, case, segment.get("label") or "")
    narrated = item.narration if segment.get("text") not in (None, title) else None
    lines = group_lines(narrated.chars) if narrated else []
    starts = [line[0]["start_ms"] for line in lines]
    for frame_index in range(round(item.seconds * FPS)):
        state = subtitle_state(lines, starts, frame_index) if lines else None
        if state is None:
            yield base.tobytes()
            continue
        frame = base.copy()
        subtitle(ImageDraw.Draw(frame), fonts, state[0], "fullbleed", state[1])
        yield frame.tobytes()


def write_audio(item: Planned, build: Path) -> Path:
    """Narration for narrated segments, digital silence for silent cards."""
    wav = build / CLIPS_DIR / f"{item.segment['id']}.wav"
    if item.narration is None:
        run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
             "anullsrc=r=44100:cl=stereo", "-t", str(item.seconds),
             "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(wav)])
    else:
        run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(item.narration.mp3),
             "-af", narration_filter(), "-t", str(item.seconds),
             "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(wav)])
    return wav


def render_item(item: Planned, build: Path, feedback: dict | None = None,
                layout: str = "banded") -> Path:
    log = {"decode": ""}
    if item.kind == "card":
        clip = encode_frames(build, item.segment["id"], item.seconds,
                             card_frames(item, feedback), lambda: "")
    else:
        clip = encode_frames(build, item.segment["id"], item.seconds,
                             shot_frames(item, build, feedback, layout, log),
                             lambda: log["decode"])
    write_audio(item, build)
    speed = f" {item.speed:.2f}x" if item.speed is not None else ""
    print(f"RENDERED {item.segment['id']}: {item.seconds:.2f}s{speed}", flush=True)
    return clip


def timeline_entry(item: Planned, start: float) -> dict:
    segment = item.segment
    entry = {"id": segment["id"], "kind": item.kind,
             "start": round(start, 3), "end": round(start + item.seconds, 3)}
    for key in ("label", "case"):
        if segment.get(key):
            entry[key] = segment[key]
    if item.kind == "card":
        entry["title"] = segment.get("title") or segment["text"]
        if segment.get("text"):
            entry["text"] = segment["text"]
        return entry
    entry.update({
        "source": segment["shot"],
        "source_start": segment["start"], "source_end": segment["end"],
        "speed": round(item.speed, 3), "source_sha256": item.take_digest,
    })
    if item.evidence_digest:
        entry["source_evidence_sha256"] = item.evidence_digest
    return entry


def loudnorm_finalize(raw: Path, final: Path) -> None:
    """Two-pass loudnorm (single pass drifts 1-1.5 LU); video stream copied."""
    probe = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", str(raw), "-af",
         "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if probe.returncode:
        raise RenderError(f"loudness measurement failed:\n{probe.stderr[-1000:]}")
    meas = json.loads(probe.stderr[probe.stderr.rindex("{"):probe.stderr.rindex("}") + 1])
    af = ("loudnorm=I=-14:TP=-1.5:LRA=11:"
          f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
          f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:linear=true")
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(raw), "-af", af,
         "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-c:v", "copy", str(final)])


def assemble(build: Path, clips: list, offset: float) -> Path:
    """Concatenate the clips, mux the narration and normalize loudness.

    The result is staged under a temporary name and renamed over
    screen_demo.mp4 only once it is complete, so an interrupted re-render never
    destroys the previous gated artifact.
    """
    parts = build / CLIPS_DIR
    video_list = parts / "_video.txt"
    write_text_atomic(video_list, "".join(f"file '{clip.name}'\n" for clip in clips))
    picture = parts / "_picture.mp4"
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(video_list), "-c", "copy", "-movflags", "+faststart", str(picture)])
    audio_list = parts / "_audio.txt"
    write_text_atomic(audio_list, "".join(f"file '{clip.stem}.wav'\n" for clip in clips))
    narration_wav = parts / "_voice.wav"
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(audio_list), "-c:a", "pcm_s16le", str(narration_wav)])
    assembled = parts / "_assembled.mp4"
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(picture), "-i", str(narration_wav),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
         "-ar", "44100", "-ac", "2", "-t", str(offset), str(assembled)])
    staging = build / STAGING_ARTIFACT
    try:
        loudnorm_finalize(assembled, staging)
        measured = duration(staging)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    if abs(measured - offset) > 0.15:
        staging.unlink()
        raise RenderError(f"final duration {measured:.3f}s != expected {offset:.3f}s")
    os.replace(staging, build / "screen_demo.mp4")
    return build / "screen_demo.mp4"


def clear_stale(build: Path) -> None:
    """Drop a half-written artifact and stray temp files left by an interrupted run."""
    stale = [build / STAGING_ARTIFACT]
    for folder in (build, *(build / name for name in OUTPUT_DIRS)):
        stale += folder.glob("*.tmp")
    for path in stale:
        path.unlink(missing_ok=True)


def guard_outputs(build: Path, segments: list, sources: dict, voice: str, rate: str) -> None:
    """Last line of defence for takes: nothing the renderer is about to write may be a
    take, however the take's path is spelled (case, symlinks)."""
    takes = {same_file_key(source.path) for source in sources.values()}
    outputs = [build / name for name in (
        "screen_demo.mp4", STAGING_ARTIFACT, "timeline.json", "cover.png",
        "delivery.generated.md", "feedback.json", "feedback.generated.md")]
    outputs += [build / "quality_gate" / "report.json", build / "review" / "critic.draft.json"]
    outputs += [build / CLIPS_DIR / name for name in (
        "_video.txt", "_audio.txt", "_picture.mp4", "_voice.wav", "_assembled.mp4")]
    for segment in segments:
        segment_id = segment["id"]
        outputs += [build / CLIPS_DIR / f"{segment_id}.mp4",
                    build / CLIPS_DIR / f"{segment_id}.wav"]
        outputs += [build / "review" / "frames" / f"{segment_id}-{mark}.png"
                    for mark in ("start", "mid", "end")]
        if segment.get("text"):
            outputs += list(cache_files(build, segment_id, segment["text"], voice, rate))
    hits = sorted(str(path) for path in outputs if same_file_key(path) in takes)
    if hits:
        raise RenderError("refusing to render: these outputs would overwrite a take: "
                          + ", ".join(hits))


def cmd_render(build: Path) -> int:
    validation = validate(build)
    for note in validation.notes:
        print(f"OK {note}", flush=True)
    for warning in validation.warnings:
        print(f"WARN: {warning}", flush=True)
    if validation.errors:
        raise RenderError(
            "preflight failed; fix the material, not the thresholds:\n"
            + "\n".join(f"  - {error}" for error in validation.errors))
    episode = validation.episode
    segments = episode["segments"]
    feedback = episode.get("issue") if episode.get("intent") == "feedback" else None
    layout = validation.layout
    voice, rate = episode["voice"], episode.get("rate", "+5%")

    clear_stale(build)
    guard_outputs(build, segments, validation.sources, voice, rate)
    planned = plan_segments(build, segments, validation.sources, voice, rate)
    tracks, timeline, retimed, offset = [], [], [], 0.0
    for item in planned:
        tracks.append(render_item(item, build, feedback, layout))
        timeline.append(timeline_entry(item, offset))
        if item.speed is not None and not SPEED_NOTICE[0] <= item.speed <= SPEED_NOTICE[1]:
            retimed.append({"id": item.segment["id"], "speed": round(item.speed, 3)})
            note = "feedback.generated.md" if feedback is not None else "delivery.generated.md"
            print(f"WARN {item.segment['id']}: playback {item.speed:.2f}x -- the footage is "
                  f"{'fast-forwarded' if item.speed > 1 else 'slowed down'}; "
                  f"it is disclosed in {note}", flush=True)
        offset += item.seconds

    final = assemble(build, tracks, offset)
    run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", "2", "-i", str(final),
         "-frames:v", "1", str(build / "cover.png")])
    timeline_path = build / "timeline.json"
    write_text_atomic(timeline_path, json.dumps(timeline, ensure_ascii=False, indent=2))
    cards = [{"start": item["start"], "end": item["end"]}
             for item in timeline if item["kind"] == "card"]
    report = quality_gate(final, build / "quality_gate", cards)
    report["episode"] = {"file": "episode.json", "sha256": content_sha256(episode)}
    report["timeline"] = {"file": "timeline.json", "sha256": sha256(timeline_path)}
    if feedback is not None:
        feedback_report_path = write_feedback_report(build, feedback, segments, report)
        markdown_path = write_feedback_markdown(build, feedback, segments, timeline, report,
                                                retimed)
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
    else:
        note_path = write_delivery_note(build, episode, timeline, report, retimed)
        report["delivery"] = {"file": note_path.name, "sha256": sha256(note_path)}
        write_report(build / "quality_gate" / "report.json", report)
        print(f"NOTE {note_path}", flush=True)
    draft = build_review(build, final, timeline, report["video_sha256"])
    print(f"NOTE review packet: {draft.parent} -- look at sheet_*.png and frames/, "
          "complete critic.draft.json as visual-critic.json, then run "
          "verify_delivery.py", flush=True)
    print(f"COMPLETE {final} duration={duration(final):.3f}s "
          f"gate={report['status']} score={report['score']['total']}", flush=True)
    for notice in report["notices"]:
        print(f"NOTE {notice['code']}: {notice['message']}", flush=True)
    if report["status"] != "pass":
        for failure in report["hard_failures"]:
            print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
        return 1
    return 0


def card_intervals(timeline_path: Path) -> list[dict]:
    """Card intervals from a rendered timeline, for gating the same mp4 again."""
    try:
        data = json.loads(timeline_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RenderError(f"cannot read timeline {timeline_path}: {exc}") from exc
    if not isinstance(data, list):
        raise RenderError(f"timeline must be a JSON array: {timeline_path}")
    intervals = []
    for item in data:
        if not isinstance(item, dict) or item.get("kind") != "card":
            continue
        try:
            intervals.append({"start": float(item["start"]), "end": float(item["end"])})
        except (KeyError, TypeError, ValueError) as exc:
            raise RenderError(f"invalid card interval in {timeline_path}: {item!r}") from exc
    return intervals


def cmd_gate(video: Path, work: Path, timeline: Path | None = None) -> int:
    check_tools()
    if not video.is_file():
        raise RenderError(f"missing video: {video}")
    report = quality_gate(video, work, card_intervals(timeline) if timeline else None)
    print(f"GATE={report['status'].upper()} video={video} "
          f"score={report['score']['total']} profile={report['profile']} "
          f"report={work / 'report.json'}", flush=True)
    for failure in report["hard_failures"]:
        print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
    for warning in report["warnings"]:
        print(f"WARN {warning['code']}: {warning['message']}", flush=True)
    for notice in report["notices"]:
        print(f"NOTE {notice['code']}: {notice['message']}", flush=True)
    flagged = {failure["code"] for failure in report["hard_failures"]}
    if timeline is None and flagged & {"B101", "T301", "T304", "E301"}:
        print("NOTE: if the flagged span sits inside a title or closing card, pass "
              "--timeline <build>/timeline.json", flush=True)
    if timeline is not None and report.get("exempt"):
        print(f"NOTE: {len(report['exempt']['intervals'])} card interval(s) were taken from "
              f"{timeline.name}; the gate cannot prove that timeline belongs to this video",
              flush=True)
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
    gate_parser.add_argument("--timeline", type=Path,
                             help="timeline.json of a render whose cards may stay static")
    args = parser.parse_args()
    try:
        if args.command == "render":
            return cmd_render(args.build.expanduser().resolve())
        timeline = args.timeline.expanduser().resolve() if args.timeline else None
        return cmd_gate(args.video.expanduser().resolve(), args.work.expanduser().resolve(),
                        timeline)
    except RenderError as exc:
        print(f"FAIL: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
