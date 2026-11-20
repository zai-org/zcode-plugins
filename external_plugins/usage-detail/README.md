# usage-detail

Per-request usage analytics for ZCode, entirely local: every model request is one row — time, session, model, provider (official plan vs. custom BYOK), token breakdown (input / cache read / cache write / output), duration, TTFT, **output tok/s**, status, and optional price-converted cost. Zero runtime dependencies (Node built-ins only), database opened read-only.

中文文档：[README_CN.md](./README_CN.md)

![demo](https://raw.githubusercontent.com/axdlee/zcode-usage-detail/main/screenshots/dashboard-overview-dark.png)

## Features

> **Platform support**: full experience on macOS; Windows & Linux cover all core features (side panel / MCP / hooks / dashboard / CLI). CLI needs bash (on Windows, Git Bash — if `bash.exe` is not on PATH the service probes common Git for Windows install locations, or set `ZCODE_BASH`) and Node >= 22.13 (bundled with ZCode); when the sqlite3 CLI is missing a node:sqlite shim is used automatically (readfile + CSV export included). Notifications use native channels per platform (osascript / WinRT toast / notify-send), silently degrading when unavailable. On macOS they are attributed to ZCode (ZCode icon instead of the Script Editor scroll). With terminal-notifier installed (`brew install terminal-notifier`) clicks go straight to the target: budget/turn notifications open the local panel, permission-wait activates ZCode; otherwise clicking opens ZCode, falling back to the system default when ZCode is not running (0.22.2/0.22.3). Config files with a UTF-8 BOM are read fine; local writes retry and fall back when the target file is locked (0.22.1).

- **UI language (i18n)**: zh/en follows the system language automatically (overridable in Settings: Auto / 中文 / English; the local panel reloads instantly, reopen the side panel to apply) — covers tabs, filters, KPIs, insights, table headers, buttons, empty states, the settings dialog, tooltips and the per-turn live banner; number units switch to K/M/B in English (万/亿 otherwise); missing entries fall back to Chinese. Language detection order: manual choice → **ZCode's own language preference** (`localePreference` in `~/.zcode/v2/setting.json`, side panel & local views) → browser / WebView language (browser mode always follows the browser). Known boundaries: CLI output, notification texts and SVG accessibility descriptions (`aria-label`/`<desc>`) remain Chinese; session titles, model/provider names and quota bucket names are data and never translated (0.23.0, extended in 0.23.1/0.23.2)
- **Yesterday filter & text search**: new "Yesterday" time tier (insight badge becomes yesterday-vs-day-before); new search box filtering by session title / model / provider (case-insensitive, 200ms debounce) (0.23.0)
- **Today budget card**: once a daily budget is set, insights always show "spent / budget · %" for today (gold at 80%, red at 100%, mirroring the alert thresholds), unaffected by filters (0.23.0)
- **Auto refresh**: "Auto ON/OFF" toggle in the local panel (60s full refresh, remembered; tab hash preserved) for unattended monitoring (0.23.0)
- **Burn rate & pacing**: last-hour tok/min with converted cost always visible in insights, plus a pacing label (slowing / steady / accelerating) against the 7-day daily average (borrowed from coding-usage-bar).
- **Projects tab**: usage aggregated by project (sessions / requests / tokens / 7-day sparkline / last activity); click a project to filter the session table. Projects resolve to the **real git repository root** — sessions started in sub/sub-sub directories merge into their project; falls back to raw directories when a path is gone, non-git, or git is not installed (common on Windows) (0.22.0)
- **BYOK provider display names**: custom providers (provider_id is often `new-provider`) are shown under the name you set in `provider_config.json` (e.g. `hub-linuxdo`). Only the name mapping is read — API keys in that file are never read or sent anywhere (0.22.0)
- **Model name normalization**: the same model stored in mixed-case variants (`GLM-5.3-Flash` / `glm-5.3-flash`) merges into one row / one filter option, displayed under the most-used variant (0.22.0)
- **Billing windows (approximate)**: local 5-hour split (same rule as ccusage blocks) with the last 8 windows as bars; the active window shows a full-window token projection.
- **Port adaptive**: the local panel defaults to 7741; when occupied it shifts to 7742-7749 automatically (logs and the "open panel" entry always point at the real port), while an explicitly requested busy port fails with a clear error (0.22.4)
- **Statusline one-liner**: `usage.sh statusline` prints "today tokens · cost · burn rate · budget %" for tmux / SwiftBar.
- **Polished motion**: KPI count-up, tab fade, pulsing live banner, heatmap hover outline - all respecting reduced-motion.

- **Interactive dashboard** (`/usage-ui`): six tabs — overview / daily trend / sessions / model efficiency / requests / failures. Global filters (provider, model, session, time range) apply everywhere; sortable tables, pagination, drill-downs, GitHub-style activity heatmap (day/week/month-calendar), dark & light themes.
- **Panel UX & live sync** (0.30.5): a **Sync Data** button re-fetches the snapshot and repaints in place — skeleton, filters, expanded rows and scroll position all survive (no full reload); Auto mode shows a **next-sync countdown** on the button and refreshes through the same in-place path; burn-rate figures use **compact units** (364K / 36.5万 tok/min) with exact values on hover; every input/select now uses the plugin's design language (custom arrows, focus rings, dark-mode aware) instead of browser defaults
- **Context Browser** (0.29.0, extended 0.30.0): the Context Top drill-down becomes a real browser — category rows (conversation text / reasoning / tool calls / compaction / attachments, with item counts, ≈bytes and share bars) expand into per-item rows showing a content snippet of every tool call (tool name ▸ input head) and message, sorted by size so the biggest context consumers surface first (top 30 per category, fetched on demand). Category rows carry a green **"+N · ≈X last 1h" badge** (see what grew while unattended), items click to expand full text (tool calls render as a parameter key/value table with tolerant parsing of truncated JSON, messages/reasoning as comfortable text blocks), and the water-level curve gains a **Level / Delta toggle** (delta bars: blue up = input growth, green down = compaction reclaim)
- **Cost/budget/quota/fleet UI parity** (0.28.0): the overview gains a **budget hero card** (today's cost as a hero number vs. daily budget, threshold-colored progress bar, this-month & burn-rate pills; also fixes the local panel never receiving budget config so the card never showed), quota progress bars get a 60% yellow warning tier, Fleet swimlane bars are **clickable to drill into that subagent's request log**, and the session drill-down gains a **Timing Breakdown donut** (TTFT wait / generation / tool runs around total active time)
- **UI parity & theme fallback** (0.27.0): the session drill-down gains a **Current Context hero card** (last-request input vs. window limit with usage %, cache-read/uncached segment bar, window/compaction/cache pills), donut legends upgrade to three-layer rows (color + name + mini bar + ≈absolute value + %), pill badges on the water-level header, and card-style KPI rows; the generated page now ships its own theme-variable fallback (same values as the official theme), so opening it directly from file:// renders fully colored instead of monochrome
- **Context insights** (0.24.0): the session drill-down gains a **Context Composition donut** (conversation text / reasoning / tool calls & results / step skeleton / attachments, approximated by local storage bytes) with drill-down to **tool bytes top**, **file bytes top** (Read/Edit/Write) and a **subagent parallel timeline** (fetched on demand — see what eats your context and when subagents run in parallel), an **Agent team** row (named subagent breakdown with request counts and tokens, attributed to the parent session via `parent_id`), a **subagent parallel timeline** (swimlane Gantt with per-request tooltips, in the Context Top drill-down), compaction events annotated with their **trigger & phase** (auto·mid_turn / manual·standalone_turn), and **over-window requests marked red** on the context water-level curve.
- **Session side panel** (ZCode Desktop 3.15+): the same full dashboard as an MCP App tab, following the host theme. Per-turn stats banner refreshed in real time via MCP resource subscription (`resources/subscribe` → `notifications/resources/updated`) — computed locally, zero model overhead, never enters the conversation.
- **Session health score & waste forensics**: 0-100 per-session health score (error/cancel/retry weighted); insight card + `usage.sh waste [days]` showing tokens burned by failed/cancelled/retried requests, top failing sessions and most-retried models.
- **Model leaderboard**: average tok/s, average TTFT, error rate, cache rate, and converted cost per 1k tokens per model.
- **Budget & burn alerts**: when the local panel service is resident, a watchdog checks every minute — macOS notification at 80%/100% of the daily budget and when today's tokens exceed 1.5× the 7-day daily average (once per tier per day).
- **Permission-wait reminder** (opt-in): async `PermissionRequest` hook notifies you when the agent waits for approval.
- **Per-turn stats**: local Stop-hook stats pushed to the side-panel banner; optional macOS notification or in-conversation stats line (`usage.sh turnstats`). When the hook is off or the subscription is unavailable, the banner falls back to aggregating the latest `turn_id` group from loaded data (marked "as of HH:MM"), so the current turn is always visible (0.22.0).
- **Settings dialog**: unit prices (official Zhipu CNY prices for GLM 5.3 series built in; other models synced from models.dev with USD→CNY conversion), daily/monthly budgets, and all notification switches editable in the local panel UI.
- **Cost**: price table is editable; subscription plans don't bill per token — converted costs represent the equivalent API list-price value. Cache-hit tokens are billed at the cache price (never double-billed as uncached input); time-of-use models are priced per request timestamp. **Time-of-use (peak/off-peak) pricing**: add a `tariff` field to a model and each request is priced by its own local timestamp; the insights "current tier" row judges the active tier from the system clock. Built-in official DeepSeek peak/off-peak list prices (workday 9:00–12:00 & 14:00–18:00 peak, weekends/holidays off-peak half price, verified 2026-10) plus the official 2026 Chinese public-holiday calendar (incl. 6 adjusted working Saturdays) and a real-time GLM Coding Plan peak-hours hint (workday 14:00–18:00 credits at 1×, otherwise 0.5×) are included.

## Install

Search **usage-detail** in ZCode Settings → Plugins, or add the author's marketplace:

```
/plugin marketplace add axdlee/zcode-usage-detail
```

Then open `/usage` for the CLI summary or `/usage-ui` for the dashboard. After installing or updating, restart ZCode; hooks apply to newly opened sessions.

## Components

- **Commands / skills**: `/usage`, `/usage-ui`, `/usage-this`, `/usage-this-ui`, `/usage-today` backed by the `usage-detail` skill (read-only CLI: summary/recent/day/days/sessions/models/providers/errors/months/projects/blocks/waste/export…).
- **MCP server** (`usage-detail-panel`): tools `usage_summary/detail/trend/sessions/session/quota`, `open_full_panel`; resources for the side-panel page and the per-turn stats feed.
- **Multi-vendor quota card (opt-in)**: the dashboard and `usage_quota` aggregate GLM (zero-key, reads local client logs) with DeepSeek / Kimi / OpenRouter / MiniMax once you fill in each vendor's API key in plugin settings — keys are sent only to that vendor's official API, stored locally (mode 0600), never logged.
- **Hooks**: `UserPromptSubmit` (per-turn stats guard, silent unless enabled), `Stop` (async, writes a local turn-done marker; optional macOS notification), `PermissionRequest` (async, opt-in reminder).
- **Local panel service**: `usage.sh serve` (or `open_full_panel`) starts a read-only HTTP server bound to `127.0.0.1:7741`.

## Privacy & side effects

- **Reads** `~/.zcode/cli/db/db.sqlite` (read-only connection) and the plugin's own config files under `~/.zcode/`.
- **Writes** only its own config/state files: `~/.zcode/usage-prices.json`, `usage-budget.json`, `usage-alerts.json`, `usage-alerts-state.json`, `usage-turnstats.json`, `usage-turn-done.json`, `usage-serve.json`, `usage-vendors.json` (optional vendor quota keys, mode 0600).
- **Local network**: the panel service listens on `127.0.0.1` only.
- **Outbound network**: daily price sync from [models.dev](https://models.dev) (disable with `ZCODE_USAGE_NO_AUTOSYNC=1`); optional GLM quota lookup (reads local client logs, no credentials sent, or `open.bigmodel.cn` if you configure an API key); optional per-vendor quota lookups — DeepSeek `api.deepseek.com`, Kimi `api.kimi.com`, OpenRouter `openrouter.ai`, MiniMax `api.minimaxi.com` — each only if you configure that vendor's API key, read-only, keys stored locally and never logged. No telemetry, no other endpoints.
- **Notifications**: cross-platform system toasts — macOS `osascript`, Windows WinRT toast via PowerShell, Linux `notify-send` — silently skipped where unavailable.
- Third-party material: pricing data from models.dev (converted, cached locally); everything else is original code, MIT licensed.

## License

MIT
