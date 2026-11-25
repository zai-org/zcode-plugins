"""ZCode official identity for ToolHub calls (receiver side).

The plugin holds no credential. Its MCP server is declared in
``.zcode-plugin/plugin.json`` with ``"auth": {"type": "zcode_official",
"provider": "jwt_token"}``; the ZCode host then puts the identity headers of
**each** ``tools/call`` into ``params._meta["com.zcode/official-mcp-auth"]``.

How the identity travels inside this plugin:

1. ``server_common`` reads it on the event-loop thread (the MCP request context
   is a contextvar and does not cross thread boundaries) and hands it to
   ``jobs.call``.
2. ``jobs`` sets the ``CURRENT`` contextvar for the thread that runs the tool
   body (inline worker thread or job thread). It is never written to disk or to
   the environment, so ffmpeg and other children never see the token.
3. Threads a tool starts itself (thread pools for parallel TTS or images) do not
   inherit contextvars; for them ``current()`` falls back to the most recent
   valid identity this server process received. One MCP server serves one
   signed-in ZCode user, and that identity is also the freshest JWT.

A process that never served a tool call (the CLI, recap scripts) has no
identity at all. A 401/403 is not retried inside the call; the agent re-invokes
the tool to get fresh headers.
"""
from __future__ import annotations

import contextvars
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

# Cross-language protocol constant; must match the ZCode host exactly.
OFFICIAL_AUTH_META_KEY = "com.zcode/official-mcp-auth"

REASON_HINTS = {
    # Only the ZCode desktop app answers the host's identity request; a headless
    # `zcode -p` / `--target` run (or the TUI) sends this reason on every call.
    "official_auth_unavailable": ("ZCode is not signed in, no model connection is selected, or the session is "
                                  "not hosted by the ZCode desktop app (headless `zcode -p`/`--target` runs "
                                  "never carry an identity)"),
    "official_auth_plan_required": "the selected ZCode connection has no Coding Plan entitlement",
    "official_mcp_origin_untrusted": "the host rejected its own ZCode API origin (client configuration problem)",
}


@dataclass(frozen=True)
class OfficialAuth:
    """Identity of one tool call. Exactly one of ``headers`` / ``reason`` is set."""

    headers: dict[str, str] | None = None
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return bool(self.headers)

    def describe_failure(self) -> str:
        if self.ok:
            return ""
        reason = self.reason or "official_auth_unavailable"
        hint = REASON_HINTS.get(reason)
        return f"{reason} ({hint})" if hint else reason


CURRENT: contextvars.ContextVar[OfficialAuth | None] = contextvars.ContextVar("ve_official_auth", default=None)
_LATEST: OfficialAuth | None = None


def zcode_api_origin() -> tuple[str | None, str | None]:
    """``(origin, error)`` of the ZCode API, from the host-injected ``ZCODE_BASE_URL`` only.

    Never falls back to a project ``.env``: a repository could otherwise send the
    user's identity headers to another host. https only (http on loopback for
    local development).
    """
    raw = (os.environ.get("ZCODE_BASE_URL") or "").strip().rstrip("/")
    if not raw:
        return None, "ZCODE_BASE_URL is not set; the plugin is not running under ZCode"
    try:
        parts = urlsplit(raw)
    except Exception as exc:  # noqa: BLE001
        return None, f"ZCODE_BASE_URL is unparseable: {raw!r} ({exc})"
    scheme, host = (parts.scheme or "").lower(), (parts.hostname or "").lower()
    if parts.username or parts.password:
        return None, "ZCODE_BASE_URL must not embed credentials"
    if scheme == "https" or (scheme == "http" and host in ("127.0.0.1", "::1", "localhost")):
        return f"{parts.scheme}://{parts.netloc}", None
    return None, f"ZCODE_BASE_URL must be https (or http on loopback), got {raw!r}"


def extract_official_auth(meta: Any) -> OfficialAuth | None:
    """Identity payload of one ``_meta`` object; None when the host sent none."""
    payload = _meta_get(meta, OFFICIAL_AUTH_META_KEY)
    if not isinstance(payload, dict):
        return None
    if payload.get("ok") is True:
        headers = payload.get("headers")
        clean = {str(k): str(v) for k, v in headers.items()
                 if isinstance(k, str) and v is not None and str(v).strip()} if isinstance(headers, dict) else {}
        return OfficialAuth(headers=clean) if clean else OfficialAuth(reason="official_auth_unavailable")
    reason = payload.get("reason")
    return OfficialAuth(reason=reason if isinstance(reason, str) else "official_auth_unavailable")


def read_official_auth(*, server: Any = None, request_context: Any = None, params: Any = None) -> OfficialAuth | None:
    """Read this request's identity on the event-loop thread (all mcp 1.x dispatch styles)."""
    global _LATEST
    for meta in (_params_meta(params), getattr(request_context, "meta", None), _server_context_meta(server)):
        if meta is None:
            continue
        found = extract_official_auth(meta)
        if found is not None:
            if found.ok:
                _LATEST = found
            return found
    return None


def current() -> OfficialAuth | None:
    """Identity of the running call; in threads without it, the latest one this process received."""
    return CURRENT.get() or _LATEST


def _params_meta(params: Any) -> Any:
    if params is None:
        return None
    if isinstance(params, dict):
        return params.get("_meta") or params.get("meta")
    return getattr(params, "meta", None)


def _server_context_meta(server: Any) -> Any:
    if server is None:
        return None
    try:
        return getattr(server.request_context, "meta", None)
    except Exception:  # noqa: BLE001 - outside a request there is simply no identity
        return None


def _meta_get(meta: Any, key: str) -> Any:
    if meta is None:
        return None
    if isinstance(meta, dict):
        return meta.get(key)
    # pydantic RequestParams.Meta keeps custom keys (with dots and slashes) in model_extra.
    extra = getattr(meta, "model_extra", None)
    if isinstance(extra, dict) and key in extra:
        return extra[key]
    try:
        dumped = meta.model_dump(by_alias=True)
    except Exception:  # noqa: BLE001
        return None
    return dumped.get(key) if isinstance(dumped, dict) else None
