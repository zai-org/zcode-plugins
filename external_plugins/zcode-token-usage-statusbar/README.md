# ZCode Token Usage Statusbar

See model speed, token usage, context size, plan quota, and Git status while you work in ZCode.

> **Important:** installing the status bar **modifies the ZCode desktop client's `app.asar`** (injects a loader and an overlay; the patch is removable and keeps a backup). After install you must **fully quit and reopen ZCode** — closing the window is not enough. Local database queries themselves do not upload usage; explicitly enabling the optional mobile relay forwards statistics through ZCode's official relay as described below. If you only want the query tools, skip the status bar (see [Turn off or remove](#turn-off-or-remove)).

## What you get

- Floating status bar (desktop): generation speed (tok/s), per-turn / session / today token usage, cache hit rate, sub-agent breakdown, context usage, plan-quota chip, Git status chip. Tooltips show details; the ⚙ panel toggles what is shown.
- Per-answer rate line appended under each reply: tok/s, time to first token, output tokens, duration, session totals.
- `/usage` command (today / week / models / current), the `token_usage` MCP tool, and a skill that teaches the agent how to query usage.
- Source capability: **⚡ Pull models** in the host's model settings checks selected models before saving, can repair a verified URL path, fill evidence-backed model settings, and warn about tool-history compatibility. Checks call the current provider and may consume quota; see the [user guide (Chinese)](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md#拉取模型与确认检测) for release availability and limits.

## Requirements

- Python **3.8+** with the standard library only — no pip packages.
- Hook commands fall back `python3` → `python` → `py -3` (Windows friendly). The stdio MCP server starts `mcp-launch.cjs` via `node` (ZCode desktop 3.17.1+ appends an Electron Node fallback shim to the MCP subprocess PATH; older desktop builds or hosts without that mechanism need a real `node` on PATH), which probes the same interpreter order and pipes stdio through to `usage_mcp.py` — no manual `.mcp.json` edits on any platform (issue #234). The MCP tool is optional; commands and hooks work without it.
- Previously using the standalone installer (`install.py`)? It may have registered the same MCP server in `~/.zcode/cli/config.json`, which would make every session spawn two `usage_mcp.py` servers (and their `node` launchers). On session start the plugin removes those legacy registrations (historical names `zcode-token-usage-statusbar` / `token-usage` / `zusage`) only when they point at the `usage_mcp.py` inside this plugin's runtime or plugin directory; entries with custom keys (such as `env`) and all other entries are kept. The plugin's own `.mcp.json` keeps the `token_usage` tool available. Set `ZUSAGE_KEEP_LEGACY_MCP` to any non-empty value (for example `1`) to keep the legacy entry.

## Install & first run

1. Install this plugin from the marketplace and keep it enabled — in ZCode → Settings → Plugins → Add marketplace, paste `https://github.com/ByteRax/zcode-token-usage-statusbar#plugin-releases` (the officially released stable channel), then install **ZCode Token Usage Statusbar**.
2. Open (or reopen) a session. The plugin then installs / repairs the status bar automatically. **This modifies `app.asar` — only proceed if you trust this project.**
3. **Fully quit and reopen ZCode.**

Auto-install is always on (the legacy `plugin_auto_install_overlay` config key and `ZUSAGE_PLUGIN_AUTO_INSTALL` env var are no longer read); `/uninstall-overlay` leaves an opt-out marker — the only way to block re-injection. When a restart is pending or a new version is available, the status-bar gear shows a red dot (cleared by opening the ⚙ "Plugin updates" section, which also offers a "Restart ZCode" button); no in-session text notices are injected anymore (failure guidance excepted). If automatic install fails, run `/install-overlay` and follow its output; a full restart is still required.

## Mobile remote page (current source feature)

Use a browser with a userscript manager such as Tampermonkey. In the desktop status bar, open the separate **⚙ → Maintenance → Mobile remote control** section and enable **Push status bar data to the remote page**. The regular script URL is provided in this separate section in a read-only field that remains selectable for copying while the switch is off. The panel does not install the script or open external pages; copy the URL into your mobile browser's userscript manager to install it. [Install the regular mobile script](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.user.js), then separately enable the host's official **Web Remote Control** and open `https://zcode.z.ai/remote/`. Installing the script does not authorize data pushes. The script follows `main`; check the desktop Release notes for stable-channel availability and the [mobile remote guide (Chinese)](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md#手机远控页面) for details.

The switch merges only `mobile_relay.enabled` into the runtime directory's `config.json`, preserving other fields. Only the boolean `true` inside a `mobile_relay` object enables it; missing fields, `false` and invalid values leave it off. Upgrading users without this key start with it off; an existing explicit `true` is preserved. Turning it off stops only plugin handshake announcements, relay statistics queries and snapshot pushes, and discards pending query results. Ordinary host remote-control messages remain unaffected. It does not immediately revoke the phone's ability to send display preferences; while off, the desktop ignores those preferences without applying or acknowledging them. You do not need to disable the phone uplink separately. This desktop setting is unavailable on the phone. If an older main process leaves the control disabled, first update the installed plugin and safely deploy the matching cold `inject-main.cjs` to the actual runtime directory, then fully quit and reopen ZCode. Updating only the overlay or restarting alone does not replace deployment.

## How it works & side effects

| Area | Behavior |
|---|---|
| Hooks | `SessionStart` syncs runtime files, checks for updates, auto-installs when not injected, and removes legacy standalone-installer MCP registrations from `~/.zcode/cli/config.json` (only entries pointing at this plugin's `usage_mcp.py`; a pre-change backup is kept next to the file); `PromptSubmit` records the prompt timestamp and appends the per-answer rate line. |
| MCP server | `.mcp.json` starts `usage_mcp.py` as a stdio JSON-RPC server exposing `token_usage(scope)`. It reads the local usage database only. |
| Files written | `~/.zcode/zcode-token-usage-statusbar/` (runtime files, config, per-session state; secrets file is `0600`); a patch + backup inside the ZCode client directory (`app.asar`); overlay settings in `~/.zcode/zusage3`; `~/.zcode/cli/config.json` only while a legacy standalone-installer MCP registration exists (entry removed, same-directory `.zusage-mcp.bak` pre-change backup kept, see Hooks above). Uninstalling the plugin does not delete personal config. |
| Network | Local statistics queries themselves do not upload usage (read-only SQLite). The optional mobile relay is a separate opt-in channel, described in the next row. The plan-quota chip is on by default (turn it off in ⚙): it decrypts the host's stored OAuth credentials **in memory only** (since ZCode 3.18.0 the decryption key is read, inside the ZCode process, from the OS keychain or the host's managed secret) and calls BigModel / Z.ai usage endpoints directly to show your plan quota; credentials are never written to config, logs, or diagnostics. Estimated cost syncs public model pricing (`models.dev`) and USD exchange rates every 12 hours in the resident process (download-only, no usage data uploaded; set `"pricing": {"fetch": false}` to disable). Plugin updates download code from the configured source (release notes are fetched from GitHub/GitCode APIs when viewing the update card). Optional SSH/WSL remote queries go through the connection channel you configured; the plugin never decrypts or reuses host passwords or key passphrases and never auto-deploys. The Git chip runs local read-only `git` queries (no fetch, no network). |
| Mobile relay | Only an explicit `mobile_relay.enabled: true` enables status bar pushes through ZCode's official relay (`wss://zcode.z.ai/api/v1/remote/ws2`); this project adds no server of its own. The plugin payload has no end-to-end encryption, so the server can see it. Downstream data is limited to the current remote session's identifier and numeric statistics, plus aggregates such as today's total and project totals from that session's host. These aggregates may include contributions from other sessions; no conversation text, workspace paths or credentials are included. Upstream data contains only display preferences and generation counters. This switch controls only the plugin extension, not ordinary host remote-control messages. |
| Executed commands | Python scripts shipped with the plugin; `git` (read-only status queries); `ssh`/`wsl.exe` only for remote usage you configured. |
| Third-party code | None bundled — plain Python 3.8 stdlib, plain JavaScript (Electron main-process CommonJS). MIT licensed; source at [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar). |

Remote sessions (SSH/WSL) need a matching `zusage.py` deployed manually on each remote host; see the [user guide](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md) for the full remote, quota-source, and multi-window details.

For the Web remote status bar, install [the receiver userscript](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.user.js) in a userscript manager in the browser that opens the remote page; use [the debug variant](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.debug.user.js) for troubleshooting and enable only one variant. These URLs follow source `main`, which may be ahead of a stable plugin Release; use a desktop plugin supporting the same mobile relay protocol. The manager controls update checks; desktop plugin updates do not install the browser script. The receiver embeds the same desktop overlay for local and WSL/SSH sessions, including tooltips and settings, with no separate chips fallback UI. Relay pushes require an explicit boolean `mobile_relay.enabled: true`; the switch is off by default. The official relay has no end-to-end encryption for this payload and its server can read statistics, including host aggregates with contributions from other sessions, as disclosed above. See the [remote page guide](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md#web-远程控制页面).

## Turn off or remove

- `/uninstall-overlay` — removes the status bar, keeps the opt-out marker, keeps personal config.
- There is no switch to disable auto-install (always on); use `/uninstall-overlay` to keep the query tools only.
- `"answer_rate_line": false` — drop the per-answer rate line (takes effect on the next prompt).
- `"restart_notice": false` — stop the update/pending-restart red badge on the status-bar gear and the "Plugin updates" entry (command-line output and failure guidance are unaffected).
- `"quota_enabled": false` — stop quota queries and hide the plan-quota chip (credentials are then never read).
- `"auto_compact_patch": false` — turn off the auto-compact context threshold injection (on by default since v188; the ⚙ switch is preferred). Patches the client engine (allow-listed per build) so the auto-compact trigger becomes a configurable percentage; turning it off restores the engine bytes. Desktop client only; the terminal CLI is unaffected.
- `"plugin_auto_update": false` — disable update checks.
- `"mobile_relay": {"enabled": false}` — stop the plugin's mobile handshake announcements, statistics queries and snapshot pushes; off by default. Ordinary host remote-control messages are unaffected; mobile display-preference capability is not immediately revoked, but the desktop ignores those preferences while off.
- Full removal: turn off auto-update, run `/uninstall-overlay`, then uninstall the plugin from ZCode settings and fully restart. **Uninstalling the plugin alone does not remove the status bar.**

## Configuration

Default runtime config lives in `~/.zcode/zcode-token-usage-statusbar/config.json` — merge only the fields you change. Beyond the switches above it also covers remote targets, quota sources, and display options; see [`config.example.json`](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/config.example.json) and the [user guide](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md).

**WorkBuddy data source (optional)**: `"host": "workbuddy"` (or `"auto"`) points queries at `~/.workbuddy/workbuddy.db` for session context and credits, and at the matching transcripts `projects/*/*.jsonl` for per-request tokens, cache, thinking, credits and tool calls. If the files live elsewhere use `"hosts": {"workbuddy": {"db_path": "..."}}` or `ZUSAGE_WORKBUDDY_DB`; CLI/MCP can also override per call with `--host workbuddy` / `host: "workbuddy"`. The default stays `zcode`; WorkBuddy has no asar chain, so its status bar is injected over CDP into the input card instead. See [docs/hosts.md](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/hosts.md).

## Source & license

MIT — [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar). Bug reports and PRs welcome (Chinese or English).
