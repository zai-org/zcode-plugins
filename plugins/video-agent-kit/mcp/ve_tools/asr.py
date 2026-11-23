"""asr: Seed ASR (录音文件识别) through ZCode ToolHub.

The service takes only an https audio URL, so a local file is first uploaded with
the ToolHub file endpoint (mp3 / wav, <= 10 MiB), then submitted to
``seed_asr/invoke`` and polled on ``seed_asr/tasks/query``. Identity comes from
the signed-in ZCode account of the running tool call; there is no key to set.

Audio that is not a small mp3/wav is extracted to 16 kHz mono mp3 at
``SEED_AUDIO_BITRATE``; at that rate one ``media.ASR_CHUNK_SECONDS`` chunk
(plus overlap) stays under the upload limit, so long media is chunked by the
caller and every chunk uploads on its own.

The service has no language parameter: ``language`` is recorded on the
transcript but does not steer recognition. Speaker labels come from
``additions.speaker`` when the service returns them.

Output is the plugin transcript.json shape: millisecond times become seconds,
utterances become segments, words are flattened.
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from .result import ToolResult

PROVIDER = "asr"
SERVICE_LABEL = "zcode-toolhub:seed_asr"
INTERFACE = "upload_submit_query"

SEED_AUDIO_BITRATE = "40k"            # 16 kHz mono speech; 1702 s ~= 8.5 MB < the 10 MiB upload limit
SEED_SAMPLE_RATE = "16000"
CONVERTER_VERSION = 2
# Formats the upload endpoint takes for audio, and the matching seed_asr ``format``.
SEED_PASSTHROUGH_FORMATS = {".mp3": "mp3", ".wav": "wav"}

SUBMIT_REPLAYS = 3
SUBMIT_REPLAY_DELAY_SECONDS = 5.0
MIN_POLL_INTERVAL_SECONDS = 3.0       # the service asks for one query every 3-5 s
# The task can stay "running" forever when the service cannot fetch the audio, so
# the wait is bounded by the audio length too (short audio: a few minutes).
WAIT_BASE_SECONDS = 180.0
WAIT_PER_AUDIO_SECOND = 1.0


def _upload_limit() -> int:
    from . import toolhub
    return toolhub.MAX_UPLOAD_BYTES


def asr_config() -> dict[str, Any]:
    return {"service": SERVICE_LABEL, "audio_bitrate": SEED_AUDIO_BITRATE, "sample_rate": SEED_SAMPLE_RATE}


def asr_status() -> dict[str, Any]:
    """{available, reasons, ...}: whether this tool call can reach the ZCode ASR service."""
    from . import toolhub
    state = toolhub.status()
    return {
        "available": state["available"],
        "reasons": list(state["reasons"]),
        "provider": PROVIDER,
        "service": SERVICE_LABEL,
        "resource_id": SERVICE_LABEL,
    }


def speaker_info_enabled(language: str) -> bool:
    """The service decides speaker labelling itself; no argument turns it off."""
    return True


_CJK_RANGES = ((0x4E00, 0x9FFF), (0x3400, 0x4DBF), (0xF900, 0xFAFF))


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in _CJK_RANGES)


def _cjk_ratio(text: str) -> float:
    letters = [ch for ch in text if ch.isalpha() or _is_cjk(ch)]
    if not letters:
        return 0.0
    return sum(1 for ch in letters if _is_cjk(ch)) / len(letters)


def language_sanity_warning(language: str, text: str, has_speaker_labels: bool) -> str | None:
    """Say when a language hint was given: the service recognises without one."""
    lang = (language or "").strip().lower()
    if lang in ("", "zh", "auto", "zh-cn"):
        return None
    ratio = _cjk_ratio(text)
    note = (f"language={language!r} was recorded, but the ASR service takes no language hint and detects the "
            f"language itself ({ratio:.0%} of the returned text is Chinese).")
    if not has_speaker_labels:
        note += " The service returned no speaker labels for this audio."
    return note


def prepare_audio_tts(input_path: Path, work_dir: Path) -> tuple[Path, str, str] | ToolResult:
    """(audio_path, format, source_kind). Small mp3/wav upload as-is; anything else becomes 16 kHz mono mp3."""
    audio_format = SEED_PASSTHROUGH_FORMATS.get(input_path.suffix.lower())
    if audio_format and 0 < input_path.stat().st_size <= _upload_limit():
        return input_path, audio_format, "original_audio"
    if not shutil.which("ffmpeg"):
        return ToolResult(text="[ERROR] ffmpeg not found on PATH; required to extract asr audio")
    extracted = extract_bound_asr_audio(input_path, work_dir)
    if isinstance(extracted, ToolResult):
        return extracted
    return extracted, "mp3", "extracted_audio"


def extract_bound_asr_audio(input_path: Path, work_dir: Path) -> Path | ToolResult:
    """抽 16k 单声道 mp3, 文件名与 .binding.json 绑定源 SHA + 转换参数。

    分块与非分块 ASR 共用: 只有 binding 与音频 SHA 都对得上才复用, 否则重抽。
    """
    from .creation_planning import file_digest
    from .creation_takes import read_object, write_object
    source_hash = file_digest(input_path)
    output = work_dir / f"{input_path.stem}.{source_hash[:16]}.asr.mp3"
    metadata = output.with_suffix('.binding.json')
    binding = {'source_sha256': source_hash, 'sample_rate': SEED_SAMPLE_RATE,
               'bitrate': SEED_AUDIO_BITRATE, 'channels': 1, 'converter_version': CONVERTER_VERSION}
    if any(p.is_symlink() for p in (work_dir, *work_dir.parents, output, metadata)):
        return ToolResult('[ERROR] ASR cache must not use symlinks', is_error=True)
    try:
        # 重试 (网络瞬时错误后的整包重跑) 不重抽音频: 与 chunked 路径的缓存口径一致
        cached = read_object(metadata)
        if (output.is_file() and cached.get('binding') == binding
                and cached.get('sha256') == file_digest(output)):
            return output
    except (OSError, ValueError):
        pass
    # 先写临时名再 os.replace: 并发 transcribe 同一输入时, 另一 worker 不会把
    # 半写的 mp3 当成"已有且非空"的成品直接上传
    tmp_output = output.with_name(f"{output.name}.part-{uuid.uuid4().hex[:8]}")
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-i", str(input_path),
        "-vn",
        "-ac", "1",
        "-ar", SEED_SAMPLE_RATE,
        "-b:a", SEED_AUDIO_BITRATE,
        "-f", "mp3",
        str(tmp_output),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if proc.returncode != 0 or not tmp_output.is_file() or tmp_output.stat().st_size == 0:
            detail = (proc.stderr or proc.stdout or "").strip()[-1200:]
            tmp_output.unlink(missing_ok=True)
            return ToolResult(
                text="[ERROR] failed to extract ASR audio for asr",
                data={"cmd": cmd, "detail": detail},
            )
        if file_digest(input_path) != source_hash:
            tmp_output.unlink(missing_ok=True)
            return ToolResult('[ERROR] source changed during ASR extraction', is_error=True)
        os.replace(tmp_output, output)
        write_object(metadata, {'binding': binding, 'sha256': file_digest(output)})
        return output
    finally:
        tmp_output.unlink(missing_ok=True)


def _audio_seconds(path: Path) -> float | None:
    from .media import media_duration_seconds
    return media_duration_seconds(path)


def asr_transcribe_payload(
    input_path: Path,
    work_dir: Path,
    *,
    language: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
    started: float,
) -> tuple[dict[str, Any], Path] | ToolResult:
    status = asr_status()
    if not status["available"]:
        return ToolResult(
            text="[ERROR] asr is not available: " + "; ".join(status["reasons"]),
            data={"recoverable": False, "provider": PROVIDER, "status": status},
        )
    from .creation_planning import file_digest
    original_sha = file_digest(input_path)
    prepared = prepare_audio_tts(input_path, work_dir)
    if isinstance(prepared, ToolResult):
        return prepared
    asr_source, audio_format, source_kind = prepared
    audio_bytes = asr_source.stat().st_size
    limit = _upload_limit()
    if audio_bytes > limit:
        return ToolResult(
            text=(
                f"[ERROR] asr audio too large ({audio_bytes / 2**20:.1f} MiB > the {limit / 2**20:.0f} MiB upload "
                "limit); transcribe with a smaller chunk_seconds or split the source media first"
            ),
            data={"provider": PROVIDER, "recoverable": False, "asr_audio": str(asr_source)},
        )

    audio_sha = file_digest(asr_source)
    if source_kind == 'extracted_audio':
        from .creation_takes import read_object
        cached = read_object(asr_source.with_suffix('.binding.json'))
        expected_binding = {'source_sha256': original_sha, 'sample_rate': SEED_SAMPLE_RATE,
                            'bitrate': SEED_AUDIO_BITRATE, 'channels': 1, 'converter_version': CONVERTER_VERSION}
        if cached.get('binding') != expected_binding or cached.get('sha256') != audio_sha:
            return ToolResult('[ERROR] ASR audio binding changed before submission', is_error=True)
    elif audio_sha != original_sha:
        return ToolResult('[ERROR] source audio changed before submission', is_error=True)
    duration = _audio_seconds(asr_source)
    max_wait = float(timeout_seconds)
    if duration:
        max_wait = min(max_wait, WAIT_BASE_SECONDS + WAIT_PER_AUDIO_SECOND * duration)
    try:
        result, meta = _run_recognition(
            asr_source, audio_format,
            max_wait_seconds=max_wait,
            poll_interval_seconds=max(MIN_POLL_INTERVAL_SECONDS, float(poll_interval_seconds)),
            audio_sha256=audio_sha,
        )
    except ASRError as exc:
        return ToolResult(
            text=f"[ERROR] asr transcription failed: {exc}",
            data={"provider": PROVIDER, "recoverable": exc.detail.get("recoverable", True), **exc.detail},
        )
    except Exception as exc:  # noqa: BLE001 — unexpected network-layer errors stay retryable
        return ToolResult(
            text=f"[ERROR] asr transcription failed: {exc}",
            data={"provider": PROVIDER, "recoverable": True},
        )
    if file_digest(input_path) != original_sha or file_digest(asr_source) != audio_sha:
        return ToolResult('[ERROR] source or ASR audio changed during recognition', is_error=True)
    payload = result_to_transcript_json(
        result,
        source_media=input_path,
        asr_audio=asr_source,
        language=language,
        source_kind=source_kind,
        elapsed_seconds=round(time.time() - started, 3),
        meta=meta,
    )
    payload['asr_audio_sha256'] = audio_sha
    payload['source_video_sha256'] = original_sha
    return payload, asr_source


class ASRError(RuntimeError):
    def __init__(self, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}


def _error_detail(exc: Any) -> dict[str, Any]:
    detail = dict(getattr(exc, "detail", {}) or {})
    return {key: detail[key] for key in ("code", "logid", "http_status", "msg", "hint", "idempotency_key")
            if detail.get(key) not in (None, "")}


def _submit(audio_url: str, audio_format: str, meta: dict[str, Any]) -> str:
    """Create the recognition task; returns its id.

    A lost response or UNKNOWN is replayed with the SAME Idempotency-Key; a
    replay reports the task id in ``upstream_req_id``.
    """
    from . import toolhub
    key = toolhub.new_idempotency_key()
    meta["idempotency_key"] = key
    body = {"audio": audio_url, "format": audio_format}
    last = None
    for attempt in range(SUBMIT_REPLAYS + 1):
        if attempt:
            time.sleep(SUBMIT_REPLAY_DELAY_SECONDS)
        try:
            data, call_meta = toolhub.invoke_with_retries(toolhub.PATH_ASR_SUBMIT, json_body=body,
                                                          idempotency_key=key,
                                                          timeout_seconds=toolhub.SUBMIT_TIMEOUT_SECONDS)
        except toolhub.ToolHubError as exc:
            if exc.retry_same_key and attempt < SUBMIT_REPLAYS:
                last = str(exc)
                continue
            # 3703: the audio URL or format was refused; a fixed request needs a new key.
            raise ASRError(f"submit failed: {exc}", {"recoverable": exc.code not in (3001, 3703, 3706),
                                                    "status_code": exc.code, **_error_detail(exc)}) from exc
        meta["submit_logid"] = call_meta.get("logid")
        output = data.get("output") if isinstance(data.get("output"), dict) else {}
        task_id = output.get("task_id") or (data.get("upstream_req_id") if data.get("replayed") else None)
        if data.get("state") == "SUCCEEDED" and task_id:
            return str(task_id)
        last = f"state {data.get('state')!r} (logid {call_meta.get('logid')})"
    raise ASRError(f"submit outcome unknown after {SUBMIT_REPLAYS + 1} same-key replays ({last})",
                   {"recoverable": True, "idempotency_key": key})


def _run_recognition(
    audio_path: Path,
    audio_format: str,
    *,
    max_wait_seconds: float,
    poll_interval_seconds: float,
    audio_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """upload -> submit -> poll. Returns ({"result": output}, meta)."""
    from . import toolhub
    meta: dict[str, Any] = {"resource_id": SERVICE_LABEL, "interface": INTERFACE, "audio_format": audio_format}
    try:
        audio_url, upload_meta = toolhub.upload_file(audio_path)
    except toolhub.ToolHubError as exc:
        raise ASRError(f"audio upload failed: {exc}", {"recoverable": exc.retry_same_key or exc.code == 2005,
                                                      "status_code": exc.code, "stage": "upload",
                                                      **_error_detail(exc)}) from exc
    meta["upload_logid"] = upload_meta.get("logid")
    meta["audio_url_expires_at"] = upload_meta.get("expires_at")
    task_id = _submit(audio_url, audio_format, meta)
    meta["request_id"] = task_id
    meta["task_id"] = task_id

    deadline = time.time() + max_wait_seconds
    status = ""
    while True:
        time.sleep(poll_interval_seconds)
        try:
            data, call_meta = toolhub.invoke_with_retries(toolhub.PATH_ASR_QUERY, json_body={"task_id": task_id},
                                                          timeout_seconds=toolhub.QUERY_TIMEOUT_SECONDS, attempts=2)
        except toolhub.ToolHubError as exc:
            if not exc.retry_same_key:
                # 3703 (query refused) / 3704 (task gone): stop polling this task.
                raise ASRError(f"query failed for task {task_id}: {exc}",
                               {"recoverable": exc.code == 3704, "status_code": exc.code, "task_id": task_id,
                                **_error_detail(exc)}) from exc
            errors = meta.setdefault("transient_query_errors", [])
            errors.append(str(exc))
            del errors[:-5]
            data, call_meta = None, {}
        if data is not None:
            status = str(data.get("status") or "").lower()
            if status == "succeeded":
                meta["query_logid"] = call_meta.get("logid")
                output = data.get("output") if isinstance(data.get("output"), dict) else {}
                if not str(output.get("text") or "").strip() and not output.get("utterances"):
                    meta["silent_audio"] = True
                return {"result": output}, meta
            if status == "failed":
                failure = data.get("failure") if isinstance(data.get("failure"), dict) else {}
                raise ASRError(
                    f"task {task_id} failed: {failure.get('code') or 'unknown'} {failure.get('message') or ''}".strip(),
                    {"recoverable": True, "task_id": task_id, "failure": failure},
                )
        if time.time() >= deadline:
            # The service may never finish a task whose audio it cannot fetch; do not
            # resubmit automatically, say so instead.
            raise ASRError(
                f"task {task_id} still {status or 'unknown'} after {max_wait_seconds:.0f}s; not resubmitting "
                "automatically — rerun transcribe to submit it again",
                {"recoverable": False, "task_id": task_id, "status": status or None,
                 "audio_sha256": audio_sha256},
            )


def _ms_to_seconds(value: object) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(parsed) or parsed < 0:
        return 0.0
    return round(parsed / 1000.0, 3)


def _utterance_speaker(item: dict[str, Any]) -> str:
    """说话人字段在文档里没定死: 逐个候选位置尽力取 (additions.speaker 为主)。"""
    additions = item.get("additions") if isinstance(item.get("additions"), dict) else {}
    for value in (
        item.get("speaker"),
        additions.get("speaker"),
        additions.get("speaker_id"),
        additions.get("channel_id"),
        item.get("channel_id"),
    ):
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _normalize_word(item: dict[str, Any], speaker: str) -> dict[str, Any]:
    return {
        "text": str(item.get("text") or "").strip(),
        "start": _ms_to_seconds(item.get("start_time")),
        "end": _ms_to_seconds(item.get("end_time")),
        "speaker": speaker or None,
    }


def result_to_transcript_json(
    payload: dict[str, Any],
    *,
    source_media: Path,
    asr_audio: Path,
    language: str,
    source_kind: str,
    elapsed_seconds: float,
    meta: dict[str, Any],
) -> dict[str, Any]:
    from .creation_planning import file_digest
    source_sha256 = file_digest(source_media)
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    utterances_raw = result.get("utterances") if isinstance(result.get("utterances"), list) else []
    segments: list[dict[str, Any]] = []
    words: list[dict[str, Any]] = []
    for item in utterances_raw:
        if not isinstance(item, dict):
            continue
        speaker = _utterance_speaker(item)
        seg_words = [
            _normalize_word(word, speaker)
            for word in (item.get("words") or [])
            if isinstance(word, dict)
        ]
        seg_words = [word for word in seg_words if word["text"]]
        segment = {
            "speaker": speaker,
            "text": str(item.get("text") or "").strip(),
            "start": _ms_to_seconds(item.get("start_time")),
            "end": _ms_to_seconds(item.get("end_time")),
            "words": seg_words,
        }
        if segment["text"] or seg_words:
            segments.append(segment)
            words.extend(seg_words)
    text = str(result.get("text") or "").strip()
    if not text and segments:
        text = "\n".join(seg["text"] for seg in segments if seg["text"]).strip()
    out: dict[str, Any] = {
        "provider": "asr",
        "asr_request_id": meta.get("request_id"),
        "asr_task_id": meta.get("task_id"),
        "resource_id": meta.get("resource_id"),
        "interface": meta.get("interface"),
        "language": language,
        "speaker_labels": any(seg.get("speaker") for seg in segments),
        "source_media": str(source_media),
        "source_video_sha256": source_sha256,
        "asr_audio": str(asr_audio),
        "source_kind": source_kind,
        "text": text,
        "words": words,
        "segments": segments,
        "elapsed_seconds": elapsed_seconds,
        "time_unit": "seconds",
    }
    if meta.get("silent_audio"):
        out["silent_audio"] = True
        out["note"] = "asr reported silent audio (no speech detected); empty transcript is valid"
    warning = language_sanity_warning(language, text, bool(out["speaker_labels"]))
    if warning:
        out["warnings"] = [warning]
        out["note"] = (out.get("note") + " " if out.get("note") else "") + warning
    return out
