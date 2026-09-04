# zCoder (ZCode plugin)

Always-on GLM multi-model orchestration for ZCode, plus **skill-forge** — a measured lifecycle for building and improving skills. Every task is decomposed and routed to the right engine automatically; every skill change is graded by deterministic oracles before it ships.

## What it solves

- **Routing waste**: ZCode's main thread and its subagents can run the same task at the same effort. zCoder pins each engine's model and thinking effort, then routes by ordered predicates: atomic requests are answered directly, visual sub-tasks go to the vision engine, mechanical batches go to the cheap lane, and deep sub-tasks get the max-effort engine only when parallelism or context isolation pays for it.
- **Unmeasured skills**: a skill that "seems better" after an edit is a vibe. skill-forge scores skills with deterministic Python oracles into a Wilson-scored, session-stamped trials ledger; improvements must be same-session PAIRED evidence on a Pareto frontier, and promotion passes 7 explicit gates. Idle automation never promotes — promotion requires interactive `--approved-by`.

## Engines

| Engine agent | Model | Effort | Routes |
|---|---|---|---|
| `glm-vision` | GLM-5.3-Flash | `max` | Images, OCR, screenshots/mockups, visual diffs, UI/UX inspection, diagrams |
| `glm-turbo` | GLM-5.3-Flash | `low` | **Conditional lane** — routed to only after a verified PASS in the current session; until then mechanical batches run on the main thread (never route real work to an unverified engine) |
| `glm-main` | GLM-5.3 | `max` | Architecture, multi-file logic, algorithms, deep debugging, security analysis, final correctness audits |

**Degradation ladder:** if the vision engine fails, perception degrades to the main thread first (same model), then `glm-main`. An unverified engine is never trusted with real work — mechanical batches route to `glm-turbo` only after a verified PASS in the current session.

**ZCode-only.** This plugin uses the `.zcode-plugin/plugin.json` manifest and ZCode hooks/agents/skills/commands exclusively. It intentionally ships no `.claude-plugin/` or `.codex-plugin/` compatibility manifest.

## Components

- `agents/` — the three engine agents. The `model:` and `thoughtLevel:` in each agent's frontmatter pin routing and effort; both are required. Omitting `thoughtLevel:` makes the harness inject compiled defaults that some backends reject (e.g. `high`/`low`), so the values are pinned, not implicit. `thoughtLevel:` edits apply live on the next dispatch; `model:` edits need a session restart.
- `skills/glm-orchestrator/` — the orchestration protocol: 4-step chain (decompose → routing plan → dispatch → synthesize + Principal Engineer audit), zero-waste rule, degradation rules, worked example.
- `skills/skill-forge/` + `commands/skill-scan.md` + `commands/skill-evolve.md` — the measured skill lifecycle. `/skill-scan` detects stack gaps zero-token (manifest-based, no LLM calls); `/skill-evolve` runs a staged evaluate→mutate→promote round (Pareto-targeted, mini-batch budget: a candidate that doesn't fix its target scenario dies before any full-matrix spend). Skills are scored by deterministic Python oracles into a Wilson-scored trials ledger (`tests/skill-evals/<skill>/trials.jsonl` in the project where the skill is exercised); comparisons are same-session interleaved only; improvements are reflective mutations that must cite the failing trial (`MUTATION.md`); acceptance is Pareto-frontier expansion (`pareto.py` — per-scenario dominance, never scalar averages; also emits the next mutation target and the plateau stop-rule: 2 consecutive promotions without frontier entry ⇒ write a new scenario, not another body mutation). Promotion passes 7 gates — static caps, oracle self-test, strictly-better paired evidence, mutation citation, differs-from-incumbent, growth limit, trigger evidence (a changed `description:` needs a recorded router-probe run: effective ≥0.75, zero cross-skill regressions) — and requires interactive `--approved-by`.
- `skills/laravel-dev/`, `skills/yaml-json-convert/` — the first skills born from this lifecycle, each shipping its scenario/oracle eval suite under `tests/skill-evals/`.
- `commands/` — `/orchestrate <task>` (full pipeline with visible routing JSON) and `/route <task>` (plan-only preview, no execution).
- `hooks/` — **always-on routing, three events**: `SessionStart` anchors the routing directive at chat boot (covers new, resumed, cleared, and compacted sessions), `UserPromptSubmit` re-injects it on every prompt, and `PreToolUse` on the Agent tool runs a dispatch-contract check on every glm-engine dispatch (self-contained message, ≤300 words, no inlined file bodies — non-zCoder agents stay untouched).
- `tests/` — the plugin's own regression and integrity suites (portable, zero-token): `skill-forge-static.sh` (static integrity checks), `skill-forge-smoke.sh` (adversarial fixtures against every script CLI, all state in a mktemp sandbox), the OHI monitoring scripts, the capability ledger, and the pre-registered trigger-case table.

## Install (ZCode)

1. Open ZCode → **Settings → Plugin Management → **Discover** tab.
2. Find **zCoder** in the official marketplace and click **Get**.
3. Keep it enabled — the plugin hooks enable the hook runner automatically.

Verify: the `/` menu shows `orchestrate` and `route` under zCoder, and **Settings → Subagents** lists `glm-vision`, `glm-turbo`, `glm-main`.

## Usage

- Always-on: with the plugin enabled, zCoder orchestration applies to every chat automatically — the hooks anchor routing at session start, re-inject it on each prompt, and check each engine dispatch against the contract. No invocation needed.
- Explicit: `/orchestrate implement this dashboard mockup and optimize the server fetch logic`.
- Preview only: `/route refactor auth across 3 services and fix the CSV parser` → table of sub-tasks, engines, and effort levels without executing.
- Skill lifecycle: `/skill-scan` to detect missing stack skills; `/skill-evolve <skill>` to run one measured improvement round.

## Model IDs

Defaults are model codes from the Z.ai GLM catalog: `glm-5.3-flash` (vision/turbo), `glm-5.3` (deep). If your build lists different names in the model picker, edit the `model:` line in the matching `agents/*.md` and restart the session — nothing else needs to change.

## Tuning

- **Thinking effort** — pinned per agent via `thoughtLevel:` in `agents/*.md`. Effort rejections are deterministic and cost zero tokens: never retry them. Pins apply at session start; mid-session `thoughtLevel:` edits may serve stale cached values.
- **Vision model** — if your plan grants a dedicated vision model, change `model:` in `agents/glm-vision.md` and restart the session.
- **Disable the always-on routing injection** (keep the agents/commands): `touch ~/.zcode/zcoder.off`, or run ZCode with `GLM_ORCHESTRATOR_DISABLE=1`. Delete the file / unset the variable to re-enable.
- **Routing rules** — the matrix and dispatch rules live in `skills/glm-orchestrator/SKILL.md`; edit there to reweight precedence (e.g. make the turbo lane the default instead of the deep engine).

## Dependencies, side effects, and security

- **Network**: none. The plugin makes no outbound requests and bundles no MCP servers. Subagents dispatched by the orchestrator use ZCode's own model providers.
- **Model/API dependencies**: the engine agents reference GLM models by ID (`glm-5.3`, `glm-5.3-flash`) available through ZCode's built-in Z.ai provider. A plan without those exact model IDs needs the one-line `model:` edit described above.
- **Command execution**: the hooks run a local bash script (`hooks/inject-routing.sh`) on session start, every prompt, and Agent-tool dispatches. It only reads its stdin payload and prints a routing directive — no file writes, no network, and it exits immediately when either kill switch is active.
- **File writes**: running skill-forge rounds (`/skill-evolve`) and the OHI monitors writes trial ledgers, promotion records, and logs under `tests/skill-evals/` and `tests/` **in the project where you run them**. The plugin never writes outside the current project or `~/.zcode` (the optional `zcoder.off` flag file, which you create yourself).
- **No credentials, telemetry, or analytics** are collected or transmitted.

## Health definition (learned the hard way)

A green static suite only proves the **files agree with each other** — it is not system health. The turbo lane once sat at zero lifetime successful dispatches while every round reported green, because nothing measured ground-truth capability. Health is now a three-way conjunction, enforced statically:

1. **Static suite green** (config coherence) — `tests/skill-forge-static.sh`,
2. **Capability ledger green** — `tests/capability-ledger.json`: every engine explicitly VERIFIED-fresh / CONDITIONAL-routed-around / REMOVED; no silent defaults, no zombie lanes; and
3. **No lifetime alarms** — `tests/ohi-stats.py` from the dispatch ledger: 0%-success and majority-fail engines report NEVER-WORKED / remove-or-investigate; consecutive-failure streaks flagged.

Plus institutionalized humility: every FULL dogfood round runs one adversarial **blind-spot sweep** (an engine is asked what the system still cannot see), because blind spots are found by hunting, not by checklists.

## License and provenance

MIT. The reflective-mutation, size-cap, growth-cap, session-mining, Pareto-frontier, staged mini-batch, and trigger/description-evolution patterns are ported from [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) (MIT). Its AGPL Darwinian Evolver was deliberately not ported, and its DSPy/GEPA LLM-judge machinery was re-implemented as deterministic oracles (a judge's opinion is not a measurement).
