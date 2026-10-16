# usage-detail

Per-request usage analytics for ZCode, entirely local: every model request is one row — time, session, model, provider (official plan vs. custom BYOK), token breakdown (input / cache read / cache write / output), duration, TTFT, **output tok/s**, status, and optional price-converted cost. Zero runtime dependencies (Node built-ins only), database opened read-only.

中文文档：[README_CN.md](./README_CN.md)

![demo](https://raw.githubusercontent.com/axdlee/zcode-usage-detail/main/screenshots/dashboard-overview.png)

## Features

> **Platform support**: full on macOS; Windows and Linux cover all core capabilities (side panel / MCP / hooks / dashboard / CLI). The CLI needs bash (Git Bash on Windows) and Node >= 22.13 (bundled with ZCode); when the `sqlite3` CLI is absent it automatically falls back to a node:sqlite shim. System notifications use each platform's native channel and are silently skipped when unavailable.

- **Interactive dashboard** (`/usage-ui`): six tabs — overview / daily trend / sessions / model efficiency / requests / failures. Global filters (provider, model, session, time range) apply everywhere; sortable tables, pagination, drill-downs, GitHub-style activity heatmap (day/week/month-calendar), dark & light themes.
- **Session side panel** (ZCode Desktop 3.15+): the same full dashboard as an MCP App tab, following the host theme. Per-turn stats banner refreshed in real time via MCP resource subscription (`resources/subscribe` → `notifications/resources/updated`) — computed locally, zero model overhead, never enters the conversation.
- **Session health score & waste forensics**: 0-100 per-session health score (error/cancel/retry weighted); insight card + `usage.sh waste [days]` showing tokens burned by failed/cancelled/retried requests, top failing sessions and most-retried models.
- **Model leaderboard**: average tok/s, average TTFT, error rate, cache rate, and converted cost per 1k tokens per model.
- **Budget & burn alerts**: when the local panel service is resident, a watchdog checks every minute — macOS notification at 80%/100% of the daily budget and when today's tokens exceed 1.5× the 7-day daily average (once per tier per day).
- **Permission-wait reminder** (opt-in): async `PermissionRequest` hook notifies you when the agent waits for approval.
- **Per-turn stats**: local Stop-hook stats pushed to the side-panel banner; optional macOS notification or in-conversation stats line (`usage.sh turnstats`).
- **Settings dialog**: unit prices (official Zhipu CNY prices for GLM 5.3 series built in; other models synced from models.dev with USD→CNY conversion), daily/monthly budgets, and all notification switches editable in the local panel UI.
- **Cost**: price table is editable; subscription plans don't bill per token — converted costs represent the equivalent API list-price value.

## Install

Search **usage-detail** in ZCode Settings → Plugins, or add the author's marketplace:

```
/plugin marketplace add axdlee/zcode-usage-detail
```

Then open `/usage` for the CLI summary or `/usage-ui` for the dashboard. After installing or updating, restart ZCode; hooks apply to newly opened sessions.

## Components

- **Commands / skills**: `/usage`, `/usage-ui`, `/usage-this`, `/usage-this-ui`, `/usage-today` backed by the `usage-detail` skill (read-only CLI: summary/recent/day/days/sessions/models/providers/errors/months/projects/blocks/waste/export…).
- **MCP server** (`usage-detail-panel`): tools `usage_summary/detail/trend/sessions/session/quota`, `open_full_panel`; resources for the side-panel page and the per-turn stats feed.
- **Hooks**: `UserPromptSubmit` (per-turn stats guard, silent unless enabled), `Stop` (async, writes a local turn-done marker; optional macOS notification), `PermissionRequest` (async, opt-in reminder).
- **Local panel service**: `usage.sh serve` (or `open_full_panel`) starts a read-only HTTP server bound to `127.0.0.1:7741`.

## Privacy & side effects

- **Reads** `~/.zcode/cli/db/db.sqlite` (read-only connection) and the plugin's own config files under `~/.zcode/`.
- **Writes** only its own config/state files: `~/.zcode/usage-prices.json`, `usage-budget.json`, `usage-alerts.json`, `usage-alerts-state.json`, `usage-turnstats.json`, `usage-turn-done.json`, `usage-serve.json`.
- **Local network**: the panel service listens on `127.0.0.1` only.
- **Outbound network**: daily price sync from [models.dev](https://models.dev) (disable with `ZCODE_USAGE_NO_AUTOSYNC=1`); optional official quota lookup at `open.bigmodel.cn` only if you configure an API key. No telemetry, no other endpoints.
- **Notifications**: cross-platform system toasts — macOS `osascript`, Windows WinRT toast via PowerShell, Linux `notify-send` — silently skipped where unavailable.
- Third-party material: pricing data from models.dev (converted, cached locally); everything else is original code, MIT licensed.

## License

MIT
