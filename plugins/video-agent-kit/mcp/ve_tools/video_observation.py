"""One observation interface for local files and remote video sources."""
from __future__ import annotations

import json
import math
import tempfile
import threading
from pathlib import Path

from . import observation_media as decoding
from . import video_sources as sources
from .result import ToolResult
from .run_context import RunContext, clean_env

_log_lock = threading.Lock()


def _limit(name: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(clean_env(name) or default)))
    except ValueError:
        return default


def _number(args: dict, name: str, default=None):
    value = args.get(name, default)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


def _transcript(path: Path, info: dict, start: float, end: float, language: str, ctx: RunContext) -> dict:
    items = decoding.subtitle_items(path, info)
    if items is not None:
        provider = "embedded_subtitles"
    elif info["has_audio"]:
        payload = _source_transcript(path, language, ctx)
        items = [{"text": str(s.get("text", "")), "start_time": s["start"], "end_time": s["end"]}
                 for s in payload.get("segments", [])]
        provider = "speech_transcription"
    else:
        items, provider = [], "no_audio"
    selected = [item for item in items if item["end_time"] > start and item["start_time"] < end]
    return {"source": provider, "segments": selected,
            "text": decoding.format_transcript(selected, start, end),
            "empty_scope": "requested_window" if not selected else None}


def _source_transcript(path: Path, language: str, ctx: RunContext) -> dict:
    """Whole-source transcript, recognised once per source bytes and language.

    Every windowed observation used to start a new recognition of the full file."""
    import re
    import subprocess

    from . import media
    from .creation_planning import file_digest

    from ve_tools import file_lock
    digest = file_digest(path)
    cache = ctx.work_dir / "observe_transcripts" / f"{digest[:24]}_{re.sub(r'[^A-Za-z0-9_-]', '_', language)[:24]}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)

    def cached():
        try:
            payload = json.loads(cache.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if isinstance(payload, dict) and payload.get("source_video_sha256") == digest \
                and isinstance(payload.get("segments"), list):
            return payload
        return None

    payload = cached()
    if payload is not None:
        return payload
    # Parallel windows of one source wait for the single recognition instead of failing
    # on its output lock (or each recognizing the whole file again).
    with cache.with_suffix(".lock").open("a") as handle:
        file_lock.flock(handle, file_lock.LOCK_EX)
        payload = cached()
        if payload is not None:
            return payload
        try:
            result = media.transcribe({"input_path": str(path), "language": language, "output_json": str(cache)}, ctx)
        except subprocess.SubprocessError as exc:
            raise RuntimeError(f"transcription failed: {exc}") from exc
        if result.failed:
            raise RuntimeError(result.text)
        return json.loads(Path(result.artifacts[0]).read_text(encoding="utf-8"))


def _images(frames: list[tuple[float, Path]], layout: str,
            directory: Path) -> tuple[list[str], list[dict], tuple[int, int]]:
    """Label the frames; returns (image paths, evidence rows, pixel size of one frame file)."""
    from PIL import Image, ImageDraw

    annotated = []
    evidence = []
    for stamp, path in frames:
        with Image.open(path) as original:
            frame = original.convert("RGB")
        label = decoding.fmt_ts(stamp, ms=True)
        draw = ImageDraw.Draw(frame)
        box = draw.textbbox((4, 3), label)
        draw.rectangle((0, 0, box[2] + 4, box[3] + 4), fill="black")
        draw.text((4, 3), label, fill="yellow")
        frame.save(path, "JPEG", quality=88)
        annotated.append(frame)
        evidence.append({"time_s": stamp, "label": label, "frame_path": str(path)})
    if layout == "frames":
        for row in evidence:
            row.update(image_path=row["frame_path"], cell=0)
        return [str(path) for _, path in frames], evidence, annotated[0].size
    sheets = []
    for offset in range(0, len(annotated), 9):
        group = annotated[offset:offset + 9]
        width, height = group[0].size
        sheet = Image.new("RGB", (width * 3, height * math.ceil(len(group) / 3)), (16, 16, 16))
        for index, frame in enumerate(group):
            sheet.paste(frame, ((index % 3) * width, (index // 3) * height))
        target = directory / f"sheet_{offset // 9:03d}.jpg"
        sheet.save(target, "JPEG", quality=88)
        sheets.append(str(target))
        for cell, row in enumerate(evidence[offset:offset + 9]):
            row.update(image_path=str(target), cell=cell)
    return sheets, evidence, annotated[0].size


def video_observe(args: dict, ctx: RunContext) -> ToolResult:
    source = str(args.get("source") or "").strip()
    if not source:
        return ToolResult(text="[ERROR] source is required")
    try:
        start = _number(args, "start_s", 0)
        end = _number(args, "end_s")
        fps = _number(args, "fps")
        count = _number(args, "num_frames")
        if start < 0 or (end is not None and end < 0) or (fps is not None and fps <= 0):
            raise ValueError("times must be nonnegative and fps must be positive")
        if count is not None and (count < 1 or int(count) != count):
            raise ValueError("num_frames must be a positive integer")
        if fps is not None and count is not None:
            raise ValueError("use fps or num_frames, not both")
        include_transcript = args.get("include_transcript", False)
        include_frames = args.get("include_frames", not include_transcript)
        if not isinstance(include_frames, bool) or not isinstance(include_transcript, bool):
            raise ValueError("include_frames and include_transcript must be booleans")
        if not (include_frames or include_transcript):
            raise ValueError("request frames or a transcript")
        layout = args.get("layout", "contact_sheet")
        if layout not in ("frames", "contact_sheet"):
            raise ValueError("layout must be frames or contact_sheet")
    except (TypeError, ValueError) as exc:
        return ToolResult(text=f"[ERROR] {exc}")
    path, resolved_source, metadata = sources.resolve_media(source, ctx)
    if path is None:
        return ToolResult(text=f"[ERROR] Cannot resolve or download source: {source}."
                               f"{sources.fetch_failure(resolved_source)}")
    observations = ctx.output_dir / "observations"
    observations.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="call_", dir=observations))
    images, evidence = [], []
    data = {"source": resolved_source, "local_path": str(path), "metadata": metadata, "layout": layout}
    try:
        if sources._is_image(path):
            if include_transcript or not include_frames:
                return ToolResult(text="[ERROR] Image sources support frames only")
            from PIL import Image

            with Image.open(path) as original:
                frame = original.convert("RGB")
                frame.thumbnail((1600, 1600))
            image_path = directory / "image.jpg"
            frame.save(image_path, "JPEG", quality=90)
            images = [str(image_path)]
            evidence = [{"image_path": str(image_path), "cell": 0}]
            data.update(kind="image", num_frames=1, evidence=evidence)
        else:
            info = decoding.probe(path)
            end = info["duration"] if end is None else min(end, info["duration"])
            if start >= end:
                return ToolResult(text="[ERROR] Requested time window is empty or outside the video "
                                       f"(start_s={start:g}, video duration {info['duration']:.3f}s)")
            data.update(kind="video", duration_s=info["duration"], start_s=start, end_s=end,
                        has_audio=info["has_audio"])
            if include_frames:
                cap = _limit("VE_OBSERVE_MAX_FRAMES", 64, 1, 1000)
                rate = fps if fps is not None else (count if count is not None else 16) / (end - start)
                requested = (end - start) * rate
                # An absurd fps overflows ceil(); it is simply "more than the cap".
                requested_count = cap + 1 if not math.isfinite(requested) or requested > cap + 1 else max(1, math.ceil(requested - 1e-9))
                effective_rate = min(rate, cap / (end - start))
                expected_count = min(cap, requested_count)
                width = _limit("VE_OBSERVE_FRAME_WIDTH", 512, 64, 3840)
                frames = decoding.extract_frames(path, start, end, effective_rate, width, directory)
                if not frames:
                    return ToolResult(text="[ERROR] No video frames could be decoded")
                images, evidence, frame_size = _images(frames, layout, directory)
                # frame_path files are downscaled copies (VE_OBSERVE_FRAME_WIDTH). Callers cropped
                # them with coordinates in the source's resolution because only that was reported.
                data.update(num_frames=len(frames), fps_requested=rate, fps_effective=effective_rate,
                            capped=requested_count > cap, evidence=evidence,
                            missing_frames=expected_count - len(frames),
                            frame_width=frame_size[0], frame_height=frame_size[1],
                            sampling="sampled frames; timestamps follow the requested sampling grid")
            if include_transcript:
                try:
                    data["transcript"] = _transcript(path, info, start, end, args.get("language") or "auto", ctx)
                except RuntimeError as exc:
                    data["transcript_error"] = str(exc)
                    if not images:
                        return ToolResult(text=f"[ERROR] Transcript unavailable: {exc}", data=data)
        with _log_lock, (observations / "index.jsonl").open("a", encoding="utf-8") as log:
            log.write(json.dumps(data, ensure_ascii=False) + "\n")
        summary = f"Observed {resolved_source}. Returned {len(images)} images."
        if data.get("frame_width"):
            summary += (f" Each frame file is {data['frame_width']}x{data['frame_height']} px, downscaled from the "
                        "source; pixel coordinates for a crop of a frame file use this size.")
        if data.get("capped"):
            summary += " Frame sampling was reduced to the configured limit."
        if data.get("missing_frames"):
            summary += f" {data['missing_frames']} requested frames could not be decoded."
        if "transcript" in data:
            summary += "\n" + (data["transcript"]["text"] or "No transcript content in the requested window.")
        if "transcript_error" in data:
            summary += " Transcript unavailable; see transcript_error."
        return ToolResult(text=summary, data=data, image_paths=images)
    except (OSError, RuntimeError, ValueError) as exc:
        return ToolResult(text=f"[ERROR] Observation failed: {exc}", data=data)
