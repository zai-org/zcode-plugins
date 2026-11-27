"""Deterministic session-subagent scheduling and reconciliation.

:class:`SessionController` is assembled from focused mixins — receipts
(``receipt_flow``), leases and recovery (``lease_flow``), dispatch
(``dispatch_flow``), operator verbs (``operator_flow``), run settings
(``run_settings``) — this module keeps the scheduling loop itself: ``actions``
and ``reconcile``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from orchestration.dispatch_flow import DispatchFlowMixin
from orchestration.git_run import run_git
from orchestration.lease_flow import LeaseFlowMixin
from orchestration.operator_flow import OperatorFlowMixin
from orchestration.plan_model import PlanRevision
from orchestration.plan_store import ExecutionAttemptError, PlanStore
from orchestration.receipt_flow import (
    POST_MERGE_FAILURE,
    REDEFINED_IN_FLIGHT,
    REMOVED_IN_FLIGHT,
    ReceiptFlowMixin,
)
from orchestration.relay import relay_facts, suggest_action
from orchestration.run_settings import RunSettingsMixin, _sync_warnings
from orchestration.session_model import (
    ActionBatch,
    BaseAction,
    BlockedAction,
    CompleteAction,
    ExecutionAttempt,
    RecoverAction,
    RepairIntegrationAction,
    ResolveMergeAction,
    SessionControllerError,
    WaitAction,
    display_ticket,
)
from orchestration.store_base import (
    BASE_BRANCH_SETTING,
    CAPACITY_SETTING,
    LEASED_ATTEMPT_STATES,
    TERMINAL_ATTEMPT_STATES,
)
from orchestration.worktree import (
    WorktreeError,
    cleanup_feature_worktrees,
    integration_branch,
    prepare_integration_worktree,
    sync_integration_base,
)


class SessionController(
    ReceiptFlowMixin,
    LeaseFlowMixin,
    DispatchFlowMixin,
    OperatorFlowMixin,
    RunSettingsMixin,
):
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
        capacity: int | None = None,
        base_branch: str | None = None,
    ) -> ActionBatch:
        """Recover durable attempts, then claim and prepare remaining capacity."""
        if not session_id.strip():
            raise ValueError("session_id is required")
        settings = self._run_settings(capacity, base_branch)
        capacity = settings[CAPACITY_SETTING]
        base_branch = settings[BASE_BRANCH_SETTING]
        self.store.ensure_initial_plan()
        self._refresh_leases()
        self.store.expire_execution_attempts()
        verification_commands = self._verification_commands(settings)
        warnings: list[dict[str, Any]] = []

        try:
            integration = prepare_integration_worktree(
                self.project_path, self.feature, base_branch=base_branch
            )
            sync = sync_integration_base(integration.path, base_branch)
            red_base = any(
                attempt.state == "blocked-review"
                and attempt.failure_code == POST_MERGE_FAILURE
                for attempt in self.store.list_execution_attempts()
            )
            # Run after the sync so a re-aligned HEAD is the one being judged.
            base_block = self._integration_base_check(
                integration.path,
                integration.branch,
                verification_commands,
                owner_parked=red_base,
            )
            if base_block is not None:
                # A red HEAD with no parked owner blocks receipts exactly like
                # one with an owner: nothing merges onto it until it passes.
                red_base = True
        except WorktreeError as exc:
            return self._batch(
                "blocked",
                [BlockedAction(code="integration-worktree", reason=str(exc))],
                warnings,
            )
        warnings.extend(_sync_warnings(sync, integration.branch))
        plan = self.store.current_plan()

        produced: list[BaseAction] = []
        lost_owner = False
        # Pass 1: reconcile every valid sealed receipt, including receipts whose
        # attempt lease ran out (the evidence is re-verified, not trusted by age).
        for attempt in self.store.list_execution_attempts():
            if attempt.state in TERMINAL_ATTEMPT_STATES:
                continue
            if not attempt.receipt_path or not Path(attempt.receipt_path).is_file():
                continue
            token = self._token_from_packet(attempt.packet_path)
            if not token or attempt.failure_code.startswith("receipt-invalid"):
                continue
            repairing = attempt.failure_code == POST_MERGE_FAILURE
            if red_base and not repairing:
                warnings.append(
                    {
                        "code": "receipt-waiting-for-repair",
                        "assignment_id": attempt.assignment_id,
                        "message": (
                            f"{attempt.assignment_id}: its sealed receipt waits until "
                            "the red merge on the integration branch is repaired"
                        ),
                    }
                )
                continue
            action = self._reconcile_sealed(
                attempt, token, plan, verification_commands, warnings
            )
            if action is not None:
                produced.append(action)
            # Nothing may merge onto a red base: a repair that landed clears
            # the way, a merge that just turned red closes it for this pass. A
            # parked owner whose receipt was rejected keeps the base red.
            if repairing and action is None:
                landed = self.store.get_execution_attempt(attempt.assignment_id)
                red_base = landed.state != "succeeded"
                lost_owner = red_base  # its receipt was rejected: nobody repairs now
            elif isinstance(action, RepairIntegrationAction):
                red_base = True
        if lost_owner and base_block is None:
            base_block = self._integration_base_check(
                integration.path,
                integration.branch,
                verification_commands,
                owner_parked=False,
            )

        # Pass 2: resolve stale attempts, re-dispatch claims that were never
        # bound to an agent, and surface the recoveries that still need a
        # decision.
        attempts = self.store.list_execution_attempts()
        recover_actions: list[RecoverAction] = []
        retryable: set[str] = set()
        for attempt in attempts:
            if attempt.state in TERMINAL_ATTEMPT_STATES:
                continue
            token = self._token_from_packet(attempt.packet_path)
            if attempt.failure_code.startswith("receipt-invalid"):
                recover_actions.append(self._recover_action(attempt, attempt.failure_code))
                continue
            if attempt.receipt_path and Path(attempt.receipt_path).is_file() and token:
                continue  # the receipt pass owns it: handled, or waiting on a merge
            if attempt.state == "unknown":
                if self._ticket_delivered(attempt, attempts):
                    self.store.supersede_execution_attempt(
                        attempt.assignment_id, failure_code="superseded-by-receipt"
                    )
                    continue
                reason = attempt.failure_code or "attempt outcome is unknown"
                recover_actions.append(self._recover_action(attempt, reason))
                if reason == "lease-expired" and not self._at_retry_cap(attempt.ticket_num):
                    # A dead lease is retryable: let the claim below replace this
                    # attempt instead of deadlocking the run.
                    retryable.add(attempt.assignment_id)
            elif attempt.state == "blocked-review":
                if (
                    attempt.failure_code in {REDEFINED_IN_FLIGHT, REMOVED_IN_FLIGHT}
                    and token
                    and self._definition_change(attempt, plan) is None
                ):
                    attempt = self._resume_parked(attempt, token)
                else:
                    produced.append(self._blocked_review_action(attempt, token))
                    continue
            if attempt.state in LEASED_ATTEMPT_STATES:
                change = self._definition_change(attempt, plan)
                if change is not None:
                    produced.append(
                        self._park_redefined(attempt, token, change, sealed=False)
                    )
                    continue
                if attempt.state == "leased" and not attempt.agent_id and token:
                    produced.append(
                        self._dispatch_from_attempt(
                            attempt, token, self._title(attempt, plan)
                        )
                    )

        if base_block is not None:
            produced.append(base_block)
        can_claim = (
            base_block is None
            and all(action.assignment_id in retryable for action in recover_actions)
            and not any(
                isinstance(
                    action, (ResolveMergeAction, RepairIntegrationAction, BlockedAction)
                )
                for action in produced
            )
        )
        if can_claim:
            # Read after the receipt pass: a ticket claimed now starts from the
            # tip the receipts just produced, and its packet must say so.
            integration_sha = self._git(integration.path, "rev-parse", "HEAD")
            claimed = self.store.claim_ready_assignments(
                session_id=session_id,
                capacity=capacity,
                base_branch=base_branch,
                base_sha=integration_sha,
                lease_seconds=self.lease_seconds,
                # The lease sweep at the top of this call already ran: judging
                # it again here could retire an attempt pass 2 just re-issued.
                expire_first=False,
            )
            for attempt in claimed:
                try:
                    produced.append(
                        self._prepare_dispatch(
                            attempt,
                            integration.path,
                            integration.branch,
                            verification_commands,
                            plan,
                        )
                    )
                except Exception as exc:
                    reason = f"prepare-failed: {type(exc).__name__}: {exc}"
                    self.store.mark_execution_attempt_state(
                        attempt.assignment_id,
                        attempt.claim_token,
                        "unknown",
                        failure_code=reason,
                    )
                    produced.append(
                        self._recover_action(
                            self.store.get_execution_attempt(attempt.assignment_id), reason
                        )
                    )
            # A retry replaces the stale attempt for that ticket: retire the
            # old one now and say so — its subagent may still be running.
            successors = {attempt.ticket_num: attempt for attempt in claimed}
            if successors:
                recover_actions = self._retire_retried(recover_actions, successors, warnings)
        produced.extend(recover_actions)
        # A ticket the budget lockout keeps out of the claim loop must stay
        # visible, or it silently vanishes from every batch.
        produced.extend(self._exhausted_tickets())

        if produced:
            state = (
                "blocked"
                if any(
                    isinstance(
                        action,
                        (
                            RecoverAction,
                            ResolveMergeAction,
                            RepairIntegrationAction,
                            BlockedAction,
                        ),
                    )
                    for action in produced
                )
                else "executing"
            )
            return self._batch(state, produced, warnings)

        completion = self.store.latest_completion()
        if completion["complete"]:
            # A completed run's per-assignment worktrees and merged branches
            # (baton/<feature>-tic-*) are stale — their work is already in the
            # integration branch. Auto-remove them; the shared integration
            # worktree stays so the user can merge baton/<feature> to main,
            # then `cleanup --include-integration` removes it.
            in_flight = {
                attempt.worktree_branch
                for attempt in self.store.list_execution_attempts()
                if attempt.state in LEASED_ATTEMPT_STATES and attempt.worktree_branch
            }
            try:
                cleanup = cleanup_feature_worktrees(
                    self.project_path, self.feature, base_branch=base_branch,
                    keep=in_flight,
                )
            except WorktreeError as exc:
                cleanup = _empty_cleanup()
                warnings.append(
                    {"code": "cleanup-failed", "message": f"complete, but cleanup failed: {exc}"}
                )
            return self._batch(
                "complete",
                [
                    CompleteAction(
                        revision=int(completion["revision"]),
                        resolved_tickets=sorted(ticket.num for ticket in plan.tickets),
                        worktrees_removed=cleanup["removed"],
                        worktrees_skipped=cleanup["skipped"],
                        branches_deleted=cleanup["branches_deleted"],
                        branches_kept=cleanup["branches_kept"],
                        write_back=self._write_back_state(base_branch),
                    )
                ],
                warnings,
            )

        active = [
            attempt.assignment_id
            for attempt in self.store.list_execution_attempts()
            if attempt.state in LEASED_ATTEMPT_STATES
        ]
        return self._batch(
            "waiting",
            [
                WaitAction(
                    reason="no newly dispatchable ticket; required work remains",
                    active_assignments=active,
                )
            ],
            warnings,
        )

    def reconcile(
        self,
        assignment_id: str,
        claim_token: str,
        *,
        agent_terminal: str,
        session_id: str,
        capacity: int | None = None,
        base_branch: str | None = None,
        reason: str = "",
    ) -> ActionBatch:
        """Consume a terminal lifecycle event; a success claim in free text
        is ignored.

        ``reason`` is the operator's one-line account of *why* a subagent
        ended without a receipt. It is recorded for diagnosis only — it never
        decides success — so the recover action can say what went wrong
        instead of a bare "unknown".
        """
        if agent_terminal not in {"completed", "failed", "canceled"}:
            raise ValueError("agent_terminal must be completed, failed, or canceled")
        attempt = self.store.get_execution_attempt(assignment_id)
        if attempt.state in TERMINAL_ATTEMPT_STATES and attempt.state != "succeeded":
            # The attempt was retired (superseded by a retry, or abandoned); a
            # late terminal notice cannot change it, and must not wedge the run.
            return self.actions(session_id, capacity=capacity, base_branch=base_branch)
        if attempt.state != "succeeded" and not (
            attempt.receipt_path and Path(attempt.receipt_path).is_file()
        ):
            detail = self._failure_detail(attempt, reason)
            self.store.mark_execution_attempt_state(
                assignment_id,
                claim_token,
                "unknown",
                failure_code=f"agent-{agent_terminal}-without-sealed-receipt"
                + (f": {detail}" if detail else ""),
            )
        # A sealed receipt is integrated by the receipt pass inside actions(),
        # under the same gates as every other receipt: the red-base hold, the
        # ticket-redefinition guard and the resolved run settings all apply.
        return self.actions(session_id, capacity=capacity, base_branch=base_branch)

    def bind_agent(
        self, assignment_id: str, claim_token: str, agent_id: str
    ) -> ExecutionAttempt:
        return self.store.bind_attempt_agent(assignment_id, claim_token, agent_id)

    def status(self) -> dict[str, Any]:
        """Return a read snapshot — this creates no plan revision and no files.

        ``revision`` is 0 until the first ``actions`` call records a revision,
        so "never ran" is distinguishable from "ran and progressed". Each
        attempt carries a ``relay`` block — the mechanical alive/dead judgment
        (elapsed vs lease budget, receipt existence, worktree activity, and a
        suggested action) a handing-off or taking-over session should read
        before deciding to wait or to abandon. ``resolved_but_unchecked``
        names tickets whose checkbox says ``[ ]`` although a receipt already
        delivered them: baton will not re-run those without ``reopen``.
        """
        snapshot = self.store.snapshot()
        attempts: list[dict[str, Any]] = []
        for row in snapshot["attempts"]:
            attempt = ExecutionAttempt.from_dict(row)
            facts = relay_facts(attempt)
            row["relay"] = {"suggested_action": suggest_action(attempt, facts), **facts}
            attempts.append(row)
        return {
            "run_id": f"RUN-{self.feature}",
            "feature": self.feature,
            "project_path": str(self.project_path),
            "revision": snapshot["revision"],
            "complete": bool(snapshot["complete"]),
            "missing_required_tickets": [
                display_ticket(num) for num in snapshot["missing_required_tickets"]
            ],
            "resolved_but_unchecked": [
                display_ticket(num) for num in snapshot["resolved_but_unchecked"]
            ],
            "attempts": attempts,
        }

    # --- claims that replace a stale attempt ---------------------------------

    def _retire_retried(
        self,
        recover_actions: list[RecoverAction],
        successors: dict[int, ExecutionAttempt],
        warnings: list[dict[str, Any]],
    ) -> list[RecoverAction]:
        """Retire every retried attempt and announce the retry.

        The announcement carries the stale attempt's agent id: its subagent may
        still be running, and only the session can stop it.
        """
        remaining: list[RecoverAction] = []
        for action in recover_actions:
            successor = successors.get(action.ticket_num)
            if successor is None:
                remaining.append(action)
                continue
            stale = self.store.get_execution_attempt(action.assignment_id)
            try:
                self.store.supersede_execution_attempt(
                    action.assignment_id,
                    success_assignment_id=successor.assignment_id,
                )
            except ExecutionAttemptError:
                # It became terminal between pass 2 and the claim; the
                # successor still owns the ticket, so drop the recovery.
                pass
            used, budget = self.store.attempts_used(action.ticket_num)
            ticket = display_ticket(stale.ticket_num)
            warnings.append(
                {
                    "code": "lease-expired-retried",
                    "assignment_id": stale.assignment_id,
                    "agent_id": stale.agent_id,
                    "successor_assignment_id": successor.assignment_id,
                    "ticket_id": ticket,
                    "attempts_used": used,
                    "attempts_max": budget,
                    "message": (
                        f"{stale.assignment_id} (ticket {ticket}) ran out of its "
                        f"lease and is retried as {successor.assignment_id} "
                        f"(attempt {used} of {budget})"
                        + (
                            f"; stop the old agent {stale.agent_id} if it is "
                            "still running"
                            if stale.agent_id
                            else ""
                        )
                    ),
                }
            )
        return remaining

    # --- small helpers ---------------------------------------------------------

    @staticmethod
    def _title(attempt: ExecutionAttempt, plan: PlanRevision) -> str:
        ticket = next(
            (item for item in plan.tickets if item.num == attempt.ticket_num), None
        )
        return ticket.title if ticket else ""

    def _write_back_state(self, base_branch: str) -> dict[str, Any]:
        """The ``[x]`` write-back is an uncommitted edit in the main working
        tree; the integration branch does not carry it, so it must be
        committed along with the merge."""
        tasks = self.store.tasks_path
        status = run_git(
            ["status", "--porcelain", "--", str(tasks)],
            cwd=self.project_path,
            error=WorktreeError,
            check=False,
        )
        uncommitted = bool(status.stdout.strip()) if status.returncode == 0 else True
        branch = integration_branch(self.feature)
        return {
            "path": str(tasks),
            "uncommitted": uncommitted,
            "next": (
                f"commit it together with merging {branch} into {base_branch}"
                if uncommitted
                else "already committed"
            ),
        }

    def _token_from_packet(self, packet_path: str) -> str:
        if not packet_path or not Path(packet_path).is_file():
            return ""
        try:
            payload = json.loads(Path(packet_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        return str(payload.get("claimToken", ""))

    def _batch(
        self,
        state: str,
        actions: list[BaseAction],
        warnings: list[dict[str, Any]] | None = None,
    ) -> ActionBatch:
        notices = list(warnings or [])
        unchecked = self.store.resolved_but_unchecked()
        if unchecked:
            tickets = ", ".join(display_ticket(num) for num in unchecked)
            notices.append(
                {
                    "code": "resolved-but-unchecked",
                    "tickets": [display_ticket(num) for num in unchecked],
                    "message": (
                        f"tasks.md shows [ ] for {tickets}, but each already has a "
                        "succeeded receipt and baton will not re-run them. Commit or "
                        "restore baton's [x] write-back, or use `reopen <N.M>` to "
                        "re-run one deliberately."
                    ),
                }
            )
        return ActionBatch(
            run_id=f"RUN-{self.feature}",
            generation=self.store.events_count(),
            state=state,
            actions=actions,
            warnings=notices,
        )

    @staticmethod
    def _git(path: Path, *args: str) -> str:
        return run_git(list(args), cwd=path, error=WorktreeError).stdout.strip()


def _empty_cleanup() -> dict[str, Any]:
    return {"removed": [], "skipped": [], "branches_deleted": [], "branches_kept": []}


__all__ = ["SessionController", "SessionControllerError"]
