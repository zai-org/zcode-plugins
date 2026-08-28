# autoresearch

[中文文档](./README_CN.md)

An autonomous experiment loop for ZCode: set a fixed, mechanical metric and let the coding agent iterate — modify code → run the benchmark → keep improvements, revert regressions → repeat.

Based on research into [karpathy/autoresearch](https://github.com/karpathy/autoresearch) and [pi-autoresearch](https://github.com/yourduskqubis/pi-autoresearch) (see `docs/research/autoresearch-survey.md`). Architecture decisions live in `adr/decisions/`.

## Security and side effects

This plugin executes code and operates on a git repository. Enabling it grants code-execution trust (official marketplace convention). Specifically, it:

- **Runs commands**: `run_experiment` executes the benchmark script you author (`.auto/measure.sh`) and, when present, the correctness gate (`.auto/checks.sh`);
- **Runs git operations automatically**: `git commit` on keep, automatic rollback on non-keep (`.auto/` is exempt from rollback);
- **Installs ZCode hooks**: Stop (loop continuation), PreToolUse (frozen-file write protection), PermissionRequest (experiment-tool gating), UserPromptSubmit/SessionStart (ledger memory injection);
- **Serves a local HTTP dashboard** on 127.0.0.1 via `export_dashboard`;
- **Writes session state** to `.auto/` files (`log.jsonl`, `config.json`) in the project directory.

No third-party npm dependencies: the MCP server and hooks are Node-stdlib TypeScript scripts (Node ≥24, types stripped natively — no build step).

## Install

This repository is itself a plugin marketplace (`marketplace.json` points to `./plugin`). In ZCode:

1. Add the marketplace: this repository's URL (or a local directory).
2. In **Settings → Plugin Management**, install and enable `autoresearch`.
3. The plugin provides: an MCP server (5 tools), the `autoresearch` skill, 5 slash commands, and 5 hooks.

## Usage

```
/autoresearch:autoresearch <goal>   # enter/resume autoresearch mode (runs setup if there is no session)
/autoresearch:export                # export a static dashboard (autoresearch-dashboard.html)
/autoresearch:off                   # pause loop continuation (sets autoresearchOff: true)
/autoresearch:clear                 # reset the session ledger
/autoresearch:finalize              # organize kept experiments into a clean branch (scripts/finalize.sh)
```

Or let the skill trigger on its own (descriptions containing "autoresearch", "autonomous optimization", etc.). A full loop:

1. **Setup**: pick a mechanical metric → write `.auto/measure.sh` (emits `METRIC name=value` lines) → optionally `.auto/checks.sh` (correctness gate) → write the `.auto/prompt.md` charter → create an experiment branch `git checkout -b autoresearch/<tag>`.
2. `init_experiment` (metric_name, direction) → run a baseline.
3. **Loop**: one focused change → `run_experiment` → `log_experiment` (keep auto-commits / non-keep auto-rolls-back, `.auto/` exempt).

## Tools (MCP)

| Tool                | What it does                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init_experiment`   | Start/restart an experiment segment (name, primary metric, direction lower/higher)                                                                                                                           |
| `run_experiment`    | Run the benchmark: times it, parses `METRIC name=value` lines, returns a truncated tail (10 lines / 4KB), kills the process group on timeout, takes the median over `repeat` runs, runs the `before.sh` hook |
| `log_experiment`    | Record the outcome: keep auto-commits (`experiment:` prefix); non-keep auto-rolls-back (`.auto/` exempt); returns baseline/best/delta/confidence/plateau plus a next-action hint; runs the `after.sh` hook   |
| `export_dashboard`  | Serve a live local dashboard (127.0.0.1 + SSE auto-refresh) and write a static HTML fallback                                                                                                                 |
| `clear_experiments` | Delete `.auto/log.jsonl` and reset the session (keeps measure/checks/prompt)                                                                                                                                 |

## Guardrails

- **Benchmark locking**: when `.auto/measure.sh` exists, `run_experiment` only executes that script (validated after stripping env/time/nice wrappers).
- **Correctness backpressure**: when `.auto/checks.sh` exists, it runs automatically after a passing benchmark; a failing gate forbids keep and rolls back.
- **Write protection**: a PreToolUse hook denies writes to `.auto/measure.sh` / `.auto/checks.sh`.
- **Tool gating (approximate)**: a PermissionRequest hook denies experiment tools when there is no session (only covers calls that go through the permission prompt).
- **Auto-resume hint**: SessionStart injects a continuation hint when an active session is detected; `/autoresearch:off` pauses it (`autoresearchOff: true`).
- **Memory injection**: UserPromptSubmit/SessionStart hooks inject an aggregated summary (progress + deduped tried directions + best trajectory + ASI distillation) so progress survives compaction; repeated/oscillating attempts (doom-loop) trigger a hint to switch direction.
- **Loop continuation**: the Stop hook blocks (`decision:block`) while a loop is unfinished (zcode platform limit: 3 consecutive windows).
- **Iteration hooks**: `.auto/hooks/before.sh` (pre-benchmark) and `after.sh` (post-record) run on every experiment (fail-open, 30s timeout, stdout → `*_steer`).
- **Hook ecosystem**: `skills/autoresearch-hooks` tutorial + 6 ready-to-use examples in `hooks/examples/` (anti-thrash, hypothesis reflection, idea rotator, learnings journal, auto-tag winners, macOS notify) — copy to `.auto/hooks/` and go (parsed with Node, no jq dependency).
- **Stop-loss**: after `consecutiveFailures` in a row (default 3, configurable in `.auto/config.json`) the plugin hints you to stop.
- **Ledger audit**: `log_experiment` validates invariants before writing (keep must be a real improvement, a discarded real improvement must have failed the guard, event ordering, commit field); violations are rejected; a crashed segment that wasn't rolled back blocks continuation. `auditBypass: true` in `.auto/config.json` explicitly skips it (not recommended).
- **Benchmark drift detection**: `init_experiment` records hashes of measure.sh/checks.sh; `run_experiment` compares — a mid-run benchmark change returns a `benchmark_drift` warning (prevents "faking the metric by editing the benchmark").
- **Secondary-metric constraints** (opt-in): `log_experiment` supports `constraints: [{name, maxPct}]` — on keep, secondary metrics are checked not to exceed maxPct% of the first run's value, rejected otherwise (prevents reward hacking like "trading memory for speed").

## Directory structure

```text
plugin/
├── .zcode-plugin/plugin.json   # manifest (userConfig: maxIterations / timeouts)
├── .mcp.json                   # MCP stdio server declaration
├── mcp/
│   ├── server.ts              # JSON-RPC line protocol + tools
│   └── lib/                    # pure logic: experiment / ledger / git / validate / dashboard / dashboard-server / html / paths
├── hooks/
│   ├── hooks.json              # Stop / PreToolUse / PermissionRequest / UserPromptSubmit / SessionStart
│   ├── stop-continue.ts       # loop unfinished → block
│   ├── guard-frozen.ts        # frozen-file write protection → deny
│   ├── permission-gate.ts     # experiment-tool gating → deny
│   ├── memory-inject.ts       # ledger tail injection
│   ├── session-start.ts       # session resume hints
│   └── examples/               # 6 ready-to-use before/after iteration hooks
├── skills/
│   ├── autoresearch/           # SKILL.md thin router + references/
│   └── autoresearch-hooks/     # iteration-hook tutorial
├── commands/                   # autoresearch / export / off / clear / finalize
├── scripts/finalize.sh         # /autoresearch:finalize implementation
└── tests/                      # node --test unit tests
```

## workingDir

Setting `"workingDir": "work/"` in `.auto/config.json` separates the research directory from the project directory (ledger/benchmark/git/dashboard all act on work/, config stays in the project).

## Session state (`.auto/`)

| File          | Purpose                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `log.jsonl`   | **append-only single source of truth**: config lines + run lines; segments advance on config lines |
| `prompt.md`   | session charter (goal/metric/scope/Off Limits/What's Been Tried)                                   |
| `measure.sh`  | benchmark script (frozen)                                                                          |
| `checks.sh`   | optional correctness gate (frozen)                                                                 |
| `config.json` | optional `{ "maxIterations": N }`                                                                  |
| `ideas.md`    | optional hypothesis list                                                                           |

## Known limits (research-backed, see `docs/research/autoresearch-survey.md` §4.1)

- **No session-injection API**: no overnight unattended runs; rely on the 3-window Stop-hook allowance plus user re-triggering to continue.
- **Headless mode (`--prompt`) does not run hooks**: guardrails take effect in interactive sessions; run autoresearch in an interactive session.
- `git add -A` commits unrelated dirty files together (known pi inheritance) — commit a clean baseline during setup.

## Development

```bash
cd plugin && node --test tests/*.test.ts   # unit tests
```
