# autoresearch

[中文文档](./README_CN.md)

Let the ZCode coding agent iterate autonomously on a fixed, mechanical metric: modify code → run the benchmark → keep improvements, revert regressions → repeat.

Based on research into [karpathy/autoresearch](https://github.com/karpathy/autoresearch) and [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) (see `docs/research/autoresearch-survey.md` at the repository root). Architecture decisions live in `adr/implemented/`.

## Security and side effects

This plugin executes code and operates on a git repository. Enabling it grants code-execution trust (official marketplace convention). Specifically, it:

- **Runs commands**: `run_experiment` executes the benchmark script you author (`.auto/measure.sh`) and, when present, the correctness gate (`.auto/checks.sh`);
- **Runs git operations automatically**: `git commit` on keep, automatic rollback on discard/crash/checks_failed (noop changes nothing; session state: `.auto/`, the host session dir `.zcode/`, and `autoresearch-dashboard.html`, is exempt from commit/rollback);
- **Installs ZCode hooks**: Stop (loop continuation), PreToolUse (frozen-file write protection), UserPromptSubmit (ledger memory injection), SessionStart (resume hint);
- **Serves a local HTTP dashboard** on 127.0.0.1 via `export_dashboard` (editorial archive page: full experiment history, trend across segments, light/dark themes);
- **Writes session state** to `.auto/` files (`log.jsonl`, `config.json`) in the project directory.

No third-party npm dependencies: the MCP server and hooks are Node-stdlib TypeScript scripts (Node ≥24, types stripped natively, no build step).

Node ≥24 must exist on the machine, but it does not have to be on the host's PATH: the MCP server and hooks launch through `scripts/launcher.mjs` via plain `node` (the one command the host resolves on all platforms), which resolves Node from PATH, then nvm (POSIX `$NVM_DIR` / Windows `%NVM_HOME%` or `%APPDATA%
vm`, newest-first), Homebrew or `/usr/local/bin` (POSIX) / `%ProgramFiles%
odejs` (Windows), and honors `AUTORESEARCH_NODE_BIN` to pin one explicitly (run `node scripts/launcher.mjs --resolve` to see what it picks). The benchmark scripts (`.auto/measure.sh`, `.auto/checks.sh`) are still bash and need a POSIX shell (Git-Bash or WSL) on Windows.

## Install

This repository is itself a plugin marketplace (`marketplace.json` points to `./plugin`). In ZCode:

1. Add the marketplace: this repository's URL (or a local directory).
2. In **Settings → Plugin Management**, install and enable `autoresearch`.
3. The plugin provides: an MCP server (5 tools), 2 skills (`autoresearch` + `autoresearch-hooks`), 5 slash commands, and 4 hooks.

## Usage

```
/autoresearch:autoresearch <goal>   # enter/resume autoresearch mode (runs setup if there is no session)
/autoresearch:export                # export the dashboard (live SSE URL + static autoresearch-dashboard.html)
/autoresearch:off                   # pause the loop and its hints (sets autoresearchOff: true)
/autoresearch:clear                 # reset the session ledger
/autoresearch:finalize              # organize kept experiments into a clean branch (scripts/finalize.sh)
```

Or let the skill trigger on its own (descriptions containing "autoresearch", "autonomous optimization", etc.). A full loop:

1. **Setup**: pick a mechanical metric → write `.auto/measure.sh` (emits `METRIC name=value` lines) → optionally `.auto/checks.sh` (correctness gate) → record the user's deep goal verbatim in `.auto/goal.md` and the agreed scope boundary in `.auto/scope.md` (both frozen; the hook denies rewrites) → write the `.auto/prompt.md` charter (its Goal/Scope sections quote the two files verbatim) → create an experiment branch `git checkout -b autoresearch/<tag>`.
2. `init_experiment` (metric_name, direction) → run a baseline.
3. **Loop**: one focused change → `run_experiment` → `log_experiment` (keep auto-commits; discard/crash/checks_failed auto-roll-back; noop changes nothing; `.auto/`, the host session dir `.zcode/`, and the dashboard are exempt from both).

## Tools (MCP)

| Tool                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_experiment`   | Start/restart an experiment segment (name, primary metric, direction lower/higher); optional loop calibration: `plateau_min_improvement` / `plateau_window` (set near the metric's real step size to avoid false plateaus) and `deterministic` (plateau switches to no-progress counting and hints skip repeat re-measurement); `founding_commit: true` folds pre-existing uncommitted work into a segment founding commit so keeps cannot ride along and discards restore it                                                                                                                                                                                                                                                                                                            |
| `run_experiment`    | Run the benchmark: `command` is optional when `.auto/measure.sh` exists (defaults to it), required in free-form mode; times it, parses `METRIC name=value` lines, returns a truncated tail (10 lines / 4KB), kills the process group on timeout, takes the median over `repeat` runs, runs the `before.sh` hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `log_experiment`    | Record the outcome: keep auto-commits (`experiment:` prefix); discard/crash/checks_failed auto-roll back (noop: nothing to roll back; session state `.auto/` + `.zcode/` + dashboard exempt); reports a discard/crash rollback via `rolled_back` (restored_to hash + file list), returns baseline/best/delta/confidence (unit × noise)/plateau/`runs_left` plus a next-action hint, with a `revisit_nudge` when a discard/checks_failed lands and the segment has a rollback-reasoned discard worth re-checking (annotate deliberate retries with `asi.revisits_run: <run number>`, and environment-caused crashes with `asi.infra: true` — infra rows are excluded from the doom-loop signal); the computed confidence is snapshotted into the ledger run row; runs the `after.sh` hook |
| `export_dashboard`  | Serve a live local dashboard (127.0.0.1 + SSE auto-refresh) and write a static HTML fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `clear_experiments` | Delete `.auto/log.jsonl` and reset the session (all other `.auto/` files are kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Guardrails

- **Benchmark locking**: when `.auto/measure.sh` exists, `run_experiment` only executes that script (validated after stripping env/time/nice wrappers and leading assignments; assignment values pass the same character whitelist, so `$(`/backtick smuggling is rejected).
- **Correctness backpressure**: when `.auto/checks.sh` exists, it runs automatically after a passing benchmark; a failing gate forbids keep and rolls back. A gate that never produces a verdict (not executable, killed by a signal, exits ≥126) is infrastructure, not failure — it does not veto keeps and is surfaced as `verdict: false`.
- **Write protection**: a PreToolUse hook denies Write/Edit/ApplyPatch rewrites (ApplyPatch's per-file targets are parsed from the patch text) of `.auto/measure.sh` / `.auto/checks.sh` / `.auto/goal.md` (the deep-goal record: the root the loop serves stays immutable while the harness-edit step revises its surface representations) / `.auto/scope.md` (the user-agreed scope boundary: the loop works inside the fence, it never redraws it — widening or narrowing is the user's edit or a new segment). First creation during setup is the intended exception — frozen means immutable once recorded. A denied rewrite attempt is recorded to the ledger as a `frozen_attempt` row.
- **Harness trace**: the editable surfaces (`prompt.md`, `ideas.md`, `experience.md`, `.auto/hooks/before.sh` / `after.sh`) are hashed at the accounting checkpoints (`run_experiment` / `log_experiment` / `export_dashboard`); anything that moved since the baseline gets a `harness_edit` row in the ledger — including hand edits, which no tool hook could see. The edit step's verdict discipline stays advisory; the fact of a change is mechanical.
- **Pause switch**: `/autoresearch:off` sets `autoresearchOff: true`, which silences Stop continuation, memory injection and the SessionStart hint; `init_experiment`/`clear_experiments` and the resume command clear it.
- **Memory injection**: UserPromptSubmit injects an aggregated summary (progress + deduped tried directions + best trajectory + discard reasons with rollback rationale + ASI distillation) so progress survives compaction; SessionStart injects the resume hint. Both stay silent while `autoresearchOff` is set.
- **Loop continuation**: the Stop hook blocks (`decision:block`) while a loop is unfinished and not paused (zcode platform limit: 3 consecutive windows).
- **Iteration hooks**: `.auto/hooks/before.sh` (pre-benchmark) and `after.sh` (post-record) run on every experiment (fail-open, 30s timeout, stdout → `*_steer`).
- **Hook ecosystem**: `skills/autoresearch-hooks` tutorial + 7 ready-to-use examples in `hooks/examples/before/` and `hooks/examples/after/` (anti-thrash, hypothesis reflection, idea rotator with shallow-streak nudge, hourly self-check, learnings journal, auto-tag winners, macOS notify); copy one into `.auto/hooks/` renamed to `before.sh` (from `before/`) or `after.sh` (from `after/`) — those exact filenames are what the server executes (parsed with Node, no jq dependency).
- **Stop-loss**: after `consecutiveFailures` in a row (default 3, configurable in `.auto/config.json`) the plugin hints you to stop.
- **Ledger audit**: `log_experiment` validates invariants before writing (keep must be a real improvement, a discarded real improvement must have failed the guard, a checks_failed row must be attested by a failed-checks verdict on the latest run, event ordering, commit field), and every logged metric must equal what `run_experiment` observed — the run's observation snapshot persists in config.json and is consumed by each successful log (one log per run; a crash is only attested when nothing was measured); cross-call `pending*` state is cleared wholesale at segment boundaries (`init_experiment`/`clear_experiments`), so a previous session's observation never attests the next one; violations are rejected; a noop on a dirty working tree carries an explicit warning; a crashed segment that wasn't rolled back blocks continuation. `auditBypass: true` in `.auto/config.json` explicitly skips both the audit and secondary-metric constraints (not recommended).
- **Benchmark drift detection**: `init_experiment` records hashes of measure.sh/checks.sh; `run_experiment` compares them, and a mid-run benchmark change returns a `benchmark_drift` warning (surfaces benchmark edits instead of silently accepting incomparable metrics).
- **Secondary-metric constraints** (opt-in): `log_experiment` supports `constraints: [{name, maxPct}]`. On keep, secondary metrics must stay within maxPct% of the first run's value; anything beyond rejects the keep (a "faster but much heavier" change is not a valid keep).

## Directory structure

```text
plugin/
├── .zcode-plugin/plugin.json   # manifest (userConfig: maxIterations / timeouts)
├── .mcp.json                   # MCP stdio server declaration
├── mcp/
│   ├── server.ts              # JSON-RPC line protocol + tools
│   └── lib/                    # pure logic: experiment / ledger / git / validate / dashboard / dashboard-server / html / paths / bash / frozen / harness / types
├── hooks/
│   ├── hooks.json              # Stop / PreToolUse / UserPromptSubmit / SessionStart
│   ├── stop-continue.ts       # loop unfinished → block
│   ├── guard-frozen.ts        # frozen-file write protection → deny
│   ├── memory-inject.ts       # ledger tail injection
│   ├── session-start.ts       # session resume hints
│   └── examples/               # 7 ready-to-use before/after iteration hooks
├── skills/
│   ├── autoresearch/           # SKILL.md thin router + references/
│   └── autoresearch-hooks/     # iteration-hook tutorial
├── commands/                   # autoresearch / export / off / clear / finalize
├── scripts/                    # launcher.mjs (cross-platform Node resolver for server + hooks) / finalize.sh (/autoresearch:finalize)
└── tests/                      # node --test unit tests
```

## workingDir

Setting `"workingDir": "work/"` in `.auto/config.json` separates the research directory from the project directory (ledger/benchmark/git/dashboard all act on work/, config stays in the project).

## Session state (`.auto/`)

| File            | Purpose                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log.jsonl`     | **append-only single source of truth**: config lines + run lines; segments advance on config lines; hook / harness_edit / frozen_attempt rows ride along as observations and never affect loop state                                                                                                                                                                         |
| `goal.md`       | the deep goal, recorded verbatim from the user at setup (frozen)                                                                                                                                                                                                                                                                                                             |
| `scope.md`      | the user-agreed scope boundary (files in scope + off limits, frozen)                                                                                                                                                                                                                                                                                                         |
| `prompt.md`     | session charter (goal/metric/scope/Off Limits/What's Been Tried)                                                                                                                                                                                                                                                                                                             |
| `measure.sh`    | benchmark script (frozen)                                                                                                                                                                                                                                                                                                                                                    |
| `checks.sh`     | optional correctness gate (frozen)                                                                                                                                                                                                                                                                                                                                           |
| `config.json`   | optional session overrides: `maxIterations`, `consecutiveFailures`, `workingDir`, `auditBypass`, `autoresearchOff`, loop calibration `plateauWindow` / `plateauMinImprovement` / `deterministic` (server-managed keys like `benchmarkHashes`/`pendingChecksFailed`/`pendingObservation` also live here; `pending*` keys are cross-call state, cleared at segment boundaries) |
| `ideas.md`      | optional hypothesis list                                                                                                                                                                                                                                                                                                                                                     |
| `experience.md` | optional cross-segment lessons (at most one per segment; survives clear)                                                                                                                                                                                                                                                                                                     |

The manifest `userConfig` (`maxIterations` / timeouts) seeds the **MCP server's** defaults via env; the hooks (Stop continuation, memory injection) cannot see it — they read `.auto/config.json` overrides only and fall back to 20 runs / 3 failures. Set session-level overrides in `config.json` when hooks and server must agree.

## Known limits (research-backed, see `docs/research/autoresearch-survey.md` §4.1 at the repository root)

- **Unattended runs**: two layers - the Stop-hook continuation window (3 consecutive) inside a session, plus scheduled self-wakeup via `CronCreate` (finite schedule + `maxRuns`, user-authorized only; see the skill's `references/unattended.md`). Infinite auto-resume stays impossible by platform design.
- **Headless mode (`--prompt`) does not run hooks**: guardrails take effect in interactive sessions; run autoresearch in an interactive session.
- **Frozen-file write protection covers file tools only**: the PreToolUse guard sees `Write`/`Edit`/`ApplyPatch`; shell redirections (e.g. `echo x > .auto/measure.sh`) bypass it and are caught by benchmark drift detection instead — detection after the fact, not prevention.
- **Windows spawn chain verified**: the MCP server and all hooks start via `node scripts/launcher.mjs` (plain `node`, no POSIX shell involved); resolver branches are covered on Windows by `tests/launcher.test.ts` — report anything odd there.
- A keep commits every uncommitted change inside the research directory — unrelated files included (known pi inheritance); commit a clean baseline during setup. Changes outside the research dir (`workingDir` mode) are never committed, and any pre-staged files elsewhere in the repo are unstaged first so the commit describes exactly this experiment.

## Development

```bash
cd plugin && node --test tests/*.test.ts   # unit tests
```
