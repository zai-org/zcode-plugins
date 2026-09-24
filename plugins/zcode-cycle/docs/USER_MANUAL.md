# ZCode Cycle — User Manual

ZCode Cycle adds governed, evidence-gated software delivery to ZCode. A
`Cycle` orchestrator coordinates five independent roles — an architect,
an executor, a functional reviewer, a security reviewer and a final
arbiter — over a deterministic control plane. Work happens in isolated
git worktrees; candidates are frozen with digests; verification runs
real commands; the arbiter sees the original request, the exact
candidate and the raw evidence, never the executor's summary. Nothing is
declared done that the control plane did not verify.

## Installation

1. In ZCode: Settings → Plugin Management → Discover → `+` → add the
   repository `jannotix/zcode-cycle-plugin` as a marketplace (or a local
   directory clone of it).
2. Install `zcode-cycle`, open the project and run `/cycle:setup install`.
   This writes five managed profiles under `.zcode/agents` and refuses any
   unowned conflicting file.
3. Start a new session, then run `/cycle:setup`. On Windows, quit from the
   tray if a normal restart does not reload plugin or project profiles.

Requirements: ZCode Desktop with plugin support, a git repository for
the project you govern, and Node.js for the bundled bridge. The
`workflowd` control-plane binary ships with the plugin per platform.

## The roles

| Role | Boundaries |
|---|---|
| Architect | Read-only. Decomposes the exact request into a validated task graph. |
| Executor | Implements bounded tasks in the isolated worktree, commits its work. |
| Functional reviewer | Read-only. Completeness, behavior, tests, every user-visible path. |
| Security reviewer | Read-only. Security, trust boundaries, architecture. Blocking findings need a reproducible path. |
| Arbiter | Read-only. Final approval from the original request plus evidence plus reviews. The only role that can approve. |

Read-only roles physically lack edit and shell tools in the managed project
profiles. That is the boundary — not a convenience in front of one. ZCode runs
the PreToolUse hook for your main session and not inside a dispatched agent, so
once a role is running, its profile is what holds.

The hook still does real work, on the main session: while a workflow is locked
it denies you mutating the project directly, and it denies a role dispatch that
has no unique Cycle registration, so raw direct role launches fail.

The executor is the exception, and it is worth knowing how it is held. It
legitimately holds edit and shell tools, so its profile cannot bound it the way
it bounds the others, and the hook does not reach it either. Nothing physically
stops it writing outside the isolated worktree. What the control plane does
instead is refuse to build a candidate on a project that moved: freezing checks
that your project still stands exactly where the workflow started, with nothing
uncommitted, and names the files it found if it does not. Work that escaped the
worktree therefore stops the workflow instead of riding along with it.

Two consequences for you. Leave your project alone while a run is in flight —
your own uncommitted edit stops the freeze the same way a stray one does. And
commit what Cycle delivered before starting the next run, because promotion is
fast-forward onto the revision it started from.

## Which model runs a role

Each role can be pinned to its own model with `/cycle:models`, so the
arbiter can judge on a stronger model than the one that drafted the work. The
choice is written into the managed profile, and the ledger records the model
that was pinned for every event a role produces — a receipt says which model
approved a candidate, not merely that one did.

A model reference is `inherit` or `custom:<provider-id>:<model>`, with the
provider id URI-encoded the way ZCode encodes it - a colon inside it is written
`%3A`, because ZCode splits the reference at the first colon:

| Provider as ZCode shows it | Reference |
|---|---|
| `account:zai-individual-coding-plan`, model `GLM-5.3` | `custom:account%3Azai-individual-coding-plan:GLM-5.3` |
| `builtin:zai-coding-plan`, model `GLM-5.3` | `custom:builtin:zai-coding-plan:GLM-5.3` |
| any | `inherit` - follows the session |

Which providers exist is the host's answer. On the 1.0.9 certification host the
Z.ai plan resolves only under `account:zai-individual-coding-plan`, and every
`builtin:` reference fails at dispatch. Third-party models you add to ZCode are
assigned the same way. Cycle checks only the reference's shape and reports every
pin as `dispatch_unverified`; the run then probes each pinned role before a
workflow starts, so an unreachable provider is found in seconds. Use
`/cycle:models` rather than editing a profile by hand: only an assignment made
through it is recorded, and only a recorded pin is reported if a later rewrite
of the profile loses it. Your own main session is unaffected.

## Modes and routing

`/cycle:run auto` lets the deterministic router choose: small
well-understood changes take the quick route (verification and
arbitration); risk signals — authentication, cryptography, migrations,
dependencies, public interfaces, deployment, large refactors — take the
full route with both independent reviews. `quick` and `full` force a
route; a critical downgrade is refused without explicit approval. A normal
conversation in the main orchestrator session stays read-only until you arm a
run or express implementation intent.

## The governed flow

Intake and routing → architecture (the graph is validated by the daemon;
the orchestrator interrogates risks and ambiguities before submitting) →
isolated worktree from your current HEAD → execution with per-task
verification commands → candidate freeze (per-file digests) → mandatory
verification gates (your commands, secret scanning, candidate integrity,
and — for UI changes — managed-browser evidence) → full route only:
both reviews in parallel → arbitration → approved candidates are
promoted to your project directory. Failures drive a repair loop capped
at five cycles, then a recoverable blocked state.

Two operational rules keep promotion clean: the executor commits inside
the worktree (candidates are committed state), and you commit delivered
changes in your project between workflows (promotion is fast-forward
only — it applies onto the base revision it started from).

## Goal Mode

Persistent objectives above single workflows: immutable objective,
constraints, non-goals, success criteria, a versioned plan, milestones
linked to real workflows, bounded continuations. Completion is gated:
every milestone needs a COMPLETED workflow (cancelled does not count)
and the approval must cite the arbiter's receipt digest as evidence.
Manage goals with `/cycle:goal`.

## Managed browser QA

For UI-affecting changes the daemon adds mandatory browser gates,
satisfied only by an attested managed-browser session: isolated
temporary profile, loopback pages allowed by default, external origins
blocked until you explicitly approve them, actions and logs recorded as
a receipt bound to the candidate digest. Interactive actions are
executor-only. See the browser guide.

Whether a change affects the interface is decided from the files a write
scope covers, not from how the scope was worded: a scope naming a
directory is expanded to the files under it before the question is
asked, so declaring `public` rather than `public/index.html` does not
remove the gates.

## What blocks a promotion

A mandatory gate that fails blocks promotion, and so does one that
cannot start: a gate whose program cannot be spawned is recorded as
failed with the reason, never left pending. A verification plan is
refused outright if a gate's program is a shell expression rather than
an executable, because the daemon spawns it directly.

An arbiter's approval is refused where it contradicts something the
record already holds: a live reviewer rejection, a mandatory gate that
did not pass, or an explicit constraint of the immutable original
request. The last of these is checked mechanically only where the
request is plain enough to decide by comparing paths — "do not modify
any test file" against the candidate's file list. Anything less explicit
stays a matter of judgement, and silence from this check is never an
approval.

## Project memory and history

Every action lands in a tamper-evident ledger (hash chain plus signed
checkpoints): who, when, which tools, which files, which outcome.
`/cycle:history verify` proves integrity. `/cycle:memory` manages
durable project knowledge — every entry cites ledger events as
provenance; manual entries cannot claim verified confidence.

## Code intelligence

An incremental index (git-fingerprinted) feeds the architect
request-scoped context without rescanning unchanged files. Unchanged
repositories report `reused: true` with zero parsed files.

## Recovery

`/cycle:resume` reconciles paused, interrupted or blocked work — the
daemon's state is durable, so even a hard kill loses nothing.
`/cycle:doctor` diagnoses; `/cycle:pause` and `/cycle:cancel --confirm`
control live runs.

## Where data lives

Everything durable — control-plane database, ledger keys, worktrees,
browser evidence, role registry — lives under your user data directory
(`%LOCALAPPDATA%\ZCode Cycle` on Windows, `~/.local/share/zcode-cycle`
on Linux), never inside the ZCode installation or your repository. The five
non-secret role configuration files live in `.zcode/agents`; remove them with
`/cycle:setup remove` before uninstalling. Uninstalling preserves audit data.

Cycle's native daemon is not signed with an Authenticode certificate, so Windows
may warn about an unrecognised publisher or block it outright. The README's
**Windows SmartScreen and the unsigned daemon** section explains how to verify
the download against its published checksum and build provenance first, and how
to unblock it afterwards.

Two things about an uninstall are ZCode's behaviour rather than Cycle's, and
neither can be changed from inside a plugin. ZCode's confirmation dialog warns
that it removes the plugin's cached files and data directory and that this
cannot be undone; read that as describing the installation. It does **not**
remove the marketplace's cached copy of the plugin — roughly 76 MB including a
native daemon per platform, inert and loaded by nothing — which you reclaim by
removing the marketplace itself afterwards. And it does not touch your audit
data, which is the point of keeping the control plane outside the plugin tree.
See "Known ZCode limitations" in the README.

## License

Copyright 2026 Gianluca Iannotta. FSL-1.1-MIT: every version becomes
MIT two years after its release. See `LICENSE` and `NOTICE`.
