# ZCode Token Usage Statusbar

See model speed, token usage, context size, plan quota, and Git status while you work in ZCode.

> **Important:** installing the status bar **modifies the ZCode desktop client's `app.asar`** (injects a loader and an overlay; the patch is removable and keeps a backup). After install you must **fully quit and reopen ZCode** — closing the window is not enough. Usage statistics are read from the local database and never uploaded. If you only want the query tools, skip the status bar (see [Turn off or remove](#turn-off-or-remove)).

## What you get

- Floating status bar (desktop): generation speed (tok/s), per-turn / session / today token usage, cache hit rate, sub-agent breakdown, context usage, plan-quota chip, Git status chip. Tooltips show details; the ⚙ panel toggles what is shown.
- Per-answer rate line appended under each reply: tok/s, time to first token, output tokens, duration, session totals.
- `/usage` command (today / week / models / current), the `token_usage` MCP tool, and a skill that teaches the agent how to query usage.

## Requirements

- Python **3.8+** with the standard library only — no pip packages.
- Hook commands fall back `python3` → `python` → `py -3` (Windows friendly). The stdio MCP server is fixed to `python3`; if your machine has no `python3` on PATH, edit `command` in the installed copy's `.mcp.json` to your interpreter (the MCP tool is optional; commands and hooks work without it).

## Install & first run

1. Install this plugin from the marketplace and keep it enabled.
2. Open (or reopen) a session. The plugin then installs / repairs the status bar automatically. **This modifies `app.asar` — only proceed if you trust this project.**
3. **Fully quit and reopen ZCode.**

Automatic install is on by default (missing config file or missing field = enabled). An explicit `"plugin_auto_install_overlay": false` in `~/.zcode/zcode-token-usage-statusbar/config.json` is preserved; `ZUSAGE_PLUGIN_AUTO_INSTALL=1/0` overrides the config; `/uninstall-overlay` leaves an opt-out marker that blocks re-injection. With no environment override, a corrupted or non-boolean config does **not** enable auto-install. If automatic install fails, run `/install-overlay` and follow its output; a full restart is still required.

## How it works & side effects

| Area | Behavior |
|---|---|
| Hooks | `SessionStart` syncs runtime files, checks for updates, and may show a restart notice; `PromptSubmit` records the prompt timestamp and appends the per-answer rate line. |
| MCP server | `.mcp.json` starts `usage_mcp.py` as a stdio JSON-RPC server exposing `token_usage(scope)`. It reads the local usage database only. |
| Files written | `~/.zcode/zcode-token-usage-statusbar/` (runtime files, config, per-session state; secrets file is `0600`); a patch + backup inside the ZCode client directory (`app.asar`); overlay settings in `~/.zcode/zusage3`. Uninstalling the plugin does not delete personal config. |
| Network | Local statistics never leave your machine (read-only SQLite). The plan-quota chip decrypts the host's stored OAuth credentials **in memory only** and calls BigModel / Z.ai usage endpoints directly to show your plan quota; credentials are never written to config, logs, or diagnostics. Plugin updates download code from the configured source. Optional SSH/WSL remote queries go through the connection channel you configured; the plugin never decrypts or reuses host passwords or key passphrases and never auto-deploys. The Git chip runs local read-only `git` queries (no fetch, no network). |
| Executed commands | Python scripts shipped with the plugin; `git` (read-only status queries); `ssh`/`wsl.exe` only for remote usage you configured. |
| Third-party code | None bundled — plain Python 3.8 stdlib, plain JavaScript (Electron main-process CommonJS). MIT licensed; source at [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar). |

Remote sessions (SSH/WSL) need a matching `zusage.py` deployed manually on each remote host; see the [user guide](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md) for the full remote, quota-source, and multi-window details.

## Turn off or remove

- `/uninstall-overlay` — removes the status bar, keeps the opt-out marker, keeps personal config.
- `"plugin_auto_install_overlay": false` — keep the query tools only.
- `"answer_rate_line": false` — drop the per-answer rate line (takes effect on the next prompt).
- `"plugin_auto_update": false` — disable update checks.
- Full removal: turn off auto-update, run `/uninstall-overlay`, then uninstall the plugin from ZCode settings and fully restart. **Uninstalling the plugin alone does not remove the status bar.**

## Configuration

Default runtime config lives in `~/.zcode/zcode-token-usage-statusbar/config.json` — merge only the fields you change. Beyond the switches above it also covers remote targets, quota sources, and display options; see [`config.example.json`](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/config.example.json) and the [user guide](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md).

## Source & license

MIT — [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar). Bug reports and PRs welcome (Chinese or English).
