#!/usr/bin/env python3
"""Self-contained delivery-demo renderer: episode.json -> screen_demo.mp4.

Subcommands:
  render <build-dir>                    render all segments + run the built-in gate
  gate --video <mp4> --work <dir>       run the delivery gate on any mp4 (attachment gate)

Requires: python3.9+, ffmpeg & ffprobe on PATH, `pip install edge-tts Pillow`.

Fail-loud by design: bad episode.json, missing recordings, out-of-range speed,
narration redline hits and gate hard failures all abort with a nonzero exit.
"""

from __future__ import annotations

import argparse
import asyncio
import bisect
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

W, H, FPS = 1920, 1080, 30
LEAD = 0.15
TAIL = 0.45
PROFILE = "delivery-v1"
SPEED_MIN, SPEED_MAX = 0.3, 3.0
MAX_LINE = 24

BREAK_AFTER = set("。！？；!?;")
SOFT_BREAK = set("，、,")

FONT_CANDIDATES = [
    # macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    # Linux (Noto CJK / WQY)
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
    # Windows
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
]

# Narration red lines for external deliveries. AI-cliche patterns abort the
# render; internal-jargon terms only warn because technical acceptance videos
# may legitimately quote real commands and evidence.
INTERNAL_TERMS = (
    "工作流", "管线", "pipeline", "接口", "数据库", "后端", "前端",
    "部署", "构建", "docker", "commit", "refactor",
)
AI_CLICHE_PATTERNS = (
    ("not-x-but-x cliche",
     re.compile(r"这[^。！？；\n，,]{0,4}不是[^。！？；\n]{1,40}[，,]?\s*(?:而是|是)")),
)


class RenderError(Exception):
    pass


def run(args: list[str]) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RenderError(f"{args[0]} failed:\n{result.stderr[-2000:]}")
    return result.stdout


def duration(path: Path) -> float:
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                      "-of", "csv=p=0", str(path)]).strip())


def probe_json(path: Path) -> dict:
    return json.loads(run(["ffprobe", "-v", "error", "-print_format", "json",
                           "-show_streams", "-show_format", str(path)]))


def sha256(path: Path) -> str:
    import hashlib
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_font(size: int):
    from PIL import ImageFont
    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, size)
    raise RenderError(
        "No CJK font found; install one (e.g. Noto Sans CJK) at: "
        + ", ".join(FONT_CANDIDATES))


def check_narration(text: str, segment_id: str) -> None:
    cliches = [name for name, pattern in AI_CLICHE_PATTERNS if pattern.search(text)]
    if cliches:
        raise RenderError(
            f"narration red line hit on {segment_id}: AI-cliche pattern "
            + ", ".join(cliches)
            + " -- rewrite as a plain factual statement from the viewer's perspective")
    for term in INTERNAL_TERMS:
        if term in text.lower() or term in text:
            print(f"WARN: narration for {segment_id} mentions internal jargon "
                  f"'{term}' -- fine for technical acceptance, remove it for "
                  "external deliveries", flush=True)


async def synth(segment: dict, voice: str, rate: str, build: Path):
    import edge_tts
    root = build / "tts"
    root.mkdir(exist_ok=True)
    mp3, clock = root / f"{segment['id']}.mp3", root / f"{segment['id']}.json"
    contract = {"text": segment["text"], "voice": voice, "rate": rate}
    if mp3.exists() or clock.exists():
        if not (mp3.exists() and clock.exists()):
            raise RenderError(f"incomplete narration cache: {segment['id']}")
        cached = json.loads(clock.read_text())
        if any(cached.get(k) != v for k, v in contract.items()):
            raise RenderError(
                f"narration cache mismatch for {segment['id']}: edit episode.json "
                "and delete tts/<id>.mp3/.json to re-synthesize")
        return mp3, cached["words"]
    words, content = [], bytearray()
    stream = edge_tts.Communicate(segment["text"], voice, rate=rate, boundary="WordBoundary")
    async for chunk in stream.stream():
        if chunk["type"] == "audio":
            content.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({"char": chunk["text"],
                          "start_ms": chunk["offset"] // 10000,
                          "end_ms": (chunk["offset"] + chunk["duration"]) // 10000})
    if not words or not content:
        raise RenderError(f"no audio or word boundaries from TTS: {segment['id']}")
    mp3.write_bytes(content)
    clock.write_text(json.dumps({**contract, "words": words}, ensure_ascii=False, indent=2))
    return mp3, words


def group_lines(chars: list[dict], max_line: int = MAX_LINE) -> list[list[dict]]:
    """Split word-clock chars into subtitle lines; keep latin words unbroken."""
    lines, current = [], []
    for index, char in enumerate(chars):
        current.append(char)
        nxt = chars[index + 1]["char"] if index + 1 < len(chars) else ""
        if char["char"].isascii() and char["char"].isalnum() \
                and nxt.isascii() and nxt.isalnum():
            continue
        if (char["char"] in BREAK_AFTER
                or len(current) >= max_line + 2
                or (len(current) >= max_line and char["char"] in SOFT_BREAK)):
            lines.append(current)
            current = []
    if current:
        lines.append(current)
    return lines


def render_segment(segment: dict, mp3: Path, chars: list[dict], build: Path):
    from PIL import Image, ImageDraw
    src = build / segment["shot"]
    if not src.is_file():
        raise RenderError(f"missing real recording: {src}")
    start, end = float(segment["start"]), float(segment["end"])
    if not 0 <= start < end <= duration(src) + 0.1:
        raise RenderError(f"invalid recording interval: {segment['id']}")
    seconds = math.ceil((duration(mp3) + LEAD + TAIL) * FPS) / FPS
    frames = round(seconds * FPS)
    speed = (end - start) / seconds
    if not SPEED_MIN <= speed <= SPEED_MAX:
        raise RenderError(
            f"recording speed {speed:.2f}x outside {SPEED_MIN}x..{SPEED_MAX}x for "
            f"{segment['id']}: shorten the narration or widen the interval")
    crop = segment.get("crop", [260, 64, 1340, 780])
    x, y, width, height = crop
    vf = (f"crop={width}:{height}:{x}:{y},setpts={seconds / (end - start)}*(PTS-STARTPTS),"
          "scale=1800:866:force_original_aspect_ratio=decrease:flags=lanczos,"
          "eq=brightness=-0.035,pad=1920:1080:(ow-iw)/2:66:color=0x10182b,"
          f"fps={FPS},tpad=stop_mode=clone:stop_duration={seconds}")
    decode = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(end - start),
         "-i", str(src), "-vf", vf, "-frames:v", str(frames),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output = build / f"{segment['id']}.mp4"
    encode = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0", "-an", "-t", str(seconds),
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
         str(output)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    lines = group_lines(chars)
    starts = [line[0]["start_ms"] for line in lines]
    font, label_font, case_font = find_font(48), find_font(32), find_font(30)
    case = segment.get("case", "")
    try:
        for frame_index in range(frames):
            content = decode.stdout.read(W * H * 3)
            if len(content) != W * H * 3:
                raise RenderError(
                    f"recording decoder ended at frame {frame_index}/{frames}: "
                    "interval beyond the source")
            frame = Image.frombytes("RGB", (W, H), content)
            draw = ImageDraw.Draw(frame)
            label_x = 82
            if case:
                case_right = 56 + draw.textlength(case, font=case_font) + 28
                draw.rounded_rectangle((56, 12, case_right, 56), radius=8, fill=(37, 99, 235))
                draw.text((56 + 14, 34), case, font=case_font, fill="white", anchor="lm")
                label_x = case_right + 16
            draw.text((label_x, 34), segment["label"], font=label_font,
                      fill=(190, 206, 230), anchor="lm")
            t = frame_index / FPS * 1000 - LEAD * 1000
            index = bisect.bisect_right(starts, t) - 1
            if index >= 0 and t <= lines[index][-1]["end_ms"] + 180:
                text = "".join(c["char"] for c in lines[index])
                draw.text((W / 2, 1008), text, font=font, fill="white", anchor="mm")
            encode.stdin.write(frame.tobytes())
    finally:
        decode.stdout.close()
        encode.stdin.close()
    decode_error = decode.stderr.read().decode()
    encode_error = encode.stderr.read().decode()
    if decode.wait() or encode.wait():
        raise RenderError(f"video encoding failed:\n{decode_error}\n{encode_error}")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3),
         "-af", "adelay=150:all=1,apad", "-t", str(seconds),
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
         str(output.with_suffix(".wav"))])
    print(f"RENDERED {segment['id']}: {seconds:.2f}s {speed:.2f}x", flush=True)
    return output, seconds


def loudnorm_finalize(raw: Path, final: Path) -> None:
    """Two-pass loudnorm (single pass drifts 1-1.5 LU); video stream copied."""
    probe = subprocess.run(
        ["ffmpeg", "-i", str(raw), "-af",
         "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True)
    if probe.returncode:
        raise RenderError(f"loudness measurement failed:\n{probe.stderr[-1000:]}")
    meas = json.loads(probe.stderr[probe.stderr.rindex("{"):probe.stderr.rindex("}") + 1])
    af = ("loudnorm=I=-14:TP=-1.5:LRA=11:"
          f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
          f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:linear=true")
    run(["ffmpeg", "-y", "-i", str(raw), "-af", af, "-ar", "44100", "-ac", "2",
         "-c:a", "aac", "-b:a", "192k", "-c:v", "copy", str(final)])


# ---------------------------------------------------------------- quality gate

def parse_detects(log: str, key: str) -> list[dict]:
    """Parse ffmpeg silencedetect/blackdetect/freezedetect key=value lines."""
    events, current = [], {}
    for line in log.splitlines():
        for match in re.finditer(r"(\w+)_start: ([\d.]+)", line):
            current = {key: float(match.group(2))}
        for match in re.finditer(r"(\w+)_end: ([\d.]+)", line):
            current["end"] = float(match.group(2))
            if "start" in current:
                events.append(current)
                current = {}
    return events


def quality_gate(video: Path, work: Path) -> dict:
    """Deterministic delivery gate; hard failures make status=fail."""
    work.mkdir(parents=True, exist_ok=True)
    hard, warnings, checks = [], [], {}
    info = probe_json(video)
    streams = info.get("streams") or []
    fmt = info.get("format") or {}
    total = float(fmt.get("duration") or 0)

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
        fps = float(num) / float(den or 1)
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
            hard.append({"code": "M111",
                         "message": f"bitrate density {kbps:.0f} kbps too low for readable 1080p text; do not re-encode small, shorten the video instead"})

    if audio_stream is not None:
        ebur = subprocess.run(
            ["ffmpeg", "-i", str(video), "-filter_complex",
             "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
            capture_output=True, text=True)
        if ebur.returncode == 0 and "{" in ebur.stderr:
            meas = json.loads(ebur.stderr[ebur.stderr.rindex("{"):ebur.stderr.rindex("}") + 1])
            integrated = float(meas.get("input_i", "0") or 0)
            checks["loudness_lufs"] = integrated
            if not -30 <= integrated <= -5:
                hard.append({"code": "L101",
                             "message": f"integrated loudness {integrated:.1f} LUFS outside [-30,-5]"})
        filters = {
            "black": (["-vf", "blackdetect=d=0.5:pix_th=0.05", "-an"], 1.0, 0.3, "B101"),
            "freeze": (["-vf", "freezedetect=n=-60dB:d=0.5", "-an"], 2.0, 0.8, "T301"),
            "silence": (["-af", "silencedetect=n=-35dB:d=2", "-vn"], 5.0, 2.0, "E301"),
        }
        for name, (args, hard_s, warn_s, code) in filters.items():
            scan = subprocess.run(
                ["ffmpeg", "-v", "info", "-i", str(video), *args, "-f", "null", "-"],
                capture_output=True, text=True)
            spans = parse_detects(scan.stderr, "start")
            lengths = [s["end"] - s["start"] for s in spans if "end" in s]
            checks[f"{name}_spans"] = [
                {"start": round(s["start"], 2), "end": round(s.get("end", 0), 2)}
                for s in spans]
            if lengths:
                longest = max(lengths)
                if longest >= hard_s:
                    hard.append({"code": code,
                                 "message": f"longest {name} span {longest:.1f}s >= {hard_s}s at "
                                            + ", ".join(f"{s['start']:.1f}" for s in spans
                                                        if "end" in s and s["end"] - s["start"] == longest)})
                elif longest >= warn_s:
                    warnings.append({"code": code,
                                     "message": f"longest {name} span {longest:.1f}s"})
                if name == "freeze" and total > 0 and sum(lengths) / total >= 0.20:
                    hard.append({"code": "T304",
                                 "message": f"frozen frames are {sum(lengths)/total:.0%} of the video; cut waiting segments or raise playback speed"})
    warnings.append({"code": "E401",
                     "message": "no independent visual review (visual-critic.json); required for external deliveries"})

    status = "fail" if hard else "pass"
    score = max(0, 100 - 10 * len(hard) - 2 * len(warnings))
    report = {"profile": PROFILE, "status": status, "video": video.name,
              "video_sha256": sha256(video), "duration_s": round(total, 3),
              "hard_failures": hard, "warnings": warnings,
              "score": {"total": score}, "checks": checks}
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def cmd_render(build: Path) -> int:
    episode_path = build / "episode.json"
    if not episode_path.is_file():
        raise RenderError(f"missing {episode_path}")
    episode = json.loads(episode_path.read_text())
    segments = episode.get("segments") or []
    if not segments or len({s["id"] for s in segments}) != len(segments):
        raise RenderError("missing segments or duplicate segment IDs")
    for key in ("voice",):
        if not episode.get(key):
            raise RenderError(f"episode.json missing required field: {key}")
    for segment in segments:
        for key in ("id", "label", "shot", "start", "end", "text"):
            if key not in segment:
                raise RenderError(f"segment missing field {key!r}: {segment.get('id')}")
        if not isinstance(segment["text"], str) or "\n" in segment["text"]:
            raise RenderError(f"segment text must be one continuous line: {segment['id']}")
        check_narration(segment["text"], segment["id"])

    tracks, timeline, offset = [], [], 0.0
    for segment in segments:
        mp3, chars = asyncio.run(
            synth(segment, episode["voice"], episode.get("rate", "+5%"), build))
        clip, seconds = render_segment(segment, mp3, chars, build)
        tracks.append(clip)
        timeline.append({"id": segment["id"], "start": round(offset, 3),
                         "end": round(offset + seconds, 3), "source": segment["shot"],
                         "source_start": segment["start"], "source_end": segment["end"]})
        offset += seconds

    concat = build / "clips.txt"
    concat.write_text("".join(f"file '{p.name}'\n" for p in tracks))
    picture = build / "picture.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(picture)])
    voice_list = build / "voice-clips.txt"
    voice_list.write_text("".join(f"file '{p.with_suffix('.wav').name}'\n" for p in tracks))
    voice = build / "voice.wav"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(voice_list), "-c:a", "pcm_s16le", str(voice)])
    assembled = build / "assembled.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(picture), "-i", str(voice),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
         "-ar", "44100", "-ac", "2", "-t", str(offset), str(assembled)])
    final = build / "screen_demo.mp4"
    loudnorm_finalize(assembled, final)
    if abs(duration(final) - offset) > 0.15:
        raise RenderError(f"final duration {duration(final):.3f}s != expected {offset:.3f}s")
    run(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", str(final),
         "-frames:v", "1", str(build / "cover.png")])
    for index, item in enumerate(timeline):
        run(["ffmpeg", "-y", "-v", "error",
             "-ss", str((item["start"] + item["end"]) / 2), "-i", str(final),
             "-frames:v", "1", str(build / f"preview_{index:02d}.png")])
    (build / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2))
    report = quality_gate(final, build / "quality_gate")
    print(f"COMPLETE {final} duration={duration(final):.3f}s "
          f"gate={report['status']} score={report['score']['total']}", flush=True)
    if report["status"] != "pass":
        for failure in report["hard_failures"]:
            print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
        return 1
    return 0


def cmd_gate(video: Path, work: Path) -> int:
    if not video.is_file():
        raise RenderError(f"missing video: {video}")
    report = quality_gate(video, work)
    print(f"GATE={report['status'].upper()} video={video} "
          f"score={report['score']['total']} profile={report['profile']} "
          f"report={work / 'report.json'}", flush=True)
    for failure in report["hard_failures"]:
        print(f"HARD FAIL {failure['code']}: {failure['message']}", flush=True)
    for warning in report["warnings"]:
        print(f"WARN {warning['code']}: {warning['message']}", flush=True)
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
    args = parser.parse_args()
    try:
        if args.command == "render":
            return cmd_render(args.build.expanduser().resolve())
        return cmd_gate(args.video.expanduser().resolve(), args.work.expanduser().resolve())
    except RenderError as exc:
        print(f"FAIL: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
