"""Leases, retry budgets and recover actions.

Mixed into :class:`orchestration.session_controller.SessionController`, which
provides ``store``, ``lease_seconds`` and ``project_path``. This module never
imports the controller, so the dependency stays one-way.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestration.receipt import last_verification_failure
from orchestration.relay import activity_epoch
from orchestration.session_model import (
    BlockedAction,
    ExecutionAttempt,
    RecoverAction,
    display_ticket,
)
from orchestration.store_base import (
    ACTIVE_ATTEMPT_STATES,
    LEASED_ATTEMPT_STATES,
    TERMINAL_ATTEMPT_STATES,
    _utc_after,
)

#: Activity can keep an attempt alive for at most this many leases: a zombie
#: that keeps touching files must not live forever.
HARD_CAP_LEASES = 3


class LeaseFlowMixin:
    """Liveness judgments and the recover actions that follow from them."""

    def _refresh_leases(self) -> None:
        """Move each leased attempt's deadline to its latest activity.

        The lease is ``lease_seconds`` of *silence*, not of wall clock: an
        attempt whose heartbeat or worktree was touched recently is still
        working, and re-dispatching it at the two-hour mark would put two
        subagents on one ticket. ``HARD_CAP_LEASES`` bounds how long activity
        can keep the attempt alive.
        """
        for attempt in self.store.list_execution_attempts():
            if attempt.state not in LEASED_ATTEMPT_STATES:
                continue
            activity = activity_epoch(attempt)
            if activity is None:
                continue
            cap = _utc_after(
                self.lease_seconds * HARD_CAP_LEASES,
                now=datetime.fromisoformat(attempt.created_at),
            )
            renewed = _utc_after(
                self.lease_seconds,
                now=datetime.fromtimestamp(activity, tz=timezone.utc),
            )
            expires = min(renewed, cap)
            if expires > attempt.lease_expires_at:
                self.store.renew_execution_attempt_lease(attempt.assignment_id, expires)

    def _at_retry_cap(self, ticket_num: int) -> bool:
        used, budget = self.store.attempts_used(ticket_num)
        return used >= budget

    def _exhausted_tickets(self) -> list[BlockedAction]:
        """Unresolved tickets that used their whole retry budget.

        The budget keeps them out of the claim loop; without this they would
        vanish from every batch — never dispatched, never complete, and
        nothing saying why. A ticket that still has an open attempt is already
        surfaced by its own ``recover`` and is not repeated here.
        """
        missing = self.store.latest_completion()["missing_required_tickets"]
        if not missing:
            return []
        attempts = self.store.list_execution_attempts()
        taken = {
            attempt.ticket_num
            for attempt in attempts
            if attempt.state not in TERMINAL_ATTEMPT_STATES
        }
        taken.update(
            attempt.ticket_num
            for attempt in attempts
            if attempt.state in ACTIVE_ATTEMPT_STATES
        )
        blocked: list[BlockedAction] = []
        for ticket_num in missing:
            if ticket_num in taken:
                continue
            used, budget = self.store.attempts_used(ticket_num)
            if used < budget:
                continue
            ticket = display_ticket(ticket_num)
            blocked.append(
                BlockedAction(
                    code="retry-budget-spent",
                    ticket_num=ticket_num,
                    reason=(
                        f"task {ticket} has had {used} attempts (the budget is "
                        f"{budget}) and is still unresolved. Nothing is dispatched "
                        "for it and the run cannot complete. "
                        f"`{self._cli()} reopen {ticket}` grants a fresh budget, "
                        "or stop here."
                    ),
                )
            )
        return blocked

    def _cli(self) -> str:
        return f'session_control.py "{self.project_path}" {self.feature}'

    def _ticket_delivered(
        self, attempt: ExecutionAttempt, attempts: list[ExecutionAttempt]
    ) -> bool:
        """Whether the ticket is already delivered by other means, which
        retires a stale ``unknown`` attempt instead of asking for a decision
        about work that no longer needs doing."""
        if self._successor_with_sealed_receipt(attempt, attempts) is not None:
            return True
        return self.store.is_ticket_resolved(attempt.ticket_num)

    @staticmethod
    def _successor_with_sealed_receipt(
        attempt: ExecutionAttempt, attempts: list[ExecutionAttempt]
    ) -> ExecutionAttempt | None:
        """Return a newer attempt for the same ticket that already has evidence."""
        later = sorted(
            (
                candidate
                for candidate in attempts
                if candidate.ticket_num == attempt.ticket_num
                and candidate.attempt > attempt.attempt
            ),
            key=lambda candidate: candidate.attempt,
        )
        for candidate in later:
            if candidate.state in {"abandoned", "superseded"}:
                continue
            if candidate.state == "succeeded":
                return candidate
            if candidate.failure_code.startswith("receipt-invalid"):
                continue
            if candidate.receipt_path and Path(candidate.receipt_path).is_file():
                return candidate
        return None

    def _resume_parked(self, attempt: ExecutionAttempt, claim_token: str) -> ExecutionAttempt:
        """Lift an in-flight ticket-edit park: tasks.md reads like the packet
        again, so the attempt continues with a fresh lease."""
        resumed = self.store.mark_execution_attempt_state(
            attempt.assignment_id,
            claim_token,
            "spawned" if attempt.agent_id else "leased",
            failure_code="",
        )
        # ``restart`` also moves the hard cap: an attempt that was parked for
        # long must be able to earn lease extensions again.
        self.store.renew_execution_attempt_lease(
            attempt.assignment_id, _utc_after(self.lease_seconds), restart=True
        )
        return resumed

    @staticmethod
    def _failure_detail(attempt: ExecutionAttempt, reason: str) -> str:
        """What is known about why an attempt ended without a receipt: the
        operator's account, and the last verification failure on record."""
        parts: list[str] = []
        reported = " ".join(reason.split())[:300]
        if reported:
            parts.append(f"reported: {reported}")
        failed = (
            " ".join(last_verification_failure(attempt.packet_path).split())
            if attempt.packet_path
            else ""
        )
        if failed:
            parts.append(f"last verification: {failed[:400]}")
        return "; ".join(parts)

    def _recover_action(self, attempt: ExecutionAttempt, failure_code: str) -> RecoverAction:
        """A recover action that says what is known: why, which agent, where
        the worktree is, and how much automatic budget the ticket has left."""
        code, _, text = failure_code.partition(": ")
        used, budget = self.store.attempts_used(attempt.ticket_num)
        detail = text.strip() or self._failure_detail(attempt, "")
        if code == "lease-expired":
            spent = used >= budget
            detail = (
                f"{detail + '; ' if detail else ''}attempt {used} of {budget}; "
                + (
                    "the automatic retry budget is spent, an operator decides"
                    if spent
                    else "retried automatically while budget remains"
                )
            )
        return RecoverAction(
            assignment_id=attempt.assignment_id,
            ticket_num=attempt.ticket_num,
            reason=code,
            detail=detail,
            agent_id=attempt.agent_id,
            worktree_path=attempt.worktree_path,
            attempt=attempt.attempt,
            attempts_used=used,
            attempts_max=budget,
            next=self._recover_next(attempt, code, used >= budget),
        )

    def _recover_next(
        self, attempt: ExecutionAttempt, code: str, at_cap: bool
    ) -> list[str]:
        cli = self._cli()
        ticket = display_ticket(attempt.ticket_num)
        steps: list[str] = []
        if attempt.agent_id:
            steps.append(f"stop the subagent {attempt.agent_id} if it is still running")
        if code == "receipt-invalid":
            steps.append(
                f're-seal from the assignment worktree (`receipt.py seal --packet '
                f'"{attempt.packet_path}"`) then call actions, or retire it with '
                f"`{cli} abandon {attempt.assignment_id}`"
            )
        elif code == "lease-expired" and at_cap:
            steps.append(f"`{cli} reopen {ticket}` to grant a fresh retry budget")
        elif code == "lease-expired":
            steps.append("call actions to retry it (nothing to decide while budget remains)")
        else:
            steps.append(
                f"investigate `{attempt.worktree_path}`; to retry, retire the attempt "
                f"with `{cli} abandon {attempt.assignment_id}` and call actions"
            )
            if at_cap:
                steps.append(
                    f"the ticket's retry budget is spent: `{cli} reopen {ticket}` "
                    "after retiring it lets the next actions claim it again"
                )
        return steps


__all__ = ["HARD_CAP_LEASES", "LeaseFlowMixin"]
