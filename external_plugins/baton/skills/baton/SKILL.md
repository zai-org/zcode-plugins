---
name: baton
description: baton 接力调度——用确定性 ticket/DAG 控制面执行已批准的 OpenSpec change。当用户说「跑 baton」「跑一下 baton」「baton status」「用 baton 排活」「派活」「派发任务」「把这个 OpenSpec change 跑完」或问 baton 能不能排活时使用；本地 CLI 返回确定 actions，会话派发给隔离 worktree 子代理，合并后的集成结果由控制器复验全绿才算完成。Also use when the user says "run baton", "baton status", or wants an OpenSpec change executed with verified integration.
whenToUse: The user mentions baton in any phrasing (跑 baton / baton status / 排活 / 派活 / dispatch) or wants an approved OpenSpec change executed or inspected in a git project.
---

# Baton

Baton is the **sole ticket / DAG / session-subagent control plane over OpenSpec
changes**. The main session is a mechanical forwarder: it never decides ticket
state itself. It forwards the deterministic `actions` the CLI returns to native
subagents verbatim, binds each returned agent id, and reports the terminal event
back via `reconcile`. Free-text subagent output is ignored; a ticket is done
only when its **sealed receipt** verifies *and* the controller re-runs the
verification commands on the merged integration branch and they pass.

## Invocation

`<baton-root>` is the directory containing this plugin's `package.json` (two
levels above this `SKILL.md`). Relative doc paths below are written against that
root, not the skill directory.

## Host tools

Baton runs on any host that can spawn subagents. The loop below is written with
the DSH tool names; on ZCode substitute per this table.

| Need | DSH | ZCode |
|---|---|---|
| Spawn a child | `subagent(prompt, cwd, description)` | `Agent(description, prompt)` — omitting `subagent_type` gives the general-purpose agent; there is no `cwd` argument, and the dispatch prompt names the worktree to work in |
| Agent id for `bind` | the id returned by `subagent` | the `agent_<uuid>` returned by `Agent` |
| Completion notice | DSH settlement notice (prose) | the background task notification for that agent id |
| Inspect or steer a running child (optional) | `list_agents` / `send_message` | `SendMessage` |
| Stop a running child (only when an action or warning tells you to) | DSH's cancel | `TaskStop` with that agent's task id |

`<python>` is a Python 3.10+ interpreter: `python3` on macOS/Linux, `python` on
Windows.

`<cli>` is `<python> <baton-root>/scripts/session_control.py`. Every verb prints
one JSON object. Success is `{"ok": true, "command": "<verb>", ...}` with
snake_case keys. A domain failure exits non-zero with
`{"ok": false, "command", "code", "error"}` — no traceback. `code` is stable
(`verification-unconfigured`, `tasks-md-invalid`, `abandon-refused`,
`unknown-assignment`, …) and anything you must act on is a field of its own
(for example `refusal`), never JSON inside a string. Quote project paths. If
the harness truncates stdout, write the batch to `.dsh/baton/batch.json` and
read that file.

| Verb | Contract |
|---|---|
| `actions --session-id <id> [--capacity 1-5] [--base-branch <branch>]` | claim + return an action batch. `--session-id` is **required**. `--capacity` and `--base-branch` are declared once and remembered by the run; omit them on later calls to reuse the stored values |
| `bind <assignment_id> <claim_token> <agent_id>` | bind a spawned child to its assignment |
| `reconcile <assignment_id> <claim_token> --agent-terminal completed\|failed\|canceled --session-id <id> [--reason "<why>"]` | turn a terminal event into a sealed receipt; returns the next batch. `--reason` is your one-line account of why a child ended without a receipt — recorded for diagnosis only |
| `status` | read-only progress snapshot (each attempt carries a `relay` judgment: elapsed / lease budget / receipt / liveness + `suggested_action`) |
| `cleanup [--include-integration] [--dry-run]` | remove a finished run's worktrees and the branches that provably merged |
| `abandon <assignment_id> [--reason "<why>"] [--force]` | retire a stuck attempt (guarded — refused while it is plausibly still working, see "Taking over a run") |
| `adopt <assignment_id>` | revive an abandoned or superseded attempt whose sealed receipt arrived late: re-verify + integrate |
| `reopen <N.M>` | re-run a finished ticket: void its succeeded receipts so the next `actions` claims it again (also restarts a spent retry budget) |

`--verify "<cmd>"` is a **top-level** flag (before the verb, repeatable). The
first claim **must** declare the change-wide verification commands: there is no
implicit `git diff --check` fallback, and an unconfigured run fails loud.
They are persisted with the run, so later packets (including ones prepared by
`reconcile`) reuse them; passing `--verify` again is an explicit override for
new packets. The commands run in a plain shell that inherits this process's
environment (no login shell), so `python3` and friends resolve exactly as they
do for the session and the subagents.

Every batch also carries `warnings`: loud, non-blocking notices. Relay them to
the user, and act on these two:

- `lease-expired-retried` with an `agent_id` — that older subagent may still be
  running on a ticket that was just retried. Stop it.
- `resolved-but-unchecked` — tasks.md shows `[ ]` for tickets a receipt already
  delivered; baton will not re-run them. Offer `reopen <N.M>` if that is wanted.
- `integration-sync-failed` — the integration branch should have been
  fast-forwarded to the base but was not (its worktree is dirty); new
  assignments build on the stale tip until it is cleaned.

## The loop

**Responsibility**: drive the deterministic session-subagent loop until every
required task of the change is verified and integrated.

### Prerequisites

- Baton is installed (this skill is mounted, and
  `<baton-root>/scripts/session_control.py` exists).
- The host provides a subagent tool — `subagent` on DSH, `Agent` on ZCode (see
  "Host tools"). The inspect / steer / stop tools are only needed for a running
  child.
- The target project is a **git repository** — its root, not a directory
  inside another repository (baton refuses that instead of silently creating
  branches in the enclosing repo) — with an OpenSpec change at
  `<project path>/openspec/changes/<change-id>/` containing `proposal.md` and a
  `tasks.md` with at least one unchecked `- [ ] N.M` task whose section
  predecessors are all checked.

### Steps

1. **`actions`** to get the first batch:

   ```bash
   <cli> "<project path>" <change-id> --verify "<cmd>" actions \
     --session-id <id> --capacity 1 --base-branch main
   ```

   Returns `{ok, command, run_id, generation, state, actions:[...], warnings:[...]}`.
   State the chosen capacity before raising it above 1.

2. **Handle every action in the batch**:
   - `dispatch` → `subagent(prompt=action.prompt, cwd=action.cwd,
     description="<change> ticket <num>")`, then immediately
     `<cli> "<project path>" <change-id> bind <assignment_id> <claim_token> <agent_id>`.
   - `resolve_merge` → `subagent(prompt=action.prompt, cwd=action.cwd,
     description="<change> merge <assignment_id>")`. It resolves the preserved
     conflict and commits the merge; the controller then verifies the merged tree.
   - `repair_integration` → same handling as `resolve_merge`. The merged tree
     failed the run's verification commands (two tickets that were green alone,
     or a conflict resolution); the subagent fixes the integration branch where
     it stands and commits.
   - `wait` → nothing to spawn; end the turn and wait for outstanding notices.
   - `recover` → no sealed receipt, so the outcome is unknown. A `lease-expired`
     recovery with budget left is retried automatically (the next claim
     supersedes the stale attempt and `warnings` announces it). Any other
     `recover` needs a decision; `detail` says what is known and `next` lists
     the ready steps. **Never** mark it succeeded.
   - `blocked` → report the block code and reason. A blocked batch may still
     re-issue the dispatch of an unbound claim; it never carries a new claim.
     When the action carries an `agent_id`, that subagent is working on
     something the block made obsolete — stop it before retiring the attempt.
     `retry-budget-spent` names a ticket that used its attempts: nothing is
     dispatched for it until `reopen <N.M>`.
   - `complete` → every required ticket has a verified, integrated receipt. Run
     `status` for the final summary and stop.

3. **On each child's completion notice**, `reconcile`. DSH settlement notices
   are prose, not a status enum — map them explicitly (ZCode's task notification
   maps the same way): "finished" → `completed`;
   stopped / canceled / interrupted → `canceled`; failed / "ran out of room" /
   declined / abnormal → `failed`.

   ```bash
   <cli> "<project path>" <change-id> reconcile \
     <assignment_id> <claim_token> --agent-terminal completed --session-id <id>
   ```

   Reconcile honors only a sealed receipt written by
   `<baton-root>/scripts/receipt.py seal` in the assignment worktree. Any other
   terminal event flips the attempt to `unknown` and returns `recover`. When a
   child ended without a receipt, pass what its final report said:

   ```bash
   <cli> "<project path>" <change-id> reconcile \
     <assignment_id> <claim_token> --agent-terminal failed --session-id <id> \
     --reason "<one line from the child's final report>"
   ```

   A receipt that fails verification (edited on disk, written for another
   ticket) is rejected before any merge and comes back as a `recover` with
   reason `receipt-invalid`; the rest of the batch is unaffected.

4. **Process the batch `reconcile` returns directly.** Call `actions` again only
   when starting a run or resuming after a restart. Continue until a batch
   contains `complete`.

If a batch produces only running children, end the turn and wait for their
completion notices instead of polling.

### Concurrency

- Capacity 1 is strictly serial. Capacity 2–5 dispatches that many isolated
  worktrees in parallel; integration into the shared worktree is serialized
  under a repository-scoped lock, and **each merge is verified on the merged
  tree** before the attempt is finalized.
- Merge conflicts are preserved (never auto-aborted) and surfaced as
  `resolve_merge` actions.
- Never exceed capacity 5 (the controller rejects it) and never spawn more
  children than the batch returned `dispatch` actions for.

### Completion and cleanup

At `complete` the controller auto-removes the per-assignment worktrees
(`baton/<feature>-tic-*`) and every assignment branch whose commits are in the
integration branch; both are listed in `worktrees_removed`, `worktrees_skipped`,
`branches_deleted` and `branches_kept` (an abandoned attempt's unmerged branch
is kept for audit). The `complete` action also reports `write_back`: baton's
`[x]` flips are an **uncommitted edit in the project's main working tree** and
the integration branch does not carry them — commit tasks.md together with
merging `baton/<feature>` into the base branch.

The shared integration worktree (`baton/<feature>`) is left in place: merge it
into the base branch, then remove it with `cleanup --include-integration`,
which also deletes that branch once it is merged.

`cleanup` never touches the project's main working tree, never force-removes a
dirty worktree (it skips and reports), and never deletes an unmerged branch (it
keeps and reports it). `--dry-run` lists what it would remove. A change-id that
never ran fails with `no baton worktrees or branches found` instead of an empty
success.

### Taking over a run (relay)

A handed-off run's subagents may still be working. A **clean worktree mid-ticket
is normal** — the subagent flow is write → verify → commit → seal, so nothing is
committed until the end — and a receipt only exists after that whole pipeline.
"No receipt yet" inside the lease is not a death verdict; "the completion notice
was lost" in a handoff note is an assumption, not evidence.

Before judging any in-flight attempt, run `status` and read its `relay` block:
`elapsed_sec`, `lease_remaining_sec`, `lease_elapsed_fraction`, `receipt_exists`,
worktree signals (`heartbeat_age_sec`, `last_activity_age_sec`, `dirty`,
`exists`) and the `suggested_action`. Then follow it mechanically:

- **`wait`** (active, lease healthy, no receipt, no failure evidence) → end the
  turn and wait for the completion notice; `reconcile` only needs
  `assignment_id` + `claim_token`, which the batch already gave you. Do not
  abandon.
- **`wait-lease-nearly-spent`** → keep waiting; an expired lease recovers by
  itself (the next `actions` supersedes the attempt and re-dispatches, up to
  the retry budget).
- **`dispatch`** (claimed but no agent bound yet) → call `actions`; it hands you
  that assignment's dispatch again, whichever session you are.
- **`reconcile`** (active attempt, sealed receipt on disk) → the notice may have
  beaten you to it; reconcile or just run `actions` (it auto-reconciles sealed
  receipts).
- **`adopt`** (abandoned or superseded attempt, sealed receipt on disk) → the
  subagent finished *after* its attempt was retired. Run `adopt <assignment_id>`;
  it re-verifies the receipt and integrates it. If a newer attempt for the same
  ticket already sealed its own evidence, adopt refuses and lists both — pick
  one deliberately (keep the successor, or abandon it and adopt the earlier
  attempt). If a successor is still in flight, stop it first.
- **`repair-integration`** (parked on a red merge) → run `actions`; it returns
  the `repair_integration` action.
- **`decide` / `resolve-or-abandon` / `await-expiry`** → the failure is already
  on record (`unknown`, `blocked-review`, expired lease); treat as above.

### Leases and retries

A claim's lease is **7200 s of silence**, not of wall clock. The subagent is
told to refresh a heartbeat file after each milestone, and baton also reads its
worktree: a fresh heartbeat, a freshly edited file or a new commit moves the
deadline. Activity can keep an attempt alive for at most three leases (6 h);
after that it is judged `lease-expired` whatever it is doing.

An expired attempt is retried automatically — up to **3 attempts per ticket**.
Each retry is announced in `warnings` (`lease-expired-retried`, with the stale
attempt's `agent_id`). When the budget is spent, the `recover` says so and
needs an operator: `reopen <N.M>` grants a fresh budget, or the ticket is left
alone. The budget counts every attempt of a ticket, and a ticket that spent it
stays visible as `blocked: retry-budget-spent` — it never silently drops out
of the run.

### Abandon a stuck attempt (guarded)

```bash
<cli> "<project path>" <change-id> abandon <assignment_id> [--reason "<why>"] [--force]
```

The operator escape hatch for an attempt that can no longer progress (a
non-retryable `recover`, or a receipt rejected as tampered). It **destroys** the
attempt's lease and its eligibility for reconcile — any later receipt from that
assignment is ignored unless explicitly revived with `adopt`. It **preserves**
the worktree, branch, commits, packet and receipt on disk for audit; it reverts
and merges nothing. The ticket becomes claimable again on the next `actions`
call. The command prints `destroys` / `preserves` so the consequence is
explicit, and `attempts_used` / `attempts_max`; when the budget is already
spent, `next` says that `reopen <N.M>` is what makes the ticket claimable again.

**Guard**: abandoning an attempt that is plausibly still working — active state,
no failure evidence, no sealed receipt, less than 80% of its lease spent — is
**refused** with the full judgment data (`code: abandon-refused`, `refusal:
{elapsed, lease remaining, liveness signals, advice}`). Read it, then either do
as advised or pass `--force`. The hatch stays free where it is actually needed:
`unknown` outcomes, `blocked-review`, expired leases and terminal states are
never guarded.

### Adopt a late sealed receipt

```bash
<cli> "<project path>" <change-id> adopt <assignment_id>
```

The reverse hatch for the case abandon got wrong, and for its automatic
counterpart: the retired subagent (abandoned, or superseded by a lease retry)
turned out to be alive and sealed a valid receipt afterwards. `adopt` fully
re-verifies the receipt (body digest, claim token, packet hash, identity)
*before* any state changes, then integrates it through the normal path — the
ticket lands with zero re-work. A receipt that fails verification leaves the
attempt retired. A merge conflict still parks the attempt in `blocked-review`
and reports the follow-up, exactly like a normal reconcile. While the
integration branch is red, the revived receipt is verified but waits, and
`follow_up` says so; it lands on the next `actions` after the repair.

### Reopen a finished ticket

```bash
<cli> "<project path>" <change-id> reopen <N.M>
```

A succeeded receipt resolves a ticket for good — baton does not re-run it just
because the checkbox was unchecked (it says so in `warnings` and in `status`'s
`resolved_but_unchecked` instead). `reopen` voids those receipts, unchecks the
task and restarts the ticket's retry budget, so the next `actions` claims it
again. It is refused while an attempt for the ticket is still active: retire
that one with `abandon` first.

## Status

```bash
<cli> "<project path>" <change-id> status
```

Returns `{ok, command, run_id, feature, project_path, revision, complete,
missing_required_tickets, resolved_but_unchecked, attempts:[...]}`. Each
attempt carries a `relay` block — the mechanical alive/dead judgment
(`elapsed_sec`, `lease_remaining_sec`, `lease_elapsed_fraction`,
`receipt_exists`, worktree liveness signals, `suggested_action`) that "Taking
over a run" tells you to read before deciding to wait or to abandon.

`status` writes nothing: it creates no plan revision, no runtime directory and
no `plan.json`, so it is safe on a project that never ran (and on a mistyped
change-id, which still fails loud with the missing-tasks.md error). `revision:
0` therefore means "no plan revision recorded yet"; the first `actions` call
creates revision 1. Completion comes from the plan store's ticket check against
the latest plan revision — not from any PRD `passes` flags.

## Editing the plan (live plan)

Add, reorder or split tasks by editing the change's `tasks.md`. The next
`actions` call records a new plan revision and recomputes the frontier.

- A running assignment keeps its original `planRevision` and `taskPacketHash`;
  packets are immutable.
- **Editing the text of a task that is still in flight parks its attempt**
  (`blocked: ticket-redefined`, with the old and new text): the subagent is
  implementing the old wording. Restore the original text to let it resume, or
  `abandon` it so the ticket is re-claimed under the new definition. A receipt
  sealed under the old text is never integrated against the new one.
- Removing a task that is in flight parks its attempt the same way
  (`blocked: ticket-removed`).
- Completion is judged against the latest revision, so every unchecked task in
  the final `tasks.md` must be delivered.
- Tasks added to an earlier section block later sections; keep runtime additions
  in a trailing section unless they must gate pending work.

Mapping (`docs/ticket-format.md` is authoritative — it has the exact parsing
rules, the section-order DAG and the write-back contract):

- change → feature; task `N.M` → ticket (`num = N*100 + M`)
- `[x]` = resolved, `[ ]` = ready; there is no draft state
- task `N.M` is blocked by every task in earlier sections; tasks inside one
  section are independent (parallel frontier)
- every top-level checkbox in a section is a ticket and needs an `N.M` id; one
  without an id (or an indented one that carries an id) fails loud
- verification is change-wide via `--verify`, not per task
- an integrated receipt flips the checkbox to `[x]` in `tasks.md`
- reopening a change after its branch was merged: the integration branch is
  fast-forwarded to the base branch before new work starts from it (a warning
  reports it; a branch that still holds unmerged work is only reported, never
  moved)

## Runtime directory layout

Only what the loop needs to name; the rest lives in `AGENTS.md`.

```
<project>/.dsh/baton/
|-- queue.db                  durable plan store (name kept for compatibility)
|-- runs/<assignment_id>/     packet.json / verification.json / receipt.json
`-- <change-id>/              plan.json / results/
```

Baton appends `.dsh/baton/` to the repository's `info/exclude` (a local,
untracked file), so its runtime state never shows up in `git status` and is
never staged by a blanket `git add -A`. A tracked `.gitignore` is never touched;
when the project already ignores `.dsh/`, nothing is written.

`openspec/changes/<change-id>/tasks.md` is the plan face. There is no
`prd-<feature>.json` on the active path; historical `prd.json` files are inert
and must not be used to judge completion.

## Troubleshooting

- **"No receipt + a clean worktree" reads like death** → it isn't: mid-flight
  worktrees are clean by design (write → verify → commit → seal). Read
  `status`'s `relay.suggested_action`; inside the lease it says `wait`, and
  `abandon` refuses without `--force`. A receipt that arrives *after* an
  abandon can still be revived with `adopt`.
- **Frontier empty** → are the target task's section predecessors all `[x]`? Is
  the task itself unchecked?
- **An attempt is `unknown`** → the subagent finished without a sealed receipt,
  or its lease ran out. `recover.detail` carries what is known: the `--reason`
  you passed and the last verification failure on record. Leases are 7200 s of
  silence (renewed by heartbeat and worktree activity, capped at three leases)
  with no CLI flag, so a ticket that goes silent for two hours comes back as
  `lease-expired` and is re-dispatched while its retry budget lasts.
- **A `recover` whose reason is `receipt-invalid`** (its `detail` names the
  changed segment, or `receiptHash`) → an edited receipt was rejected before
  any merge. Nothing was integrated. Re-seal from the assignment worktree, or
  `abandon` and let the next `actions` claim fresh.
- **A `resolve_merge` action appeared** → two assignments touched overlapping
  files; the conflict is preserved in the integration worktree. Resolve it in a
  subagent, then reconcile again. Only the assignment whose branch owns the
  preserved merge gets this action; other pending receipts keep waiting (they
  are not marked conflicted, and nothing merges into a worktree that is already
  mid-merge).
- **A `repair_integration` action appeared** → a merge landed but the merged
  tree failed the run's verification commands (the prompt carries the failing
  command and its output). The attempt is parked in `blocked-review`
  (`post-merge-verification-failed`), nothing else merges onto that base and no
  new ticket is claimed until a fix is committed on the integration branch.
- **A `repair_integration` action says the verification could not be run** → a
  command timed out (30 minutes per command) or could not start on the merged
  tree. The merge did land and nothing else builds on it. Fix the cause (a
  missing dependency, a hanging command), then either commit on the integration
  branch or pass `--verify` again on the next call — that re-runs the
  verification even though HEAD did not move.
- **The integration worktree is a fresh checkout** → verification commands
  that need untracked dependencies (`node_modules`, a virtualenv) fail there.
  Install them inside the command (`npm ci && npm test`) or make the project
  self-sufficient in a fresh checkout.
- **`project is not a git repository root`** → the path is a directory inside
  another repository. Baton creates `baton/*` branches and worktrees at the
  repository root, so point it at the repository itself.
- **`blocked: retry-budget-spent`** → the ticket used its attempts and has no
  open attempt; `reopen <N.M>` grants a fresh budget.
- **`blocked: integration-verification-failed`** → the integration branch's HEAD
  is red and no attempt owns the repair any more (it was abandoned). Fix it on
  that branch and commit; the next `actions` re-verifies it.
- **`blocked: ticket-redefined` / `ticket-removed`** → the task text changed or
  the task left tasks.md while its attempt was in flight. Restore it to resume,
  or `abandon` the attempt.
- **`blocked: integration-worktree-dirty`** → the shared integration worktree
  has uncommitted tracked changes (typically a half-finished conflict
  resolution). Nothing was merged. Commit or discard them there, then call
  `actions` again. The attempt keeps its lease, so it is retried once the
  worktree is clean; `abandon <assignment_id>` retires it instead.
- **`blocked: integration-failed`** → the merge could not run at all (for
  example unrelated histories). Nothing was merged and the attempt is parked in
  `blocked-review` instead of sitting in `integrating` until its lease expires.
  Fix the integration worktree, then `actions` again, or `abandon`.
- **`blocked: branch-moved-after-seal`** → the assignment branch advanced past
  the commit the sealed receipt verified, so merging it would integrate work
  that never ran the verification commands. Nothing was merged. Re-seal from
  the new tip (`receipt.py seal` re-runs the verification commands there) and
  `actions` again, or `abandon` the attempt (the ticket is re-claimed fresh).
- **`HEAD did not advance from the assignment baseline`** → the subagent
  committed nothing. If the ticket genuinely changes no files (a verification
  or decision-only task), have it record that with an explicit empty commit
  (`git commit --allow-empty -m "<what you verified>"`); the sealed receipt then
  carries `changed_files: []` and the packet's verification commands are still
  what decides success.
- **`verification failed: <command> exited <code>: <output>`** → `receipt.py`
  reports the exit code and the output tail, and leaves them in
  `verification.json` next to the packet, so the subagent (and a later
  `recover`) can see what broke. `verification timed out` means a command hit
  the 30-minute per-command limit and its whole process group was killed.
- **`capacity > 5` rejected** → the controller caps concurrency at 5.
- **A sealed receipt is not semantic correctness**: it binds the packet hash,
  claim token, a clean advanced HEAD, the exit codes and the changed-file list
  into one JSON file, and covers the whole body with a canonical `sha256` digest
  (`receiptHash`). That is integrity evidence produced by `receipt.py`, not a
  cryptographic proof (the digest has no secret) — pass strong
  `verification_commands` and still review destructive outcomes. The
  controller's own verification of the merged tree is what stands between a
  subagent's claim and the integration branch.
- **`tasks.md` changed mid-run** → fine; the next `actions` call records a
  new plan revision and in-flight packets stay immutable (see "Editing the
  plan" for a changed task text).
- **`queue.db uses schema version N`** → the project's plan store was written
  by a newer baton. Upgrade baton; baton never writes a store it does not
  understand.

## Installation

Baton ships as the `dsh-openspec-baton` DSH bundle and as the `baton` ZCode
plugin; either install mounts `skills/` so this skill is available. No
background process and no manual tool registration are required — the skill
drives
`<baton-root>/scripts/session_control.py` directly.
