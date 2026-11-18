# Baton Orchestration Layer

This folder contains the local control-plane primitives for Baton.

- `plan_model.py` defines the shared plan data contracts (`PlanTicket`,
  `PlanRevision`) and the `utc_now`/`stable_hash` helpers used across the
  durable store.
- `plan_store.py` owns versioned persistence, SQLite event logging, the
  run-wide verification settings, sealed result envelopes, completion facts,
  the read-only `snapshot()` behind `status`, and the sync from the OpenSpec
  change's `tasks.md` into plan revisions (edits and baton's own `[x]`
  write-backs each produce a new revision).
- `attempt_store.py` is the attempt lifecycle mixin of `PlanStore` (claim,
  lease + expiry, agent binding, state transitions, finalize). It imports
  `store_base` only — never `plan_store` — so the dependency stays one-way.
- `store_base.py` holds the store errors/terminal states and the atomic JSON
  write helper shared by both modules.
- `store_schema.py` holds the `queue.db` DDL and its WAL busy-retry loop.
- `session_controller.py` is the deterministic session-subagent state machine:
  actions, native-agent binding, sealed-receipt reconciliation, integration,
  recovery, and latest-plan completion. This is the **sole** execution
  scheduler — the CLI delegates to it.
- `session_model.py` holds the action-batch models (dispatch / recover /
  resolve_merge / wait / blocked / complete) and Task Packet finalization.
- `integrator.py` merges sealed assignment branches serially into the
  integration worktree, preserving conflicts for `resolve_merge`.
- `worktree.py` prepares isolated per-assignment worktrees + the shared
  integration worktree.
- `receipt.py` / `result.py` define the sealed-receipt evidence model.

The former cognitive layer (`complete.py`, `grill.py`, `brief.py`,
`planner.py`, `approval.py`, `delta_grill.py`) and the amendment engine
(`amendment.py`, `impact.py`, `coordinator.py`) were removed in v5: the
OpenSpec workflow is the cognitive protocol, and live-plan edits are plain
`tasks.md` edits picked up as new revisions. The legacy driver kernel
(`dispatcher.py` / `router.py` / `registry.py` / `verifier.py`) was removed
with them.

Conventions:

- Keep these modules standard-library only.
- Do not import external agent runtimes from here.
- Treat the change's tasks.md and `queue.db` as shared local state; updates
  must be versioned and auditable.
