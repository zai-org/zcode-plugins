"""Versioned local storage for Baton live plans."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from _ticket import TasksMarkdownError, Ticket, parse_tasks_md, validate_change_id

from orchestration.attempt_store import AttemptStoreMixin
from orchestration.plan_model import PlanRevision, PlanTicket, stable_hash, utc_now
from orchestration.result import ResultEnvelope
from orchestration.store_base import (
    VERIFICATION_COMMANDS_SETTING,
    ExecutionAttemptError,
    PlanStoreError,
    TERMINAL_ATTEMPT_STATES,
    _atomic_write,
    _pretty_json,
)
from orchestration.store_schema import init_db


class PlanStore(AttemptStoreMixin):
    """Persist plan revisions, execution attempts, and audit events.

    The plan face is an OpenSpec change: ``openspec/changes/<feature>/tasks.md``
    is re-read on every sync — edits (including baton's own ``[x]`` write-backs)
    produce a new plan revision. `queue.db` lives at
    `<project>/.dsh/baton/queue.db`; runtime snapshots live under
    `<project>/.dsh/baton/<feature>/`.
    """

    def __init__(self, project_path: str | Path, feature: str):
        self.project_path = Path(project_path).resolve()
        try:
            self.feature = validate_change_id(feature)
        except ValueError as exc:
            raise PlanStoreError(str(exc)) from exc
        self.job_id = self.feature
        self.baton_dir = self.project_path / ".dsh" / "baton"
        self.feature_dir = self.baton_dir / self.feature
        self.change_dir = self.project_path / "openspec" / "changes" / self.feature
        self.tasks_path = self.change_dir / "tasks.md"
        self.results_dir = self.feature_dir / "results"
        self.plan_path = self.feature_dir / "plan.json"
        self.db_path = self.baton_dir / "queue.db"

    def ensure_initial_plan(self, approved_by: str = "baton") -> PlanRevision:
        """Create revision 1 from existing Markdown tickets if needed."""
        self._ensure_dirs()
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            plan = self._ensure_initial_plan_locked(conn, approved_by)
            conn.commit()
        finally:
            conn.close()

        self._write_plan_json(plan)
        return plan

    def current_plan(self) -> PlanRevision:
        """Load the latest approved plan revision."""
        self.ensure_initial_plan()
        conn = self._connect()
        try:
            plan = self._load_current_plan_locked(conn)
            if plan is None:
                raise PlanStoreError("initial plan was not created")
            return plan
        finally:
            conn.close()











    def run_verification_commands(self) -> list[str]:
        """Return the verification commands persisted for this run, if any.

        The controller persists the commands on the first claim so every later
        packet for the run reuses them even when the CLI call that follows does
        not repeat ``--verify``.
        """
        self.ensure_initial_plan()
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT value_json FROM run_settings "
                "WHERE job_id = ? AND setting_key = ?",
                (self.job_id, VERIFICATION_COMMANDS_SETTING),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return []
        try:
            value = json.loads(row["value_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise PlanStoreError(
                f"run settings {VERIFICATION_COMMANDS_SETTING} are corrupt: {exc}"
            ) from exc
        if not isinstance(value, list):
            raise PlanStoreError(
                f"run settings {VERIFICATION_COMMANDS_SETTING} must be a list, "
                f"got {type(value).__name__}"
            )
        return [str(item) for item in value]

    def set_run_verification_commands(self, commands: list[str]) -> None:
        """Persist the run-wide verification commands (explicit override wins)."""
        normalized = [str(command) for command in commands]
        if not normalized:
            raise PlanStoreError("verification commands must not be empty")
        self.ensure_initial_plan()
        now = utc_now()
        payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO run_settings (job_id, setting_key, value_json, updated_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(job_id, setting_key) DO UPDATE SET "
                "value_json = excluded.value_json, updated_at = excluded.updated_at",
                (self.job_id, VERIFICATION_COMMANDS_SETTING, payload, now),
            )
            self._event_locked(
                conn,
                "run.settings.verification-commands",
                {"commands": normalized},
            )
            conn.commit()
        finally:
            conn.close()


    def result_envelopes(self) -> list[ResultEnvelope]:
        """Return persisted Result Envelopes for the current job."""
        self.ensure_initial_plan()
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT payload_json FROM result_envelopes "
                "WHERE job_id = ? ORDER BY created_at, envelope_id",
                (self.job_id,),
            ).fetchall()
            return [
                ResultEnvelope.from_dict(json.loads(row["payload_json"]))
                for row in rows
            ]
        finally:
            conn.close()

    def latest_completion(self) -> dict[str, Any]:
        """Check completion against the latest approved revision's required tickets."""
        plan = self.current_plan()
        required = {t.num for t in plan.tickets if t.required}
        status_by_num = {t.num: t.status for t in self._read_source_tickets()}
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT ticket_num FROM result_envelopes "
                "WHERE job_id = ? AND status = 'succeeded'",
                (self.job_id,),
            ).fetchall()
            for row in rows:
                status_by_num[int(row["ticket_num"])] = "resolved"
        finally:
            conn.close()
        missing = sorted(
            n for n in required if status_by_num.get(n) != "resolved"
        )
        return {
            "jobId": self.job_id,
            "revision": plan.revision,
            "complete": not missing,
            "missingRequiredTickets": missing,
        }

    def snapshot(self) -> dict[str, Any]:
        """Read the run state for a progress report — creating nothing.

        ``status`` must be safe to call on a project baton never ran, and must
        not leave runtime artifacts behind (a typo'd change-id is a read, not a
        write). It therefore never syncs a plan revision, never writes
        ``plan.json`` and never touches the database unless the store file
        already exists.
        """
        tickets = self._read_source_tickets()
        resolved = {ticket.num for ticket in tickets if ticket.status == "resolved"}
        attempts: list[dict[str, Any]] = []
        revision = 0
        if self.db_path.is_file():
            conn = sqlite3.connect(self.db_path, timeout=30)
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    "SELECT MAX(revision) AS revision FROM plan_revisions "
                    "WHERE job_id = ?",
                    (self.job_id,),
                ).fetchone()
                revision = int(row["revision"] or 0)
                attempts = [
                    self._execution_attempt_from_row(attempt_row).to_dict()
                    | {"claim_token": ""}
                    for attempt_row in conn.execute(
                        "SELECT * FROM execution_attempts WHERE job_id = ? "
                        "ORDER BY ticket_num, attempt",
                        (self.job_id,),
                    )
                ]
                resolved.update(
                    int(row["ticket_num"])
                    for row in conn.execute(
                        "SELECT ticket_num FROM result_envelopes "
                        "WHERE job_id = ? AND status = 'succeeded'",
                        (self.job_id,),
                    )
                )
            finally:
                conn.close()
        missing = sorted(ticket.num for ticket in tickets if ticket.num not in resolved)
        return {
            "revision": revision,
            "complete": not missing,
            "missingRequiredTickets": missing,
            "attempts": attempts,
        }

    def events(self) -> list[dict[str, Any]]:
        self.ensure_initial_plan()
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT event_type, created_at, payload_json FROM events "
                "WHERE job_id = ? ORDER BY id",
                (self.job_id,),
            ).fetchall()
            return [
                {
                    "eventType": row["event_type"],
                    "createdAt": row["created_at"],
                    "payload": json.loads(row["payload_json"]),
                }
                for row in rows
            ]
        finally:
            conn.close()

    def _ensure_dirs(self) -> None:
        self.baton_dir.mkdir(parents=True, exist_ok=True)
        self.feature_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        self._ensure_dirs()
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        init_db(conn)
        return conn

    def _read_source_tickets(self) -> list[Ticket]:
        """Parse the change's tasks.md — the single ticket source."""
        try:
            return parse_tasks_md(self.tasks_path)
        except TasksMarkdownError as exc:
            raise PlanStoreError(str(exc)) from exc

    @staticmethod
    def _tickets_hash(tickets: list[PlanTicket]) -> str:
        """Hash the ticket set for change detection.

        ``source_revision`` is projected out: candidates are parsed with the
        *next* revision number stamped in, so including it would make every
        sync look like a change (runaway revision creep).
        """
        def projection(ticket: PlanTicket) -> dict[str, Any]:
            data = ticket.to_dict()
            data["source_revision"] = 0
            return data

        return stable_hash([projection(t) for t in tickets])

    def _plan_tickets_from_source(self, revision: int) -> list[PlanTicket]:
        return [
            PlanTicket(
                num=parsed.num,
                title=parsed.title,
                what_to_build=parsed.what_to_build,
                blocked_by=parsed.blocked_by,
                status=parsed.status,
                criteria=[text for _, text in parsed.criteria],
                source_revision=revision,
            )
            for parsed in self._read_source_tickets()
        ]

    def _ensure_initial_plan_locked(
        self,
        conn: sqlite3.Connection,
        approved_by: str = "openspec/tasks.md",
    ) -> PlanRevision:
        """Sync the durable plan with the OpenSpec change's tasks.md.

        No plan yet → revision 1. tasks.md changed since the latest revision
        (human edits, added tasks, or baton's own ``[x]`` write-backs) → a
        fresh revision, so the next frontier reflects the current file. In-flight
        attempts keep their immutable packets and are never rewritten.
        """
        current = self._load_current_plan_locked(conn)
        candidate_revision = 1 if current is None else current.revision + 1
        tickets = self._plan_tickets_from_source(candidate_revision)
        if (
            current is not None
            and self._tickets_hash(tickets) == self._tickets_hash(current.tickets)
        ):
            return current

        now = utc_now()
        plan = PlanRevision(
            job_id=self.job_id,
            feature=self.feature,
            revision=candidate_revision,
            parent_revision=None if current is None else current.revision,
            plan_hash="",
            approved_by=approved_by,
            approved_at=now,
            created_at=now,
            tickets=tickets,
        )
        plan.plan_hash = stable_hash(plan.hashable_dict())
        self._insert_revision_locked(conn, plan)
        self._event_locked(
            conn,
            "plan.revision.initialized" if current is None else "plan.revision.updated",
            {
                "revision": plan.revision,
                "parentRevision": plan.parent_revision,
                "planHash": plan.plan_hash,
                "source": f"openspec/changes/{self.feature}/tasks.md",
            },
        )
        return plan


    def _load_current_plan_locked(
        self,
        conn: sqlite3.Connection,
    ) -> PlanRevision | None:
        row = conn.execute(
            "SELECT snapshot_json FROM plan_revisions "
            "WHERE job_id = ? ORDER BY revision DESC LIMIT 1",
            (self.job_id,),
        ).fetchone()
        if row is None:
            return None
        return self._plan_from_snapshot_json(row["snapshot_json"])

    def _plan_from_snapshot_json(self, snapshot_json: str) -> PlanRevision:
        """Materialize the plan revision stored in a snapshot."""
        return PlanRevision.from_dict(json.loads(snapshot_json))

    def _insert_revision_locked(
        self,
        conn: sqlite3.Connection,
        plan: PlanRevision,
    ) -> None:
        conn.execute(
            "INSERT INTO plan_revisions "
            "(job_id, feature, revision, parent_revision, plan_hash, approved_by, "
            "approved_at, created_at, snapshot_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                plan.job_id,
                plan.feature,
                plan.revision,
                plan.parent_revision,
                plan.plan_hash,
                plan.approved_by,
                plan.approved_at,
                plan.created_at,
                json.dumps(plan.to_dict(), ensure_ascii=False, sort_keys=True),
            ),
        )


    def _event_locked(
        self,
        conn: sqlite3.Connection,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        conn.execute(
            "INSERT INTO events "
            "(job_id, feature, event_type, created_at, payload_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                self.job_id,
                self.feature,
                event_type,
                utc_now(),
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ),
        )





    def _write_plan_json(self, plan: PlanRevision) -> None:
        _atomic_write(self.plan_path, _pretty_json(plan.to_dict()))


    def _result_envelope_id(self, envelope: ResultEnvelope) -> str:
        if envelope.assignment_id:
            return f"RE-{envelope.assignment_id}"
        return f"RE-{self.feature}-{envelope.ticket_num:03d}"

    def _write_result_envelope_json(
        self,
        envelope_id: str,
        envelope: ResultEnvelope,
    ) -> None:
        path = self.results_dir / f"{envelope_id}.json"
        _atomic_write(path, _pretty_json(envelope.to_dict()))
