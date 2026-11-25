from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


# Working directory of the current hook event (ZCode puts the project root in
# every event's ``cwd``; it injects no project-directory variable).
_EVENT_CWD: str | None = None


def remember_event(event) -> None:
    global _EVENT_CWD
    cwd = event.get("cwd") if isinstance(event, dict) else None
    _EVENT_CWD = cwd.strip() if isinstance(cwd, str) and cwd.strip() else None


def project_dir() -> Path:
    # 与 run_context.project_dir 同口径: 显式 VE_PROJECT_DIR 优先; 其次本次 hook 事件的 cwd,
    # 最后进程 cwd。空值 / 未展开的 ${...} 占位视为未设置 (否则 hook 与 MCP 工具会看到不同的项目目录)
    value = (os.environ.get("VE_PROJECT_DIR") or "").strip()
    if value and "${" not in value:
        return Path(value).resolve()
    if _EVENT_CWD:
        return Path(_EVENT_CWD).resolve()
    return Path.cwd().resolve()


def plugin_root() -> Path:
    value = os.environ.get("ZCODE_PLUGIN_ROOT") or os.environ.get("VE_PLUGIN_ROOT")
    return Path(value).resolve() if value else Path(__file__).resolve().parents[1]


def read_event_line() -> dict:
    """One hook event from stdin (ZCode writes one JSON line); {} when absent or invalid.

    Reads a single line so a host that keeps stdin open cannot block the hook.
    """
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return {}
        value = json.loads(sys.stdin.readline() or "{}")
    except Exception:
        return {}
    value = value if isinstance(value, dict) else {}
    remember_event(value)
    return value


def read_stdin_json() -> dict:
    try:
        raw = sys.stdin.read()
        value = json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}
    # 宿主总是发 object; 防御性归一, 非 dict 输入不该让 hook 以 AttributeError 崩掉
    value = value if isinstance(value, dict) else {}
    remember_event(value)
    return value


def state_dir() -> Path:
    value = os.environ.get("ZCODE_PLUGIN_DATA")
    root = Path(value) if value else project_dir() / ".video_agent" / "hook_state"
    root.mkdir(parents=True, exist_ok=True)
    return root


def sanitize_scope(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_.-]", "_", value.strip())
    return cleaned[:80] or "default"


def _strike_counter(rule: str, scope: str | None) -> Path:
    name = f"strike_{rule}" + (f"_{sanitize_scope(scope)}" if scope else "")
    return state_dir() / f"{name}.count"


def strike(rule: str, limit: int = 3, scope: str | None = None) -> tuple[int, bool]:
    """Count one violation. Counters are scoped (typically per session) so
    stale counts from earlier sessions cannot leak into a new one."""
    counter = _strike_counter(rule, scope)
    try:
        count = int(counter.read_text(encoding="utf-8").strip())
    except Exception:
        count = 0
    count += 1
    released = count >= limit
    if released:
        counter.write_text("0", encoding="utf-8")
        with (state_dir() / "violations.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"rule": rule, "scope": scope, "strikes": count}, ensure_ascii=False) + "\n")
    else:
        counter.write_text(str(count), encoding="utf-8")
    return count, released


def clear_strike(rule: str, scope: str | None = None) -> None:
    counter = _strike_counter(rule, scope)
    if counter.exists():
        counter.write_text("0", encoding="utf-8")


def block_stop(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    sys.exit(0)


def allow() -> None:
    sys.exit(0)
