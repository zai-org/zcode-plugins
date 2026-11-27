"""Sealed-receipt reconciliation: verify, integrate, verify the merged tree.

Mixed into :class:`orchestration.session_controller.SessionController`, which
provides ``store``, ``_git`` and ``_token_from_packet``. This module never
imports the controller, so the dependency stays one-way.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from orchestration.integrator import (
    IntegrationLockBusy,
    integration_lock,
    integrate_assignment,
    read_integration_verification,
    verify_integration_head,
)
from orchestration.plan_model import stable_hash
from orchestration.plan_store import ExecutionAttemptError
from orchestration.receipt import (
    ReceiptError,
    last_verification_failure,
    run_verification_commands,
    verification_summary,
    verify_sealed_receipt,
)
from orchestration.result import ResultEnvelope
from orchestration.session_model import (
    BaseAction,
    BlockedAction,
    ExecutionAttempt,
    RepairIntegrationAction,
    ResolveMergeAction,
    SessionControllerError,
    display_ticket,
)
from orchestration.worktree import WorktreeError

#: The merged tree failed the run's verification commands.
POST_MERGE_FAILURE = "post-merge-verification-failed"
#: The ticket's text in tasks.md changed while its attempt was in flight.
REDEFINED_IN_FLIGHT = "ticket-redefined"
REDEFINED_AFTER_SEAL = "ticket-redefined-after-seal"
#: The task left tasks.md while its attempt was in flight.
REMOVED_IN_FLIGHT = "ticket-removed"
REMOVED_AFTER_SEAL = "ticket-removed-after-seal"


class VerificationUnavailable(WorktreeError):
    """The merged tree's verification could not even run (timeout, a command
    that cannot start). The merge did land, so the attempt is parked as the
    owner of an unverified base — not reported as a failed merge."""

    code = "verification-unavailable"


class ReceiptFlowMixin:
    """Receipt verification and integration steps of the session controller."""

    def _definition_change(
        self, attempt: ExecutionAttempt, plan
    ) -> tuple[str, str] | None:
        """``(claimed text, current text)`` when the ticket an attempt was
        claimed against no longer reads the same; ``None`` when unchanged.

        Packets are immutable, so a subagent keeps implementing the text it
        was claimed with. An empty current text means the task left tasks.md.
        """
        claimed_plan = self.store.plan_revision(attempt.plan_revision)
        if claimed_plan is None:
            return None
        claimed = next(
            (t for t in claimed_plan.tickets if t.num == attempt.ticket_num), None
        )
        if claimed is None:
            return None
        current = next((t for t in plan.tickets if t.num == attempt.ticket_num), None)
        if current is None:
            return claimed.title, ""
        if current.title != claimed.title:
            return claimed.title, current.title
        return None

    def _integration_verifier(self, integration_path: str, commands: list[str]):
        """A callable the integrator runs on the merged tree, or ``None`` when
        the run declares no verification commands."""
        if not commands:
            return None

        def run() -> list[dict[str, Any]]:
            try:
                return run_verification_commands(Path(integration_path), commands)
            except ReceiptError as exc:
                raise VerificationUnavailable(str(exc)) from exc

        return run

    @staticmethod
    def _verify_key(commands: list[str]) -> str:
        """Fingerprint of the verification commands: correcting them must
        re-verify a commit that was red under the old ones."""
        return stable_hash(commands)

    def _verify_force(self) -> bool:
        """``--verify`` passed on this very call: the operator asked for the
        merged tree to be checked again with these commands."""
        return bool(self.verification_commands)

    def _integration_base_check(
        self,
        integration_path: str,
        integration_branch: str,
        verification_commands: list[str],
        *,
        owner_parked: bool,
    ) -> BlockedAction | None:
        """Block the run while the integration branch's HEAD is known-red.

        ``None`` when the base is healthy — or when the attempt that owns the
        red merge is still parked, because the receipt pass re-checks it and
        emits the repair action. When HEAD moved since the failure (a fix may
        have landed) the new HEAD is verified before anything branches from it.
        """
        if owner_parked:
            return None
        memo = read_integration_verification(integration_path)
        if memo is None or memo.get("ok", True):
            return None
        head = self._git(Path(integration_path), "rev-parse", "HEAD")
        if memo.get("integration_sha") != head:
            with integration_lock(Path(integration_path)):
                verify_integration_head(
                    Path(integration_path).resolve(),
                    self._integration_verifier(integration_path, verification_commands)
                    or (lambda: []),
                    key=self._verify_key(verification_commands),
                    force=self._verify_force(),
                )
            memo = read_integration_verification(integration_path)
            if memo is None or memo.get("ok", True):
                return None
        return BlockedAction(
            code="integration-verification-failed",
            reason=self._red_base_reason(memo, integration_path, integration_branch),
        )

    @staticmethod
    def _red_base_reason(memo: dict[str, Any], integration_path: str, branch: str) -> str:
        detail = memo.get("error") or verification_summary(memo.get("verification") or [])
        return (
            f"the integration branch {branch} is at {str(memo.get('integration_sha'))[:12]} "
            "and that commit failed the run's verification commands:\n"
            f"{detail}\n"
            f"Nothing new is claimed until it passes. Fix it on that branch in "
            f"`{integration_path}` (commit the fix; do not reset the branch), then "
            "call actions again."
        )

    def _reconcile_sealed(
        self,
        attempt: ExecutionAttempt,
        claim_token: str,
        plan,
        verification_commands: list[str],
        warnings: list[dict[str, Any]],
    ) -> BaseAction | None:
        """Verify one sealed receipt, integrate its branch, verify the merge.

        Returns the action the operator (or a subagent) must take next, or
        ``None`` when the attempt was finalized or should simply be retried on
        a later call. A rejected receipt never raises: the attempt is parked
        as recoverable and the receipt pass surfaces it as a ``recover``.
        """
        try:
            payload = json.loads(Path(attempt.receipt_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            self._reject_receipt(attempt, claim_token, f"cannot read sealed receipt: {exc}")
            return None
        try:
            envelope = verify_sealed_receipt(
                payload,
                claim_token=claim_token,
                task_packet_hash=attempt.task_packet_hash,
            )
            self._check_receipt_identity(attempt, envelope)
        except ReceiptError as exc:
            self._reject_receipt(attempt, claim_token, str(exc))
            return None

        change = self._definition_change(attempt, plan)
        if change is not None:
            return self._park_redefined(attempt, claim_token, change, sealed=True)

        try:
            result = integrate_assignment(
                attempt.integration_path,
                attempt.worktree_branch,
                expected_sha=envelope.commit_sha,
                verify=self._integration_verifier(
                    attempt.integration_path, verification_commands
                ),
                verify_key=self._verify_key(verification_commands),
                verify_force=self._verify_force(),
            )
        except VerificationUnavailable as exc:
            # The merge landed; only the verification could not run. Park the
            # attempt as the owner of an unverified base instead of reporting
            # "nothing was merged" and inviting a re-claim of merged work.
            return self._park_verification_failure(
                attempt,
                claim_token,
                {
                    "error": f"the verification commands could not run on the merged "
                    f"tree: {exc}"
                },
                verification_commands,
            )
        except IntegrationLockBusy as exc:
            warnings.append(
                {
                    "code": "integration-lock-busy",
                    "assignment_id": attempt.assignment_id,
                    "message": (
                        f"{attempt.assignment_id}: another process is integrating right "
                        f"now ({exc}); its sealed receipt is retried on the next call"
                    ),
                }
            )
            return None
        except WorktreeError as exc:
            return self._integration_failed(attempt, claim_token, str(exc))

        if result["ok"]:
            try:
                self.store.mark_execution_attempt_state(
                    attempt.assignment_id, claim_token, "integrating"
                )
            except ExecutionAttemptError:
                # Another process already finalized this very receipt: the
                # outcome is the same, so this call has nothing left to do.
                if self.store.get_execution_attempt(attempt.assignment_id).state == "succeeded":
                    return None
                raise
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
        if reason == "verification-failed":
            return self._park_verification_failure(
                attempt, claim_token, result, verification_commands
            )
        if reason == "branch-moved":
            return self._branch_moved_action(attempt, claim_token, result)
        if reason == "merge-in-progress":
            # The shared worktree is mid-merge for a *different* assignment.
            # Leave this attempt untouched: it is retried on the next call,
            # once that conflict is resolved, and must not be reported as
            # conflicted itself.
            warnings.append(
                {
                    "code": "receipt-waiting-for-preserved-merge",
                    "assignment_id": attempt.assignment_id,
                    "message": (
                        f"{attempt.assignment_id}: its sealed receipt waits until the "
                        "preserved merge in the integration worktree is resolved"
                    ),
                }
            )
            return None
        if reason == "worktree-dirty":
            return BlockedAction(
                code="integration-worktree-dirty",
                ticket_num=attempt.ticket_num,
                reason=self._dirty_worktree_reason(
                    attempt, result.get("conflicts", [])
                ),
            )
        raise SessionControllerError(
            f"integration returned an unknown outcome {reason!r} for "
            f"{attempt.assignment_id}"
        )

    def _park_verification_failure(
        self,
        attempt: ExecutionAttempt,
        claim_token: str,
        result: dict[str, Any],
        verification_commands: list[str],
    ) -> RepairIntegrationAction:
        """The merge landed but the merged tree is red: park the attempt and
        ask for the integration branch to be repaired where it stands.

        The merge commit is kept (nothing is reset) and the failed outcome is
        recorded on the integration worktree, so no other receipt merges onto
        the red base and no new ticket branches from it until a fix lands.
        """
        detail = result.get("error") or verification_summary(
            result.get("verification") or []
        )
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "blocked-review",
                failure_code=POST_MERGE_FAILURE,
            )
        except ExecutionAttemptError:
            pass
        could_not_run = bool(result.get("error"))
        return RepairIntegrationAction(
            assignment_id=attempt.assignment_id,
            ticket_num=attempt.ticket_num,
            cwd=attempt.integration_path,
            claim_token=claim_token,
            prompt=(
                f"The merge of assignment {attempt.assignment_id} (ticket "
                f"{display_ticket(attempt.ticket_num)}) landed on "
                f"{attempt.integration_branch}, but the run's verification "
                + (
                    "could not be run on the merged tree:\n"
                    f"{detail}\n\n"
                if could_not_run
                else "failed on the merged tree:\n"
                f"{detail}\n\n"
                )
                + f"Work only in `{attempt.integration_path}`. "
                + (
                    "Make the verification commands runnable and finishable there "
                    "(a missing dependency, a hanging command), commit whatever you "
                    "change on that branch, and do not reset the merge. "
                    if could_not_run
                    else "Two tickets that were each green alone can break each other "
                    "once merged, and a conflict resolution is never verified by the "
                    "branches that produced it: find what the combination broke, fix "
                    "it, and commit the fix on that branch. Do not reset, revert or "
                    "abort the merge. "
                )
                + "The main session will reconcile again and the verification "
                "commands run on the merged tree:\n"
                + "\n".join(verification_commands)
            ),
        )

    def _integration_failed(
        self, attempt: ExecutionAttempt, claim_token: str, detail: str
    ) -> BlockedAction:
        """Surface a hard integration failure without wedging the attempt.

        The attempt moves to ``blocked-review`` (still active, so no retry
        churn) instead of being left in ``integrating`` until its lease runs
        out two hours later.
        """
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "blocked-review",
                failure_code=f"integration-failed: {detail}",
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
            assignment_id=attempt.assignment_id,
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
    def _dirty_worktree_reason(attempt: ExecutionAttempt, dirty: list[str]) -> str:
        listing = ", ".join(dirty[:5]) or "unknown files"
        return (
            f"integration worktree {attempt.integration_path} has uncommitted "
            f"changes ({listing}) and nothing was merged. Commit or discard them "
            f"(or `git -C <path> merge --abort` if a merge is half done), then "
            f"call actions again; to retire this attempt instead, "
            f"`abandon {attempt.assignment_id}`."
        )

    @staticmethod
    def _check_receipt_identity(attempt: ExecutionAttempt, envelope: ResultEnvelope) -> None:
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

    def _reject_receipt(self, attempt: ExecutionAttempt, claim_token: str, reason: str) -> None:
        """Leave a bad receipt's attempt recoverable: no merge, lease freed.

        The rejection is written into ``failure_code`` so every later batch
        keeps showing exactly which segment was edited; the receipt pass turns
        it into the ``recover`` action.
        """
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id,
                claim_token,
                "unknown",
                failure_code=f"receipt-invalid: {reason}",
            )
        except ExecutionAttemptError:
            # The attempt already reached a terminal state; nothing to park.
            pass

    def _park_redefined(
        self,
        attempt: ExecutionAttempt,
        claim_token: str,
        change: tuple[str, str],
        *,
        sealed: bool,
    ) -> BlockedAction:
        """Park an attempt whose ticket text changed under it, for an operator."""
        claimed_text, current_text = change
        ticket = display_ticket(attempt.ticket_num)
        if current_text:
            code = REDEFINED_AFTER_SEAL if sealed else REDEFINED_IN_FLIGHT
            state_of_work = (
                "Its sealed receipt implements the OLD text. "
                if sealed
                else "The subagent is implementing the OLD text. "
            )
            reason = (
                f"task {ticket} was redefined while assignment {attempt.assignment_id} "
                f"was in flight.\n  claimed as: {claimed_text!r}\n"
                f"  tasks.md now says: {current_text!r}\n"
                f"{state_of_work}Nothing was merged. Restore the original text to "
                f"let the attempt resume, or retire it with "
                f"`abandon {attempt.assignment_id}` so the ticket is re-claimed "
                "under the new definition."
            )
            blocked_code = "ticket-redefined"
        else:
            code = REMOVED_AFTER_SEAL if sealed else REMOVED_IN_FLIGHT
            reason = (
                f"task {ticket} was removed from tasks.md while assignment "
                f"{attempt.assignment_id} was in flight (it was claimed as: "
                f"{claimed_text!r}). Nothing was merged. Restore the task to let "
                f"the attempt resume, or retire it with "
                f"`abandon {attempt.assignment_id}`."
            )
            blocked_code = "ticket-removed"
        try:
            self.store.mark_execution_attempt_state(
                attempt.assignment_id, claim_token, "blocked-review", failure_code=code
            )
        except ExecutionAttemptError:
            pass
        return BlockedAction(
            code=blocked_code,
            ticket_num=attempt.ticket_num,
            assignment_id=attempt.assignment_id,
            agent_id=attempt.agent_id,
            reason=reason,
        )

    def _blocked_review_action(self, attempt: ExecutionAttempt, claim_token: str) -> BaseAction:
        """Re-surface a parked blocked-review attempt whose receipt can no
        longer be re-reconciled (receipt or packet gone from disk), or whose
        in-flight ticket edit still stands.

        Only ``merge-conflict`` leaves a preserved merge to resolve; the other
        failure codes merged nothing that a ``resolve_merge`` prompt could
        point at, so each surfaces as its own named ``blocked`` action.
        """
        if attempt.failure_code == "merge-conflict":
            return self._merge_action(attempt, claim_token)
        if attempt.failure_code == POST_MERGE_FAILURE:
            memo = read_integration_verification(attempt.integration_path) or {}
            return BlockedAction(
                code="integration-verification-failed",
                ticket_num=attempt.ticket_num,
                assignment_id=attempt.assignment_id,
                reason=(
                    f"the merged tree of {attempt.assignment_id} failed verification "
                    f"and its receipt can no longer be re-read.\n"
                    + self._red_base_reason(
                        memo, attempt.integration_path, attempt.integration_branch
                    )
                    + f" To retire this attempt instead: `abandon {attempt.assignment_id}`."
                ),
            )
        if attempt.failure_code in {REDEFINED_IN_FLIGHT, REDEFINED_AFTER_SEAL}:
            return BlockedAction(
                code="ticket-redefined",
                ticket_num=attempt.ticket_num,
                assignment_id=attempt.assignment_id,
                agent_id=attempt.agent_id,
                reason=(
                    f"task {display_ticket(attempt.ticket_num)} was redefined while "
                    f"{attempt.assignment_id} was in flight and its receipt or packet "
                    "can no longer be re-read. Nothing was merged. Restore the "
                    "original text and call actions again, or retire it with "
                    f"`abandon {attempt.assignment_id}`."
                ),
            )
        if attempt.failure_code in {REMOVED_IN_FLIGHT, REMOVED_AFTER_SEAL}:
            return BlockedAction(
                code="ticket-removed",
                ticket_num=attempt.ticket_num,
                assignment_id=attempt.assignment_id,
                agent_id=attempt.agent_id,
                reason=(
                    f"task {display_ticket(attempt.ticket_num)} left tasks.md while "
                    f"{attempt.assignment_id} was in flight. Nothing was merged. "
                    f"Restore it, or retire the attempt with "
                    f"`abandon {attempt.assignment_id}`."
                ),
            )
        if attempt.failure_code.startswith("integration-failed"):
            detail = attempt.failure_code.removeprefix("integration-failed").lstrip(": ")
            return BlockedAction(
                code="integration-failed",
                ticket_num=attempt.ticket_num,
                reason=(
                    f"cannot merge {attempt.worktree_branch} into "
                    f"{attempt.integration_path}: {detail}. Nothing was merged. "
                    f"Fix the integration worktree, or retire the attempt with "
                    f"`abandon {attempt.assignment_id}`."
                ),
            )
        if attempt.failure_code == "branch-moved-after-seal":
            return BlockedAction(
                code="branch-moved-after-seal",
                ticket_num=attempt.ticket_num,
                assignment_id=attempt.assignment_id,
                reason=(
                    f"branch {attempt.worktree_branch} advanced past the commit "
                    f"the sealed receipt for {attempt.assignment_id} verified, "
                    "and the receipt can no longer be re-read; commits after "
                    "the seal were never verified. Nothing was merged. Retire "
                    f"the attempt with `abandon {attempt.assignment_id}` (the "
                    "ticket is re-claimed fresh)."
                ),
            )
        return BlockedAction(
            code=attempt.failure_code or "blocked-review",
            ticket_num=attempt.ticket_num,
            reason=(
                f"attempt {attempt.assignment_id} is parked in blocked-review "
                f"({attempt.failure_code or 'no failure code'}) and its "
                "receipt can no longer be re-read; fix the cause and call "
                f"actions again, or retire it with `abandon {attempt.assignment_id}`."
            ),
        )

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
                "commands, and commit the merge; then the main session will reconcile again "
                "and the controller re-verifies the merged tree before the ticket lands."
            ),
        )


__all__ = [
    "POST_MERGE_FAILURE",
    "ReceiptFlowMixin",
    "VerificationUnavailable",
]
