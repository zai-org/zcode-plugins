---
name: cycle-run
description: Use when a workflow is armed or running - after /cycle:run, on explicit implementation intent, or to continue a governed delivery. Defines the exact orchestration procedure through the control plane tools: routing, architecture, isolated worktree, execution, candidate freeze, mandatory verification, independent reviews, arbitration, the five-cycle repair loop and promotion.
---

# Running a Governed Workflow

The daemon owns every transition and refuses out-of-order submissions. Your
job is to feed it exact inputs, dispatch roles, and relay outcomes. Never
fabricate a state the daemon did not return.

Throughout: pass the project's absolute directory as `project_key`. The bridge
derives the project identity from the directory it was started for and uses that
regardless, so the value you pass cannot split one project into two. Do not
invent a slug, and do not carry a key over from an earlier session. Before every
role dispatch, generate a fresh UUID role token, call `cycle_role_register`
with that token as `session_id`, the exact role, project key and workflow id,
and include the token in the dispatched prompt. Revoke that exact token after
the role returns. The installed `zcode-cycle:<role>` project profile is the
host identity used by the fail-closed Hook; the token binds audit and browser
evidence to the workflow. Never reuse a token or invent a host session id.
The token itself must be a UUID; labels such as `orchestrator-main` are invalid.
Every role dispatch is fail closed: if the exact `zcode-cycle:<role>` profile
cannot start for any reason (including an unsupported model or thought level),
cancel or block the workflow and report the configuration error. Never retry
with `general-purpose`, another profile, another model, or an unregistered
session. A substitute agent is not evidence for the configured role.

## 0a. Probe every pinned role before any work

Call `cycle_role_profiles` with the `status` operation. Every role reported with
`dispatch_unverified: true` carries a model this plugin cannot vouch for: only
the host resolves providers, and it answers at dispatch. Before `cycle_start`,
dispatch each such role once with a throwaway prompt that asks for a single word
and nothing else.

If a probe cannot start, stop here and report the configuration error with the
host's exact message. Do not begin a workflow. A pinned model that cannot be
dispatched otherwise surfaces only at the review phase, after an architecture, an
execution and five verification gates have already been paid for — which is what
the 1.0.6 certification measured, three times.

Roles on `inherit` need no probe: that is the model the session is already
running on.

## 0. Capture and start

When armed (or on explicit implementation intent), take the user's request
message **verbatim** — the whole message, never your summary — and call
`cycle_start` with it. Record the returned `workflowId`, `mode` (quick or
full) and `requestDigest`. Require `orchestrator_locked: true`; otherwise stop
fail closed. From this point until terminal cleanup the main session never
uses Edit, Write, ApplyPatch, MultiEdit, NotebookEdit, Bash or Shell — all
implementation is performed by a registered executor. Report the route and
the repair budget (five).

## 1. Architecture

Quick and full modes both require a validated architecture plan. A quick
workflow enters `quick_execution` immediately, but that state does **not**
permit worktree creation until the plan has been accepted and stored.

1. Create and register an architect role token.
2. `cycle_code_index` for the workflow; pass the paths and scopes summary
   to the architect as context. Include the project standards file
   (`.zcode-cycle/standards.md` in the project root) when it exists.
3. Dispatch `zcode-cycle:architect` with the verbatim request, the exact
   `requestDigest` returned by `cycle_start`, and the code context. Interrogate
   the returned graph before submitting: every risk
   and ambiguity the architect recorded gets a forcing question answered
   or explicitly accepted by the user; unresolved material ambiguity goes
   back to the architect, not forward to execution. Protocol requirements
   the graph must satisfy: task `id` and `dependencies` are UUIDs;
   `write_scopes` are repository-relative; `verification_commands` are
   single commands (no `&&`, `||`, `;`, pipes or redirections; git, sh
   and powershell are blocked) runnable from the repository root.
4. Before calling `cycle_submit_architecture`, require exactly the documented
   plan fields: no `plan_id`, string requirements, `description` tasks, short
   IDs or missing `request_digest`. Continue only with a schema-valid graph.
5. Call `cycle_submit_architecture` with the architect token as
   `role_session_id`. Revoke the architect role token only after the accepted
   receipt. Rejected: send the exact validation reason back to the architect
   and repeat (at most five attempts; then `cycle_report_execution` `blocked`
   and stop).

## 2. Worktree

Only after `cycle_submit_architecture` returns `accepted: true`, call
`cycle_prepare_worktree` and record the returned `path` and `baseRevision`.
All execution happens inside that path, never in the project directory.
The main session is mutation-locked and must dispatch the executor into the
returned path; it never implements a "quick" change in place.

## 3. Execution

1. Create and register an executor role token.
2. Dispatch `zcode-cycle:executor` with the task graph, the worktree path
   and the base revision. The executor commits its work in the worktree
   (candidates freeze committed state). Collect per-task reports.
3. For each task, `cycle_audit` an `execution_task_<status>` observation
   with the changed paths.
4. Any task failed: send its report as repair feedback to the executor and
   repeat from step 2 (shared budget of five repair cycles, counted below).
   `PLAN_DEFECT`: `cycle_report_execution` `plan_defect`; if the daemon
   returns the workflow to architecture, go to phase 1 keeping the same
   workflow id.
5. Revoke the executor role token.

## 4. Verification

1. `cycle_plan_verification` — record `planId` and `evidenceIds`.
2. Managed browser evidence (UI-affecting changes): the daemon discovers
   mandatory `browser:affected-user-flow` and
   `accessibility:affected-user-flow` gates, satisfied only by an
   attested session whose receipt contains the required operation
   subsequence. Run one registered executor role token and session with
   `cycle_browser` (pass that token as `session_id`) in this
   order — `open` the page (loopback allowed by default), `check` the
   expected text, `screenshot`, `logs`, `snapshot` (accessibility),
   `close` — then pass `browser_session_ids` plus the frozen
   `candidate_digest` to verify. External origins require explicit user
   approval (`approve_origin`) after the tool reports
   `origin-approval-required`.
3. `cycle_freeze_candidate` with the base revision, plan id and evidence
   ids. Record `candidateId`, `candidateDigest` and the manifest.
   If the freeze is refused because **the project changed while this
   workflow was holding it**, the project directory is the operator's, not
   the workflow's. Never dispatch a role - or act yourself - to modify,
   commit, revert, stash or delete anything in it, including untracked files
   you did not create: a file you cannot explain may be the operator's own
   work, or a file the host writes. Report the named paths verbatim, say the
   operator must resolve them, and stop; after they do, freeze again.
4. `cycle_verify_candidate`. Record every gate's status.
5. Mandatory gates failed or skipped for lack of valid attestations: the
   evidence becomes repair feedback; the daemon drives the state back to
   execution — continue from phase 3 and count one repair cycle. Five
   failed repairs: the daemon blocks; report the blocked state and stop
   (recovery is `/cycle:resume`).

## 5. Reviews (full mode only)

1. Create and register distinct tokens for both reviewers
   (`functional_reviewer`, `security_reviewer`).
2. Dispatch `zcode-cycle:functional-reviewer` and
   `zcode-cycle:security-reviewer` — both in the same turn, so they run in
   parallel — each with the verbatim original request, the plan, the
   candidate manifest, the verification evidence and, when present, the
   project standards file content.
3. Collect both verdict JSONs and `cycle_submit_review` each with its matching
   reviewer token as `role_session_id`. Revoke both tokens only after accepted
   receipts.

## 6. Arbitration

1. Create and register an arbiter role token.
2. Dispatch `zcode-cycle:arbiter` with the verbatim original request, the
   candidate manifest, the raw evidence records and **both review verdicts in
   full** — decision, findings and repair target for each. An arbiter that
   cannot see a rejection cannot honour it, and the plane will refuse the
   approval that follows.
3. `cycle_submit_arbitration` with its verdict JSON and the arbiter token as
   `role_session_id`. Read the state the plane returns; never assume it from
   the verdict you submitted.
   - Approved: `cycle_promote_candidate` with the project directory, then
     report the delivered paths and the final state. Audit an
     `approved_candidate_delivered` observation. Done.
     Promotion confirms it is delivering into the right repository by
     comparing the project directory against the one `cycle_code_index`
     recorded in phase 1. If you skipped or lost that step while recovering
     from something else, promotion refuses here and the remedy is to run
     `cycle_code_index` for the project and promote again — the candidate and
     its approval are untouched.
   - Rejected with `repair_target` `execution`: the verdict is repair
     feedback; continue from phase 3, one repair cycle.
   - Rejected with `repair_target` `architecture`: continue from phase 1,
     one repair cycle.
   - **Refused**: the arbiter approved against a live rejection or over a
     failed mandatory gate. The plane has recorded the verdict, named the
     refusal in the audit chain and routed the workflow to repair itself, so
     the returned state is already `execution` or `architecture`. Continue
     from there and count one repair cycle. Do **not** re-dispatch the arbiter
     on the same candidate: the inputs have not changed and neither would the
     verdict.
4. Revoke the arbiter role token.

## Repair budget

Five repair cycles across the whole workflow (execution restarts and
architecture restarts share it). When the daemon reports blocked, say so
plainly: the work is preserved, `/cycle:resume` reconciles and continues.

## Reporting

Always: next action first line, current state (from the daemon, never
assumed), numbered steps, no filler. Never claim completion the daemon did
not report.
