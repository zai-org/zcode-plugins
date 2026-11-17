# Baton Architecture — The Deterministic Control Plane Is the Core IP

> This document explains why baton is not "scaffolding" but the deterministic
> layer that makes session-subagent execution safe.

## Each System's Strengths

**Baton's `SessionController`** (`scripts/orchestration/session_controller.py`):
- Strength: deterministic scheduling. It owns claim, lease, worktree, receipt
  verification, integration, recovery, and completion. The model never decides
  ticket state.
- It is the **sole** execution scheduler — the CLI delegates to it.

**OpenSpec** (the plan face):
- Strength: spec-driven decomposition. A change carries a `proposal.md`
  (why/what, human-approved) and a `tasks.md` checklist (sections = phases,
  `N.M` tasks), each task fitting one context window.
- Weakness: it does not execute; it only produces `.md` files.

**Native session subagents** (DSH `subagent` tool):
- Strength: real isolated context per task, full tool access, report back to
  the main session.
- Weakness: free-text output is unreliable for state decisions; a model saying
  "done" is not evidence.

The granularity aligns: **one assignment ≈ one task** (both "doable in one
context window").

## The Three Breaks (the reason baton exists)

| # | Break | Symptom | baton solution |
|---|---|---|---|
| 1 | **Dependency** | tasks have a section-order DAG; what runs next must respect it | `SessionController.actions()` computes the frontier fresh on every call and atomically claims distinct unchecked tasks |
| 2 | **Concurrency** | ≤5 parallel tasks must not collide on a shared workspace | one isolated git worktree per assignment; serial integration under a repository-scoped lock |
| 3 | **State** | a subagent finishing is not the same as a task being done | a **sealed receipt** (verification commands run green in the worktree) is the only accepted success evidence; the controller integrates the branch, finalizes the attempt, and flips the task's `[x]` in tasks.md |

### Why the sealed receipt solves the state problem

A subagent's terminal lifecycle event (`completed`/`failed`/`canceled`) is **not**
success. `reconcile` only honors a sealed receipt written by
`scripts/receipt.py verify`/`seal` — which re-runs the packet's declared
verification commands on a clean, advanced HEAD in the assignment worktree. A
terminal event without a sealed receipt flips the attempt to `unknown` and
returns a `recover` action. It is never silently marked successful.

A sealed receipt is hash-bound local evidence (packet hash, claim-token hash,
clean advanced HEAD, exit-0 verification results). `seal` digests the whole
envelope body — canonical JSON (sorted keys, no whitespace, `receiptHash`
excluded) — into `receiptHash`, and `reconcile` recomputes it from the file
*before* merging: an edited `exitCode`, `changed_files`, `commit_sha`, or any
other field is rejected with a non-zero exit and the changed segment named. The
receipt's ticket/assignment/revision are also checked against the attempt
before integration, so a receipt for another ticket can never leave an attempt
stuck in `integrating`. It bounds state transitions; it is not a cryptographic
guarantee against a subagent that edits files directly (the digest has no
secret).

### Why leases are fixed at 7200 s

A claim's lease is **7200 s (2 h)** — there is no CLI flag and no renewal entry
point (the constructor takes an override, used by tests only). `expire_execution_attempts()` runs before every batch: an
attempt whose lease ran out is marked `unknown` with
`failure_code=lease-expired`, and its ticket is claimable again on that same
`actions()` call (the retry supersedes the stale attempt). A ticket that
legitimately needs longer than two hours therefore always surfaces as
`lease-expired` and is re-dispatched instead of silently deadlocking.

### Why isolated worktrees solve the concurrency problem

Each assignment gets its own branch + worktree
(`<project>-baton-<change>-tic-NNN-aNN`). A shared integration worktree
(`<project>-baton-<change>-integration`) merges sealed branches serially under
a repository-scoped lock. Merge conflicts are **preserved** (never auto-aborted) and
surfaced as `resolve_merge` actions for a dedicated subagent to resolve.

## The Loop

```
main session (mechanical forwarder)
  ├─ actions      → session_control.py <project> <change> actions
  │                 SessionController.actions(): recover/reconcile sealed receipts,
  │                 claim frontier, prepare worktrees + packets, return action batch
  ├─ for each dispatch: subagent(prompt, cwd) → agent_id
  ├─ bind         → bind the agent_id to the assignment
  ├─ wait         → wait for the subagent terminal lifecycle event
  └─ reconcile    → session_control.py <project> <change> reconcile ...
                    sealed receipt → succeeded + integrated; otherwise unknown + recover
```

The main session adds **no** orchestration of its own. It forwards the
deterministic actions verbatim and reports objective lifecycle events back.
The cognitive phase is the project's OpenSpec workflow — baton has no
self-built Grill/Brief/approval state machine.

## Module Dependencies

```
session_controller.py ──→ plan_store.py (durable: queue.db)
   │   │   │   │
   │   │   │   └──→ relay.py (read-only liveness judgments)
   │   │   └──→ integrator.py ──→ worktree.py (git)
   │   └──────→ receipt.py (verify/seal — the subagent CLI)
   └──────────→ session_model.py (action/attempt contracts)
plan_store.py ──→ _ticket.py (OpenSpec tasks.md parser)
ticket_board.py ──→ _frontier.py (DAG frontier, observability only)
session_control.py ──→ session_controller.py (thin CLI adapter)
```

- `plan_store.py`: durable plan store (`queue.db`) — plan revisions (synced
  from tasks.md edits), execution attempts, leases, sealed receipts,
  completion facts.
- `relay.py`: read-only relay judgments — elapsed vs the lease budget,
  receipt existence, worktree/heartbeat liveness, the suggested action, and
  the abandon guard verdict; feeds `status` and the abandon guard without
  writing state.
- `_ticket.py`: OpenSpec tasks.md parsing — the ticket source the plan store
  reads on every sync.
- `_frontier.py`: DAG frontier — used by `ticket_board.py` to label claimable
  cards; the controller claims through `plan_store.py` instead.

## Why the plan face is OpenSpec tasks.md

- The user's projects already live in the OpenSpec workflow
  (`openspec/changes/<id>/`): proposal → approval → tasks → archive. Baton
  adopts it as-is instead of inventing a parallel ticket format.
- Sections are phases in real tasks.md files; making section order the
  dependency order (earlier sections block later ones; tasks within a section
  are parallel) is the safe default and needs zero extra syntax.
- Checkbox state is the status: `[x]` resolved, `[ ]` ready. Baton's only
  write-back is flipping a checkbox on integration — no dual status fields to
  drift.

See [ticket-format.md](ticket-format.md) for the exact parsing rules.

## History

- **v1** — external `ralph.sh` bash loop spawning headless `zcode -p`.
- **v2** — loop moved into Python (`SerialExecutor`/`ParallelExecutor`), still headless subprocesses.
- **v3** — subprocesses replaced by subagents, but coordination used a shared PRD + `passes:true` flags. This caused overwrite-induced ticket loss, batches mis-marked complete, and double-writes.
- **v4** — `SessionController` is the sole deterministic scheduler. No PRD, no `passes` flags, isolated worktrees, sealed receipts, capacity-≤3 sliding window (3 was the cap at the time; the whole repository is ≤5 now). Ralph permanently retired.
- **v5** — OpenSpec is the single plan face: tasks.md is the ticket source, the self-built cognitive layer (CompleteFlow/Grill/Brief/Planner/Approval) and the amendment engine are retired, and live-plan edits are plain tasks.md edits picked up as new plan revisions.
- **v6 (current)** — the local MCP adapter is dropped: the CLI is the only control surface while the plugin is still iterating (same history as README.md).
