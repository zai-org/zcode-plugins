---
name: autoresearch
description: Run an autonomous experiment loop in ZCode. Set a goal and a mechanical metric, then iterate: modify code, run the benchmark, keep improvements, revert regressions, repeat. Use when the user wants the agent to autonomously optimize something measurable (runtime, bundle size, test speed, loss, any number) over many iterations, or says "autoresearch". Tools: init_experiment / run_experiment / log_experiment / export_dashboard / clear_experiments (MCP, from this plugin).
---

# Autoresearch

Set a goal, pick a mechanical metric, and let the loop iterate. The plugin's MCP tools own timing, metric parsing, git commit/revert and the ledger; you make the decisions.

## Security invariants (never violate)

1. **Never modify `.auto/measure.sh` or `.auto/checks.sh`**: the metric and the correctness gate must stay frozen. The PreToolUse hook also denies this.
2. **Never run arbitrary commands through `run_experiment` when `.auto/measure.sh` exists**: it only runs the benchmark script.
3. **Never keep a run whose checks failed.**
4. **Only touch files inside the agreed scope**; one focused change per experiment.
   4b. **Benchmark drift**: if `run_experiment` returns `benchmark_drift: true`, the frozen benchmark (measure.sh/checks.sh) changed since the session started, so metrics are no longer comparable. Start a new segment (`init_experiment`) or confirm the change with the user; do not keep comparing old and new numbers.
5. **Do not start experiment tools without a session**: both `run_experiment` and `log_experiment` refuse without one (tool-internal checks); call `/autoresearch:autoresearch` first rather than creating a stray session.
6. To pause the loop and its hints: `/autoresearch:off` (writes `autoresearchOff: true`); `/autoresearch:autoresearch` clears the marker and resumes.

## Session state (all under `.auto/`)

- `log.jsonl`: append-only ledger of config rows + run rows. Single source of truth.
- `goal.md`: the deep goal, recorded **verbatim** from the user at setup. Frozen — the PreToolUse hook denies writes; the harness-edit step cannot touch it.
- `scope.md`: the user-agreed scope boundary (files in scope + off limits). Frozen the same way — widening or narrowing it is the user's call, not the loop's.
- `prompt.md`: the session charter (goal quote / metric / scope quote / What's Been Tried). Its Goal section quotes `goal.md`, its scope section quotes `scope.md`, both verbatim. Update "What's Been Tried" as you go.
- `measure.sh`: the benchmark; prints `METRIC name=value` lines.
- `checks.sh`: optional correctness gate, run after a passing benchmark.
- `experience.md`: cross-segment lessons — at most one per segment (`cue` / `lesson` / `evidence` / `confidence`), or `NO_ENTRY`. Survives `clear`; reviewed into the project AGENTS.md at finalize.
- `config.json`: optional overrides (`maxIterations`, `consecutiveFailures`, `workingDir`, `auditBypass`, `autoresearchOff`); server-managed keys (benchmark hashes, pending checks state) also live here.
- `ideas.md`: optional backlog of hypotheses.

## The loop

For each iteration, exactly one pass through:

1. Read `.auto/prompt.md` (and the ledger tail, which the hook injects). **Revisit check**: before picking, check whether the latest result invalidated a previous discard's rollback reason (the injected 「弃用方向与理由」 line, or the `asi.rollback` rows in the ledger); if yes, weigh a targeted retry of that discard alongside the other candidates and annotate it with `asi.revisits_run`; if no, move on. Then pick the next hypothesis; prefer `asi.next_action_hint` from the last `log_experiment`. At a fresh segment, do the cold-start ideation step first (tier-tagged hypotheses into `ideas.md` before touching code — `references/loop-protocol.md` → Segment cold start).
2. Make **one focused change** to the code under test.
3. `run_experiment` (the benchmark). Note `metric`, `metrics`, `checks.failed`, `exit_code`. **If the metric looks noisy, use `repeat: 3` and log the returned `median_metric`.**
4. `log_experiment`:
   - metric improves on the current best (the ratchet line: `best` in the log result; the segment baseline only seeds it before the first keep) → `status: "keep"` (auto-commits with `experiment:` prefix). A run that beats the baseline but not the best is still a `discard` — the audit rejects such keeps
   - worse, unchanged, crashed, or checks failed → `status: "discard"` / `"crash"` / `"checks_failed"` (auto-reverts the working tree, `.auto/` survives). Distinguish two crash causes: an idea that is fundamentally broken (logic bug, architectural OOM) is a plain crash; an environment problem (network outage, missing dependency, platform throttling) is an infra crash — annotate it with `asi.infra: true` (advisory; infra rows are excluded from the doom-loop signal). Fix the environment or retry once it clears instead of logging the idea as broken
   - weigh keep against simplicity: all else equal, prefer the simpler implementation. A tiny improvement that adds ugly complexity is usually not worth keeping; a deletion that matches or beats the previous metric is a clear win
   - pass `asi` with `{ hypothesis, next_action_hint, rollback }`; it is the only memory that survives a revert. Tag `hypothesis` with a tier prefix (`[struct]` / `[tune]` / `[ensemble]`) so shallow streaks stay visible to the idea-rotator hook. When deliberately retrying a previously discarded idea because its rollback reason no longer holds, add `revisits_run: <run number>` to `asi` so the dashboard marks it as a grounded revisit (`↻ Revisiting #N`); verification reruns for measurement noise are not revisits and get no annotation.
     4b. **The ledger is audited**: `log_experiment` rejects writes that break invariants. A keep that does not actually improve, a discarded improvement without a failed guard, broken run numbering, or a crash with un-rolled-back changes are all hard errors, not advice. Every logged metric must equal what `run_experiment` observed (the run's observation snapshot is consumed by each successful log — one log per run; re-run instead of retyping numbers), and a crash is only attested when the run measured nothing. (`.auto/config.json` `auditBypass: true` disables the audit invariants; only use it knowingly.)
5. **Read `confidence`, `plateau` and `doom_loop` from the log result**: low-confidence (red/yellow) improvements are "directional": keep them with a note, or re-measure with `repeat:3` before structural changes. If `plateau: true`, stop re-litigating the last 1%; either confirm with `repeat:3`, start a new segment (`init_experiment`), or summarize. If `doom_loop: true`, you are repeating/oscillating between the same hypotheses; stop repeating and do a research pass first (re-read `prompt.md` What's Been Tried, related docs, prior near-misses), then pick a structurally different direction. **Trigger the harness-edit step** when `plateau` or `doom_loop` fires, when consecutive failures hit the threshold, every ~8 runs, or at segment end (see Harness editing below).
6. If `iteration cap` reached → `init_experiment` again for a new target, or stop and summarize.

## Harness editing (second-order loop)

The loop optimizes the target code; this step lets the loop revise its **own harness** from ledger evidence. The deep goal in `.auto/goal.md` is the root and the scope boundary in `.auto/scope.md` is the fence — neither ever changes by the loop's hand; everything else in the harness is a revisable representation of them.

Trigger: `plateau`, `doom_loop`, consecutive-failure threshold, every ~8 runs, or segment end. Then:

1. **Edit rows first**: for each candidate change write `{component, change, observed, verdict}` before touching anything. `verdict` is `helped` / `hurt` / `no observed effect` / `confounded`; prefer `confounded` when one edit touches several components and no execution isolates the cause — an honest "confounded" is a useful record, an invented attribution poisons every later edit.
2. **Editable surfaces only**: `prompt.md` surface sections (the verbatim quotes of `goal.md` and `scope.md` stay untouched), `ideas.md`, `.auto/hooks/` config, repeat/segment choices. `.auto/goal.md`, `.auto/scope.md`, `measure.sh`, `checks.sh` are frozen (the hook denies goal and scope writes). If evidence says a wider — or narrower — scope would help, do not touch the boundary: ask the user to edit `scope.md`, or `init_experiment` for a new segment. Replacing the metric proxy or the optimization target is not an edit either — `init_experiment` for a new segment.
3. **KEEP_BASE**: an edit the evidence does not argue for is a regression. No edit is a valid outcome.
4. **Experience**: at segment end add at most one lesson to `.auto/experience.md` — `{cue, lesson, evidence, confidence}`, `evidence` citing run numbers — or `NO_ENTRY` when no behavioral contrast supports one. Distinguish workspace facts (verified here, labelled here) from transferable procedure; "be thorough" is not a lesson.

Full protocol: `references/loop-protocol.md` → Harness editing.

## Dashboard

Run `export_dashboard` (or `/autoresearch:export`) to start a **live** local dashboard at a `127.0.0.1` URL (auto-refreshes via SSE after every experiment); it also writes `autoresearch-dashboard.html` as a static fallback. Open the URL with a browser (e.g. `open <url>`) to watch progress. Reset the session with `clear_experiments` (or `/autoresearch:clear`); when experiments are done, `/autoresearch:finalize` splits kept work into clean PR-able branches.

## Working directory

By default the project directory is the research directory. To run experiments elsewhere, add `"workingDir": "<relative-or-absolute path>"` to `.auto/config.json`. The ledger, benchmark, git and dashboard all operate there (config stays in the project dir).

## Iteration hooks (optional)

Drop an executable script into `.auto/hooks/` to run custom logic around every experiment (fail-open, 30s timeout, output ≤8KB):

- `.auto/hooks/before.sh` runs before each benchmark; stdin gets a JSON line `{event, cwd, next_run, last_run, session}`, and its stdout is returned as `before_steer`.
- `.auto/hooks/after.sh` runs after each `log_experiment`; stdin gets `{event, cwd, run_entry, session}`, and its stdout is returned as `after_steer`.

Use hooks for things the agent shouldn't do by itself: checking external docs before a change, anti-repetition guards, sending notifications, keeping a learnings journal. Treat `*_steer` as advisory input. Ready-made examples live in `hooks/examples/before/` and `hooks/examples/after/` (anti-thrash, idea-rotator, hypothesis-reflection, self-check, learnings-journal, macos-notify, auto-tag-winners); copy one into `.auto/hooks/` renamed to `before.sh` (from `before/`) or `after.sh` (from `after/`) — those exact filenames are what the server executes. To write your own, load the `autoresearch-hooks` skill.

## Unattended runs (optional, user-authorized only)

When the user explicitly asks for unattended operation ("run overnight", "无人值守跑"), the loop can keep going across turns: create a scheduled self-wakeup with the host's `CronCreate` tool (finite schedule + maxRuns, self-contained wake prompt) right after authorization; wake turns re-enter the loop via the `.auto/` facts. Only create the task on explicit user request - an unprompted scheduled wakeup is a scare behavior. Cleanup happens in user turns (`/autoresearch:off` / `/autoresearch:clear` / `/autoresearch:finalize` include the CronList + CronDelete step); leftover wakes idle cheaply until maxRuns if the loop ends early. Full protocol: `references/unattended.md`

## Details

- Setup guide (target → metric → measure.sh → checks.sh): `references/setup-guide.md`
- Full loop protocol and failure handling: `references/loop-protocol.md`
- Unattended continuation (scheduled self-wakeup, authorization + template + cleanup): `references/unattended.md`
