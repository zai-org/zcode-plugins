# Baton Orchestration Layer

This folder contains the local control-plane primitives for Baton.

- `session_controller.py` is the deterministic session-subagent state machine:
  the `actions` two-pass loop (reconcile sealed receipts, then resolve stale
  attempts and claim), `reconcile`, `status` and agent binding. This is the
  **sole** execution scheduler — the CLI delegates to it. The class is
  assembled from the focused mixins below; none of them import it back.
- `receipt_flow.py` reconciles sealed receipts: verify the receipt, integrate
  the branch, **verify the merged tree**, finalize. It also guards a ticket
  whose text changed under a running attempt and keeps a red integration HEAD
  from silently passing for healthy.
- `lease_flow.py` moves each lease to its latest activity, judges retry
  budgets and builds the `recover` actions (what is known, which agent, where
  the worktree is, what to do next).
- `dispatch_flow.py` prepares the assignment worktree, writes the immutable
  packet and renders the dispatch prompt.
- `operator_flow.py` holds the operator verbs: `abandon`, `adopt`, `reopen`.
- `run_settings.py` resolves and persists what a run remembers between calls
  (verification commands, capacity, base branch) and reports how the
  integration branch relates to its base branch.
- `plan_model.py` defines the shared plan data contracts (`PlanTicket`,
  `PlanRevision`) and the `utc_now`/`stable_hash` helpers used across the
  durable store.
- `plan_store.py` owns versioned persistence, SQLite event logging, the
  run-wide settings, sealed result envelopes, completion facts, the read-only
  `snapshot()` behind `status`, and the sync from the OpenSpec change's
  `tasks.md` into plan revisions (edits and baton's own `[x]` write-backs each
  produce a new revision).
- `attempt_store.py` is the attempt lifecycle mixin of `PlanStore` (claim,
  lease expiry, agent binding, state transitions, finalize). It imports
  `store_base` only — never `plan_store` — so the dependency stays one-way.
- `budget_store.py` is the other half of that persistence: lease renewal (with
  the hard-cap restart), `attempts_used`, and `reopen` with the per-ticket
  attempt epoch that a reopened ticket's budget is counted from.
- `store_base.py` holds the store errors, the attempt-state vocabulary, the
  retry budget, the run-setting keys and the atomic JSON write helper shared by
  both store modules.
- `store_schema.py` holds the `queue.db` DDL (the active-state index is
  generated from the vocabulary), the WAL busy-retry loop and the schema
  version gate with its migrations.
- `session_model.py` holds the action-batch models (dispatch / recover /
  resolve_merge / repair_integration / wait / blocked / complete),
  `ExecutionAttempt`, `SessionControllerError` and Task Packet finalization.
- `integrator.py` merges sealed assignment branches serially into the
  integration worktree, verifies each merged tree and records the outcome per
  integration HEAD, and preserves conflicts for `resolve_merge`.
- `relay.py` produces the read-only liveness judgments behind `status` and the
  abandon guard; `activity_epoch` is also what renews a lease.
- `worktree.py` prepares isolated per-assignment worktrees + the shared
  integration worktree, re-aligns a reused integration branch with its base,
  keeps the runtime directory out of the target repo, and cleans up worktrees
  and merged branches.
- `receipt.py` / `result.py` define the sealed-receipt evidence model; the
  verification runner there is the one both `seal` and the integrator use.
- `git_run.py` is the single git subprocess wrapper; every git call in
  `scripts/` goes through it.

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
- Attempt states live in exactly one place (`store_base.ACTIVE_ATTEMPT_STATES`
  and its siblings); a state nothing writes does not exist.
