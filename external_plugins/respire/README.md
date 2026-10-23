# respire

> Store on inhale, recall on exhale — local encrypted memory for ZCode.

`respire` (CLI: `rsrs`) is a standard ZCode plugin that wires the respire memory engine into the agent loop with command hooks: title-tier recall injected every turn, one-prefix storing, and a Stop storage check. Local-first, end-side encrypted, cloud LWW sync.

Sibling builds for other hosts: [respire-dimcode](https://github.com/risense-ai/respire-dimcode) (Dim) · [respire-qoder](https://github.com/risense-ai/respire-qoder) (Qoder) · [respire-workbuddy](https://github.com/risense-ai/respire-workbuddy) (WorkBuddy) · [respire-zcode](https://github.com/risense-ai/respire-zcode) (this plugin's standalone repo).

## Fully usable without the model (degradation is a first-class citizen)

- **Registration, login, sync and recall never depend on a local model** — the plugin works right after install; without the model the engine automatically falls back to the lexical tier.
- BGE-M3 is a **pure optional boost**: for better semantic recall run `rsrs model install && rsrs model activate m3`. The plugin notices it is missing and mentions it once in-session; installing or not never blocks anything.

## What happens after install

| When | Behavior |
| --- | --- |
| `SessionStart` | Injects a short memory playbook (when to recall, how to store, red lines); **one probe, three states** — signed-out gets registration guidance, an empty store (<10 records) gets first-day seeding/import guidance, a missing semantic model gets the **optional** install hint; zero interruption otherwise |
| `UserPromptSubmit` | Automatic `rsrs recall --titles`: **title-tier injection** — score + 8-char short id + title only; the agent fetches bodies on demand with `rsrs show <id>`. Default is **direct output without threshold filtering**; noise is bounded by the engine's own skip gate + limit 5 + title tier |
| Prompt starts with `记：` / `存：` / `remember:` | Stores directly via `rsrs remember … --importance important` and returns a receipt; when the dedup judge finds a similar record nothing is written — candidates are relayed for the model to decide (`--parent` attach or `--force` write); the receipt requires the model to extract a "subject + action + result" fact sentence and `retitle` |
| `Stop` (agent finished) | **Storage check**: `{"decision":"block","reason":…}` continues one round, nudging the model to store new facts/decisions/agreements/lessons/pitfalls; pure Q&A or chat ends directly. Loop-safe: the continuation round carries `stop_hook_active=true` and passes through (the host caps continuations at three; this layer nudges at most once per turn); throttle `store_nudge_every` (1 = every turn, N = every N turns, 0 = off); if the store saw a write in the last 10 minutes (engine `list`), it stays silent |
| Prompt starts with `/nomem` | Skips recall for that turn |
| `skills/respire` | On-demand playbook (recall/remember/show/forget/sync and envelope parsing notes); **the skill is documentation — actions are hook-driven** |

## Install

Install directly from the official plugin market (**Settings → Plugins**, search respire). Alternatively add the standalone repo as a custom market: clone [risense-ai/respire-zcode](https://github.com/risense-ai/respire-zcode), then **Plugin Marketplace → Add → Add Plugin Marketplace** with the repo directory, and install from "Personal → risense-zcode".

## First use · three things

1. **Register & sign in** (works out of the box, no model needed): register at [rsrs.rs](https://rsrs.rs) → run `rsrs register` locally; day-to-day `rsrs login` via browser; autosync is always on, `rsrs sync` for manual sync, `rsrs status` for state.
2. **Import existing rules and memory** (one-shot store, LLM extracts): paste this into a new ZCode task —

   > Please import my existing rules and memory into respire: read one by one — `~/.zcode/AGENTS.md` (home rules, if present), workspace-root and per-project `AGENTS.md`, `~/.agents/skills/*/SKILL.md`; extract reusable facts, agreements, lessons and red lines (never passwords, ID numbers, card numbers, private keys — record only where they are stored), dedupe, and store them one by one with `rsrs remember` (`--importance important`, fact-sentence titles; on dedup candidates decide to attach or merge), then give me a list.

3. **Local model (optional boost)**: `rsrs model install && rsrs model activate m3` — fully usable without it; install for better semantic recall.

## Tuning (optional)

`hooks/respire.config.json` inside the installed plugin directory (missing = all defaults; new sessions pick it up; **never touches login or account**; template: `hooks/respire.config.example.json`):

| Field | Default | Meaning |
| --- | --- | --- |
| `rsrs` | `""` | Engine path; empty = auto-detect (PATH → `~/.local/bin` → `~/.rsrs/bin`) |
| `recall_threshold` | `0.0` | Recall floor; **0 = off by default (engine direct output)** |
| `recall_limit` | `5` | Top N per turn |
| `min_prompt_chars` | `2` | Skip 1-char prompts |
| `session_rules` | `true` | Inject the SessionStart playbook |
| `budget_chars` | `1500` | Per-turn injection budget |
| `enabled` | `true` | **Master switch**: false = fully silent |
| `store_nudge_every` | `1` | Stop-check throttle: 1 = every turn, N = every N turns, 0 = off |
| `skip_prefixes` | `[]` | Host-internal prompts matching these prefixes are neither recalled nor stored |
| `log` | `true` | `hook.log` trace in the data dir (rotated at 256KB) |

## Dependencies, network and side effects

- **Required dependency**: the respire engine (`rsrs` CLI, npm package [`@rsrsai/cli`](https://www.npmjs.com/package/@rsrsai/cli), MIT, by risense-ai — the same vendor as this plugin). When missing, the plugin injects the install command (`npm i -g @rsrsai/cli@latest`) for the agent to run in-session; auto-detected at PATH, `~/.local/bin`, `~/.rsrs/bin`.
- **Network**: installing the engine uses npm; `rsrs sync` talks to the respire cloud (end-side encrypted; account optional — local-only mode works). No other network access.
- **Model/API**: optional BGE-M3 sidecar model downloaded via `rsrs model install`; no external LLM API is called by this plugin.
- **Command execution**: hooks invoke `rsrs` (`recall`/`remember`/`list`/`status`) as subprocesses.
- **File writes**: `hook.log` and `.nudge_counter` in the plugin data dir (or the hooks directory as fallback); nothing else.
- **Hooks**: `SessionStart`, `UserPromptSubmit`, `Stop` — all fail-open (empty output + exit 0 on any error, never blocks a session).
- **No MCP server**, no telemetry.
- **Assets**: `assets/respire/icon.png` is the project logo of risense-ai's respire (MIT). Third-party services referenced: rsrs.rs (account/sync, optional), npm registry (engine install).

## Self-test

```bash
python3 ../../scripts/validate.py   # marketplace structure (repo root)
bash tests/test_hooks.sh            # read-only behavior assertions against a real engine
bash tests/test_hooks.sh --store    # adds a write probe (writes the real store, then rsrs forget cleanup)
```

## License

MIT
