"""Mechanical relay judgments: is an in-flight attempt alive, and what next?

The 2026-11-06 fusion-s1 incident: a handoff session saw "no receipt + a clean
worktree" 14 minutes into a ~26-minute ticket under a 2-hour lease, concluded
the subagent was dead, and abandoned the attempt. The subagent was alive and
sealed a receipt 11 minutes later — but the abandon had already destroyed the
attempt's reconcile eligibility, so the ticket was rebuilt from scratch. All
three pieces of "evidence" actually said *alive*: the subagent flow is
write → verify → commit → seal, so a mid-flight worktree is clean by design; a
receipt only exists after that whole pipeline; and "the notice was lost" was an
unverified assumption copied from the handoff note.

This module turns that judgment into data the CLI can print: elapsed vs the
lease budget, receipt existence, worktree activity, a heartbeat age, and a
suggested action. Everything here is read-only.
"""

from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestration.session_model import ExecutionAttempt
from orchestration.store_base import TERMINAL_ATTEMPT_STATES

#: States that mean "the subagent may still be working". ``blocked-review``
#: and ``unknown`` are deliberately absent: both already carry failure
#: evidence, so the abandon escape hatch must stay cheap for them.
ACTIVE_ATTEMPT_STATES = frozenset(
    {"leased", "spawned", "running", "submitted", "verifying", "integrating"}
)

#: An attempt whose lease is less than this fraction spent is treated as
#: plausibly mid-flight: abandoning it is refused without ``--force``.
ABANDON_GUARD_FRACTION = 0.8

HEARTBEAT_NAME = "progress"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _parse(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def _age_sec(now: datetime, ts: str) -> int | None:
    parsed = _parse(ts)
    if parsed is None:
        return None
    return max(0, int((now - parsed).total_seconds()))


def _heartbeat_path(attempt: ExecutionAttempt) -> Path | None:
    if not attempt.packet_path:
        return None
    return Path(attempt.packet_path).parent / HEARTBEAT_NAME


def _file_age_sec(path: Path) -> int | None:
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    return max(0, int(time.time() - mtime))


def _worktree_signals(attempt: ExecutionAttempt) -> dict[str, Any]:
    """Weak liveness signals from the assignment worktree — read-only.

    A mid-flight worktree is *expected* to be clean (the subagent commits only
    right before sealing), so ``dirty: false`` is not a death verdict. The
    signals that matter are ages: freshly touched files (dirty or index) or a
    fresh heartbeat mean "alive"; everything missing or stale is simply
    uninformative and reported as such.
    """
    path = Path(attempt.worktree_path) if attempt.worktree_path else None
    if path is None or not path.is_dir():
        return {"exists": False, "dirty": None, "lastActivityAgeSec": None}
    signals: dict[str, Any] = {"exists": True, "dirty": None, "lastActivityAgeSec": None}
    candidates: list[int] = []
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return signals
    if proc.returncode != 0:
        signals["note"] = "git status failed"
        return signals
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    signals["dirty"] = bool(lines)
    for line in lines:
        # porcelain v1: "XY <path>", rename targets after " -> "
        name = line[3:].split(" -> ")[-1].strip().strip('"')
        age = _file_age_sec(path / name)
        if age is not None:
            candidates.append(age)
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--git-path", "index"],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if proc.returncode == 0:
            index_age = _file_age_sec(path / proc.stdout.strip())
            if index_age is not None:
                candidates.append(index_age)
    except (OSError, subprocess.SubprocessError):
        pass
    if candidates:
        signals["lastActivityAgeSec"] = min(candidates)
    return signals


def relay_facts(attempt: ExecutionAttempt) -> dict[str, Any]:
    """Everything a relay decision needs, computed from one attempt row."""
    now = _now()
    elapsed = _age_sec(now, attempt.created_at)
    remaining: int | None = None
    fraction: float | None = None
    expires = _parse(attempt.lease_expires_at)
    created = _parse(attempt.created_at)
    if expires is not None and created is not None:
        total = (expires - created).total_seconds()
        if total > 0:
            remaining = int((expires - now).total_seconds())
            fraction = round(max(0.0, 1.0 - remaining / total), 3)
    worktree = _worktree_signals(attempt)
    heartbeat = _heartbeat_path(attempt)
    if heartbeat is not None:
        # The heartbeat lives in the run directory (outside the worktree, so
        # touching it never dirties a seal), and survives worktree removal.
        worktree["heartbeatAgeSec"] = _file_age_sec(heartbeat)
    return {
        "elapsedSec": elapsed,
        "leaseRemainingSec": remaining,
        "leaseElapsedFraction": fraction,
        "receiptExists": bool(
            attempt.receipt_path and Path(attempt.receipt_path).is_file()
        ),
        "worktree": worktree,
    }


def suggest_action(attempt: ExecutionAttempt, facts: dict[str, Any]) -> str:
    """One coarse verdict per attempt, for a relay session to read aloud."""
    if attempt.state in TERMINAL_ATTEMPT_STATES:
        if attempt.state == "abandoned" and facts["receiptExists"]:
            return "adopt"
        return "none"
    if facts["receiptExists"]:
        return "reconcile"
    if attempt.state == "blocked-review":
        return "resolve-or-abandon"
    if attempt.state == "unknown":
        return "decide"
    if attempt.failure_code:
        return "decide"
    remaining = facts["leaseRemainingSec"]
    if remaining is not None and remaining <= 0:
        return "await-expiry"
    if (
        facts["leaseElapsedFraction"] is not None
        and facts["leaseElapsedFraction"] >= ABANDON_GUARD_FRACTION
    ):
        return "wait-lease-nearly-spent"
    return "wait"


def abandon_refusal(
    attempt: ExecutionAttempt, facts: dict[str, Any]
) -> dict[str, Any] | None:
    """The guard payload when abandon would destroy plausibly-live work.

    Returns ``None`` when abandoning is reasonable (failure evidence present,
    lease expired or nearly spent, or the attempt already terminal) — the
    escape hatch must stay cheap exactly where it is needed. A refusal is
    data, not a block: ``--force`` bypasses it.
    """
    if attempt.state not in ACTIVE_ATTEMPT_STATES:
        return None
    if attempt.failure_code:
        return None
    remaining = facts["leaseRemainingSec"]
    fraction = facts["leaseElapsedFraction"]
    if facts["receiptExists"]:
        reason = (
            "a sealed receipt already exists for this attempt — abandoning "
            "would discard verified work"
        )
        advice = "reconcile the receipt (adopt it if the attempt was abandoned)"
    elif remaining is not None and remaining > 0 and fraction is not None:
        if fraction >= ABANDON_GUARD_FRACTION:
            return None
        reason = (
            f"no failure evidence and only {int(fraction * 100)}% of the lease "
            f"has elapsed ({remaining}s remaining) — the attempt is plausibly "
            "still working"
        )
        advice = (
            "wait for the completion notice; a clean worktree mid-ticket is "
            "normal (write → verify → commit → seal), not a death verdict"
        )
    else:
        # Unreadable budget (or an expired lease): never block the hatch.
        return None
    return {
        "assignmentId": attempt.assignment_id,
        "state": attempt.state,
        "elapsedSec": facts["elapsedSec"],
        "leaseRemainingSec": remaining,
        "leaseElapsedFraction": fraction,
        "receiptExists": facts["receiptExists"],
        "worktree": facts["worktree"],
        "reason": reason,
        "suggestedAction": suggest_action(attempt, facts),
        "advice": advice,
        "force": "pass --force to abandon anyway",
    }


def refusal_message(refusal: dict[str, Any]) -> str:
    return "abandon refused — " + json.dumps(refusal, ensure_ascii=False)


__all__ = [
    "ABANDON_GUARD_FRACTION",
    "ACTIVE_ATTEMPT_STATES",
    "HEARTBEAT_NAME",
    "abandon_refusal",
    "refusal_message",
    "relay_facts",
    "suggest_action",
]
