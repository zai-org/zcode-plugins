"""Session clock: soft-deadline reminder for long creation sessions.

1109 A/B autopsy: both arms died the same way - an unconverged verify/regenerate
loop ran into the launcher's wall clock and was SIGKILLed with nothing delivered
(A/121 had budget left; time ran out first). The agent has no clock of its own,
so this hook carries the wall-clock fact into the session: after
VE_SESSION_SOFT_DEADLINE_MINUTES (default 180, measured from the first creation
tool call of this session) every ~20 minutes it injects one convergence reminder
via PostToolUse additionalContext. It never blocks a call (exit 0, advisory
only); the SKILL pairs it with the budget-exhaustion discipline: stop deepening,
assemble from what already passed, deliver, report the unresolved units.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hook_common import read_stdin_json, sanitize_scope, state_dir

DEFAULT_SOFT_DEADLINE_MINUTES = 180.0
REMINDER_INTERVAL_MINUTES = 20.0
# The video-edit MCP tools: "mcp__video-edit__<tool>" standalone, or with the plugin namespace
# ("mcp__plugin_video-agent-kit_video-edit__<tool>" under ZCode).
TOOL_MARK = "video-edit__"
# Tools that start the clock: the creation group (mcp/ve_tools/catalog.py). Recaps, editing and
# subtitles never start it, so a long movie recap does not get the "deliver out/preview.mp4"
# reminder. Once started, any video-edit call keeps it ticking: a creation run ends with
# video_render / video_qc.
CREATION_TOOLS = frozenset({
    "creation_plan_validate", "creation_review", "creation_timeline_build", "creation_verify",
    "image_crop", "image_generate", "title_cards", "video_generate", "voice_compare",
})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clock_path(scope: str) -> Path:
    return state_dir() / f"session_clock_{sanitize_scope(scope)}.json"


def _read_clock(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _write_clock(path: Path, data: dict) -> None:
    try:  # 原子写; hook 状态丢失只意味着少一次提醒, 绝不抛出
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def _parse_iso(value) -> "datetime | None":
    try:
        out = datetime.fromisoformat(str(value))
        return out if out.tzinfo else out.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def reminder_text(elapsed_min: float, deadline_min: float) -> str:
    return (f"[video-agent-kit session clock] This creation session has run for {elapsed_min:.0f} minutes "
            f"(soft deadline {deadline_min:.0f} minutes). If out/preview.mp4 is not delivered yet: stop "
            "submitting new takes and new verification rounds, assemble and render from the footage that "
            "has already passed review, deliver it, and list the unresolved units truthfully in the report. "
            "Time is spent like budget: a result delivered before it runs out beats nothing after it has. "
            "If the film is already delivered, finish up normally.")


def decide(now: datetime, payload: dict, env: dict) -> "str | None":
    """Pure decision core (unit-testable): the reminder text, or None."""
    tool = str(payload.get("tool_name") or "")
    if not (tool.startswith("mcp__") and TOOL_MARK in tool):
        return None
    try:
        deadline = float(env.get("VE_SESSION_SOFT_DEADLINE_MINUTES")
                         or DEFAULT_SOFT_DEADLINE_MINUTES)
    except (TypeError, ValueError):
        deadline = DEFAULT_SOFT_DEADLINE_MINUTES
    if deadline <= 0:
        return None
    path = _clock_path(str(payload.get("session_id") or "default"))
    data = _read_clock(path)
    first = _parse_iso(data.get("first_seen"))
    if first is None:  # first creation call of this session: start the clock
        if tool.split(TOOL_MARK, 1)[1] in CREATION_TOOLS:
            _write_clock(path, {"first_seen": now.isoformat()})
        return None
    elapsed = (now - first).total_seconds() / 60.0
    if elapsed < deadline:
        return None
    last = _parse_iso(data.get("last_reminder"))
    if last is not None and (now - last).total_seconds() / 60.0 < REMINDER_INTERVAL_MINUTES:
        return None
    data["first_seen"] = first.isoformat()
    data["last_reminder"] = now.isoformat()
    _write_clock(path, data)
    return reminder_text(elapsed, deadline)


def main() -> None:
    try:
        text = decide(_now(), read_stdin_json(), os.environ)
        if text:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                                     "additionalContext": text}},
                             ensure_ascii=False))
    except Exception:  # noqa: BLE001 — a reminder hook must never break a tool call
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
