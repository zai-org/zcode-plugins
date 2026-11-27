"""Shared plan-store errors, attempt-state constants and durable-file helpers.

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
    """Base class for plan-store failures.

    ``code`` is the stable machine-readable cause the CLI reports; a raise
    site overrides it when the message alone would be ambiguous.
    """

    code = "plan-store"

    def __init__(self, message: str = "", *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


class ExecutionAttemptError(PlanStoreError):
    """Raised when a session execution attempt transition is invalid."""

    code = "invalid-transition"


#: States that still own the ticket: they count against capacity and are the
#: subject of the one-active-attempt-per-ticket index.
ACTIVE_ATTEMPT_STATES = frozenset({"leased", "spawned", "integrating", "blocked-review"})

#: Active states whose lease clock can run out (``blocked-review`` is parked
#: on recorded failure evidence and waits for an operator instead).
LEASED_ATTEMPT_STATES = frozenset({"leased", "spawned", "integrating"})

#: States that never transition again. ``superseded`` (a stale lease replaced
#: by a retry or a reopen) and ``abandoned`` (operator escape hatch) are kept
#: as distinct audit states; all three stay adoptable when a receipt lands.
TERMINAL_ATTEMPT_STATES = frozenset({"succeeded", "superseded", "abandoned"})

#: Automatic ``lease-expired`` retries per ticket before the recover needs an
#: operator (``reopen`` grants a fresh budget).
MAX_ATTEMPTS_PER_TICKET = 3

VERIFICATION_COMMANDS_SETTING = "verification_commands"
CAPACITY_SETTING = "capacity"
BASE_BRANCH_SETTING = "base_branch"
#: ``{ticket_num: attempts_before_the_last_reopen}`` — the attempt numbers a
#: retry budget is counted from.
REOPEN_EPOCHS_SETTING = "attempt_epochs"


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


def _utc_after(seconds: int, *, now: datetime | None = None) -> str:
    base = now or datetime.now(timezone.utc)
    return (base.replace(microsecond=0) + timedelta(seconds=seconds)).isoformat()


__all__ = [
    "ACTIVE_ATTEMPT_STATES",
    "BASE_BRANCH_SETTING",
    "CAPACITY_SETTING",
    "ExecutionAttemptError",
    "LEASED_ATTEMPT_STATES",
    "MAX_ATTEMPTS_PER_TICKET",
    "PlanStoreError",
    "REOPEN_EPOCHS_SETTING",
    "TERMINAL_ATTEMPT_STATES",
    "VERIFICATION_COMMANDS_SETTING",
]
