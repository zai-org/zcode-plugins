"""Execution-attempt lifecycle: claim, lease, bind, state, finalize, reopen.

Mixed into :class:`orchestration.plan_store.PlanStore` so the store's
persistence and plan-revision logic stays readable; lease renewal and the
retry budget live in :class:`orchestration.budget_store.BudgetStoreMixin`.
These methods use the private helpers the base class provides (``_connect``, ``_event_locked``,
``_ensure_initial_plan_locked``, ``_run_setting_locked``, ...); this module
never imports ``plan_store``, so the dependency stays one-way.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from typing import Any

from _frontier import is_frontier_ticket
from _ticket import TasksMarkdownError, check_task

from orchestration.plan_model import stable_hash, utc_now
from orchestration.result import ResultEnvelope
from orchestration.session_model import ExecutionAttempt
from orchestration.store_base import (
    ACTIVE_ATTEMPT_STATES,
    LEASED_ATTEMPT_STATES,
    MAX_ATTEMPTS_PER_TICKET,
    TERMINAL_ATTEMPT_STATES,
    ExecutionAttemptError,
    PlanStoreError,
    _utc_after,
)


class AttemptStoreMixin:
    """Attempt lifecycle methods for the durable plan store."""

    def claim_ready_assignments(
        self,
        *,
        session_id: str,
        capacity: int,
        base_branch: str = "main",
        base_sha: str = "",
        lease_seconds: int = 7200,
        expire_first: bool = True,
    ) -> list[ExecutionAttempt]:
        """Atomically claim up to ``capacity`` distinct ready tickets.

        This is the session-subagent claim primitive. It never claims the whole
        frontier pre-emptively. Each returned attempt receives a one-time
        claim token; only its hash is persisted. A ticket that already spent
        its automatic retry budget (``MAX_ATTEMPTS_PER_TICKET``) is left for
        the operator instead of being dispatched again.

        ``expire_first=False`` is for a caller that has already swept expired
        leases earlier in the same turn (the controller does): judging the
        lease a second time here could retire an attempt the caller just
        re-dispatched, putting two subagents on one ticket.
        """
        if not session_id.strip():
            raise ValueError("session_id is required")
        if capacity < 1 or capacity > 5:
            raise ValueError("capacity must be between 1 and 5")

        conn = self._connect()
        claimed: list[ExecutionAttempt] = []
        try:
            conn.execute("BEGIN IMMEDIATE")
            plan = self._ensure_initial_plan_locked(conn)
            if expire_first:
                self._expire_execution_attempts_locked(conn)
            active_rows = conn.execute(
                "SELECT ticket_num FROM execution_attempts "
                f"WHERE job_id = ? AND state IN ({self._active_states_sql()})",
                (self.job_id, *sorted(ACTIVE_ATTEMPT_STATES)),
            ).fetchall()
            active_tickets = {int(row["ticket_num"]) for row in active_rows}
            available = max(0, capacity - len(active_rows))
            if available == 0:
                conn.commit()
                return []

            epochs = self._attempt_epochs_locked(conn)
            ticket_files = {
                ticket.num: ticket for ticket in self._read_source_tickets()
            }
            resolved = {
                num for num, ticket in ticket_files.items() if ticket.status == "resolved"
            }
            result_rows = conn.execute(
                "SELECT ticket_num FROM result_envelopes "
                "WHERE job_id = ? AND status = 'succeeded'",
                (self.job_id,),
            ).fetchall()
            resolved.update(int(row["ticket_num"]) for row in result_rows)

            eligible = [
                ticket
                for ticket in plan.tickets
                if ticket.num not in active_tickets
                and ticket.num not in resolved
                and ticket_files.get(ticket.num) is not None
                and is_frontier_ticket(
                    ticket_files[ticket.num].status, ticket.blocked_by, resolved
                )
                and self._attempts_used_locked(conn, ticket.num, epochs)
                < MAX_ATTEMPTS_PER_TICKET
            ]
            eligible.sort(key=lambda ticket: ticket.num)

            for ticket in eligible:
                if len(claimed) >= available:
                    break
                attempt_no = self._latest_attempt_locked(conn, ticket.num) + 1
                assignment_id = (
                    f"ASG-{self.feature}-{ticket.num:03d}-r{plan.revision}-a{attempt_no}"
                )
                claim_token = uuid.uuid4().hex
                claim_token_hash = self._claim_token_hash(claim_token)
                packet_hash = stable_hash(
                    {
                        "planRevision": plan.revision,
                        "ticket": ticket.to_dict(),
                        "baseBranch": base_branch,
                        "baseSha": base_sha,
                    }
                )
                now = utc_now()
                expires_at = _utc_after(lease_seconds)
                run_id = f"RUN-{self.feature}"
                conn.execute(
                    "INSERT INTO execution_attempts "
                    "(job_id, run_id, assignment_id, ticket_num, attempt, state, "
                    "session_id, agent_id, plan_revision, task_packet_hash, "
                    "claim_token_hash, lease_expires_at, base_branch, base_sha, "
                    "worktree_path, worktree_branch, integration_path, "
                    "integration_branch, packet_path, receipt_path, commit_sha, "
                    "integration_sha, failure_code, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, 'leased', ?, '', ?, ?, ?, ?, ?, ?, "
                    "'', '', '', '', '', '', '', '', '', ?, ?)",
                    (
                        self.job_id, run_id, assignment_id, ticket.num, attempt_no,
                        session_id, plan.revision, packet_hash, claim_token_hash,
                        expires_at, base_branch, base_sha, now, now,
                    ),
                )
                self._event_locked(
                    conn,
                    "execution.attempt.claimed",
                    {
                        "assignmentId": assignment_id,
                        "ticket": ticket.num,
                        "attempt": attempt_no,
                        "sessionId": session_id,
                        "planRevision": plan.revision,
                        "taskPacketHash": packet_hash,
                        "leaseExpiresAt": expires_at,
                    },
                )
                claimed.append(
                    ExecutionAttempt(
                        assignment_id=assignment_id,
                        run_id=run_id,
                        ticket_num=ticket.num,
                        attempt=attempt_no,
                        state="leased",
                        session_id=session_id,
                        plan_revision=plan.revision,
                        task_packet_hash=packet_hash,
                        claim_token=claim_token,
                        lease_expires_at=expires_at,
                        base_branch=base_branch,
                        base_sha=base_sha,
                    )
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        if claimed:
            self._write_plan_json(self.current_plan())
        return claimed

    def list_execution_attempts(self) -> list[ExecutionAttempt]:
        self.ensure_initial_plan()
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM execution_attempts WHERE job_id = ? "
                "ORDER BY ticket_num, attempt",
                (self.job_id,),
            ).fetchall()
            return [self._execution_attempt_from_row(row) for row in rows]
        finally:
            conn.close()

    def get_execution_attempt(self, assignment_id: str) -> ExecutionAttempt:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM execution_attempts WHERE job_id = ? AND assignment_id = ?",
                (self.job_id, assignment_id),
            ).fetchone()
            if row is None:
                raise ExecutionAttemptError(
                    f"unknown assignment: {assignment_id}", code="unknown-assignment"
                )
            return self._execution_attempt_from_row(row)
        finally:
            conn.close()

    def bind_attempt_agent(
        self, assignment_id: str, claim_token: str, agent_id: str
    ) -> ExecutionAttempt:
        if not agent_id.strip():
            raise ValueError("agent_id is required")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            self._require_claim_token(row, claim_token)
            if row["state"] not in {"leased", "spawned"}:
                raise ExecutionAttemptError(
                    f"cannot bind agent while {assignment_id} is {row['state']}"
                )
            if row["state"] == "spawned":
                if row["agent_id"] != agent_id:
                    raise ExecutionAttemptError(
                        f"assignment {assignment_id} is already bound to {row['agent_id']}"
                    )
                conn.commit()
                return self.get_execution_attempt(assignment_id)
            now = utc_now()
            conn.execute(
                "UPDATE execution_attempts SET state = 'spawned', agent_id = ?, "
                "updated_at = ? WHERE job_id = ? AND assignment_id = ?",
                (agent_id, now, self.job_id, assignment_id),
            )
            self._event_locked(
                conn,
                "execution.agent.bound",
                {"assignmentId": assignment_id, "agentId": agent_id},
            )
            conn.commit()
            return self.get_execution_attempt(assignment_id)
        finally:
            conn.close()

    def configure_execution_attempt(
        self,
        assignment_id: str,
        claim_token: str,
        *,
        task_packet_hash: str,
        worktree_path: str,
        worktree_branch: str,
        integration_path: str,
        integration_branch: str,
        packet_path: str,
        receipt_path: str,
    ) -> ExecutionAttempt:
        """Persist the immutable packet and workspace coordinates for a claim."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            self._require_claim_token(row, claim_token)
            if row["state"] not in {"leased", "spawned"}:
                raise ExecutionAttemptError(
                    f"cannot configure {assignment_id} while it is {row['state']}"
                )
            now = utc_now()
            conn.execute(
                "UPDATE execution_attempts SET task_packet_hash = ?, "
                "worktree_path = ?, worktree_branch = ?, integration_path = ?, "
                "integration_branch = ?, packet_path = ?, receipt_path = ?, "
                "updated_at = ? WHERE job_id = ? AND assignment_id = ?",
                (
                    task_packet_hash,
                    worktree_path,
                    worktree_branch,
                    integration_path,
                    integration_branch,
                    packet_path,
                    receipt_path,
                    now,
                    self.job_id,
                    assignment_id,
                ),
            )
            self._event_locked(
                conn,
                "execution.attempt.configured",
                {
                    "assignmentId": assignment_id,
                    "taskPacketHash": task_packet_hash,
                    "worktreePath": worktree_path,
                    "packetPath": packet_path,
                },
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_execution_attempt(assignment_id)

    def mark_execution_attempt_state(
        self,
        assignment_id: str,
        claim_token: str,
        state: str,
        *,
        failure_code: str = "",
    ) -> ExecutionAttempt:
        """Move an attempt to a controller-owned lifecycle state.

        ``failure_code`` is a short machine prefix optionally followed by
        ``: <detail>``; the recover action shows it verbatim.
        """
        allowed = {"leased", "spawned", "integrating", "blocked-review", "unknown"}
        if state not in allowed:
            raise ValueError(f"unsupported execution attempt state: {state}")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            self._require_claim_token(row, claim_token)
            if row["state"] in TERMINAL_ATTEMPT_STATES:
                raise ExecutionAttemptError(f"attempt is terminal: {assignment_id}")
            now = utc_now()
            conn.execute(
                "UPDATE execution_attempts SET state = ?, failure_code = ?, "
                "updated_at = ? WHERE job_id = ? AND assignment_id = ?",
                (state, failure_code, now, self.job_id, assignment_id),
            )
            self._event_locked(
                conn,
                f"execution.attempt.{state}",
                {"assignmentId": assignment_id, "failureCode": failure_code},
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_execution_attempt(assignment_id)

    def expire_execution_attempts(self) -> None:
        """Mark every attempt past its lease ``unknown`` and free the lease.

        Called by the controller before planning a batch so an expired lease is
        never re-dispatched as if it were still owned. ``failure_code`` is set
        to ``lease-expired``; the attempt is retried automatically while the
        ticket still has retry budget, otherwise the operator decides.
        """
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._expire_execution_attempts_locked(conn)
            conn.commit()
        finally:
            conn.close()

    def supersede_execution_attempt(
        self,
        assignment_id: str,
        *,
        success_assignment_id: str = "",
        failure_code: str = "superseded-by-retry",
    ) -> ExecutionAttempt:
        """Retire a stale attempt that a newer attempt for the ticket replaced."""
        return self._resolve_execution_attempt(
            assignment_id,
            state="superseded",
            failure_code=(
                f"{failure_code} (successor {success_assignment_id})"
                if success_assignment_id
                else failure_code
            ),
        )

    def abandon_execution_attempt(
        self,
        assignment_id: str,
        *,
        reason: str = "operator-abandoned",
    ) -> ExecutionAttempt:
        """Operator escape hatch: retire a stuck attempt without touching git.

        Releases the attempt's lease and marks it ``abandoned`` so
        the ticket becomes claimable again. It deliberately does **not** remove
        the assignment worktree/branch, its commits, packet or receipt — those
        stay on disk for audit. It only destroys the attempt's ability to be
        reconciled: any later receipt is ignored unless ``adopt`` revives it.
        """
        return self._resolve_execution_attempt(
            assignment_id, state="abandoned", failure_code=reason
        )

    def adopt_execution_attempt(
        self,
        assignment_id: str,
        *,
        lease_seconds: int = 7200,
    ) -> ExecutionAttempt:
        """Revive an abandoned or superseded attempt so a late receipt lands.

        The reverse hatch of :meth:`abandon_execution_attempt`: an attempt
        whose subagent later sealed a valid receipt is put back into an active
        state with a fresh lease, so the controller can verify and integrate
        the receipt as if the retire never happened. The caller is expected to
        hold the verified receipt; this transition only changes scheduling
        state, never git.
        """
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            if row["state"] != "abandoned" and row["state"] != "superseded":
                raise ExecutionAttemptError(
                    f"cannot adopt {assignment_id} while it is {row['state']} "
                    "(only abandoned or superseded attempts can be adopted)"
                )
            now = utc_now()
            expires_at = _utc_after(lease_seconds)
            conn.execute(
                "UPDATE execution_attempts SET state = 'integrating', "
                "failure_code = '', lease_expires_at = ?, updated_at = ? "
                "WHERE job_id = ? AND assignment_id = ?",
                (expires_at, now, self.job_id, assignment_id),
            )
            self._event_locked(
                conn,
                "execution.attempt.adopted",
                {"assignmentId": assignment_id, "leaseExpiresAt": expires_at},
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_execution_attempt(assignment_id)

    def _resolve_execution_attempt(
        self,
        assignment_id: str,
        *,
        state: str,
        failure_code: str,
    ) -> ExecutionAttempt:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            if row["state"] in TERMINAL_ATTEMPT_STATES:
                raise ExecutionAttemptError(
                    f"attempt is already terminal ({row['state']}): {assignment_id}"
                )
            now = utc_now()
            conn.execute(
                "UPDATE execution_attempts SET state = ?, failure_code = ?, "
                "updated_at = ? WHERE job_id = ? AND assignment_id = ?",
                (state, failure_code, now, self.job_id, assignment_id),
            )
            self._event_locked(
                conn,
                f"execution.attempt.{state}",
                {"assignmentId": assignment_id, "failureCode": failure_code},
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_execution_attempt(assignment_id)

    def finalize_execution_attempt(
        self,
        assignment_id: str,
        claim_token: str,
        envelope: ResultEnvelope,
        integration_sha: str,
    ) -> ExecutionAttempt:
        """Persist one sealed, integrated result and release its attempt lease."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = self._load_execution_attempt_locked(conn, assignment_id)
            self._require_claim_token(row, claim_token)
            if row["state"] == "succeeded":
                conn.commit()
                return self.get_execution_attempt(assignment_id)
            if row["state"] in TERMINAL_ATTEMPT_STATES:
                raise ExecutionAttemptError(f"attempt is terminal: {assignment_id}")
            if envelope.status != "succeeded":
                raise ExecutionAttemptError("only succeeded sealed receipts can finalize")
            expected = {
                "assignment_id": assignment_id,
                "ticket_num": int(row["ticket_num"]),
                "plan_revision": int(row["plan_revision"]),
                "task_packet_hash": str(row["task_packet_hash"]),
                "attempt": int(row["attempt"]),
            }
            for field, value in expected.items():
                if getattr(envelope, field) != value:
                    raise ExecutionAttemptError(
                        f"receipt {field} mismatch for {assignment_id}"
                    )
            now = utc_now()
            envelope.integration_sha = integration_sha
            conn.execute(
                "UPDATE execution_attempts SET state = 'succeeded', commit_sha = ?, "
                "integration_sha = ?, failure_code = '', updated_at = ? "
                "WHERE job_id = ? AND assignment_id = ?",
                (envelope.commit_sha, integration_sha, now, self.job_id, assignment_id),
            )
            envelope_id = self._result_envelope_id(envelope)
            conn.execute(
                "INSERT OR REPLACE INTO result_envelopes "
                "(envelope_id, job_id, feature, ticket_num, assignment_id, "
                "plan_revision, task_packet_hash, status, payload_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    envelope_id,
                    self.job_id,
                    self.feature,
                    envelope.ticket_num,
                    envelope.assignment_id,
                    envelope.plan_revision,
                    envelope.task_packet_hash,
                    envelope.status,
                    json.dumps(envelope.to_dict(), ensure_ascii=False, sort_keys=True),
                    envelope.created_at,
                ),
            )
            self._event_locked(
                conn,
                "execution.attempt.succeeded",
                {
                    "assignmentId": assignment_id,
                    "ticket": envelope.ticket_num,
                    "commitSha": envelope.commit_sha,
                    "integrationSha": integration_sha,
                },
            )
            conn.commit()
        finally:
            conn.close()

        try:
            check_task(self.tasks_path, envelope.ticket_num)
        except TasksMarkdownError as exc:
            raise PlanStoreError(str(exc)) from exc
        self._write_result_envelope_json(self._result_envelope_id(envelope), envelope)
        self._write_plan_json(self.current_plan())
        return self.get_execution_attempt(assignment_id)

    def _expire_execution_attempts_locked(self, conn: sqlite3.Connection) -> None:
        now = utc_now()
        rows = conn.execute(
            "SELECT assignment_id FROM execution_attempts "
            f"WHERE job_id = ? AND lease_expires_at <= ? AND state IN ({self._leased_states_sql()})",
            (self.job_id, now, *sorted(LEASED_ATTEMPT_STATES)),
        ).fetchall()
        for row in rows:
            assignment_id = str(row["assignment_id"])
            conn.execute(
                "UPDATE execution_attempts SET state = 'unknown', failure_code = 'lease-expired', "
                "updated_at = ? WHERE job_id = ? AND assignment_id = ?",
                (now, self.job_id, assignment_id),
            )
            self._event_locked(
                conn,
                "execution.attempt.unknown",
                {"assignmentId": assignment_id, "reason": "lease-expired"},
            )

    def _load_execution_attempt_locked(
        self, conn: sqlite3.Connection, assignment_id: str
    ) -> sqlite3.Row:
        row = conn.execute(
            "SELECT * FROM execution_attempts WHERE job_id = ? AND assignment_id = ?",
            (self.job_id, assignment_id),
        ).fetchone()
        if row is None:
            raise ExecutionAttemptError(
                f"unknown assignment: {assignment_id}", code="unknown-assignment"
            )
        return row

    @staticmethod
    def _active_states_sql() -> str:
        return ", ".join("?" for _ in ACTIVE_ATTEMPT_STATES)

    @staticmethod
    def _leased_states_sql() -> str:
        return ", ".join("?" for _ in LEASED_ATTEMPT_STATES)

    @staticmethod
    def _claim_token_hash(claim_token: str) -> str:
        return hashlib.sha256(claim_token.encode("utf-8")).hexdigest()

    def _require_claim_token(self, row: sqlite3.Row, claim_token: str) -> None:
        if self._claim_token_hash(claim_token) != row["claim_token_hash"]:
            raise ExecutionAttemptError(
                f"invalid claim token for assignment {row['assignment_id']}",
                code="invalid-claim-token",
            )

    def _execution_attempt_from_row(self, row: sqlite3.Row) -> ExecutionAttempt:
        return ExecutionAttempt(
            assignment_id=str(row["assignment_id"]),
            run_id=str(row["run_id"]),
            ticket_num=int(row["ticket_num"]),
            attempt=int(row["attempt"]),
            state=str(row["state"]),
            session_id=str(row["session_id"]),
            plan_revision=int(row["plan_revision"]),
            task_packet_hash=str(row["task_packet_hash"]),
            claim_token="",
            lease_expires_at=str(row["lease_expires_at"]),
            base_branch=str(row["base_branch"]),
            base_sha=str(row["base_sha"]),
            worktree_path=str(row["worktree_path"]),
            worktree_branch=str(row["worktree_branch"]),
            integration_path=str(row["integration_path"]),
            integration_branch=str(row["integration_branch"]),
            packet_path=str(row["packet_path"]),
            receipt_path=str(row["receipt_path"]),
            agent_id=str(row["agent_id"]),
            commit_sha=str(row["commit_sha"]),
            integration_sha=str(row["integration_sha"]),
            failure_code=str(row["failure_code"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )


__all__ = ["AttemptStoreMixin"]
