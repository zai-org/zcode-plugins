"""Shared plan-store errors, constants and small durable-file helpers.

Imported by both ``plan_store`` (persistence, revisions) and ``attempt_store``
(attempt lifecycle) so neither has to import the other.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class PlanStoreError(RuntimeError):
    """Base class for plan-store failures."""


class ExecutionAttemptError(PlanStoreError):
    """Raised when a session execution attempt transition is invalid."""


#: Attempt states that never transition again. ``superseded`` (a stale lease
#: replaced by a retry) and ``abandoned`` (operator escape hatch) are terminal
#: for scheduling purposes but deliberately kept as distinct audit states.
TERMINAL_ATTEMPT_STATES = frozenset(
    {"succeeded", "failed", "canceled", "superseded", "abandoned"}
)

VERIFICATION_COMMANDS_SETTING = "verification_commands"


def _pretty_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _atomic_write(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` atomically (write-temp + os.replace).

    A crash mid-write (SIGKILL, disk full, power loss) must not leave a
    truncated file at ``path`` — readers would hit JSONDecodeError with no
    recovery path. We write to a sibling temp file then ``os.replace`` (POSIX
    atomic rename) so ``path`` is either the old content or the complete new
    content, never a partial write. ``fsync`` before rename persists the bytes
    so a crash after rename still has the file on disk. The temp name carries
    the pid and a uuid: concurrent CLI processes share ``path``, and a fixed
    temp name let their interleaved writes corrupt each other's payload.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.{uuid.uuid4().hex}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            # fsync may be unavailable/forbidden on some filesystems; the
            # rename is still atomic and the OS page cache is good enough in
            # the common case. Don't let fsync failure abort the write.
            pass
    os.replace(tmp, path)


def _utc_after(seconds: int) -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        + timedelta(seconds=seconds)
    ).isoformat()


__all__ = [
    "ExecutionAttemptError",
    "PlanStoreError",
    "TERMINAL_ATTEMPT_STATES",
    "VERIFICATION_COMMANDS_SETTING",
]
