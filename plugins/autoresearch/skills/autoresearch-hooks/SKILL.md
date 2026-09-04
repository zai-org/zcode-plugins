---
name: autoresearch-hooks
description: Teach how to write iteration hooks (before/after scripts) for the autoresearch plugin: contract, scenario selection, mock testing, and guidelines. Use when the user wants to add a custom hook, extend the loop with external logic (lookups, notifications, journals, guards), or understand the .auto/hooks mechanism.
---

# Writing autoresearch hooks

The loop runs `before` (each benchmark) and `after` (each `log_experiment`) hooks from `.auto/hooks/`. Hooks are plain scripts: use them for anything the agent shouldn't be trusted to do on its own, or that should run deterministically every iteration.

## Contract

|                       | before.sh                                                                                                                                                                                              | after.sh                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| when                  | before each benchmark                                                                                                                                                                                  | after each `log_experiment`                |
| stdin (one JSON line) | `{event:"before", cwd, next_run, last_run, session}`                                                                                                                                                   | `{event:"after", cwd, run_entry, session}` |
| stdout                | returned to the agent as `before_steer` (advisory)                                                                                                                                                     | returned as `after_steer` (advisory)       |
| constraints           | exit within 30s (killed otherwise); stdout ≤8KB; **fail-open** (errors never block the loop, but failures surface as `*_steer`, e.g. `[before hook exited 3] …` / `[before hook timed out after 30s]`) | same                                       |

`session` = `{metric_name, direction, baseline_metric, best_metric, run_count}`.
`last_run` (before) = previous run or `null`: `{run, status, metric, description, asi}`. `run_entry` (after) = the run just logged: `{run, status, metric, description, commit, asi}`. `asi` carries the Actionable Side Information the agent recorded (`hypothesis`, `next_action_hint`, `rollback`, …); mine it, don't require it.

Every fire (success or failure) appends a `{type:"hook", stage, exit_code, duration_ms, stdout_bytes, timed_out}` entry to `.auto/log.jsonl` for observability.

Rules of thumb:

- **Silence is the default**: print nothing unless you have something worth saying.
- **One hook, one concern**: a reminder hook vs a journal hook are different files.
- No environment variables; everything comes from stdin.

## Scenario selection

Ask: does this hook **remind** (before, produce steer) or **do work** (after, side effect)?

- remind before a run → `before`:
  - repeated failures → anti-thrash guard (see `hooks/examples/before/anti-thrash.sh`)
  - need to try other directions → idea pool (see `idea-rotator.sh`)
  - force a hypothesis → reflection (see `hypothesis-reflection.sh`)
  - external lookup before changing code → read docs/web then print a steer
- do work after a run → `after`:
  - keep a human diary → journal (see `learnings-journal.sh`)
  - notify on completion → macOS notification (see `macos-notify.sh`)
  - mark new bests → git tag (see `auto-tag-winners.sh`)
  - anything the loop should record but the agent shouldn't be trusted to do

## Steps

1. Read `.auto/prompt.md` and `.auto/measure.sh` to understand the session.
2. Pick the closest example from `plugin/hooks/examples/` (or write from scratch).
3. Parse stdin with node (available everywhere): read the payload, act, print only what should be a steer.
4. Smoke-test with a mock payload before committing:
   ```bash
   printf '%s\n' '{"event":"before","cwd":".","next_run":1,"last_run":null,"session":{"run_count":0}}' \
     | bash .auto/hooks/before.sh
   ```
   For an after hook, replace with an `{"event":"after","cwd":".","run_entry":{...},"session":{...}}` payload.
5. `chmod +x .auto/hooks/before.sh` (or `after.sh`) and commit; the loop picks it up immediately.

## Guidelines

- Steer is **advisory**: the agent may ignore it; keep messages short and actionable.
- Hooks run **every** iteration: no interactive prompts, no long work (30s cap).
- The hook directory lives in `.auto/`, which is exempt from discard rollback, so hook state survives.
- If a hook is broken, the loop continues (fail-open) and the failure comes back as a `*_steer` like `[before hook exited 3] <stderr>`; the stderr tail is included, so fix the hook.
