"""Building a dispatch: the isolated worktree, the immutable packet, the prompt.

Mixed into :class:`orchestration.session_controller.SessionController`, which
provides ``store``, ``project_path`` and ``feature``. This module never
imports the controller, so the dependency stays one-way.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from orchestration.model import ROLE_BUILDER, TaskPacket
from orchestration.plan_model import PlanRevision
from orchestration.relay import HEARTBEAT_NAME
from orchestration.session_model import (
    DispatchAction,
    ExecutionAttempt,
    SessionControllerError,
    display_ticket,
    finalize_task_packet,
)
from orchestration.worktree import prepare_assignment_worktree


class DispatchFlowMixin:
    """Turn a claimed attempt into something a host can spawn."""

    def _prepare_dispatch(
        self,
        attempt: ExecutionAttempt,
        integration_path: Path,
        integration_branch: str,
        verification_commands: list[str],
        plan: PlanRevision,
    ) -> DispatchAction:
        slot = prepare_assignment_worktree(
            self.project_path,
            self.feature,
            attempt.ticket_num,
            attempt.attempt,
            base_ref=attempt.base_sha,
        )
        ticket = next(
            (item for item in plan.tickets if item.num == attempt.ticket_num), None
        )
        if ticket is None:
            raise SessionControllerError(
                f"ticket {display_ticket(attempt.ticket_num)} left the plan before "
                f"its packet could be prepared for {attempt.assignment_id}",
                code="ticket-removed",
            )
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
            self.project_path / ".dsh" / "baton" / "runs" / attempt.assignment_id
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
        return self._dispatch_from_attempt(configured, attempt.claim_token, ticket.title)

    def _dispatch_from_attempt(
        self, attempt: ExecutionAttempt, claim_token: str, ticket_title: str = ""
    ) -> DispatchAction:
        if not attempt.packet_path:
            raise SessionControllerError(
                f"attempt has no packet: {attempt.assignment_id}",
                code="no-packet",
            )
        self._ensure_worktree(attempt)
        receipt_cli = Path(__file__).resolve().parents[1] / "receipt.py"
        heartbeat = Path(attempt.packet_path).parent / HEARTBEAT_NAME
        ticket = display_ticket(attempt.ticket_num)
        prompt = (
            f"Implement Baton assignment {attempt.assignment_id} — ticket {ticket}"
            + (f": {ticket_title}" if ticket_title else "")
            + "\n"
            f"Work exclusively in `{attempt.worktree_path}` on branch "
            f"`{attempt.worktree_branch}`. Do not change ticket or controller state.\n"
            f"Refresh the heartbeat file `{heartbeat}` after each meaningful "
            f"milestone (overwrite or touch it; it lives outside the worktree, "
            "so never commit it).\n"
            f"For change context read everything under `openspec/changes/{self.feature}/` "
            "in the worktree: `proposal.md`, plus `design.md` and the spec deltas "
            "under `specs/` when the change has them (their scenarios are the "
            "acceptance bar), and `tasks.md`.\n"
            f"Read immutable packet `{attempt.packet_path}`. Implement the ticket, run "
            "the packet's verification commands yourself until they pass, commit all "
            "changes, then seal:\n"
            f'`"{sys.executable}" "{receipt_cli}" seal --packet "{attempt.packet_path}"`\n'
            "`seal` re-runs the verification commands on the committed HEAD and "
            "reports what broke if they fail. A sealed receipt is the only success "
            "evidence. If you cannot finish, stop and report exactly what blocks you "
            "instead of sealing."
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
            ticket_title=ticket_title,
        )

    def _ensure_worktree(self, attempt: ExecutionAttempt) -> None:
        """Give a claim back its worktree when something removed it.

        A cleanup run mid-flight can delete the checkout of a claim that was
        never bound to an agent; re-issuing that dispatch must not hand the
        subagent a directory that does not exist.
        """
        if not attempt.worktree_path or Path(attempt.worktree_path).is_dir():
            return
        prepare_assignment_worktree(
            self.project_path,
            self.feature,
            attempt.ticket_num,
            attempt.attempt,
            base_ref=attempt.base_sha,
        )

    @staticmethod
    def _write_immutable_json(path: Path, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if path.exists():
            if path.read_text(encoding="utf-8") != text:
                raise SessionControllerError(
                    f"immutable packet changed: {path}", code="packet-changed"
                )
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)


__all__ = ["DispatchFlowMixin"]
