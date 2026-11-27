"""queue.db schema bootstrap — DDL, the WAL busy-retry loop and the version gate.

Split out of ``plan_store`` so the store's read/write logic is not buried
under ~120 lines of SQL. ``init_db`` is idempotent: every statement is
``IF NOT EXISTS``, so it is safe to run on every connect.
"""

from __future__ import annotations

import sqlite3
import time

from orchestration.store_base import ACTIVE_ATTEMPT_STATES, PlanStoreError

#: Bump together with ``MIGRATIONS`` whenever ``queue.db`` needs a data change.
SCHEMA_VERSION = 1

_ACTIVE_STATES_SQL = ", ".join(f"'{state}'" for state in sorted(ACTIVE_ATTEMPT_STATES))

SCHEMA_SQL = f"""\

            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS plan_revisions (
              job_id TEXT NOT NULL,
              feature TEXT NOT NULL,
              revision INTEGER NOT NULL,
              parent_revision INTEGER,
              plan_hash TEXT NOT NULL,
              approved_by TEXT NOT NULL,
              approved_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              snapshot_json TEXT NOT NULL,
              PRIMARY KEY (job_id, revision)
            );
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL,
              feature TEXT NOT NULL,
              event_type TEXT NOT NULL,
              created_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_job
              ON events(job_id, id);
            CREATE TABLE IF NOT EXISTS result_envelopes (
              envelope_id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              feature TEXT NOT NULL,
              ticket_num INTEGER NOT NULL,
              assignment_id TEXT NOT NULL,
              plan_revision INTEGER NOT NULL,
              task_packet_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS execution_attempts (
              job_id TEXT NOT NULL,
              run_id TEXT NOT NULL,
              assignment_id TEXT NOT NULL,
              ticket_num INTEGER NOT NULL,
              attempt INTEGER NOT NULL,
              state TEXT NOT NULL,
              session_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              plan_revision INTEGER NOT NULL,
              task_packet_hash TEXT NOT NULL,
              claim_token_hash TEXT NOT NULL,
              lease_expires_at TEXT NOT NULL,
              base_branch TEXT NOT NULL,
              base_sha TEXT NOT NULL,
              worktree_path TEXT NOT NULL,
              worktree_branch TEXT NOT NULL,
              integration_path TEXT NOT NULL,
              integration_branch TEXT NOT NULL,
              packet_path TEXT NOT NULL,
              receipt_path TEXT NOT NULL,
              commit_sha TEXT NOT NULL,
              integration_sha TEXT NOT NULL,
              failure_code TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (job_id, assignment_id),
              UNIQUE(job_id, ticket_num, attempt)
            );
            CREATE INDEX IF NOT EXISTS idx_execution_attempts_job_state
              ON execution_attempts(job_id, state, ticket_num);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_attempts_one_active_ticket
              ON execution_attempts(job_id, ticket_num)
              WHERE state IN ({_ACTIVE_STATES_SQL});
            CREATE TABLE IF NOT EXISTS run_settings (
              job_id TEXT NOT NULL,
              setting_key TEXT NOT NULL,
              value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (job_id, setting_key)
            );
            CREATE INDEX IF NOT EXISTS idx_result_envelopes_job
              ON result_envelopes(job_id, ticket_num);
"""

#: ``MIGRATIONS[n]`` brings a database from ``user_version`` n to n + 1.
MIGRATIONS: list[tuple[str, ...]] = [
    (
        # States earlier releases listed but never wrote on the live path;
        # map them onto the states the current machine actually has.
        "UPDATE execution_attempts SET state = 'spawned' "
        "WHERE state IN ('running', 'submitted')",
        "UPDATE execution_attempts SET state = 'integrating' "
        "WHERE state = 'verifying'",
        "UPDATE execution_attempts SET state = 'abandoned' "
        "WHERE state IN ('failed', 'canceled')",
    )
]


def _retry_while_locked(run) -> None:
    """Run ``run`` under a short busy-retry loop.

    ``PRAGMA journal_mode=WAL`` and the schema DDL run inside
    ``executescript``, which does **not** honor the connection's ``timeout``
    busy-wait. When two processes connect to a freshly-created database
    simultaneously, the second one's pragma collides with the first's lock and
    raises ``database is locked`` immediately rather than waiting. Retrying on
    that transient error lets schema bootstrap serialize cleanly instead of
    crashing the loser. The retry is bounded and short — once WAL + tables
    exist the script is a no-op.
    """
    last_err: Exception | None = None
    for _ in range(50):
        try:
            run()
            return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower():
                raise
            last_err = exc
            time.sleep(0.02)
    # Exhausted retries — surface the original locked error.
    raise last_err  # type: ignore[misc]


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables/indexes idempotently, enable WAL, run migrations.

    A ``queue.db`` written by a newer baton (``user_version`` above what this
    code understands) fails loud before anything is written to it. Migrations
    are idempotent statements, so two processes racing the same upgrade both
    succeed.
    """
    # The gate comes first: a store this baton does not understand must not
    # be written to, not even by "idempotent" DDL.
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if version > SCHEMA_VERSION:
        raise PlanStoreError(
            f"queue.db uses schema version {version}, but this baton understands "
            f"at most {SCHEMA_VERSION}; upgrade baton before running this change",
            code="schema-too-new",
        )
    _retry_while_locked(lambda: conn.executescript(SCHEMA_SQL))
    if version == SCHEMA_VERSION:
        return

    def migrate() -> None:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for step in MIGRATIONS[version:]:
                for statement in step:
                    conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise

    _retry_while_locked(migrate)


__all__ = ["MIGRATIONS", "SCHEMA_SQL", "SCHEMA_VERSION", "init_db"]
