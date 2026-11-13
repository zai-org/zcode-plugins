"""queue.db schema bootstrap — DDL plus the WAL busy-retry loop.

Split out of ``plan_store`` so the store's read/write logic is not buried
under ~120 lines of SQL. ``init_db`` is idempotent: every statement is
``IF NOT EXISTS``, so it is safe to run on every connect.
"""

from __future__ import annotations

import sqlite3
import time

SCHEMA_SQL = """\

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
              WHERE state IN ('leased', 'spawned', 'running', 'submitted',
                              'verifying', 'integrating', 'blocked-review');
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


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables/indexes idempotently and enable WAL.

    Wrapped in a short busy-retry loop: ``PRAGMA journal_mode=WAL`` and the
    schema DDL run inside ``executescript``, which does **not** honor the
    connection's ``timeout`` busy-wait. When two processes connect to a
    freshly-created database simultaneously, the second one's pragma collides
    with the first's lock and raises ``database is locked`` immediately rather
    than waiting. Retrying on that transient error lets schema bootstrap
    serialize cleanly instead of crashing the loser. The retry is bounded and
    short — once WAL + tables exist the script is a no-op.
    """
    last_err: Exception | None = None
    for _ in range(50):
        try:
            conn.executescript(SCHEMA_SQL)
            return
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower():
                last_err = exc
                time.sleep(0.02)
                continue
            raise
    # Exhausted retries — surface the original locked error.
    raise last_err  # type: ignore[misc]


__all__ = ["SCHEMA_SQL", "init_db"]
