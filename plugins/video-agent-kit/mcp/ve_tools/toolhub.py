"""ZCode ToolHub transport (image, video, H3 person swap, ASR, TTS, 3D, file upload).

Plain REST, not MCP: ``POST {ZCODE_BASE_URL}/api/v1/toolhub/...``. The plugin
holds no credential; the identity headers of the running tool call come from
``official_auth.current()`` (ZCode puts them in each ``tools/call`` ``_meta``).

Rules this layer enforces:

1. **The response is an envelope** ``{code, msg, data, logid}``; only
   ``code == 0`` is accepted and most business failures are HTTP 200.
2. **Retries reuse the same Idempotency-Key.** A new key is a new submission
   (it creates another task). When a new key is allowed is decided by
   the caller, never here.
3. **The error code decides retryability**: 3002/2007/2005/3702 are transient
   (back off, same key); 3001/3703/3704/3706/3707 are final for that request.
4. Redirects are refused (identity headers must not leave the ZCode origin),
   401/403 are not retried inside a call (the job cannot get a fresh identity),
   and generated assets are downloaded **without** identity headers (they live
   on upstream object storage, not on the ZCode origin).
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .official_auth import OfficialAuth, current, zcode_api_origin

API_PREFIX = "/api/v1/toolhub"
PATH_IMAGE = f"{API_PREFIX}/tool/image_generate/invoke"
PATH_VIDEO_SUBMIT = f"{API_PREFIX}/tool/video_generate/invoke"
PATH_VIDEO_QUERY = f"{API_PREFIX}/tool/video_generate/tasks/query"
PATH_ASR_SUBMIT = f"{API_PREFIX}/tool/seed_asr/invoke"
PATH_ASR_QUERY = f"{API_PREFIX}/tool/seed_asr/tasks/query"
PATH_TTS = f"{API_PREFIX}/tool/stepfun_tts/invoke"
PATH_MODEL3D = f"{API_PREFIX}/tool/tripo_model3d/invoke"
PATH_MODEL3D_QUERY = f"{API_PREFIX}/tool/tripo_model3d/tasks/query"
PATH_H3_SUBMIT = f"{API_PREFIX}/tool/minimax_h3_video/invoke"
PATH_H3_QUERY = f"{API_PREFIX}/tool/minimax_h3_video/tasks/query"
PATH_FILES = f"{API_PREFIX}/files"

PROVIDER = "zcode_toolhub"
MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_CONTENT_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "webp": "image/webp",
                        "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "mp4": "video/mp4"}

# Timeouts from the ToolHub documents (sync image >= 130 s, TTS >= 40 s), with margin.
IMAGE_TIMEOUT_SECONDS = 180.0
TTS_TIMEOUT_SECONDS = 60.0
SUBMIT_TIMEOUT_SECONDS = 120.0
QUERY_TIMEOUT_SECONDS = 60.0
UPLOAD_TIMEOUT_SECONDS = 180.0
DOWNLOAD_TIMEOUT_SECONDS = 300.0

RETRY_SAME_KEY_CODES = {3002, 2007, 2005, 3702}
CODE_HINTS = {
    3001: "invalid request (body, prompt, reference media, Idempotency-Key or Coding Plan scope); fix and retry",
    3002: "too many requests or upstream busy; back off and retry",
    3701: "tool temporarily unavailable; retry later",
    3702: "this Idempotency-Key belongs to a different request, or the same request is still in flight",
    3703: "tool call failed (generation failed, content refused, upstream limit); a new key may retry",
    3704: "task not found, expired, invalid, or not submitted by this user; stop polling",
    3705: "tool path not found",
    3706: "this ZCode account cannot use tools (no Z.ai account, or phone/email missing); the user must bind it",
    3707: "uploaded file is empty, too large or of a disallowed type",
    2005: "object storage error; retry later",
    2007: "server or upstream failure (including timeouts); retry later with the same key",
}


class ToolHubError(RuntimeError):
    """One failed ToolHub call; ``detail`` is safe to show to the agent (no credentials)."""

    def __init__(self, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}

    @property
    def retry_same_key(self) -> bool:
        return bool(self.detail.get("retry_same_key"))

    @property
    def code(self) -> int | None:
        value = self.detail.get("code")
        return value if isinstance(value, int) else None


NO_IDENTITY_HINT = ("no ZCode identity in this process: only MCP tool calls of the video-edit server carry the "
                    "signed-in account (a command-line run has none) — run this step through the MCP tool")


def identity_missing() -> bool:
    """True when this process is not serving a ZCode tool call (e.g. a command-line run)."""
    return current() is None


def new_idempotency_key() -> str:
    return str(uuid.uuid4())


def status() -> dict[str, Any]:
    """{available, reasons, endpoint}: why ToolHub cannot be used right now, if it cannot."""
    reasons: list[str] = []
    origin, origin_error = zcode_api_origin()
    if origin_error:
        reasons.append(origin_error)
    auth = current()
    if auth is None:
        reasons.append(NO_IDENTITY_HINT)
    elif not auth.ok:
        reasons.append(f"ZCode identity unavailable: {auth.describe_failure()}")
    return {"available": not reasons, "reasons": reasons, "provider": PROVIDER,
            "endpoint": f"{origin}{API_PREFIX}" if origin else None}


def _channel() -> tuple[str, OfficialAuth]:
    origin, origin_error = zcode_api_origin()
    if origin_error or not origin:
        raise ToolHubError(origin_error or "ZCODE_BASE_URL is unavailable", {"recoverable": False, "provider": PROVIDER})
    auth = current()
    if auth is None or not auth.ok:
        if auth is None:
            raise ToolHubError(NO_IDENTITY_HINT, {"recoverable": False, "provider": PROVIDER, "needs_mcp_call": True})
        raise ToolHubError(f"ZCode identity unavailable: {auth.describe_failure()}",
                           {"recoverable": False, "provider": PROVIDER})
    return origin, auth


# Every ToolHub call names its caller so the server can attribute usage to this plugin.
USAGE_SCENARIO_HEADER = ("X-Usage-Scenario", "video-kit")

# response headers that identify which proxy produced a non-JSON answer (never identity headers)
HOP_HEADERS = ("server", "via", "x-log-id", "x-request-id", "x-process-time", "x-envoy-upstream-service-time",
               "x-cache", "eagleeye-traceid", "x-amzn-requestid", "date")


def _decode(response: Any) -> str:
    body = getattr(response, "content", b"") or b""
    return body if isinstance(body, str) else body.decode("utf-8", errors="replace")


def invoke(path: str, *, json_body: dict[str, Any] | None = None, file_path: Path | None = None,
           idempotency_key: str | None = None, timeout_seconds: float) -> tuple[dict[str, Any], dict[str, Any]]:
    """One ToolHub call; returns ``(data, meta)`` or raises ToolHubError.

    ``meta`` carries endpoint, http_status, logid and the Idempotency-Key for
    diagnosis; it never contains identity headers.
    """
    import requests

    origin, auth = _channel()
    url = f"{origin}{path}"
    from .public_surface import public_text
    # the endpoint is shown in diagnostics: wire tool names are reduced to their public labels
    meta: dict[str, Any] = {"endpoint": public_text(url), "provider": PROVIDER}
    headers = dict(auth.headers or {})
    headers[USAGE_SCENARIO_HEADER[0]] = USAGE_SCENARIO_HEADER[1]
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
        meta["idempotency_key"] = idempotency_key
    kwargs: dict[str, Any] = {"headers": headers, "timeout": timeout_seconds, "allow_redirects": False}
    if file_path is not None:
        suffix = file_path.suffix.lower().lstrip(".")
        kwargs["files"] = {"file": (file_path.name, file_path.read_bytes(),
                                    UPLOAD_CONTENT_TYPES.get(suffix, "application/octet-stream"))}
    else:
        headers["Content-Type"] = "application/json"
        body = json.dumps(json_body or {}, ensure_ascii=False).encode("utf-8")
        if len(body) > MAX_REQUEST_BODY_BYTES:
            raise ToolHubError(f"request body is {len(body):,d} B, over the ToolHub limit of {MAX_REQUEST_BODY_BYTES:,d} B; "
                               "upload large media and pass its URL", {"recoverable": False, **meta})
        kwargs["data"] = body
    try:
        response = requests.post(url, **kwargs)
    except Exception as exc:  # noqa: BLE001 - the request may have been accepted: same-key replay decides
        raise ToolHubError(f"ToolHub request failed: {type(exc).__name__}: {exc}",
                           {"recoverable": True, "retry_same_key": True, **meta}) from exc
    status_code = int(getattr(response, "status_code", 0) or 0)
    meta["http_status"] = status_code
    if status_code in (401, 403):
        kind = "official_auth_rejected" if status_code == 401 else "official_auth_forbidden"
        raise ToolHubError(f"ZCode rejected the ToolHub call ({status_code} {kind}); call the tool again to use a fresh "
                           "identity (403: also check the account's Coding Plan)",
                           {"recoverable": False, "auth_error": kind, **meta})
    if 300 <= status_code < 400:
        raise ToolHubError(f"ToolHub answered with a redirect ({status_code}); refused",
                           {"recoverable": False, **meta})
    text = _decode(response)
    try:
        envelope = json.loads(text)
    except ValueError:
        envelope = None
    if not isinstance(envelope, dict):
        retryable = status_code == 429 or status_code >= 500
        # a non-JSON answer comes from a proxy, not ToolHub: these headers name the hop that produced it
        raw_headers = getattr(response, "headers", None) or {}
        hop = {name: str(raw_headers.get(name))[:120] for name in HOP_HEADERS if raw_headers.get(name)}
        if hop:
            meta["hop_headers"] = hop
        preview = " ".join(re.sub(r"<[^>]*>", " ", text[:2000]).split())  # proxy error pages are HTML
        raise ToolHubError(f"ToolHub returned a non-JSON response ({status_code}; body {preview[:120]!r}; headers {hop})",
                           {"recoverable": retryable, "retry_same_key": retryable, "body_preview": text[:200], **meta})
    if envelope.get("logid"):
        meta["logid"] = envelope["logid"]
    code = envelope.get("code") if isinstance(envelope.get("code"), int) else -1
    meta["code"] = code
    if code != 0:
        message = str(envelope.get("msg") or "").strip()
        hint = CODE_HINTS.get(code, "unknown error code")
        transient = code in RETRY_SAME_KEY_CODES
        raise ToolHubError(f"ToolHub returned code {code}: {message or hint}",
                           {"recoverable": transient, "retry_same_key": transient, "msg": message, "hint": hint, **meta})
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ToolHubError("ToolHub accepted the call but returned no data object",
                           {"recoverable": True, "retry_same_key": True, **meta})
    return data, meta


def invoke_with_retries(path: str, *, json_body: dict[str, Any] | None = None, file_path: Path | None = None,
                        idempotency_key: str | None = None, timeout_seconds: float, attempts: int = 3,
                        backoff_seconds: float = 5.0, sleep: Any = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Retry transient failures only, always with the same Idempotency-Key."""
    pause = sleep or time.sleep
    last: ToolHubError | None = None
    for attempt in range(max(1, int(attempts))):
        try:
            return invoke(path, json_body=json_body, file_path=file_path, idempotency_key=idempotency_key,
                          timeout_seconds=timeout_seconds)
        except ToolHubError as exc:
            last = exc
            if not exc.retry_same_key or attempt == attempts - 1:
                raise
            pause(backoff_seconds * (2 ** attempt))
    raise last if last is not None else ToolHubError("ToolHub call made no attempt")


def upload_file(file_path: Path, *, timeout_seconds: float = UPLOAD_TIMEOUT_SECONDS) -> tuple[str, dict[str, Any]]:
    """Local file -> public presigned https URL (``data.url``; valid about 24 h)."""
    resolved = Path(file_path)
    if not resolved.is_file():
        raise ToolHubError(f"upload source is not a file: {resolved}", {"recoverable": False, "provider": PROVIDER})
    size = resolved.stat().st_size
    if size == 0 or size > MAX_UPLOAD_BYTES:
        raise ToolHubError(f"upload source is {size:,d} B; ToolHub accepts 1 B to {MAX_UPLOAD_BYTES:,d} B",
                           {"recoverable": False, "provider": PROVIDER, "file_bytes": size})
    data, meta = invoke_with_retries(PATH_FILES, file_path=resolved, timeout_seconds=timeout_seconds)
    url = data.get("url")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ToolHubError("ToolHub upload returned no https URL", {"recoverable": True, **meta})
    meta["expires_at"] = data.get("expires_at")
    return url, meta


def download(url: str, dest: Path, *, max_bytes: int, timeout_seconds: float = DOWNLOAD_TIMEOUT_SECONDS) -> Path:
    """Save a generated asset. https only, **no identity headers**, size capped while streaming."""
    import requests

    if (urlsplit(url).scheme or "").lower() != "https":
        raise ToolHubError("refusing to download a generated asset that is not https", {"recoverable": False})
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    written = 0
    try:
        with requests.get(url, timeout=timeout_seconds, stream=True, allow_redirects=True) as response:
            code = int(getattr(response, "status_code", 0) or 0)
            if code >= 400:
                raise ToolHubError(f"downloading the generated asset failed ({code}); the link may have expired",
                                   {"recoverable": code >= 500, "http_status": code})
            with partial.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        raise ToolHubError(f"generated asset exceeds the {max_bytes:,d} B download cap",
                                           {"recoverable": False})
                    handle.write(chunk)
        if written == 0:
            raise ToolHubError("the generated asset downloaded as 0 bytes", {"recoverable": True})
        partial.replace(dest)
    except ToolHubError:
        partial.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        partial.unlink(missing_ok=True)
        raise ToolHubError(f"downloading the generated asset failed: {type(exc).__name__}: {exc}",
                           {"recoverable": True}) from exc
    return dest
