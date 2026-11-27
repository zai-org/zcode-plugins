# Changelog

## 0.5.0 (2026-11-27)

Correctness round from the 11-26 full review. Every item below was reproduced
against a real git repository before it was fixed, and each fix carries a
regression test. A `queue.db` written by 0.4.x is migrated on first connect.

**CLI breaking changes**

- **One envelope.** Every verb prints `{"ok": true, "command": "<verb>", ...}`
  on success, all keys snake_case (`run_id`, `missing_required_tickets`,
  `relay.elapsed_sec` / `lease_remaining_sec` / `receipt_exists` /
  `suggested_action`, `cleanup.dry_run` / `would_remove` /
  `integration_included`, `abandon.ticket_num`, `adopt.adopted_from` /
  `follow_up`). A domain failure is `{"ok": false, "command", "code", "error"}`
  with a stable `code` (`verification-unconfigured`, `tasks-md-invalid`,
  `abandon-refused`, `unknown-assignment`, `schema-too-new`, ...) and its data
  as fields (`refusal`) — no longer JSON inside the error string.
- **A rejected receipt is a `recover`, not a CLI error.** `reconcile` returns
  the batch with reason `receipt-invalid` and the changed segment in `detail`,
  so one bad receipt no longer hides the rest of the batch.
- **Removed:** the ignored `final_text` argument (replaced by
  `reconcile --reason`, which is recorded for diagnosis), the never-populated
  `TaskPacket.artifacts`, `PlanTicket.required` / `source_revision` and
  `PlanRevision.completion_state`, the never-written states `running` /
  `submitted` / `failed` / `canceled` / `verifying`, and the dead
  `release_lease` parameter. **Packet format change:** `task_packet_hash` no
  longer covers `artifacts` — finish in-flight assignments before upgrading;
  sealed receipts from earlier versions still verify and reconcile.
- **`cleanup` deletes branches.** It removes every assignment branch whose
  commits are in the integration branch and, with `--include-integration`, the
  integration branch once it is merged into the base branch; unmerged branches
  are kept and reported (`branches_kept`). A change the plan store remembers
  keeps the empty-but-successful answer once nothing is left.

**The core promise now holds for the merged tree**

- **Every merge is verified.** The controller re-runs the verification commands
  on the integration branch after each merge — fresh, or already landed after
  a conflict resolution — inside the integration lock. A red result parks the
  attempt (`post-merge-verification-failed`), returns a `repair_integration`
  action with the failing output, holds every other receipt, and blocks new
  claims until a fix lands. Before, two branches that were green alone could
  produce a broken integration branch and the run still said `complete`.
- **A changed task text parks its in-flight attempt** (`ticket-redefined` /
  `ticket-removed`) with both texts shown, instead of integrating the old
  wording and checking it off against the new definition. Restoring the text
  resumes the attempt; `abandon` re-claims under the new one.

**Liveness and retries**

- **Leases are 7200 s of silence.** The heartbeat, edited files and new
  commits renew a lease (at most three leases from the claim); before, an
  attempt died at the two-hour mark whatever it was doing.
- **Automatic retries are bounded** at 3 attempts per ticket. Each retry is
  announced in the new batch `warnings` (`lease-expired-retried`, with the
  stale attempt's `agent_id` so the session can stop a subagent that is still
  running); before, the loop was endless and left no trace.
- **`adopt` covers superseded attempts too,** not only abandoned ones: a slow
  subagent that finished after its lease expired no longer loses its verified
  work.
- **An unbound claim is re-dispatched to any session,** so handing over a run
  does not wait out a two-hour lease for a claim no agent was ever bound to.

**Honest state**

- **`reopen <N.M>` re-runs a finished ticket:** it voids the ticket's succeeded
  receipts and restarts its retry budget. A manual un-check no longer does
  nothing silently — it is reported (`resolved_but_unchecked` in `status`, a
  `resolved-but-unchecked` warning on every batch) and still not honored
  without `reopen`.
- **Failure reasons survive.** `reconcile --reason` records the operator's
  account, and a failed verification keeps its exit code and output tail in
  `verification.json`; a `recover` action carries both, plus the agent id,
  the worktree, the retry budget and ready next steps.
- **A stale `unknown` attempt retires itself** once its ticket is delivered by
  another attempt or by hand.

**Environment and hygiene**

- **Verification commands inherit the caller's environment.** They used to run
  under a login shell, where macOS `path_helper` rebuilds `PATH` — `python3`
  resolved to the system interpreter instead of the one the user and the
  subagents use.
- **A hanging verification command is killed** together with its whole process
  group after the 30-minute limit and reported as a `ReceiptError`, not a raw
  `TimeoutExpired` traceback.
- **Capacity and base branch are remembered by the run,** like `--verify`
  already was: a `reconcile` that omitted `--capacity` used to narrow a
  parallel run to serial, one completion at a time.
- **`.dsh/baton/` is kept out of the target repository** through
  `info/exclude`; it used to show up untracked, ready to be staged by a
  blanket `git add -A`. The `[x]` write-back is reported as what it is — an
  uncommitted edit to commit with the merge.
- **A re-run starts from a current base:** an integration branch whose work is
  already merged is fast-forwarded to the base branch; one that still holds
  unmerged work is reported, never moved.
- **The packet's `baseSha` is read after the receipt pass,** so a ticket
  claimed in the same call that landed another one no longer records a stale
  base (and a `changed_files` list that includes the previous ticket's files).
- **A top-level checkbox without an id is an error,** as is an indented
  checkbox that carries one; both used to vanish without a word.
- **The dispatch prompt asks for `seal` only** (it re-runs the verification
  itself; the old flow ran the suite twice) and points the subagent at the
  whole change — `design.md` and the spec deltas under `specs/` included.
- **`queue.db` has a schema version:** a store written by a newer baton fails
  loud instead of crashing on a missing column.

**Structure**

- `SessionController` is assembled from focused mixins (`receipt_flow`,
  `lease_flow`, `dispatch_flow`, `operator_flow`, `run_settings`) so the
  scheduling loop reads on its own; the attempt-state vocabulary lives in one
  place and the schema's active-state index is generated from it; every git
  call goes through `git_run.py`.

**After an independent audit of this release candidate** (each finding was
reproduced, fixed and pinned by a regression test):

- `reconcile` and `adopt` no longer integrate a receipt directly: the receipt
  pass inside `actions` does it after the red-base check. A completion notice
  used to merge its receipt onto a red integration branch.
- One `actions()` call judges each lease once. A lease that ran out between
  the sweep and the claim used to be re-issued *and* replaced in the same
  batch — two subagents on one ticket.
- A verification that cannot run on the merged tree (timeout, a command that
  cannot start) parks the attempt as the owner of the merge instead of
  reporting "nothing was merged". The recorded outcome is keyed by the commit
  and the verification commands, so corrected commands re-verify, and passing
  `--verify` again forces a re-run.
- A ticket locked out by the retry budget stays visible
  (`blocked: retry-budget-spent`); before it silently left the run incomplete.
  `abandon` reports `attempts_used` / `attempts_max` and says when `reopen` is
  the only way forward.
- The red-base hold stays when the parked owner's receipt is rejected, and the
  ownerless red base is named in the same batch.
- The project must be the root of its own repository: a directory inside
  another repository is refused instead of silently creating `baton/*`
  branches there. The `.dsh/baton/` exclusion is repository-relative and
  verified with git.
- A failed fast-forward of the integration branch is reported
  (`integration-sync-failed`) instead of silently building on the stale tip.
- The schema-version gate runs before any DDL touches the store.
- A resumed attempt can earn lease extensions again (its hard cap restarts
  with it); a receipt another process already finalized is not an error.
- `status` suggests `repair-integration` / `resolve-or-abandon` for parked
  attempts (the receipt-on-disk check used to shadow both).
- Parser: a top-level heading that is not a numbered section ends the section
  (checkboxes under it are not tickets); a UTF-8 byte-order mark no longer
  hides the first section.
- `bind` with an empty agent id is a usage error, not a traceback. `complete`
  keeps the worktree of an attempt still in flight, and a re-issued dispatch
  recreates a worktree that a mid-run cleanup removed.

Regression: 213 → 294 tests pass; `./tests/regression.sh` 5/5 stages green.

## 0.4.5 (2026-11-23)

Docs-only host-portability round from the 11-23 review; no code change.

- **SKILL.md now maps host tools for ZCode.** The loop was written with DSH tool
  names only (`subagent(...)` with a `cwd` argument, "the active DSH profile
  provides `subagent`"), so the ZCode plugin form shipped a skill that described
  another host. A "Host tools" table maps DSH ↔ ZCode (spawn, the agent id for
  `bind`, the completion notice, optional steer), and the prerequisites and the
  installation section name both forms. ZCode's `Agent` has no `cwd` argument;
  the dispatch prompt already names the worktree, so runtime is unchanged.

## 0.4.4 (2026-11-18)

Dead-code and dispatch-semantics round from the 11-18 audit: eight items, no
feature change.

- **`blocked-review` now dispatches by `failure_code` instead of always
  re-emitting `resolve_merge`.** A parked attempt whose receipt can no longer
  be re-read (receipt or packet gone from disk) used to get a "resolve the
  preserved merge" prompt even when nothing had been merged
  (`integration-failed`, `branch-moved-after-seal`); only `merge-conflict`
  leaves a preserved merge, and it is now the only failure that gets
  `resolve_merge` — the others surface as their named `blocked` action with
  the abandon exit. Two regression tests cover both failure codes.
- **TaskPacket loses two never-populated fields** (`retry_policy`,
  `allowed_paths`) together with the `allowed_paths` enforcement in `seal`
  that could never trigger — the controller never fills it (verified against
  every packet on disk: all carry the defaults). **Packet format change:**
  `task_packet_hash` is computed over the packet dict, so running
  `receipt.py verify`/`seal` on a packet written by ≤0.4.3 now fails the
  recomputed-hash check — finish in-flight assignments before upgrading, or
  abandon and let the ticket re-claim. Sealed receipts from ≤0.4.3 still
  verify and reconcile unchanged.
- **ResultEnvelope loses four never-populated fields** (`profile_id`, always
  `"session-subagent"`, and `artifacts`/`findings`/`proposed_followups`,
  always `[]` — verified against all receipts of the fusion-s1-skeleton
  run). Newly sealed receipts no longer carry these keys; older receipts
  still load and verify (`from_dict` ignores unknown keys).
- **One git subprocess wrapper instead of four.**
  `scripts/orchestration/git_run.py` exposes a single `run_git(args, cwd=…,
  error=…, timeout=…, check=…)`; `session_controller`, `integrator`,
  `worktree` and `receipt` now delegate to it, each keeping its own exception
  type. Git failure messages are unified to one format.
- **One frontier judgment.** `_frontier.is_frontier_ticket` is the shared
  predicate behind both the board's `compute_frontier` and the claim loop in
  `attempt_store` (status from tasks.md, blockers from the plan revision —
  semantics unchanged, implementation single-sourced).
- Cleanup: dead `touched_files` variable removed from `attempt_store`;
  long blank-line runs collapsed in `plan_store`.

Regression: 211 → 213 tests pass; `./tests/regression.sh` 5/5 stages green.

## 0.4.3 (2026-11-18)

- New icon: 1-bit monochrome pixel relay — two gloves passing a glowing baton
  across a dashed node path. Part of the shared pixel family across the six
  plugins; no code changes.

## 0.4.2 (2026-11-12)

Integration-trust round: what lands on the integration branch is exactly the
commit the sealed receipt verified, and the ticket parser stops guessing.
Every item below was reproduced against a real git repo before it was fixed,
and each fix carries a regression test.

- **A branch that advanced past the seal is refused, not silently merged.**
  `reconcile` used to merge the assignment *branch*, so a commit added after
  sealing (subagent kept working, stray process) was integrated even though it
  never ran the verification commands. `integrate_assignment` now takes the
  receipt's `expected_sha`: a moved tip is a named block
  (`blocked: branch-moved-after-seal`, attempt parked in `blocked-review`)
  naming the actual tip and the expected sha, with both exits documented
  (re-seal at the new tip — `seal` re-runs verification there — or `abandon`).
  Nothing is merged unless the branch tip is the verified commit or that
  commit already landed (a resolved conflict); the moved tip's extra commits
  simply stay unmerged.
- **A preserved conflict stays owned by its assignment when the branch moves.**
  Conflict ownership was judged by `MERGE_HEAD` vs the *current* branch tip;
  one post-conflict commit turned the owner into a bystander and the attempt
  silently sat in `blocked-review` forever (only wait actions, and lease
  expiry does not cover `blocked-review`). Ownership now compares `MERGE_HEAD`
  to the receipt's verified commit — the same sha the merge gate uses — so
  `resolve_merge` keeps being produced and the run progresses after the
  resolution.
- **A checkbox with a task id but no text is a validation error.** `- [ ] 1.2`
  failed the parser's non-empty-text group and vanished: the ticket was never
  dispatched and nothing reported it. It now raises `TasksMarkdownError`
  naming the line, like duplicate/misfiled ids (`docs/ticket-format.md`
  updated).
- **Fenced code blocks are documentation, not tickets.** Example checkboxes
  inside ``` fences are skipped: a misfiled id in a quoted sample no longer
  explodes the whole parse, and a matching id no longer becomes a ghost
  ticket.
- **Concurrent CLI processes no longer share one temp file name.** `plan.json`
  and `tasks.md` writes used fixed `<name>.tmp` siblings; interleaved writes
  could truncate each other's payload before the rename. Temp names now carry
  pid + uuid (per-assignment packet/receipt files were left as-is: single
  writer by construction).

Regression: 196 → 211 tests pass; `./tests/regression.sh` 5/5 stages green.

## 0.4.1 (2026-11-09)

Unfreeze simplify round — documentation parity and comment cleanup only,
zero behavior change.

- `docs/architecture.md`: the Module Dependencies graph now carries the
  `session_controller.py → relay.py` edge (introduced with the relay in
  0.4.0) and a `relay.py` entry joins the explanation list, matching the
  AGENTS.md module table.
- `README_CN.md`: the observability section documents the two behaviors
  README.md already had — omitting `<change-id>` for `build`/`scan` when the
  project has exactly one change (the omission fails loud on zero or
  several), and the card-click `check`/`uncheck` commands that rewrite built
  boards in place.
- Dropped the two decorative divider comment blocks (`scripts/ticket_board.py`,
  `scripts/orchestration/model.py`); no code path touched.

## 0.4.0 (2026-11-06)

Relay-safety round: an in-flight attempt can no longer be silently destroyed
by a mistaken abandon, and a late sealed receipt is no longer protocol debris.
Born from the 2026-11-06 fusion-s1 incident — a taking-over session saw "no
receipt + clean worktree" 14 minutes into a ~26-minute ticket under a 2-hour
lease, declared the subagent dead and abandoned it; the subagent sealed a
valid receipt 11 minutes later and the ticket was rebuilt from scratch. Every
item below replays that incident in tests, at its exact parameters (14 min
elapsed / 106 min remaining) and end-to-end.

- **`status` now answers "is it alive?".** Each attempt carries a `relay`
  block: `elapsedSec`, `leaseRemainingSec`, `leaseElapsedFraction`,
  `receiptExists`, worktree liveness signals (`heartbeatAgeSec`,
  `lastActivityAgeSec`, `dirty`, `exists`) and a `suggestedAction` (`wait`,
  `wait-lease-nearly-spent`, `reconcile`, `adopt`, `decide`,
  `resolve-or-abandon`, `await-expiry`, `none`). A clean worktree mid-ticket
  is presented as the normal shape it is — the subagent flow is
  write → verify → commit → seal — not as a death verdict.
- **`abandon` is guarded.** Retiring an attempt that is plausibly still
  working (active state, no failure evidence, no sealed receipt, lease less
  than 80% spent) is refused with the full judgment data; `--force` bypasses
  it for an operator who has read the refusal. The hatch stays free exactly
  where it is needed: `unknown`, `blocked-review`, spent/expired leases and
  terminal states are never guarded.
- **`adopt <assignment_id>` is the reverse hatch.** An abandoned attempt whose
  sealed receipt arrived late can be revived: the receipt is fully re-verified
  (body digest, claim token, packet hash, identity) *before* any state
  changes, then integrated through the normal path (a merge conflict still
  parks in `blocked-review` with a follow-up). If a newer attempt for the
  same ticket already sealed, adopt refuses and lists both evidence sets for
  a human choice; if one is still in flight, adopt says so instead of
  double-integrating.
- **Heartbeat.** The dispatch prompt tells the subagent to refresh a
  `progress` file in the run directory (outside the worktree, so it never
  dirties a seal) after each milestone; `status` reports its age. Liveness
  becomes observable, not inferred.
- New read-only module `scripts/orchestration/relay.py`; `status` stays
  fully read-only. Tests 179 → 196.

## 0.3.2 (2026-11-05)

Correctness round over the integration path, plus the leftovers of the 0.3.0
queue extraction. Every item below was reproduced against a real git repo
before it was fixed, and each fix carries a regression test.

- **A preserved merge conflict no longer contaminates other assignments.**
  `git merge` refuses to start while a conflicted merge is preserved, and
  `git diff --diff-filter=U` lists the *earlier* merge's files. The old code
  read that as "this branch conflicts", so one real conflict marked every
  other pending receipt `blocked-review` and emitted a second `resolve_merge`
  pointing at a conflict the branch never touched — two solvers, one shared
  worktree. `integrate_assignment` now returns a reason:
  `conflict` (this branch, `MERGE_HEAD` is its own tip), `merge-in-progress`
  (another assignment owns the worktree: nothing attempted, the attempt is
  left untouched and retried later), `worktree-dirty`, or a raised
  `WorktreeError` for a merge that cannot run at all.
- **A dirty integration worktree no longer wedges the run.** An uncommitted
  tracked change there used to make every `actions` call raise `WorktreeError`
  while the attempt sat in `integrating` until its two-hour lease expired. It
  is now a `blocked` action (`integration-worktree-dirty`) naming the files and
  the `abandon` escape; the attempt keeps its lease and is retried as soon as
  the worktree is clean.
- **Hard merge failures no longer strand the attempt.** A merge that fails
  without conflict files parks the attempt in `blocked-review`
  (`failure_code=integration-failed: …`) and surfaces a `blocked` action
  instead of leaving it in `integrating`.
- **`status` is genuinely read-only.** It used to create `.dsh/baton/`, the
  database and revision 1, and rewrite `plan.json` on every call — and a
  mistyped change-id left a runtime directory behind. `PlanStore.snapshot()`
  reads the existing store (if any) and writes nothing; `revision: 0` now means
  "no plan revision recorded yet".
- **`ticket_board uncheck` no longer rewrites a CRLF file.** It is the
  documented `reverse` of baton's own `[x]` write-back, but it read/wrote
  through universal-newline text I/O and wrote non-atomically, so one flip
  turned a Windows checkout into a whole-file diff. The flip moved into
  `_ticket.uncheck_task`, the exact mirror of `check_task` (same checkbox
  tolerance, same `newline=""` byte-preserving `tmp` + rename write).
- **Dead code removed** after the 0.3.0 queue extraction: the resource-lease
  subsystem (`attempt_resource_leases` table + index, claim-time insert loop,
  four deletes, `_attempt_resources_locked`) and the `assignments` table —
  neither had a producer, since the tasks.md parser never fills `resources`,
  `priority`, `agent_profile`, `authority`, `successor` or `source_amendment`.
  `PlanTicket` is down to the fields the parser actually produces,
  `TaskPacket.resources` is gone with its only writer, and the pre-0.3.1
  "adopt verification commands from existing packets" path is removed.
- **`plan_store.py` split** (1262 → 434 lines): `store_base.py` (errors,
  terminal states, atomic JSON write), `store_schema.py` (DDL + WAL retry),
  `attempt_store.py` (claim/lease/bind/state/finalize mixin, importing
  `store_base` only, so the dependency stays one-way).
- **Docs corrected.** `BATON_PYTHON` was documented in README, README_CN and
  the skill but read by no code — removed. `plan.json` is described as what it
  is (a live projection rewritten per claim; the immutable revision history is
  in `queue.db`), and the lease wording admits the constructor override.
- **New drift tripwire** (`tests/test_doc_cli_contract.py`): every CLI
  invocation in README / README_CN / SKILL.md / architecture.md is parsed and
  checked against the real argparse tree — the verb must be registered and each
  flag must belong to it. The stage-5 docs gate only checked that *paths*
  exist, which is why the 0.3.0 skill could teach a nonexistent `run` verb.
  Verified to fail on exactly that bug. `session_control.build_parser()` was
  extracted so the test reads the real parser instead of a copy.

Migration notes:

- Receipts and packets are unaffected; a **packet prepared by 0.3.1** contains
  the removed `resources` field, so its task-packet hash no longer matches.
  An attempt mid-flight across the upgrade is reported as
  `receipt-invalid: task packet hash mismatch` — `abandon` it (or let the next
  `actions` retry) and it re-dispatches with a fresh packet.
- `plan.json` no longer carries an `assignments` array (it was written but
  never read; live attempt state is in `queue.db`).
- `status` reports `revision: 0` until a run records its first revision.

Regression: 179 tests pass; `./tests/regression.sh` 5/5 stages green (was 156;
the additions are the new conflict/worktree/read-only-status/doc-contract/
CRLF cases).

## 0.3.1 (2026-11-05)

Five release blockers found by an extended verification round. The sealed
receipt, the lease state machine, the verification configuration and receipt
identity are now enforced by the controller instead of documented only.

- **The sealed receipt is actually tamper-evident.** `seal` now digests the
  whole envelope body (canonical JSON: sorted keys, no whitespace,
  `receiptHash` excluded) into `receiptHash` and records a `receiptSegments`
  table for diagnostics. `reconcile` recomputes the digest from the file
  before integration and rejects edits to `verification[*].exitCode`,
  `changed_files`, `commit_sha` or any other field with a non-zero exit that
  names the changed segment. Receipts sealed by 0.3.0 lack the digest and are
  rejected as unsealed — re-seal the worktree, or abandon the attempt.
- **An expired lease no longer deadlocks the run.** Expired attempts are
  retired before a batch is planned, a retry replaces the stale attempt (which
  is marked `superseded`) instead of being re-dispatched, and a superseded
  attempt stops emitting `recover`. The frontier advances to later tickets.
  New operator escape: `session_control.py <project> <change> abandon
  <assignment_id>` retires a stuck attempt, prints exactly what it destroys
  (the lease and future reconciliation) and what it preserves (worktree,
  branch, commits, packet, receipt), and makes the ticket claimable again.
- **`--verify` is persisted with the run.** The first claim stores the
  change-wide verification commands in the plan store; every later packet
  (including ones prepared by `reconcile` without the flag) reuses them. No
  commands configured is now a loud failure instead of a silent
  `git diff --check` downgrade. Passing `--verify` again is an explicit
  override for new packets.
- **A wrong-ticket receipt is rejected before the merge.** `reconcile`
  validates the receipt's `ticket_num`, `assignment_id`, `plan_revision`,
  `attempt` and packet hash against the attempt before touching the
  integration branch. A mismatch leaves the attempt `unknown` (not stuck in
  `integrating`) and the ticket unresolved.
- **Release hygiene.** `.npmignore` explicitly excludes `__pycache__/` and
  `*.pyc` (npm no longer relies on the `.gitignore` fallback); packaging tests
  assert no bytecode is tracked or packed and that the orchestration modules
  still import after the queue module moved out.

Regression: `./tests/regression.sh` — 156 passed, 5/5 stages green (the 16 that
went away were exclusive to the deleted queue/worktree/topo-sort surface).

### Simplification pass (same unreleased version)

- **`SKILL.md` was teaching a command that does not exist.** It documented
  `run <project> <change-id>` as the canonical verb, "no subcommand -> defaults
  to `run`", and `Default session_id="baton-run"`. The real CLI has no `run`
  verb, `add_subparsers(required=True)`, and `--session-id` is required. An
  agent following the skill would have failed on its first call. The skill now
  tables the six real verbs with their argument contracts.
- SKILL.md 351 → 229 lines: the ASCII loop diagram (duplicated in README,
  architecture and AGENTS), the `tasks.md` sample (duplicated verbatim in
  `docs/ticket-format.md`), the `status` response schema and the "Typical usage"
  walkthrough were all second copies. Every removed section is now a pointer.
- Leases are documented: fixed **7200 s**, no renewal entry point, so a ticket
  longer than two hours always returns `lease-expired` and is re-dispatched.
- ~1340 lines of dead code removed, every deletion pre-verified as zero-call:
  the local resource queue that moved out in 0.3.0 left six public methods,
  nine helpers and two tables behind; the pre-0.3.0 worker API in `worktree.py`
  was superseded by the assignment worktrees; `model.py` still carried eight
  symbols from the retired agent-profile model; and `topo_sort`, `plan_history`,
  `record_assignment`, `heartbeat_execution_attempt` and `record_result_envelope`
  had no callers at all. `attempt_resource_leases` (the live path) is untouched.
- `README_CN.md` caught up with 0.3.1 (receiptHash, abandon, persisted `--verify`,
  plus the History and Requirements sections) and `tests/check_docs.py` now
  covers README_CN, architecture and ticket-format, so the next drift fails CI.

## 0.3.0 (2026-11-04)

Baton is one product again: the ticket/DAG control plane. Two things that were
not part of it left the repository.

- **The generic resource queue moved out.** `scripts/queue.py`,
  `scripts/coordination/` and their five test files (3.1k lines of code, 2.9k of
  tests, 45% of the Python in this repo) implemented resource mutex, capacity
  and drain barriers — a separate product that the controller never imports.
  It now lives in the local `baton-queue` project; this bundle no longer ships
  it, and the skill no longer documents the `queue` verbs.
- **The repository's own OpenSpec change is gone.** `openspec/` held the design
  change for a past release of baton itself; `docs/architecture.md` carries the
  current design, so the change file only repeated it.

## 0.2.2 (2026-11-04)

Four CLI reliability fixes found by running the real commands. No protocol or
state-machine change: the action batch, the plan store and the sealed-receipt
contract are unchanged.

- **`queue.py exec` no longer wedges a resource on a spawn failure.** A command
  that cannot be started (typo, missing binary) used to keep its lease, so the
  resource stayed held by a dead owner and every later `gate` on it waited
  forever. The failure now releases the lease as `failed`; the error still
  surfaces as `Error: ...` (exit 1).
- **Bad `--capacity` / empty `--session-id` are usage errors, not tracebacks.**
  `actions` and `reconcile` documented capacity 1..5 as a hard cap but crashed
  with a Python traceback on `0`, `6` or `""`. Both flags are validated at the
  CLI boundary now: exit 2, one usage line naming the allowed range.
- **An out-of-range task id is the documented `TasksMarkdownError`.** `## 100.`
  or `1.100` in tasks.md escaped as a raw `ValueError` traceback from
  `session_control.py status|actions` and `ticket_board.py check`; it now reads
  like every other malformed-tasks.md case (one JSON error line, exit 1).
- **The `[x]` write-back preserves the file it edits.** `check_task` keeps the
  file's line endings (a CRLF tasks.md used to be rewritten to LF, turning one
  checkbox into a whole-file diff) and matches exactly the task lines the
  parser accepts (extra spaces inside the brackets), so a parsed ticket can
  always be checked off — previously such a line parsed fine and then failed
  as "task not found" after the assignment had already been integrated.

Regression: `./tests/regression.sh` — 309 passed, 2 skipped, 5/5 stages green.

## 0.2.1 (2026-11-03)

The CLI is the only control surface: the local MCP adapter is retired from the
bundle (`scripts/session_control.py` + `scripts/receipt.py` are the whole
surface).
