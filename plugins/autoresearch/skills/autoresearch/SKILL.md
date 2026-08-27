---
name: autoresearch
description: Run an autonomous experiment loop in ZCode — set a goal and a mechanical metric, then iterate: modify code, run the benchmark, keep improvements, revert regressions, repeat. Use when the user wants the agent to autonomously optimize something measurable (runtime, bundle size, test speed, loss, any number) over many iterations, or says "autoresearch". Tools: init_experiment / run_experiment / log_experiment / export_dashboard (MCP, from this plugin).
---

# Autoresearch

Set a goal, pick a mechanical metric, and let the loop iterate. The plugin's MCP tools own timing, metric parsing, git commit/revert and the ledger; you make the decisions.

## Security invariants (never violate)

1. **Never modify `.auto/measure.sh` or `.auto/checks.sh`** — the metric and the correctness gate must stay frozen. The PreToolUse hook also denies this.
2. **Never run arbitrary commands through `run_experiment` when `.auto/measure.sh` exists** — it only runs the benchmark script.
3. **Never keep a run whose checks failed.**
4. **Only touch files inside the agreed scope**; one focused change per experiment.
   4b. **Benchmark drift**: if `run_experiment` returns `benchmark_drift: true`, the frozen benchmark (measure.sh/checks.sh) changed since the session started — metrics are no longer comparable. Start a new segment (`init_experiment`) or confirm the change with the user; do not keep comparing old and new numbers.
5. **Do not start experiment tools without a session** — the PermissionRequest gate denies them when `.auto/log.jsonl` is missing; call `/autoresearch:autoresearch` first.
6. To pause auto-resume hints: `/autoresearch:off` (writes `autoresearchOff: true`); resume with `/autoresearch:autoresearch`.

## Session state (all under `.auto/`)

- `log.jsonl` — append-only ledger: config rows + run rows. Single source of truth.
- `prompt.md` — the session charter (goal / metric / scope / Off Limits / What's Been Tried). Update "What's Been Tried" as you go.
- `measure.sh` — the benchmark; prints `METRIC name=value` lines.
- `checks.sh` — optional correctness gate, run after a passing benchmark.
- `config.json` — optional `{ "maxIterations": N }` override.
- `ideas.md` — optional backlog of hypotheses.

## The loop

For each iteration, exactly one pass through:

1. Read `.auto/prompt.md` (and the ledger tail — the hook injects it). Pick the next hypothesis; prefer `asi.next_action_hint` from the last `log_experiment`.
2. Make **one focused change** to the code under test.
3. `run_experiment` (the benchmark). Note `metric`, `metrics`, `checks.failed`, `exit_code`. **If the metric looks noisy, use `repeat: 3` and log the returned `median_metric`.**
4. `log_experiment`:
   - metric improved vs baseline → `status: "keep"` (auto-commits with `experiment:` prefix)
   - worse, unchanged, crashed, or checks failed → `status: "discard"` / `"crash"` / `"checks_failed"` (auto-reverts the working tree, `.auto/` survives)
   - pass `asi` with `{ hypothesis, next_action_hint, rollback }` — it is the only memory that survives a revert.
     4b. **The ledger is audited**: `log_experiment` rejects writes that break invariants — a keep that does not actually improve, a discarded improvement without a failed guard, broken run numbering, or a crash with un-rolled-back changes. These are hard errors, not advice. (`.auto/config.json` `auditBypass: true` disables this — only use it knowingly.)
5. **Read `confidence`, `plateau` and `doom_loop` from the log result**: low confidence (red/yellow) improvements are "directional" — keep but note it, or re-measure with `repeat:3` before structural changes. If `plateau: true`, stop re-litigating the last 1%; either confirm with `repeat:3`, start a new segment (`init_experiment`), or summarize. If `doom_loop: true`, you are repeating/oscillating between the same hypotheses — stop and pick a structurally different direction.
6. If `iteration cap` reached → `init_experiment` again for a new target, or stop and summarize.

## Dashboard

Run `export_dashboard` (or `/autoresearch:export`) — it starts a **live** local dashboard at a `127.0.0.1` URL (auto-refreshes via SSE after every experiment) and also writes `autoresearch-dashboard.html` as a static fallback. Open the URL with a browser (e.g. `open <url>`) to watch progress. Reset the session with `clear_experiments` (or `/autoresearch:clear`); when experiments are done, `/autoresearch:finalize` splits kept work into clean PR-able branches.

## Working directory

By default the project directory is the research directory. To run experiments elsewhere, add `"workingDir": "<relative-or-absolute path>"` to `.auto/config.json` — the ledger, benchmark, git and dashboard all operate there (config stays in the project dir).

## Iteration hooks (optional)

Drop an executable script into `.auto/hooks/` to run custom logic around every experiment (fail-open, 30s timeout, output ≤8KB):

- `.auto/hooks/before.sh` — runs before each benchmark; stdin gets a JSON line `{event, cwd, next_run, last_run, session}`; its stdout is returned as `before_steer`.
- `.auto/hooks/after.sh` — runs after each `log_experiment`; stdin gets `{event, cwd, run_entry, session}`; its stdout is returned as `after_steer`.

Use hooks for things the agent shouldn't do by itself: checking external docs before a change, anti-repetition guards, sending notifications, keeping a learnings journal. Treat `*_steer` as advisory input. Ready-made examples live in `hooks/examples/` (anti-thrash, idea-rotator, hypothesis-reflection, learnings-journal, macos-notify, auto-tag-winners) — copy one into `.auto/hooks/` to use it. To write your own, load the `autoresearch-hooks` skill.

## Details

- Setup guide (target → metric → measure.sh → checks.sh): `references/setup-guide.md`
- Full loop protocol and failure handling: `references/loop-protocol.md`
