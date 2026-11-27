"""Lease renewal and the retry budget: persistence half.

Mixed into :class:`orchestration.plan_store.PlanStore` next to
:class:`orchestration.attempt_store.AttemptStoreMixin`, which keeps the claim
and state-transition half. These methods use the private helpers the store
provides (``_connect``, ``_event_locked``, ``_run_setting_locked``,
``_leased_states_sql``); this module never imports ``plan_store``, so the
dependency stays one-way.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from _ticket import TasksMarkdownError, uncheck_task

from orchestration.plan_model import utc_now
from orchestration.session_model import display_ticket
from orchestration.store_base import (
    ACTIVE_ATTEMPT_STATES,
    LEASED_ATTEMPT_STATES,
    MAX_ATTEMPTS_PER_TICKET,
    REOPEN_EPOCHS_SETTING,
    ExecutionAttemptError,
    PlanStoreError,
    _utc_after,
)


class BudgetStoreMixin:
    """What keeps an attempt alive, and how often a ticket may be retried."""


    def renew_execution_attempt_lease(
        self, assignment_id: str, lease_expires_at: str, *, restart: bool = False
    ) -> None:
        """Push a leased attempt's deadline out to ``lease_expires_at``.

        Only ever extends (a stale renewal can never shorten a lease) and only
        while the attempt is still leased. ``restart=True`` also resets
        ``created_at`` — the anchor of the lease's hard cap — for an attempt
        that resumes after a long park.
        """
        conn = self._connect()
        try:
            now = utc_now()
            guard = (
                "(lease_expires_at < ? OR created_at < ?)" if restart else "lease_expires_at < ?"
            )
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "UPDATE execution_attempts SET lease_expires_at = ?, updated_at = ?"
                + (", created_at = ?" if restart else "")
                + f" WHERE job_id = ? AND assignment_id = ? AND state IN ({self._leased_states_sql()}) "
                f"AND {guard}",
                (
                    lease_expires_at,
                    now,
                    *([now] if restart else []),
                    self.job_id,
                    assignment_id,
                    *sorted(LEASED_ATTEMPT_STATES),
                    lease_expires_at,
                    *([now] if restart else []),
                ),
            )
            self._event_locked(
                conn,
                "execution.lease.renewed",
                {"assignmentId": assignment_id, "leaseExpiresAt": lease_expires_at},
            )
            conn.commit()
        finally:
            conn.close()

    def reopen_ticket(self, ticket_num: int) -> dict[str, Any]:
        """Void a ticket's succeeded receipts so it can be claimed again.

        The explicit reverse of a finished ticket: succeeded result envelopes
        are marked ``reopened`` (kept for audit, ignored by completion and the
        claim loop), parked ``unknown`` attempts are retired, and the retry
        budget restarts. An attempt still owning the ticket is refused —
        retire it with ``abandon`` first.
        """
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                "SELECT assignment_id, state FROM execution_attempts "
                "WHERE job_id = ? AND ticket_num = ? ORDER BY attempt",
                (self.job_id, ticket_num),
            ).fetchall()
            active = [
                f"{row['assignment_id']} is still {row['state']}"
                for row in rows
                if row["state"] in ACTIVE_ATTEMPT_STATES
            ]
            if active:
                raise ExecutionAttemptError(
                    f"cannot reopen ticket {display_ticket(ticket_num)}: "
                    + "; ".join(active)
                    + " — abandon it first",
                    code="attempt-active",
                )
            now = utc_now()
            for row in rows:
                if row["state"] == "unknown":
                    conn.execute(
                        "UPDATE execution_attempts SET state = 'superseded', "
                        "failure_code = 'superseded-by-reopen', updated_at = ? "
                        "WHERE job_id = ? AND assignment_id = ?",
                        (now, self.job_id, row["assignment_id"]),
                    )
            voided = [
                str(row["assignment_id"])
                for row in conn.execute(
                    "SELECT assignment_id FROM result_envelopes "
                    "WHERE job_id = ? AND ticket_num = ? AND status = 'succeeded'",
                    (self.job_id, ticket_num),
                ).fetchall()
            ]
            conn.execute(
                "UPDATE result_envelopes SET status = 'reopened' "
                "WHERE job_id = ? AND ticket_num = ? AND status = 'succeeded'",
                (self.job_id, ticket_num),
            )
            epochs = self._attempt_epochs_locked(conn)
            epochs[str(ticket_num)] = self._latest_attempt_locked(conn, ticket_num)
            self._set_run_setting_locked(conn, REOPEN_EPOCHS_SETTING, epochs)
            self._event_locked(
                conn,
                "ticket.reopened",
                {
                    "ticket": ticket_num,
                    "voidedAssignments": voided,
                    "attemptsResetFrom": epochs[str(ticket_num)],
                },
            )
            conn.commit()
        finally:
            conn.close()

        try:
            uncheck_task(self.tasks_path, ticket_num)
        except TasksMarkdownError as exc:
            if "is not checked" not in str(exc):
                raise PlanStoreError(str(exc)) from exc
        self._write_plan_json(self.current_plan())
        return {
            "ticket_num": ticket_num,
            "ticket_id": display_ticket(ticket_num),
            "voided_assignments": voided,
            "attempts_reset_from": epochs[str(ticket_num)],
            "next": "the ticket is claimable again by the next `actions` call",
        }

    def attempts_used(self, ticket_num: int) -> tuple[int, int]:
        """``(attempts since the last reopen, automatic budget)``."""
        conn = self._connect()
        try:
            used = self._attempts_used_locked(
                conn, ticket_num, self._attempt_epochs_locked(conn)
            )
        finally:
            conn.close()
        return used, MAX_ATTEMPTS_PER_TICKET

    def _attempt_epochs_locked(self, conn: sqlite3.Connection) -> dict[str, int]:
        raw = self._run_setting_locked(conn, REOPEN_EPOCHS_SETTING)
        if not isinstance(raw, dict):
            return {}
        return {str(key): int(value) for key, value in raw.items()}

    def _latest_attempt_locked(self, conn: sqlite3.Connection, ticket_num: int) -> int:
        row = conn.execute(
            "SELECT COALESCE(MAX(attempt), 0) AS n FROM execution_attempts "
            "WHERE job_id = ? AND ticket_num = ?",
            (self.job_id, ticket_num),
        ).fetchone()
        return int(row["n"])

    def _attempts_used_locked(
        self, conn: sqlite3.Connection, ticket_num: int, epochs: dict[str, int]
    ) -> int:
        return self._latest_attempt_locked(conn, ticket_num) - epochs.get(
            str(ticket_num), 0
        )


__all__ = ["BudgetStoreMixin"]
