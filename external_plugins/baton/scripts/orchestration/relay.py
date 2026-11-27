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
suggested action. ``activity_epoch`` is also what the controller uses to
renew a lease: an attempt that is still touching its worktree is not judged
dead merely because two hours passed since it was claimed. Everything here is
read-only.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestration.git_run import run_git
from orchestration.session_model import ExecutionAttempt
from orchestration.store_base import LEASED_ATTEMPT_STATES, TERMINAL_ATTEMPT_STATES

#: States that mean "the subagent may still be working". ``blocked-review``
#: and ``unknown`` are deliberately absent: both already carry failure
#: evidence, so the abandon escape hatch must stay cheap for them.
ACTIVE_ATTEMPT_STATES = LEASED_ATTEMPT_STATES

#: An attempt whose lease is less than this fraction spent is treated as
#: plausibly mid-flight: abandoning it is refused without ``--force``.
ABANDON_GUARD_FRACTION = 0.8

HEARTBEAT_NAME = "progress"


class _GitProbeError(RuntimeError):
    """A git probe could not run; the signal it would give is unknown."""


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


def _mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def _age_from_epoch(epoch: float | None) -> int | None:
    if epoch is None:
        return None
    return max(0, int(time.time() - epoch))


def heartbeat_path(attempt: ExecutionAttempt) -> Path | None:
    if not attempt.packet_path:
        return None
    return Path(attempt.packet_path).parent / HEARTBEAT_NAME


def _git(path: Path, args: list[str]):
    return run_git(args, cwd=path, error=_GitProbeError, timeout=30, check=False)


def _probe_worktree(attempt: ExecutionAttempt) -> tuple[bool | None, float | None]:
    """``(dirty, latest_activity_epoch)`` for the assignment worktree — read-only.

    A mid-flight worktree is *expected* to be clean (the subagent commits only
    right before sealing), so ``dirty=False`` is not a death verdict. What
    counts as activity is the newest of: a dirty or untracked file (test runs
    and edits keep these fresh), and the branch's HEAD commit. The index is
    deliberately not read: ``git status`` itself may rewrite it, which would
    make the probe look like work.
    """
    path = Path(attempt.worktree_path) if attempt.worktree_path else None
    if path is None or not path.is_dir():
        return None, None
    stamps: list[float] = []
    dirty: bool | None = None
    status = _git(path, ["status", "--porcelain"])
    if status.returncode == 0:
        lines = [line for line in status.stdout.splitlines() if line.strip()]
        dirty = bool(lines)
        for line in lines:
            # porcelain v1: "XY <path>", rename targets after " -> "
            name = line[3:].split(" -> ")[-1].strip().strip('"')
            stamp = _mtime(path / name)
            if stamp is not None:
                stamps.append(stamp)
    head = _git(path, ["log", "-1", "--format=%ct"])
    committed = head.stdout.strip() if head.returncode == 0 else ""
    if committed.isdigit():
        stamps.append(float(committed))
    return dirty, max(stamps, default=None)


def activity_epoch(attempt: ExecutionAttempt) -> float | None:
    """Latest wall-clock time (epoch seconds) anything showed work on the
    assignment: the heartbeat file, a dirty/untracked file, or HEAD's commit.

    ``None`` means no signal at all — reported as "unknown", never as dead:
    the heartbeat is only refreshed when the subagent remembers to.
    """
    stamps: list[float] = []
    heartbeat = heartbeat_path(attempt)
    if heartbeat is not None:
        stamp = _mtime(heartbeat)
        if stamp is not None:
            stamps.append(stamp)
    _, worktree_activity = _probe_worktree(attempt)
    if worktree_activity is not None:
        stamps.append(worktree_activity)
    return max(stamps, default=None)


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
    dirty, activity = _probe_worktree(attempt)
    worktree: dict[str, Any] = {
        "exists": bool(attempt.worktree_path and Path(attempt.worktree_path).is_dir()),
        "dirty": dirty,
        "last_activity_age_sec": _age_from_epoch(activity),
    }
    heartbeat = heartbeat_path(attempt)
    # The heartbeat lives in the run directory (outside the worktree, so
    # touching it never dirties a seal), and survives worktree removal.
    worktree["heartbeat_age_sec"] = (
        _age_from_epoch(_mtime(heartbeat)) if heartbeat is not None else None
    )
    return {
        "elapsed_sec": elapsed,
        "lease_remaining_sec": remaining,
        "lease_elapsed_fraction": fraction,
        "receipt_exists": bool(
            attempt.receipt_path and Path(attempt.receipt_path).is_file()
        ),
        "worktree": worktree,
    }


def suggest_action(attempt: ExecutionAttempt, facts: dict[str, Any]) -> str:
    """One coarse verdict per attempt, for a relay session to read aloud."""
    if attempt.state in TERMINAL_ATTEMPT_STATES:
        if attempt.state in {"abandoned", "superseded"} and facts["receipt_exists"]:
            return "adopt"
        return "none"
    # A parked attempt keeps its receipt on disk; its recorded failure, not the
    # receipt, is what says what happens next.
    if attempt.state == "blocked-review":
        if attempt.failure_code == "merge-conflict":
            return "resolve-or-abandon"
        if attempt.failure_code == "post-merge-verification-failed":
            return "repair-integration"
        return "decide"
    if facts["receipt_exists"]:
        return "reconcile"
    if attempt.state == "unknown":
        return "decide"
    if attempt.failure_code:
        return "decide"
    if attempt.state == "leased" and not attempt.agent_id:
        return "dispatch"
    remaining = facts["lease_remaining_sec"]
    if remaining is not None and remaining <= 0:
        return "await-expiry"
    if (
        facts["lease_elapsed_fraction"] is not None
        and facts["lease_elapsed_fraction"] >= ABANDON_GUARD_FRACTION
    ):
        return "wait-lease-nearly-spent"
    return "wait"


def abandon_refusal(attempt: ExecutionAttempt, facts: dict[str, Any]) -> dict[str, Any] | None:
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
    remaining = facts["lease_remaining_sec"]
    fraction = facts["lease_elapsed_fraction"]
    if facts["receipt_exists"]:
        reason = (
            "a sealed receipt already exists for this attempt — abandoning "
            "would discard verified work"
        )
        advice = "reconcile the receipt (adopt it if the attempt was retired)"
    elif remaining is not None and remaining > 0 and fraction is not None:
        if fraction >= ABANDON_GUARD_FRACTION:
            return None
        reason = (
            f"no failure evidence and only {int(fraction * 100)}% of the lease "
            f"has elapsed ({remaining}s remaining) — the attempt is plausibly "
            "still working"
        )
        if attempt.state == "leased" and not attempt.agent_id:
            advice = (
                "no agent is bound to this attempt yet — call actions to get its "
                "dispatch again instead of abandoning it"
            )
        else:
            advice = (
                "wait for the completion notice; a clean worktree mid-ticket is "
                "normal (write → verify → commit → seal), not a death verdict"
            )
    else:
        # Unreadable budget (or an expired lease): never block the hatch.
        return None
    return {
        "assignment_id": attempt.assignment_id,
        "state": attempt.state,
        "agent_id": attempt.agent_id,
        "elapsed_sec": facts["elapsed_sec"],
        "lease_remaining_sec": remaining,
        "lease_elapsed_fraction": fraction,
        "receipt_exists": facts["receipt_exists"],
        "worktree": facts["worktree"],
        "reason": reason,
        "suggested_action": suggest_action(attempt, facts),
        "advice": advice,
        "force": "pass --force to abandon anyway",
    }


__all__ = [
    "ABANDON_GUARD_FRACTION",
    "ACTIVE_ATTEMPT_STATES",
    "HEARTBEAT_NAME",
    "abandon_refusal",
    "activity_epoch",
    "heartbeat_path",
    "relay_facts",
    "suggest_action",
]
