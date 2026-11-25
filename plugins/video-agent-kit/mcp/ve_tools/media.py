from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .result import ToolResult
from .run_context import RunContext, clean_env
from .asr import asr_status, asr_transcribe_payload, extract_bound_asr_audio

ASR_POLL_INTERVAL_SECONDS = 2.5
ASR_TIMEOUT_SECONDS = 3600.0
# Each recognition uploads its audio (<= 10 MiB); at the asr extraction bitrate one
# chunk plus overlap stays under that limit. Long inputs are split into overlapping
# chunks and the timestamped segments merged back onto the source timeline.
ASR_CHUNK_SECONDS = 1700.0
ASR_CHUNK_THRESHOLD_SECONDS = 1800.0
ASR_CHUNK_OVERLAP_SECONDS = 2.0
ASR_DEFAULT_RETRIES = 3
ASR_MAX_RETRIES = 10
ASR_RETRY_BACKOFF_SECONDS = 30.0


def run_json(cmd: list[str], timeout: int = 60) -> dict:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"command failed: {cmd}")
    return json.loads(proc.stdout)


def coerce_asr_retry_count(value: object) -> int | ToolResult:
    if value is None:
        return ASR_DEFAULT_RETRIES
    if isinstance(value, bool):
        return ToolResult(text="[ERROR] retries must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] retries must be an integer")
    try:
        raw = float(value)
    except (TypeError, ValueError):
        raw = float(parsed)
    if not math.isfinite(raw) or raw != parsed:
        return ToolResult(text="[ERROR] retries must be an integer")
    if parsed < 0 or parsed > ASR_MAX_RETRIES:
        return ToolResult(text=f"[ERROR] retries must be in [0, {ASR_MAX_RETRIES}]")
    return parsed


def coerce_nonnegative_number(value: object, field: str, default: float) -> float | ToolResult:
    if value is None:
        return default
    if isinstance(value, bool):
        return ToolResult(text=f"[ERROR] {field} must be numeric")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return ToolResult(text=f"[ERROR] {field} must be numeric")
    if not math.isfinite(parsed) or parsed < 0:
        return ToolResult(text=f"[ERROR] {field} must be a finite number >= 0")
    return parsed


def run_asr_with_retries(call: Any, *, retries: int, retry_backoff_seconds: float) -> tuple[Any, int]:
    result: Any = ToolResult(text="[ERROR] ASR failed")
    attempts: list[dict[str, Any]] = []
    for attempt in range(retries + 1):
        result = call()
        if not isinstance(result, ToolResult):
            return result, attempt
        retryable = asr_error_retryable(result)
        attempts.append({
            "attempt": attempt + 1,
            "error": result.text,
            "retryable": retryable,
        })
        if not retryable or attempt >= retries:
            break
        if retry_backoff_seconds > 0:
            time.sleep(float(retry_backoff_seconds) * (2 ** attempt))
    if isinstance(result, ToolResult):
        result.data = {
            **(result.data or {}),
            "attempts": attempts,
            "retry_attempts": max(0, len(attempts) - 1),
            "max_retries": retries,
        }
    return result, max(0, len(attempts) - 1)


def asr_error_retryable(result: ToolResult) -> bool:
    data = result.data or {}
    if data.get("param_error"):
        return False
    if data.get("recoverable") is False:
        return False
    status_code = str(data.get("status_code") or "")
    if status_code.startswith("55"):
        return True
    text = result.text.lower()
    http_status = http_status_from_text(text)
    if http_status is not None:
        return http_status in {408, 409, 425, 429} or 500 <= http_status <= 599
    non_retryable = [
        "input_path is required",
        "file not found",
        "no asr provider available",
        "not set",
        "not available",
        "ffmpeg not found",
        "audio too large",
        "split the source media",
        "must be",
        "unsupported",
        "package unavailable",
    ]
    if any(marker in text for marker in non_retryable):
        return False
    if data.get("retryable") is True:
        return True
    return message_retryable(text)


def http_status_from_text(text: str) -> int | None:
    marker = "http "
    idx = text.find(marker)
    if idx < 0:
        return None
    raw = text[idx + len(marker):].split(None, 1)[0].strip(":,.;")
    try:
        return int(raw)
    except ValueError:
        return None


def message_retryable(message: object) -> bool:
    text = str(message or "").lower()
    retry_markers = [
        "429",
        "too many",
        "rate limit",
        "ratelimit",
        "concurrency",
        "concurrent",
        "busy",
        "throttl",
        "temporar",
        "timeout",
        "timed out",
        "try again",
        "server error",
        "service unavailable",
        "gateway",
        "connection",
        "reset",
    ]
    return any(marker in text for marker in retry_markers)


def probe_media(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("input_path"):
        return ToolResult(text="[ERROR] input_path is required")
    input_path = ctx.resolve(args["input_path"])
    if not input_path.is_file():
        return ToolResult(text=f"[ERROR] File not found: {input_path}")
    if not shutil.which("ffprobe"):
        return ToolResult(text="[ERROR] ffprobe not found on PATH")

    started = time.time()
    try:
        data = run_json([
            # -v error: 不可解析文件失败时把原因带出来 (-v quiet 只剩 "{}")
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(input_path)
        ])
    except Exception as exc:
        return ToolResult(text=f"[ERROR] ffprobe failed: {exc}")
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    duration_seconds = safe_float(fmt.get("duration"))
    if duration_seconds is None:
        stream_durations = [safe_float(s.get("duration")) for s in streams if isinstance(s, dict)]
        stream_durations = [value for value in stream_durations if value is not None]
        duration_seconds = max(stream_durations) if stream_durations else None
    out = {
        "input_path": str(input_path),
        "duration_seconds": duration_seconds,
        "size_bytes": safe_int(fmt.get("size")) or 0,
        "format_name": fmt.get("format_name"),
        "bit_rate": safe_int(fmt.get("bit_rate")),
        "streams": streams,
        "video_streams": [s for s in streams if s.get("codec_type") == "video"],
        "audio_streams": [s for s in streams if s.get("codec_type") == "audio"],
        "elapsed_seconds": round(time.time() - started, 3),
    }
    out["summary"] = media_summary(out)
    out["technical_risks"] = media_technical_risks(out)
    output_json = args.get("output_json")
    artifacts = []
    if output_json:
        p = ctx.resolve(output_json)
    else:
        p = ctx.output_dir / "media.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    artifacts.append(str(p))
    return ToolResult(
        text=f"Inspected media: {ctx.virtualize(input_path)}",
        data=out,
        artifacts=artifacts,
    )


def safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed):
        return None
    return round(parsed, 6)


def safe_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def media_summary(probe: dict) -> dict:
    video = first_stream(probe.get("video_streams"))
    audio = first_stream(probe.get("audio_streams"))
    return {
        "duration_seconds": probe.get("duration_seconds"),
        "has_video": bool(video),
        "has_audio": bool(audio),
        "width": safe_int(video.get("width")) if video else None,
        "height": safe_int(video.get("height")) if video else None,
        "fps": stream_fps(video) if video else None,
        "video_codec": video.get("codec_name") if video else None,
        "audio_codec": audio.get("codec_name") if audio else None,
        "audio_channels": safe_int(audio.get("channels")) if audio else None,
        "audio_sample_rate": safe_int(audio.get("sample_rate")) if audio else None,
        "pix_fmt": video.get("pix_fmt") if video else None,
        "color_space": video.get("color_space") if video else None,
        "color_transfer": video.get("color_transfer") if video else None,
        "rotation": stream_rotation(video) if video else None,
    }


def media_technical_risks(probe: dict) -> list[dict]:
    risks = []
    summary = probe.get("summary") or {}
    if not summary.get("has_video") and not summary.get("has_audio"):
        risks.append({"severity": "error", "message": "no video or audio stream detected"})
    elif not summary.get("has_video"):
        risks.append({"severity": "warning", "message": "media has no video stream"})
    if summary.get("has_video") and not summary.get("has_audio"):
        risks.append({"severity": "warning", "message": "video has no audio stream"})
    width = summary.get("width") or 0
    height = summary.get("height") or 0
    if width and height and (width % 2 or height % 2):
        risks.append({"severity": "warning", "message": "odd video dimensions may require padding before H.264 render"})
    if width and height and width * height >= 3840 * 2160:
        risks.append({"severity": "info", "message": "4K-or-larger source may be expensive to sample/render"})
    video = first_stream(probe.get("video_streams"))
    if video:
        avg = stream_fps(video, "avg_frame_rate")
        nominal = stream_fps(video, "r_frame_rate")
        if avg and nominal and abs(avg - nominal) > 0.5:
            risks.append({
                "severity": "warning",
                "message": "possible variable-frame-rate source",
                "evidence": f"avg_frame_rate={avg:.3f}, r_frame_rate={nominal:.3f}",
            })
        if stream_rotation(video):
            risks.append({"severity": "info", "message": f"rotation metadata present: {stream_rotation(video)}"})
        transfer = str(video.get("color_transfer") or "").lower()
        if transfer in {"smpte2084", "arib-std-b67"}:
            risks.append({"severity": "warning", "message": f"HDR transfer detected ({transfer}); SDR preview may need tonemapping"})
    return risks


def first_stream(streams: object) -> dict:
    if isinstance(streams, list) and streams and isinstance(streams[0], dict):
        return streams[0]
    return {}


def stream_fps(stream: dict, key: str | None = None) -> float | None:
    keys = [key] if key else ["avg_frame_rate", "r_frame_rate"]
    for item in keys:
        value = stream.get(item)
        if not value or value == "0/0":
            continue
        try:
            if "/" in str(value):
                num, den = str(value).split("/", 1)
                den_f = float(den)
                if den_f == 0:
                    continue
                fps = float(num) / den_f
            else:
                fps = float(value)
        except Exception:
            continue
        if math.isfinite(fps) and fps > 0:
            return round(fps, 6)
    return None


def stream_rotation(stream: dict) -> str | None:
    tags = stream.get("tags") if isinstance(stream.get("tags"), dict) else {}
    if tags.get("rotate"):
        return str(tags["rotate"])
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for item in side_data:
            if isinstance(item, dict) and item.get("rotation") not in (None, 0, "0"):
                return str(item["rotation"])
    return None


ASR_PROVIDERS = {"auto", "asr"}


def transcribe(args: dict, ctx: RunContext) -> ToolResult:
    from .file_contract import output_locks
    paths = [ctx.resolve(args["output_json"])] if args.get("output_json") else []
    try:
        with output_locks(ctx, paths):
            return _transcribe(args, ctx)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        # An ffmpeg extraction/segment timeout is a failed transcription, not a crashed tool.
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)


def _transcribe(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("input_path"):
        return ToolResult(text="[ERROR] input_path is required")
    input_path = ctx.resolve(args["input_path"])
    if not input_path.is_file():
        return ToolResult(text=f"[ERROR] File not found: {input_path}")
    from .creation_planning import file_digest
    from .creation_takes import write_object
    from .file_contract import protect_outputs
    source_sha256 = file_digest(input_path)
    import tempfile
    output_path = ctx.resolve(args["output_json"]) if args.get("output_json") else Path(
        tempfile.mkdtemp(prefix="asr-", dir=ctx.output_dir)) / "transcript.json"
    try:
        protect_outputs([output_path], [input_path])
    except ValueError as exc:
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    language = str(args.get("language") or "zh").strip() or "zh"
    timeout_seconds = coerce_positive_number(args.get("timeout_seconds"), "timeout_seconds", ASR_TIMEOUT_SECONDS)
    if isinstance(timeout_seconds, ToolResult):
        return timeout_seconds
    poll_interval_seconds = coerce_positive_number(
        args.get("poll_interval_seconds"),
        "poll_interval_seconds",
        ASR_POLL_INTERVAL_SECONDS,
    )
    if isinstance(poll_interval_seconds, ToolResult):
        return poll_interval_seconds
    retries = coerce_asr_retry_count(args.get("retries", args.get("retry_count")))
    if isinstance(retries, ToolResult):
        return retries
    retry_backoff_seconds = coerce_nonnegative_number(
        args.get("retry_backoff_seconds"),
        "retry_backoff_seconds",
        ASR_RETRY_BACKOFF_SECONDS,
    )
    if isinstance(retry_backoff_seconds, ToolResult):
        return retry_backoff_seconds

    provider_arg = str(args.get("provider") or clean_env("VE_ASR_PROVIDER") or "auto").strip().lower()
    if provider_arg not in ASR_PROVIDERS:
        return ToolResult(
            text=f"[ERROR] provider must be one of: {', '.join(sorted(ASR_PROVIDERS))}",
            data={"supported_providers": sorted(ASR_PROVIDERS)},
        )
    seed_status = asr_status() if provider_arg in ("auto", "asr") else None
    if provider_arg == "auto":
        # Only ASR is supported. Keep provider=auto as a compatibility
        # alias, but do not fall back to local or third-party ASR.
        if seed_status["available"]:
            provider = "asr"
        else:
            return ToolResult(
                text=(
                    "[ERROR] asr is not available: "
                    + "; ".join(seed_status["reasons"])
                ),
                data={
                    "recoverable": True,
                    "asr": seed_status,
                },
            )
    else:
        provider = provider_arg

    started = time.time()
    # 默认 work_dir 加路径哈希: 只按 stem 键控时, 不同目录的同名源视频会共用
    # .video_agent/asr/{stem}/, 提取音频/中间产物被后一次调用 -y 覆盖, 前一次
    # 返回的 artifacts 静默变成另一个视频的音频 (与帧目录同 stem 互删同类洞)
    if args.get("work_dir"):
        work_dir = ctx.resolve(args["work_dir"]) / source_sha256[:16]
    else:
        path_digest = hashlib.sha256((str(input_path.resolve()) + source_sha256).encode("utf-8")).hexdigest()[:16]
        work_dir = ctx.resolve(f".video_agent/asr/{input_path.stem}_{path_digest}")
    work_dir.mkdir(parents=True, exist_ok=True)

    if provider == "asr":
        chunk_seconds = coerce_positive_number(args.get("chunk_seconds"), "chunk_seconds", ASR_CHUNK_SECONDS)
        if isinstance(chunk_seconds, ToolResult):
            return chunk_seconds
        duration = media_duration_seconds(input_path)
        if duration and duration > max(float(chunk_seconds), ASR_CHUNK_THRESHOLD_SECONDS):
            seed_result = asr_chunked_payload(
                input_path,
                work_dir,
                language=language,
                timeout_seconds=float(timeout_seconds),
                poll_interval_seconds=float(poll_interval_seconds),
                started=started,
                duration=duration,
                chunk_seconds=float(chunk_seconds),
                retries=retries,
                retry_backoff_seconds=float(retry_backoff_seconds),
            )
        else:
            seed_result, retry_attempts = run_asr_with_retries(
                lambda: asr_transcribe_payload(
                    input_path,
                    work_dir,
                    language=language,
                    timeout_seconds=float(timeout_seconds),
                    poll_interval_seconds=float(poll_interval_seconds),
                    started=started,
                ),
                retries=retries,
                retry_backoff_seconds=float(retry_backoff_seconds),
            )
        if isinstance(seed_result, ToolResult):
            return seed_result
        transcript_payload, asr_source = seed_result
        if not transcript_payload.get("chunks"):
            transcript_payload["retry_attempts"] = retry_attempts
            transcript_payload["max_retries"] = retries

    if file_digest(input_path) != source_sha256:
        return ToolResult(text="[ERROR] source changed during ASR; transcribe the current version", is_error=True)
    transcript_payload.update(source_media=str(input_path), source_video_sha256=source_sha256,
                              recognition_parameters={"language": language, "chunk_seconds": chunk_seconds,
                                                      "provider": provider})
    try:
        protect_outputs([output_path], [input_path, asr_source])
    except ValueError as exc:
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)
    write_object(output_path, transcript_payload)
    data = {
        "provider": provider,
        "requested_provider": provider_arg,
        "output_json": str(output_path),
        "source_media": str(input_path),
        "asr_audio": str(asr_source),
        "language": transcript_payload.get("language") or language,
        "word_count": len(transcript_payload.get("words", [])),
        "segment_count": len(transcript_payload.get("segments", [])),
        "retry_attempts": transcript_payload.get("retry_attempts", 0),
        "max_retries": retries,
        "elapsed_seconds": round(time.time() - started, 3),
    }
    if provider == "asr":
        data["resource_id"] = transcript_payload.get("resource_id")
        data["interface"] = transcript_payload.get("interface")
        data["n_speakers"] = len({
            seg.get("speaker") for seg in transcript_payload.get("segments", [])
            if seg.get("speaker")
        }) or None
        if transcript_payload.get("silent_audio"):
            data["silent_audio"] = True
        if transcript_payload.get("chunks"):
            data["chunks"] = transcript_payload["chunks"]
            data["chunk_seconds"] = transcript_payload.get("chunk_seconds")
    return ToolResult(
        text=f"{provider} transcript written: {ctx.virtualize(output_path)}",
        data=data,
        artifacts=[str(output_path), str(asr_source)],
    )


def media_duration_seconds(path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    try:
        data = run_json([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(path)
        ], timeout=120)
    except Exception:
        return None
    duration = safe_float(data.get("format", {}).get("duration"))
    if duration is None:
        streams = [
            safe_float(s.get("duration"))
            for s in data.get("streams", [])
            if isinstance(s, dict)
        ]
        streams = [value for value in streams if value is not None]
        duration = max(streams) if streams else None
    return duration


def asr_chunked_payload(
    input_path: Path,
    work_dir: Path,
    *,
    language: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
    started: float,
    duration: float,
    chunk_seconds: float,
    retries: int,
    retry_backoff_seconds: float,
) -> tuple[dict[str, Any], Path] | ToolResult:
    """Transcribe long media with ASR in resumable overlapping chunks."""
    if not shutil.which("ffmpeg"):
        return ToolResult(text="[ERROR] ffmpeg not found on PATH; required for chunked ASR")
    # 整段音频与非分块路径共用同一绑定机制 (源 SHA + 转换参数 + 音频 SHA):
    # 只按 mtime 复用 <stem>.asr.mp3 会让同路径换了内容的源拿到旧音频
    from .creation_planning import file_digest
    source_fingerprint = file_digest(input_path)
    extracted = extract_bound_asr_audio(input_path, work_dir)
    if isinstance(extracted, ToolResult):
        extracted.text = extracted.text.replace("for asr", "for chunked ASR")
        return extracted
    full_audio = extracted

    n_chunks = max(1, math.ceil(duration / chunk_seconds))
    span = duration / n_chunks
    segments: list[dict[str, Any]] = []
    interface = None
    resource_id = None
    silent_audio = True
    retry_attempts = 0

    for idx in range(n_chunks):
        offset = span * idx
        chunk_dir = work_dir / f"chunk_{idx:02d}"
        chunk_dir.mkdir(parents=True, exist_ok=True)
        cache = chunk_dir / "transcript_chunk.json"
        payload: dict[str, Any] | None = None

        if cache.is_file():
            try:
                payload = json.loads(cache.read_text(encoding="utf-8"))
            except Exception:
                payload = None
            if payload is not None and (
                str(payload.get("language") or "") != str(language or "")
                or str(payload.get("source_fingerprint") or "") != source_fingerprint
                or (
                    "chunk_offset" in payload
                    and abs(float(payload["chunk_offset"]) - offset) > 0.5
                )
                or (
                    "chunk_span" in payload
                    and abs(float(payload["chunk_span"]) - span) > 0.5
                )
            ):
                payload = None

        if payload is None:
            chunk_audio = chunk_dir / "audio.mp3"
            proc = subprocess.run([
                "ffmpeg", "-nostdin", "-y", "-v", "error",
                "-ss", f"{offset:.3f}",
                "-t", f"{span + ASR_CHUNK_OVERLAP_SECONDS:.3f}",
                "-i", str(full_audio),
                "-c", "copy",
                str(chunk_audio),
            ], capture_output=True, text=True, timeout=600)
            if proc.returncode != 0 or not chunk_audio.is_file() or chunk_audio.stat().st_size == 0:
                return ToolResult(
                    text=f"[ERROR] failed to cut ASR chunk {idx + 1}/{n_chunks}",
                    data={"detail": (proc.stderr or proc.stdout or "").strip()[-800:]},
                )

            last_err: ToolResult | None = None
            result, chunk_retry_attempts = run_asr_with_retries(
                lambda: asr_transcribe_payload(
                    chunk_audio,
                    chunk_dir,
                    language=language,
                    timeout_seconds=timeout_seconds,
                    poll_interval_seconds=poll_interval_seconds,
                    started=time.time(),
                ),
                retries=retries,
                retry_backoff_seconds=retry_backoff_seconds,
            )
            retry_attempts += chunk_retry_attempts
            if isinstance(result, ToolResult):
                last_err = result
            else:
                payload = result[0]
                payload["language"] = str(language or "")
                payload["source_fingerprint"] = source_fingerprint
                payload["chunk_offset"] = round(offset, 3)
                payload["chunk_span"] = round(span, 3)
                cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            if payload is None and last_err is None:
                last_err = ToolResult(text="[ERROR] asr chunk failed")

            if payload is None:
                err = last_err or ToolResult(text="[ERROR] asr chunk failed")
                err.data = {
                    **(err.data or {}),
                    "chunk": idx + 1,
                    "n_chunks": n_chunks,
                    "hint": "chunk results are cached; rerun transcribe to resume",
                }
                err.text = f"[ERROR] chunk {idx + 1}/{n_chunks}: " + err.text.removeprefix("[ERROR] ")
                return err

        interface = interface or payload.get("interface")
        resource_id = resource_id or payload.get("resource_id")
        silent_audio = silent_audio and bool(payload.get("silent_audio"))
        for seg in payload.get("segments", []):
            text = str(seg.get("text", "")).strip()
            start = safe_float(seg.get("start"))
            if not text or start is None:
                continue
            # Only remove an actual duplicate in the overlapping global interval.
            global_start = start + offset
            global_end = (safe_float(seg.get('end')) or start) + offset
            normalized = ''.join(text.split()).casefold()
            duplicate = False
            overlapping = [p for p in segments if p['start'] >= global_start - .5 and p['end'] <= global_end + .5 and min(p['end'], global_end) > max(p['start'], global_start)]
            combined = ''.join(''.join(p['text'].split()).casefold() for p in overlapping)
            if len(overlapping) > 1 and combined == normalized:
                # A complete sentence supersedes an equivalent differently split recognition.
                first = overlapping[0]
                first.update(text=text, start=round(min(first['start'], global_start), 2), end=round(max(overlapping[-1]['end'], global_end), 2))
                for old in overlapping[1:]:
                    segments.remove(old)
                continue
            for previous in reversed(segments):
                if previous['end'] < offset - ASR_CHUNK_OVERLAP_SECONDS:
                    break
                old_text = ''.join(previous['text'].split()).casefold()
                overlap = min(previous['end'], global_end) - max(previous['start'], global_start)
                if overlap > 0 and old_text == normalized:
                    previous['start'] = round(min(previous['start'], global_start), 2)
                    previous['end'] = round(max(previous['end'], global_end), 2)
                    duplicate = True
                    break
                # Keep a fuller recognition when one chunk returned only part of a sentence.
                if overlap > 0 and len(old_text) >= 3 and old_text in normalized:
                    previous['text'] = text
                    previous['start'] = round(min(previous['start'], global_start), 2)
                    previous['end'] = round(max(previous['end'], global_end), 2)
                    duplicate = True
                    break
                if overlap > 0 and len(normalized) >= 3 and normalized in old_text:
                    duplicate = True
                    break
            if duplicate:
                continue
            # 分块聚类标签只在 ASR 返回了 speaker 时才加 p{chunk}_ 前缀；未开/无
            # 说话人聚类时保持空串，避免把每个块误当成不同说话人。
            speaker_raw = str(seg.get("speaker") or "").strip()
            segments.append({
                "speaker": f"p{idx}_{speaker_raw}" if speaker_raw else "",
                "text": text,
                "start": round(start + offset, 2),
                "end": round((safe_float(seg.get("end")) or start) + offset, 2),
            })

    segments.sort(key=lambda item: item["start"])
    return {
        "provider": "asr",
        "language": language,
        "source_media": str(input_path),
        "asr_audio": str(full_audio),
        # Chunks are cut from this bound extraction; the digest identifies the audio that was recognised.
        "asr_audio_sha256": file_digest(full_audio),
        "asr_audio_scope": "full extracted audio; recognition ran on consecutive chunks cut from it",
        "resource_id": resource_id,
        "interface": interface,
        "chunks": n_chunks,
        "chunk_seconds": chunk_seconds,
        "speaker_labels": any(seg.get("speaker") for seg in segments),
        "speaker_note": (
            "speaker labels are per-chunk clusters (p{chunk}_{speaker}); "
            "the same person may carry different labels across chunks"
        ),
        "text": " ".join(s["text"] for s in segments),
        "words": [],
        "segments": segments,
        "silent_audio": silent_audio or not segments,
        "retry_attempts": retry_attempts,
        "max_retries": retries,
        "elapsed_seconds": round(time.time() - started, 3),
        "time_unit": "seconds",
    }, full_audio


def coerce_positive_number(value: object, field: str, default: float) -> float | ToolResult:
    if value is None:
        return default
    if isinstance(value, bool):
        return ToolResult(text=f"[ERROR] {field} must be numeric")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return ToolResult(text=f"[ERROR] {field} must be numeric")
    if not math.isfinite(parsed) or parsed <= 0:
        return ToolResult(text=f"[ERROR] {field} must be a finite number > 0")
    return parsed
