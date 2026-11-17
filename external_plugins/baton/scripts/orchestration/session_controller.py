"""Deterministic session-subagent scheduling and reconciliation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from orchestration.integrator import integrate_assignment
from orchestration.model import ROLE_BUILDER, TaskPacket
from orchestration.plan_store import (
    ExecutionAttemptError,
    PlanStore,
    TERMINAL_ATTEMPT_STATES,
)
from orchestration.receipt import ReceiptError, verify_sealed_receipt
from orchestration.relay import (
    HEARTBEAT_NAME,
    abandon_refusal,
    refusal_message,
    relay_facts,
    suggest_action,
)
from orchestration.result import ResultEnvelope
from orchestration.worktree import cleanup_feature_worktrees
from orchestration.session_model import (
    ActionBatch,
    BaseAction,
    BlockedAction,
    CompleteAction,
    DispatchAction,
    ExecutionAttempt,
    RecoverAction,
    ResolveMergeAction,
    WaitAction,
    finalize_task_packet,
)
from orchestration.worktree import (
    WorktreeError,
    prepare_assignment_worktree,
    prepare_integration_worktree,
)


class SessionControllerError(RuntimeError):
    """A session action cannot be produced from the durable state."""


class SessionController:
    """The sole deterministic control plane for native session subagents."""

    def __init__(
        self,
        project_path: str | Path,
        feature: str,
        *,
        verification_commands: list[str] | None = None,
        lease_seconds: int = 7200,
    ) -> None:
        self.project_path = Path(project_path).resolve()
        self.feature = feature
        self.store = PlanStore(self.project_path, feature)
        # No implicit fallback: an unconfigured run must fail loud instead of
        # silently verifying with ``git diff --check``. Commands passed here
        # are persisted on the first batch and reused by every later packet.
        self.verification_commands = list(verification_commands or [])
        self.lease_seconds = lease_seconds

    def actions(
        self,
        session_id: str,
        capacity: int = 1,
        base_branch: str = "main",
    ) -> ActionBatch:
        """Recover durable attempts, then claim and prepare remaining capacity."""
        if not session_id.strip():
            raise ValueError("session_id is required")
        if capacity < 1 or capacity > 5:
            raise ValueError("capacity must be between 1 and 5")
        self.store.ensure_initial_plan()
        # A lease that ran out is no longer owned: retire it before planning so
        # a stale attempt is never re-dispatched as if it were still running.
        self.store.expire_execution_attempts()
        verification_commands = self._run_verification_commands()

        try:
            integration = prepare_integration_worktree(
                self.project_path, self.feature, base_branch=base_branch
            )
            integration_sha = self._git(integration.path, "rev-parse", "HEAD")
        except WorktreeError as exc:
            return self._batch(
                "blocked",
                [BlockedAction(code="integration-worktree", reason=str(exc))],
            )

        produced: list[Any] = []
        # Pass 1: reconcile every valid sealed receipt, including receipts whose
        # attempt lease ran out (the evidence is re-verified, not trusted by age).
        for attempt in self.store.list_execution_attempts():
            if attempt.state in TERMINAL_ATTEMPT_STATES:
                continue
            token = self._token_from_packet(attempt.packet_path)
            if not token or attempt.failure_code.startswith("receipt-invalid"):
                continue
            if attempt.receipt_path and Path(attempt.receipt_path).is_file():
                action = self._reconcile_sealed(attempt, token)
                if action is not None:
                    produced.append(action)

        # Pass 2: resolve stale attempts, re-dispatch this session's claims and
        # surface only recoveries that still need an operator decision.
        attempts = self.store.list_execution_attempts()
        recover_actions: list[RecoverAction] = []
        retryable_recover_ids: set[str] = set()
        for attempt in attempts:
            if attempt.state in TERMINAL_ATTEMPT_STATES:
                continue
            token = self._token_from_packet(attempt.packet_path)
            if attempt.failure_code.startswith("receipt-invalid"):
                recover_actions.append(
                    RecoverAction(
                        assignment_id=attempt.assignment_id,
                        ticket_num=attempt.ticket_num,
                        reason=attempt.failure_code,
                    )
                )
                continue
            if attempt.receipt_path and Path(attempt.receipt_path).is_file() and token:
                continue
            if attempt.state == "unknown":
                successor = self._successor_with_sealed_receipt(attempt, attempts)
                if successor is not None:
                    self.store.supersede_execution_attempt(
                        attempt.assignment_id,
                        success_assignment_id=successor.assignment_id,
                        failure_code="superseded-by-successor-receipt",
                    )
                    continue
                reason = attempt.failure_code or "attempt outcome is unknown"
                recover_actions.append(
                    RecoverAction(
                        assignment_id=attempt.assignment_id,
                        ticket_num=attempt.ticket_num,
                        reason=reason,
                    )
                )
                if reason == "lease-expired":
                    # A dead lease is retryable: allow the claim below to
                    # replace this attempt instead of deadlocking the run.
                    retryable_recover_ids.add(attempt.assignment_id)
            elif attempt.state == "blocked-review":
                produced.append(self._merge_action(attempt, token))
            elif attempt.session_id == session_id and attempt.state == "leased" and token:
                produced.append(self._dispatch_from_attempt(attempt, token))

        blocking_recover = [
            action
            for action in recover_actions
            if action.assignment_id not in retryable_recover_ids
        ]
        if not any(
            isinstance(action, (ResolveMergeAction, BlockedAction))
            for action in produced
        ) and not blocking_recover:
            claimed = self.store.claim_ready_assignments(
                session_id=session_id,
                capacity=capacity,
                base_branch=base_branch,
                base_sha=integration_sha,
                lease_seconds=self.lease_seconds,
            )
            for attempt in claimed:
                try:
                    produced.append(
                        self._prepare_dispatch(
                            attempt,
                            integration.path,
                            integration.branch,
                            verification_commands,
                        )
                    )
                except Exception as exc:
                    self.store.mark_execution_attempt_state(
                        attempt.assignment_id,
                        attempt.claim_token,
                        "unknown",
                        failure_code=f"prepare-failed:{exc}",
                        release_lease=True,
                    )
                    produced.append(
                        RecoverAction(
                            assignment_id=attempt.assignment_id,
                            ticket_num=attempt.ticket_num,
                            reason=f"assignment preparation failed: {exc}",
                        )
                    )
            # A retry replaces the stale attempt for that ticket: retire the
            # old attempt now so it never emits ``recover`` again.
            claimed_by_ticket = {
                attempt.ticket_num: attempt.assignment_id for attempt in claimed
            }
            if claimed_by_ticket and recover_actions:
                remaining: list[RecoverAction] = []
                for action in recover_actions:
                    successor_id = claimed_by_ticket.get(action.ticket_num)
                    if successor_id is None:
                        remaining.append(action)
                        continue
                    try:
                        self.store.supersede_execution_attempt(
                            action.assignment_id,
                            success_assignment_id=successor_id,
                            failure_code="superseded-by-retry",
                        )
                    except ExecutionAttemptError:
                        # It became terminal between pass 2 and the claim; the
                        # successor still owns the ticket, so drop the recovery.
                        pass
                recover_actions = remaining
        produced.extend(recover_actions)

        if produced:
            state = "blocked" if any(
                isinstance(action, (RecoverAction, ResolveMergeAction, BlockedAction))
                for action in produced
            ) else "executing"
            return self._batch(state, produced)

        completion = self.store.latest_completion()
        if completion["complete"]:
            plan = self.store.current_plan()
            # A completed run's per-assignment worktrees (baton/<feature>-tic-*)
            # are stale — their work is already integrated into the integration
            # branch. Auto-remove them. The shared integration worktree stays so
            # the user can merge baton/<feature> to main, then `cleanup
            # --include-integration` removes it.
            cleanup = cleanup_feature_worktrees(self.project_path, self.feature)
            return self._batch(
                "complete",
                [
                    CompleteAction(
                        revision=int(completion["revision"]),
                        resolved_tickets=sorted(
                            ticket.num for ticket in plan.tickets if ticket.required
                        ),
                        worktrees_removed=cleanup["removed"],
                        worktrees_skipped=cleanup["skipped"],
                    )
                ],
            )

        active = [
            attempt.assignment_id
            for attempt in self.store.list_execution_attempts()
            if attempt.state in {
                "leased", "spawned", "running", "submitted", "verifying", "integrating"
            }
        ]
        return self._batch(
            "waiting",
            [
                WaitAction(
                    reason="no newly dispatchable ticket; required work remains",
                    active_assignments=active,
                )
            ],
        )

    def bind_agent(
        self, assignment_id: str, claim_token: str, agent_id: str
    ) -> ExecutionAttempt:
        return self.store.bind_attempt_agent(assignment_id, claim_token, agent_id)

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
            raise SessionControllerError(refusal_message(refusal))
        attempt = self.store.abandon_execution_attempt(assignment_id, reason=reason)
        return {
            "assignmentId": attempt.assignment_id,
            "ticketNum": attempt.ticket_num,
            "state": attempt.state,
            "failureCode": attempt.failure_code,
            "destroys": (
                "this attempt's lease and its eligibility for reconcile; any "
                "later receipt from it is ignored unless explicitly revived "
                "with `adopt`"
            ),
            "preserves": (
                "the assignment worktree, branch, commits, packet and receipt "
                "on disk"
            ),
            "next": "the ticket can be claimed again by the next `actions` call",
        }

    def adopt(self, assignment_id: str) -> dict[str, Any]:
        """Revive an abandoned attempt whose sealed receipt arrived late.

        The 2026-11-06 relay incident: an abandoned subagent finished and
        sealed a valid receipt after the abandon, and the protocol threw the
        evidence away — the ticket was rebuilt from scratch. ``adopt`` re-enters
        the receipt into the normal verify → integrate path instead. The
        receipt is fully re-verified (body digest, claim token, packet hash,
        identity) *before* any state changes, and a newer attempt for the same
        ticket with its own sealed evidence refuses the adopt: a human must
        choose between the two.
        """
        attempt = self.store.get_execution_attempt(assignment_id)
        if attempt.state != "abandoned":
            raise SessionControllerError(
                f"only abandoned attempts can be adopted; "
                f"{assignment_id} is {attempt.state}"
            )
        if not attempt.receipt_path or not Path(attempt.receipt_path).is_file():
            raise SessionControllerError(
                f"no sealed receipt for {assignment_id} at "
                f"{attempt.receipt_path or '<unset>'} — nothing to adopt; the "
                "abandon stands"
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
                f"{attempt.ticket_num} already has sealed evidence. Choose "
                "one: keep the successor (do nothing), or abandon the "
                "successor and adopt this one. Evidence: "
                + "; ".join(
                    f"{candidate.assignment_id} state={candidate.state} "
                    f"commit={candidate.commit_sha or '?'} receipt={candidate.receipt_path}"
                    for candidate in sealed
                )
                + f" — versus {assignment_id} receipt={attempt.receipt_path}"
            )
        in_flight = [
            candidate
            for candidate in successors
            if candidate.state
            in {"leased", "spawned", "running", "submitted", "verifying",
                "integrating", "blocked-review"}
        ]
        if in_flight:
            raise SessionControllerError(
                f"cannot adopt {assignment_id}: a newer attempt for ticket "
                f"{attempt.ticket_num} is still in flight ("
                + ", ".join(
                    f"{candidate.assignment_id} state={candidate.state}"
                    for candidate in in_flight
                )
                + "). Stop it first (abandon it, or wait for its terminal "
                "notice) so the ticket is not integrated twice."
            )
        token = self._token_from_packet(attempt.packet_path)
        if not token:
            raise SessionControllerError(
                f"cannot read the claim token from packet {attempt.packet_path}; "
                f"without it the receipt for {assignment_id} cannot be verified"
            )
        try:
            payload = json.loads(
                Path(attempt.receipt_path).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise SessionControllerError(
                f"cannot read sealed receipt for {assignment_id}: {exc}"
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
                f"stays abandoned: {exc}"
            ) from exc
        revived = self.store.adopt_execution_attempt(
            assignment_id, lease_seconds=self.lease_seconds
        )
        action = self._reconcile_sealed(revived, token)
        final = self.store.get_execution_attempt(assignment_id)
        return {
            "assignmentId": assignment_id,
            "ticketNum": attempt.ticket_num,
            "state": final.state,
            "adoptedFrom": "abandoned",
            "commitSha": final.commit_sha,
            "integrationSha": final.integration_sha,
            "followUp": (
                None
                if action is None
                else f"{action.kind} still required — handle it as `actions` "
                "would (see the baton skill)"
            ),
        }

    def status(self) -> dict[str, Any]:
        """Return a read snapshot — this creates no plan revision and no files.

        ``revision`` is 0 until the first ``actions`` call records a revision,
        so "never ran" is distinguishable from "ran and progressed". Each
        attempt carries a ``relay`` block — the mechanical alive/dead judgment
        (elapsed vs lease budget, receipt existence, worktree activity, and a
        suggested action) a handing-off or taking-over session should read
        before deciding to wait or to abandon.
        """
        snapshot = self.store.snapshot()
        attempts: list[dict[str, Any]] = []
        for row in snapshot["attempts"]:
            attempt = ExecutionAttempt.from_dict(row)
            facts = relay_facts(attempt)
            row["relay"] = {"suggestedAction": suggest_action(attempt, facts), **facts}
            attempts.append(row)
        return {
            "ok": True,
            "runId": f"RUN-{self.feature}",
            "feature": self.feature,
            "projectPath": str(self.project_path),
            "revision": snapshot["revision"],
            "complete": bool(snapshot["complete"]),
            "missingRequiredTickets": [
                f"{num // 100}.{num % 100}"
                for num in snapshot["missingRequiredTickets"]
            ],
            "attempts": attempts,
        }

    def reconcile(
        self,
        assignment_id: str,
        claim_token: str,
        *,
        agent_terminal: str,
        session_id: str,
        capacity: int = 1,
        base_branch: str = "main",
        final_text: str = "",
    ) -> ActionBatch:
        """Consume a terminal lifecycle event; free text is deliberately ignored."""
        del final_text
        if agent_terminal not in {"completed", "failed", "canceled"}:
            raise ValueError("agent_terminal must be completed, failed, or canceled")
        attempt = self.store.get_execution_attempt(assignment_id)
        if attempt.state in TERMINAL_ATTEMPT_STATES and attempt.state != "succeeded":
            # The attempt was retired (superseded by a retry, or abandoned); a
            # late terminal notice cannot change it, and must not wedge the run.
            return self.actions(session_id, capacity=capacity, base_branch=base_branch)
        if attempt.state != "succeeded":
            if not attempt.receipt_path or not Path(attempt.receipt_path).is_file():
                self.store.mark_execution_attempt_state(
                    assignment_id,
                    claim_token,
                    "unknown",
                    failure_code=f"agent-{agent_terminal}-without-sealed-receipt",
                    release_lease=True,
                )
            else:
                self._reconcile_sealed(attempt, claim_token)
        return self.actions(session_id, capacity=capacity, base_branch=base_branch)

    def _run_verification_commands(self) -> list[str]:
        """Resolve the run-wide commands, persist an explicit override, fail loud.

        ``--verify`` is persisted with the run on the first claim, so a later
        ``reconcile``/``actions`` call that omits the flag keeps using the same
        commands instead of falling back to some implicit default.
        """
        if self.verification_commands:
            commands = list(self.verification_commands)
            if self.store.run_verification_commands() != commands:
                self.store.set_run_verification_commands(commands)
            return commands
        stored = self.store.run_verification_commands()
        if stored:
            return stored
        if self.store.latest_completion()["complete"]:
            return []
        raise SessionControllerError(
            f"no verification commands configured for run {self.feature!r}; "
            'pass --verify "<command>" on actions (or reconcile) — it is persisted '
            "for every packet in the run"
        )

    def _successor_with_sealed_receipt(
        self, attempt: ExecutionAttempt, attempts: list[ExecutionAttempt]
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

    def _prepare_dispatch(
        self,
        attempt: ExecutionAttempt,
        integration_path: Path,
        integration_branch: str,
        verification_commands: list[str],
    ) -> DispatchAction:
        slot = prepare_assignment_worktree(
            self.project_path,
            self.feature,
            attempt.ticket_num,
            attempt.attempt,
        )
        plan = self.store.current_plan()
        ticket = next(t for t in plan.tickets if t.num == attempt.ticket_num)
        packet = finalize_task_packet(
            TaskPacket(
                task_id=f"{self.feature}:ticket-{ticket.num:03d}:build",
                role=ROLE_BUILDER,
                goal=ticket.what_to_build or ticket.title,
                acceptance_criteria=list(ticket.criteria),
                dependencies=[f"ticket-{num:03d}" for num in ticket.blocked_by],
                base_commit=attempt.base_sha,
                project_path=str(slot.path),
                verification_commands=list(verification_commands),
                output_contract=["sealed receipt"],
                plan_revision=attempt.plan_revision,
            )
        )
        run_dir = (
            self.project_path
            / ".dsh"
            / "baton"
            / "runs"
            / attempt.assignment_id
        )
        packet_path = run_dir / "packet.json"
        receipt_path = run_dir / "receipt.json"
        payload = {
            "assignmentId": attempt.assignment_id,
            "ticketNum": attempt.ticket_num,
            "attempt": attempt.attempt,
            "claimToken": attempt.claim_token,
            "worktreePath": str(slot.path),
            "worktreeBranch": slot.branch,
            "integrationPath": str(integration_path),
            "integrationBranch": integration_branch,
            "baseSha": attempt.base_sha,
            "verificationPath": str(run_dir / "verification.json"),
            "receiptPath": str(receipt_path),
            "taskPacket": packet.to_dict(),
        }
        self._write_immutable_json(packet_path, payload)
        configured = self.store.configure_execution_attempt(
            attempt.assignment_id,
            attempt.claim_token,
            task_packet_hash=packet.task_packet_hash,
            worktree_path=str(slot.path),
            worktree_branch=slot.branch,
            integration_path=str(integration_path),
            integration_branch=integration_branch,
            packet_path=str(packet_path),
            receipt_path=str(receipt_path),
        )
        return self._dispatch_from_attempt(configured, attempt.claim_token)

    def _dispatch_from_attempt(
        self, attempt: ExecutionAttempt, claim_token: str
    ) -> DispatchAction:
        if not attempt.packet_path:
            raise SessionControllerError(f"attempt has no packet: {attempt.assignment_id}")
        receipt_cli = Path(__file__).resolve().parents[1] / "receipt.py"
        heartbeat = Path(attempt.packet_path).parent / HEARTBEAT_NAME
        prompt = (
            f"Implement Baton assignment {attempt.assignment_id} only.\n"
            f"Work exclusively in `{attempt.worktree_path}` on branch "
            f"`{attempt.worktree_branch}`. Do not change ticket or controller state.\n"
            f"Refresh the heartbeat file `{heartbeat}` after each meaningful "
            f"milestone (overwrite or touch it; it lives outside the worktree, "
            "so never commit it).\n"
            f"For change context, read `openspec/changes/{self.feature}/proposal.md` "
            f"and `tasks.md` in the worktree.\n"
            f"Read immutable packet `{attempt.packet_path}`. Implement the ticket, then run:\n"
            f'`"{sys.executable}" "{receipt_cli}" verify '
            f'--packet "{attempt.packet_path}"`\n'
            "Commit all changes, then run the same command with `seal`. "
            "A sealed receipt is the only success evidence."
        )
        return DispatchAction(
            assignment_id=attempt.assignment_id,
            ticket_num=attempt.ticket_num,
            task_name=f"baton_ticket_{attempt.ticket_num:03d}",
            cwd=attempt.worktree_path,
            prompt=prompt,
            claim_token=claim_token,
            packet_path=attempt.packet_path,
            task_packet_hash=attempt.task_packet_hash,
        )

    def _reconcile_sealed(
        self, attempt: ExecutionAttempt, claim_token: str
    ) -> BaseAction | None:
        receipt_path = Path(attempt.receipt_path)
        try:
            payload = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SessionControllerError(f"cannot read sealed receipt: {exc}") from exc
        try:
            envelope = verify_sealed_receipt(
                payload,
                claim_token=claim_token,
                task_packet_hash=attempt.task_packet_hash,
            )
            self._check_receipt_identity(attempt, envelope)
        except ReceiptError as exc:
            self._reject_receipt(attempt, claim_token, str(exc))
            raise SessionControllerError(
                f"sealed receipt rejected for {attempt.assignment_id}: {exc}"
            ) from exc
        try:
            result = integrate_assignment(
                attempt.integration_path,
                attempt.worktree_branch,
                expected_sha=envelope.commit_sha,
            )
        except WorktreeError as exc:
            return self._integration_failed(attempt, claim_token, str(exc))

        if result["ok"]:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id, claim_token, "integrating"
            )
            self.store.finalize_execution_attempt(
                attempt.assignment_id,
                claim_token,
                envelope,
                str(result["integration_sha"]),
            )
            return None

        reason = result.get("reason")
        if reason == "conflict":
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "blocked-review",
                failure_code="merge-conflict",
            )
            return self._merge_action(attempt, claim_token, result.get("conflicts", []))
        if reason == "branch-moved":
            return self._branch_moved_action(attempt, claim_token, result)
        if reason == "merge-in-progress":
            # The shared worktree is mid-merge for a *different* assignment.
            # Leave this attempt untouched: it is retried on the next call,
            # once that conflict is resolved, and must not be reported as
            # conflicted itself.
            return None
        if reason == "worktree-dirty":
            return BlockedAction(
                code="integration-worktree-dirty",
                ticket_num=attempt.ticket_num,
                reason=self._dirty_worktree_reason(attempt, result.get("conflicts", [])),
            )
        raise SessionControllerError(
            f"integration returned an unknown outcome {reason!r} for "
            f"{attempt.assignment_id}"
        )

    def _integration_failed(
        self, attempt: ExecutionAttempt, claim_token: str, detail: str
    ) -> BlockedAction:
        """Surface a hard integration failure without wedging the attempt.

        The attempt moves to ``blocked-review`` (still active, so no retry
        churn) instead of being left in ``integrating`` until its lease runs
        out two hours later.
        """
        failure_code = f"integration-failed: {detail}"
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "blocked-review",
                failure_code=failure_code,
            )
        except ExecutionAttemptError:
            pass
        return BlockedAction(
            code="integration-failed",
            ticket_num=attempt.ticket_num,
            reason=(
                f"cannot merge {attempt.worktree_branch} into "
                f"{attempt.integration_path}: {detail}. Nothing was merged. Fix the "
                f"integration worktree, or retire the attempt with "
                f"`abandon {attempt.assignment_id}`."
            ),
        )

    def _branch_moved_action(
        self,
        attempt: ExecutionAttempt,
        claim_token: str,
        result: dict[str, Any],
    ) -> BlockedAction:
        """Refuse to integrate a branch that advanced past the verified commit.

        The sealed receipt verified ``expected_sha``; commits added to the
        branch after the seal never ran the verification commands, so merging
        the branch would integrate unverified work. Nothing was merged.
        """
        tip = str(result.get("branch_tip", "")) or "<unreadable>"
        expected = str(result.get("expected_sha", "")) or "<unknown>"
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "blocked-review",
                failure_code="branch-moved-after-seal",
            )
        except ExecutionAttemptError:
            pass
        return BlockedAction(
            code="branch-moved-after-seal",
            ticket_num=attempt.ticket_num,
            reason=(
                f"branch {attempt.worktree_branch} tip is {tip} but the sealed "
                f"receipt for {attempt.assignment_id} verified {expected}; "
                "commits after the seal were never verified. Nothing was "
                "merged. Re-seal from the new tip (receipt.py seal re-runs the "
                "verification commands there) and call actions again, or "
                f"retire the attempt with `abandon {attempt.assignment_id}` "
                "(the ticket is re-claimed fresh)."
            ),
        )

    @staticmethod
    def _dirty_worktree_reason(
        attempt: ExecutionAttempt, dirty: list[str]
    ) -> str:
        listing = ", ".join(dirty[:5]) or "unknown files"
        return (
            f"integration worktree {attempt.integration_path} has uncommitted "
            f"changes ({listing}) and nothing was merged. Commit or discard them "
            f"(or `git -C <path> merge --abort` if a merge is half done), then "
            f"call actions again; to retire this attempt instead, "
            f"`abandon {attempt.assignment_id}`."
        )

    @staticmethod
    def _check_receipt_identity(
        attempt: ExecutionAttempt, envelope: ResultEnvelope
    ) -> None:
        """Bind the sealed receipt to this exact attempt *before* integrating.

        ``finalize_execution_attempt`` repeats these checks as a last line of
        defence, but by then the branch has already been merged — a receipt for
        another ticket must be rejected while the attempt is still recoverable.
        """
        expected = {
            "status": "succeeded",
            "assignment_id": attempt.assignment_id,
            "ticket_num": attempt.ticket_num,
            "plan_revision": attempt.plan_revision,
            "attempt": attempt.attempt,
            "task_packet_hash": attempt.task_packet_hash,
        }
        for field, value in expected.items():
            actual = getattr(envelope, field)
            if actual != value:
                raise ReceiptError(
                    f"receipt {field} mismatch for {attempt.assignment_id}: "
                    f"receipt={actual!r}, expected={value!r}"
                )

    def _reject_receipt(
        self, attempt: ExecutionAttempt, claim_token: str, reason: str
    ) -> None:
        """Leave a bad receipt's attempt recoverable (no merge, lease freed)."""
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "unknown",
                failure_code=f"receipt-invalid: {reason}",
                release_lease=True,
            )
        except ExecutionAttemptError:
            # The attempt already reached a terminal state; the caller still
            # surfaces the rejection loudly.
            pass

    def _merge_action(
        self,
        attempt: ExecutionAttempt,
        claim_token: str,
        conflicts: list[str] | None = None,
    ) -> ResolveMergeAction:
        return ResolveMergeAction(
            assignment_id=attempt.assignment_id,
            ticket_num=attempt.ticket_num,
            cwd=attempt.integration_path,
            claim_token=claim_token,
            prompt=(
                f"Resolve the preserved merge conflict for {attempt.assignment_id} in "
                f"`{attempt.integration_path}`. Conflicts: {conflicts or 'inspect git status'}. "
                "Do not abort or discard the merge. Resolve, run the packet verification "
                "commands, and commit the merge; then the main session will reconcile again."
            ),
        )

    def _token_from_packet(self, packet_path: str) -> str:
        if not packet_path or not Path(packet_path).is_file():
            return ""
        try:
            payload = json.loads(Path(packet_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        return str(payload.get("claimToken", ""))

    def _batch(self, state: str, actions: list[Any]) -> ActionBatch:
        return ActionBatch(
            run_id=f"RUN-{self.feature}",
            generation=len(self.store.events()),
            state=state,
            actions=actions,
        )

    @staticmethod
    def _git(path: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            raise WorktreeError(result.stderr.strip() or "git command failed")
        return result.stdout.strip()

    @staticmethod
    def _write_immutable_json(path: Path, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if path.exists():
            if path.read_text(encoding="utf-8") != text:
                raise SessionControllerError(f"immutable packet changed: {path}")
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)


__all__ = ["SessionController", "SessionControllerError"]
