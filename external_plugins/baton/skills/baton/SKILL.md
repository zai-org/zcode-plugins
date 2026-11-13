---
name: baton
description: baton 接力调度——用确定性 ticket/DAG 控制面执行已批准的 OpenSpec change。当用户说「跑 baton」「跑一下 baton」「baton status」「用 baton 排活」「派活」「派发任务」「把这个 OpenSpec change 跑完」或问 baton 能不能排活时使用；本地 CLI 返回确定 actions，会话派发给隔离 worktree 子代理，验证全绿的密封回执才算完成。Also use when the user says "run baton", "baton status", or wants an OpenSpec change executed with verified integration.
whenToUse: The user mentions baton in any phrasing (跑 baton / baton status / 排活 / 派活 / dispatch) or wants an approved OpenSpec change executed or inspected in a git project.
---

# Baton

Baton is the **sole ticket / DAG / session-subagent control plane over OpenSpec
changes**. The main session is a mechanical forwarder: it never decides ticket
state itself. It forwards the deterministic `actions` the CLI returns to native
subagents verbatim, binds each returned agent id, and reports the terminal event
back via `reconcile`. Free-text subagent output is ignored; only a **sealed
receipt** (the packet's verification commands ran green in an isolated worktree)
counts as success.

## Invocation

`<baton-root>` is the directory containing this bundle's `package.json` (two
levels above this `SKILL.md`). Relative doc paths below are written against that
root, not the skill directory.

`<python>` is a Python 3.10+ interpreter: `python3` on macOS/Linux, `python` on
Windows.

`<cli>` is `<python> <baton-root>/scripts/session_control.py`. Every verb prints
one JSON object to stdout and exits non-zero on a domain failure (one JSON error
object, no traceback). Quote project paths. If the harness truncates stdout,
write the batch to `.dsh/baton/batch.json` and read that file.

| Verb | Contract |
|---|---|
| `actions --session-id <id> [--capacity 1-5] [--base-branch main]` | claim + return an action batch. `--session-id` is **required** (no default). |
| `bind <assignment_id> <claim_token> <agent_id>` | bind a spawned child to its assignment |
| `reconcile <assignment_id> <claim_token> --agent-terminal completed\|failed\|canceled --session-id <id>` | turn a terminal event into a sealed receipt; returns the next batch |
| `status` | read-only progress snapshot (each attempt carries a `relay` judgment: elapsed / lease budget / receipt / liveness + `suggestedAction`) |
| `cleanup [--include-integration] [--dry-run]` | remove a finished run's worktrees |
| `abandon <assignment_id> [--reason "<why>"] [--force]` | retire a stuck attempt (guarded — refused while it is plausibly still working, see "Taking over a run") |
| `adopt <assignment_id>` | revive an abandoned attempt whose sealed receipt arrived late: re-verify + integrate |

`--verify "<cmd>"` is a **top-level** flag (before the verb, repeatable). The
first claim **must** declare the change-wide verification commands: there is no
implicit `git diff --check` fallback, and an unconfigured run fails loud. They
are persisted with the run, so later packets (including ones prepared by
`reconcile`) reuse them; passing `--verify` again is an explicit override for
new packets.

## The loop

**Responsibility**: drive the deterministic session-subagent loop until every
required task of the change is verified and integrated.

### Prerequisites

- The `dsh-openspec-baton` bundle is installed (this skill is mounted, and
  `<baton-root>/scripts/session_control.py` exists).
- The active DSH profile provides `subagent`. `list_agents` / `send_message` are
  only needed to inspect or steer a running child.
- The target project is a **git repository** with an OpenSpec change at
  `<project path>/openspec/changes/<change-id>/` containing `proposal.md` and a
  `tasks.md` with at least one unchecked `- [ ] N.M` task whose section
  predecessors are all checked.

### Steps

1. **`actions`** to get the first batch:

   ```bash
   <cli> "<project path>" <change-id> --verify "<cmd>" actions \
     --session-id <id> --capacity 1 --base-branch main
   ```

   Returns `{ok, run_id, state, actions:[...]}`. State the chosen capacity
   before raising it above 1.

2. **Handle every action in the batch**:
   - `dispatch` → `subagent(prompt=action.prompt, cwd=action.cwd,
     description="<change> ticket <num>")`, then immediately
     `<cli> "<project path>" <change-id> bind <assignment_id> <claim_token> <agent_id>`.
   - `resolve_merge` → `subagent(prompt=action.prompt, cwd=action.cwd,
     description="<change> merge <assignment_id>")`. It resolves the preserved
     conflict, runs the packet's verification commands and commits the merge.
   - `wait` → nothing to spawn; end the turn and wait for outstanding notices.
   - `recover` → no sealed receipt, so the outcome is unknown. A `lease-expired`
     recovery is retried automatically (the next claim supersedes the stale
     attempt and never blocks the frontier). Any other `recover` needs a
     decision: retry/repair, or `abandon` if the attempt is stuck (abandon is
     guarded — see "Taking over a run"). **Never** mark it succeeded.
   - `blocked` → report the block code and reason; nothing to spawn.
   - `complete` → every required ticket has a verified, integrated receipt. Run
     `status` for the final summary and stop.

3. **On each subagent completion notice**, `reconcile`. DSH settlement notices
   are prose, not a status enum — map them explicitly: "finished" → `completed`;
   stopped / canceled / interrupted → `canceled`; failed / "ran out of room" /
   declined / abnormal → `failed`.

   ```bash
   <cli> "<project path>" <change-id> reconcile \
     <assignment_id> <claim_token> --agent-terminal completed --session-id <id>
   ```

   Reconcile honors only a sealed receipt written by
   `<baton-root>/scripts/receipt.py verify` / `seal` in the assignment worktree;
   any other terminal event flips the attempt to `unknown` and returns
   `recover`. Nothing is merged for a rejected receipt.

4. **Process the batch `reconcile` returns directly.** Call `actions` again only
   when starting a run or resuming after a restart. Continue until a batch
   contains `complete`.

If a batch produces only running children, end the turn and wait for their
completion notices instead of polling.

### Concurrency

- Capacity 1 is strictly serial. Capacity 2–5 dispatches that many isolated
  worktrees in parallel; integration into the shared worktree is serialized
  under a repository-scoped lock.
- Merge conflicts are preserved (never auto-aborted) and surfaced as
  `resolve_merge` actions.
- Never exceed capacity 5 (the controller rejects it) and never spawn more
  children than the batch returned `dispatch` actions for.

### Completion and cleanup

At `complete` the controller auto-removes the per-assignment worktrees
(`baton/<feature>-tic-*`) and reports them in `worktrees_removed` /
`worktrees_skipped`. The shared integration worktree (`baton/<feature>`) is left
in place: merge it into the project's main branch, then remove it with
`cleanup --include-integration`.

`cleanup` never touches the project's main working tree and never force-removes a
dirty worktree (it skips and reports). `--dry-run` lists what it would remove. A
change-id that never ran fails with `no baton worktrees or branches found`
instead of an empty success.

### Taking over a run (relay)

A handed-off run's subagents may still be working. A **clean worktree mid-ticket
is normal** — the subagent flow is write → verify → commit → seal, so nothing is
committed until the end — and a receipt only exists after that whole pipeline.
"No receipt yet" inside the lease is not a death verdict; "the completion notice
was lost" in a handoff note is an assumption, not evidence.

Before judging any in-flight attempt, run `status` and read its `relay` block:
`elapsedSec`, `leaseRemainingSec`, `leaseElapsedFraction`, `receiptExists`,
worktree signals (`heartbeatAgeSec`, `lastActivityAgeSec`, `dirty`, `exists`)
and the `suggestedAction`. Then follow it mechanically:

- **`wait`** (active, lease healthy, no receipt, no failure evidence) → end the
  turn and wait for the completion notice; `reconcile` only needs
  `assignment_id` + `claim_token`, which the batch already gave you. Do not
  abandon.
- **`wait-lease-nearly-spent`** → keep waiting; the guard no longer applies but
  an expired lease auto-recovers (the next `actions` supersedes the attempt and
  re-dispatches).
- **`reconcile`** (active attempt, sealed receipt on disk) → the notice may have
  beaten you to it; reconcile or just run `actions` (it auto-reconciles sealed
  receipts).
- **`adopt`** (abandoned attempt, sealed receipt on disk) → the subagent
  finished *after* a (mistaken) abandon. Run `adopt <assignment_id>`; it
  re-verifies the receipt and integrates it. If a newer attempt for the same
  ticket already sealed its own evidence, adopt refuses and lists both — pick
  one deliberately (keep the successor, or abandon it and adopt the earlier
  attempt). If a successor is still in flight, stop it first.
- **`decide` / `resolve-or-abandon` / `await-expiry`** → the failure is already
  on record (`unknown`, `blocked-review`, expired lease); treat as below.

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
call. The command prints `destroys` / `preserves` so the consequence is explicit.

**Guard**: abandoning an attempt that is plausibly still working — active state,
no failure evidence, no sealed receipt, less than 80% of its lease spent — is
**refused** with the full judgment data (elapsed, lease remaining, liveness
signals, advice). Read it, then either wait as advised or pass `--force`. The
hatch stays free where it is actually needed: `unknown` outcomes,
`blocked-review`, expired leases and terminal states are never guarded.

### Adopt a late sealed receipt

```bash
<cli> "<project path>" <change-id> adopt <assignment_id>
```

The reverse hatch for the case abandon got wrong: the abandoned subagent turned
out to be alive and sealed a valid receipt after the abandon. `adopt` fully
re-verifies the receipt (body digest, claim token, packet hash, identity)
*before* any state changes, then integrates it through the normal path — the
ticket lands with zero re-work. A receipt that fails verification leaves the
attempt abandoned. A merge conflict still parks the attempt in `blocked-review`
and reports the follow-up, exactly like a normal reconcile.

## Status

```bash
<cli> "<project path>" <change-id> status
```

Returns `{ok, runId, revision, complete, feature, projectPath,
missingRequiredTickets:["2.1","3.2"], attempts:[...]}`. Each attempt carries a
`relay` block — the mechanical alive/dead judgment (`elapsedSec`,
`leaseRemainingSec`, `leaseElapsedFraction`, `receiptExists`, worktree
liveness signals, `suggestedAction`) that "Taking over a run" tells you to
read before deciding to wait or to abandon.

`status` writes nothing: it creates no plan revision, no runtime directory and
no `plan.json`, so it is safe on a project that never ran (and on a mistyped
change-id, which still fails loud with the missing-tasks.md error). `revision:
0` therefore means "no plan revision recorded yet"; the first `actions` call
creates revision 1. Completion comes from the plan store's required-ticket
check against the latest plan revision — not from any PRD `passes` flags.

## Editing the plan (live plan)

Add, reorder or split tasks by editing the change's `tasks.md`. The next
`actions` call records a new plan revision and recomputes the frontier.

- A running assignment keeps its original `planRevision` and `taskPacketHash`;
  packets are immutable.
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
- verification is change-wide via `--verify`, not per task
- an integrated receipt flips the checkbox to `[x]` in `tasks.md`

## Runtime directory layout

Only what the loop needs to name; the rest lives in `AGENTS.md`.

```
<project>/.dsh/baton/
|-- queue.db                  durable plan store (name kept for compatibility)
|-- runs/<assignment_id>/     packet.json / verification.json / receipt.json
`-- <change-id>/              plan.json / results/
```

`openspec/changes/<change-id>/tasks.md` is the plan face. There is no
`prd-<feature>.json` on the active path; historical `prd.json` files are inert
and must not be used to judge completion.

## Troubleshooting

- **"No receipt + a clean worktree" reads like death** → it isn't: mid-flight
  worktrees are clean by design (write → verify → commit → seal). Read
  `status`'s `relay.suggestedAction`; inside the lease it says `wait`, and
  `abandon` refuses without `--force`. A receipt that arrives *after* an
  abandon can still be revived with `adopt`.
- **Frontier empty** → are the target task's section predecessors all `[x]`? Is
  the task itself unchecked?
- **An attempt is `unknown`** → the subagent finished without a sealed receipt,
  or its lease expired. Leases are fixed at **7200 s (2 h)** with no renewal
  entry point, so a ticket that runs longer than two hours will always come back
  as `lease-expired` and be re-dispatched. `lease-expired` recovers
  automatically; any other `recover` needs a decision, or `abandon`.
- **Non-zero exit mentioning `receiptHash`** → the sealed receipt's body was
  edited on disk (or written by an older baton). Nothing was merged. Re-seal from
  the assignment worktree, or `abandon` and let the next `actions` claim fresh.
- **A `resolve_merge` action appeared** → two assignments touched overlapping
  files; the conflict is preserved in the integration worktree. Resolve it in a
  subagent, then reconcile again. Only the assignment whose branch owns the
  preserved merge gets this action; other pending receipts keep waiting (they
  are not marked conflicted, and nothing merges into a worktree that is already
  mid-merge).
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
- **`capacity > 5` rejected** → the controller caps concurrency at 5.
- **A sealed receipt is not semantic correctness**: it binds the packet hash,
  claim token, a clean advanced HEAD, the exit codes and the changed-file list
  into one JSON file, and covers the whole body with a canonical `sha256` digest
  (`receiptHash`). That is integrity evidence produced by `receipt.py`, not a
  cryptographic proof (the digest has no secret) — pass strong
  `verification_commands` and still review destructive outcomes.
- **`tasks.md` changed mid-run** → fine; the next `actions` call records a new
  plan revision and in-flight packets stay immutable.

## Installation

Baton ships as the `dsh-openspec-baton` DSH bundle; installing it mounts
`skills/` so this skill is available. No background process and no manual tool
registration are required — the skill drives
`<baton-root>/scripts/session_control.py` directly.
