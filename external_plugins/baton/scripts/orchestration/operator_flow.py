"""Operator verbs over retired and finished tickets: abandon, adopt, reopen.

Mixed into :class:`orchestration.session_controller.SessionController`, which
provides ``store``, ``lease_seconds``, ``_token_from_packet``,
``_check_receipt_identity``, ``_reconcile_sealed`` and ``_stored_commands``.
This module never imports the controller, so the dependency stays one-way.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from _ticket import task_num
from orchestration.receipt import ReceiptError, verify_sealed_receipt
from orchestration.relay import abandon_refusal, relay_facts
from orchestration.session_model import SessionControllerError, display_ticket


class OperatorFlowMixin:
    """The escape hatches and their reverses."""

    def abandon(
        self,
        assignment_id: str,
        *,
        reason: str = "operator-abandoned",
        force: bool = False,
    ) -> dict[str, Any]:
        """Retire a stuck attempt and tell the operator exactly what that costs.

        Guarded: abandoning an attempt that is plausibly still working (active
        state, no failure evidence, no sealed receipt, most of its lease left)
        is refused with the judgment data — ``force=True`` bypasses the guard
        for an operator who has looked at it.
        """
        attempt = self.store.get_execution_attempt(assignment_id)
        refusal = None if force else abandon_refusal(attempt, relay_facts(attempt))
        if refusal is not None:
            raise SessionControllerError(
                f"abandon refused — {refusal['reason']}. {refusal['advice']}",
                code="abandon-refused",
                refusal=refusal,
            )
        attempt = self.store.abandon_execution_attempt(assignment_id, reason=reason)
        ticket = display_ticket(attempt.ticket_num)
        used, budget = self.store.attempts_used(attempt.ticket_num)
        claimable = used < budget
        return {
            "assignment_id": attempt.assignment_id,
            "ticket_num": attempt.ticket_num,
            "ticket_id": ticket,
            "state": attempt.state,
            "failure_code": attempt.failure_code,
            "agent_id": attempt.agent_id,
            "attempts_used": used,
            "attempts_max": budget,
            "destroys": (
                "this attempt's lease and its eligibility for reconcile; any "
                "later receipt from it is ignored unless explicitly revived "
                "with `adopt`"
            ),
            "preserves": (
                "the assignment worktree, branch, commits, packet and receipt "
                "on disk"
            ),
            "next": (
                "the ticket can be claimed again by the next `actions` call"
                if claimable
                else f"the ticket's retry budget is spent ({used} of {budget}): "
                f"`reopen {ticket}` lets the next `actions` claim it again"
            ),
        }

    def adopt(self, assignment_id: str) -> dict[str, Any]:
        """Revive a retired attempt whose sealed receipt arrived late.

        The 2026-11-06 relay incident: an abandoned subagent finished and
        sealed a valid receipt after the abandon, and the protocol threw the
        evidence away — the ticket was rebuilt from scratch. The same loss
        happened on the automatic path: a lease-expired attempt superseded by
        its retry. ``adopt`` re-enters either receipt into the normal verify →
        integrate path instead. The receipt is fully re-verified (body digest,
        claim token, packet hash, identity) *before* any state changes, and a
        newer attempt for the same ticket with its own sealed evidence refuses
        the adopt: a human must choose between the two.
        """
        attempt = self.store.get_execution_attempt(assignment_id)
        if attempt.state not in {"abandoned", "superseded"}:
            raise SessionControllerError(
                "only abandoned or superseded attempts can be adopted; "
                f"{assignment_id} is {attempt.state}",
                code="invalid-state",
            )
        if not attempt.receipt_path or not Path(attempt.receipt_path).is_file():
            raise SessionControllerError(
                f"no sealed receipt for {assignment_id} at "
                f"{attempt.receipt_path or '<unset>'} — nothing to adopt; the "
                "retire stands",
                code="no-receipt",
            )
        successors = sorted(
            (
                candidate
                for candidate in self.store.list_execution_attempts()
                if candidate.ticket_num == attempt.ticket_num
                and candidate.attempt > attempt.attempt
            ),
            key=lambda candidate: candidate.attempt,
        )
        sealed = [
            candidate
            for candidate in successors
            if candidate.state == "succeeded"
            or (
                candidate.receipt_path
                and Path(candidate.receipt_path).is_file()
                and not candidate.failure_code.startswith("receipt-invalid")
            )
        ]
        if sealed:
            raise SessionControllerError(
                f"cannot adopt {assignment_id}: a newer attempt for ticket "
                f"{display_ticket(attempt.ticket_num)} already has sealed "
                "evidence. Choose one: keep the successor (do nothing), or "
                "abandon the successor and adopt this one. Evidence: "
                + "; ".join(
                    f"{candidate.assignment_id} state={candidate.state} "
                    f"commit={candidate.commit_sha or '?'} receipt={candidate.receipt_path}"
                    for candidate in sealed
                )
                + f" — versus {assignment_id} receipt={attempt.receipt_path}",
                code="adopt-conflict",
            )
        in_flight = [
            candidate
            for candidate in successors
            if candidate.state
            in {"leased", "spawned", "integrating", "blocked-review"}
        ]
        if in_flight:
            raise SessionControllerError(
                f"cannot adopt {assignment_id}: a newer attempt for ticket "
                f"{display_ticket(attempt.ticket_num)} is still in flight ("
                + ", ".join(
                    f"{candidate.assignment_id} state={candidate.state}"
                    for candidate in in_flight
                )
                + "). Stop it first (abandon it, or wait for its terminal "
                "notice) so the ticket is not integrated twice.",
                code="successor-in-flight",
            )
        token = self._token_from_packet(attempt.packet_path)
        if not token:
            raise SessionControllerError(
                f"cannot read the claim token from packet {attempt.packet_path}; "
                f"without it the receipt for {assignment_id} cannot be verified",
                code="no-claim-token",
            )
        try:
            payload = json.loads(
                Path(attempt.receipt_path).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise SessionControllerError(
                f"cannot read sealed receipt for {assignment_id}: {exc}",
                code="receipt-invalid",
            ) from exc
        try:
            envelope = verify_sealed_receipt(
                payload,
                claim_token=token,
                task_packet_hash=attempt.task_packet_hash,
            )
            self._check_receipt_identity(attempt, envelope)
        except ReceiptError as exc:
            raise SessionControllerError(
                f"sealed receipt rejected for {assignment_id}, the attempt "
                f"stays {attempt.state}: {exc}",
                code="receipt-invalid",
            ) from exc
        revived = self.store.adopt_execution_attempt(
            assignment_id, lease_seconds=self.lease_seconds
        )
        commands = self._stored_commands()
        # The revived receipt is one more passenger on the integration branch:
        # it does not merge onto a red base either.
        if self._integration_base_check(
            revived.integration_path, revived.integration_branch, commands,
            owner_parked=False,
        ) is not None:
            final = self.store.get_execution_attempt(assignment_id)
            return {
                "assignment_id": assignment_id,
                "ticket_num": attempt.ticket_num,
                "ticket_id": display_ticket(attempt.ticket_num),
                "state": final.state,
                "adopted_from": attempt.state,
                "commit_sha": final.commit_sha,
                "integration_sha": final.integration_sha,
                "follow_up": (
                    "the receipt is verified and waits: the integration branch is red "
                    "until its parked merge is repaired; call actions after the repair"
                ),
            }
        warnings: list[dict[str, Any]] = []
        action = self._reconcile_sealed(
            revived, token, self.store.current_plan(), self._stored_commands(), warnings
        )
        final = self.store.get_execution_attempt(assignment_id)
        follow_up = None
        if action is not None:
            follow_up = f"{action.kind} still required — handle it as `actions` would (see the baton skill)"
        elif warnings:
            follow_up = "; ".join(str(item.get("message", "")) for item in warnings)
        return {
            "assignment_id": assignment_id,
            "ticket_num": attempt.ticket_num,
            "ticket_id": display_ticket(attempt.ticket_num),
            "state": final.state,
            "adopted_from": attempt.state,
            "commit_sha": final.commit_sha,
            "integration_sha": final.integration_sha,
            "follow_up": follow_up,
        }

    def reopen(self, ticket_id: str) -> dict[str, Any]:
        """Re-open a finished ticket: void its receipts so it is claimed again.

        The explicit way to re-run work baton already recorded as delivered —
        a succeeded receipt otherwise resolves a ticket for good, whatever the
        checkbox says. It is also the operator's override when a ticket spent
        its automatic retry budget: the budget restarts here.
        """
        ticket_num = self._ticket_num(ticket_id)
        plan = self.store.current_plan()
        if not any(ticket.num == ticket_num for ticket in plan.tickets):
            raise SessionControllerError(
                f"cannot reopen {display_ticket(ticket_num)}: no such task in tasks.md",
                code="unknown-ticket",
            )
        return self.store.reopen_ticket(ticket_num)

    @staticmethod
    def _ticket_num(ticket_id: str) -> int:
        parts = str(ticket_id).split(".")
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            raise SessionControllerError(
                f"ticket id must look like N.M (e.g. 2.1), got {ticket_id!r}",
                code="invalid-ticket-id",
            )
        try:
            return task_num(int(parts[0]), int(parts[1]))
        except ValueError as exc:
            raise SessionControllerError(str(exc), code="invalid-ticket-id") from exc


__all__ = ["OperatorFlowMixin"]
