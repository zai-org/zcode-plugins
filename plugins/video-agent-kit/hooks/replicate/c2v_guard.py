"""code2video guard for the main agent's tool calls (PreToolUse), wired from r2_event.handle.

One rule, an objective text check on the call the model is about to make:

secret_access (denied every time): a shell command that reads credentials or contacts a generation
    service directly — the name of a credential variable, an environment dump (`env`, `printenv`,
    bare `set`, `/proc/*/environ`, the secrets file, a whole `os.environ`), a configured service
    host or the variable holding its address. The tools are the only route to those services; a
    direct call has no ledger, no usage limit and no record.

Edits to hosted-3D products (3d.md 2.4.2) are NOT intercepted here: a text match on a Blender
script cannot tell a local repair from a rewrite and would block compliant work (user decision,
2026-11-05). They are audited after the run instead (pipeline/code2video_tasks.py, same rule table
in c2v_guard_rules.py), where a finding is reported, not enforced mid-session.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hook_common import _split_heredocs  # noqa: E402
import c2v_guard_rules as R  # noqa: E402

SECRET_DENY = ("Generation services (image generation, speech synthesis, 3D generation) are called only through their MCP "
               "tools. Do not read or print environment variables in the shell, do not open credential files and do "
               "not request the service addresses directly; the tools are already configured, call them as they are.")


def guard_hosts() -> tuple[str, ...]:
    raw = (os.environ.get("VE_GUARD_HOSTS") or "").strip()
    hosts = tuple(h.strip() for h in raw.split(",") if h.strip()) if raw else ()
    return tuple(dict.fromkeys((*hosts, *R.DEFAULT_GUARD_HOSTS)))


# ---------------------------------------------------------------- secret access
def secret_access(command: str) -> str | None:
    """Why a shell command is a credential read or a direct service call; None when it is neither."""
    text = command or ""
    skeleton, bodies = _split_heredocs(text)
    if R.SECRET_NAME.search(text):
        return "names a credential variable"
    if R.SECRET_PATHS.search(text):
        return "reads the secrets file or a process environment"
    if R.ENV_DUMP.search(skeleton):
        return "dumps the environment"
    if R.SERVICE_VAR.search(text):
        return "uses a service address variable"
    for body in bodies + [skeleton]:
        if R.OS_ENVIRON_DUMP.search(body):
            return "dumps os.environ"
    lowered = text.lower()
    for host in guard_hosts():
        if host.lower() in lowered:
            return "requests a generation service address directly"
    return None


# ---------------------------------------------------------------- state
def _state(project: Path) -> Path:
    d = project / ".v2c/hook_state"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _record(project: Path, rule: str, payload: dict) -> None:
    try:
        with (_state(project) / "violations.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"rule": rule, "time": time.time(), **payload}, ensure_ascii=False) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- entry
def check(tool: str, tool_input: dict, project: Path) -> str | None:
    """Deny message for this call, or None to let it through."""
    tool_input = tool_input or {}
    if tool == "Bash":
        why = secret_access(str(tool_input.get("command") or ""))
        if why:
            _record(project, "secret_access", {"why": why, "command": str(tool_input.get("command") or "")[:300]})
            return SECRET_DENY
    return None
