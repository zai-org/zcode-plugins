# Balance Dashboard

[![Version](https://img.shields.io/badge/version-0.3.0-blue)](../../releases) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![Platform](https://img.shields.io/badge/platform-ZCode%20Desktop%203.18%2B-orange)](https://zcode.z.ai)

[中文说明](./README_CN.md)

A compact balance widget that lives in ZCode Desktop's left sidebar:

- Each row shows a provider's **balance/plan** and **today's usage (cost + tokens)**;
- Clicking any balance row opens the **consumption analytics** modal: today / yesterday / this week / this month / custom date range, with project, task, and provider filters, stacked bar charts, provider shares, top models, and project/task rankings;
- The gear opens the same modal on its **settings** tab where API keys can be configured directly; saving triggers an immediate refresh.

Data sources:

- **DeepSeek**: account balance (total / granted / topped-up) and today's spend.
- **Volcengine**: account balance, today's billing spend, and Coding Plan quota windows (daily / 5-hour / weekly / monthly).
- **ZCode**: Start Plan or coding-plan quota usage, plus today's local request count and token usage.

> 中文：ZCode Desktop 左侧边栏余额组件，支持 DeepSeek / 火山引擎（账户与 Coding Plan）/ ZCode 套餐余额与今日消耗；点击余额行打开多维度消耗分析，齿轮打开设置弹框。

## Side effects (please read)

All side effects of this plugin, disclosed for transparency:

- **Hook (SessionStart)**: runs after install/update, syncs runtime files to `~/.zcode/balance-dashboard/runtime/`, and checks `resources/app.asar`;
- **Modifies `app.asar`**: ZCode's plugin system has no left-sidebar mount point, so the plugin appends one plugin-specific dynamic `import()` line at the end of `out/main/index.js` (with full per-file SHA-256 verification, an automatic `app.asar.balance-dashboard.bak` backup, and rollback on failure; `/remove-sidebar-widget` restores the original);
- **Local file writes**: `~/.zcode/balance-dashboard/runtime/` (status, runtime copies, plaintext `options.json` settings);
- **Network requests** (official endpoints only): `api.deepseek.com` (balance), signed `billing.volces.com` APIs (Volcengine balance/billing/quota), `zcode.z.ai` and `api.z.ai` / `bigmodel.cn` (plan quota); no telemetry is sent;
- **Credential handling**: API keys are stored in ZCode's plugin config or the local `options.json` (plaintext, same level as ZCode's own plugin-secret storage); read locally only, never logged or uploaded;
- **Command execution**: the hook and the main-process injector spawn `node` child processes running this plugin's own scripts (usage collection, analytics queries, asar verify/patch);
- **MCP server**: none.

## Prerequisites

- A local Node.js runtime (`node` on PATH).
- The sidebar widget needs to write to ZCode's `app.asar`; after install/update you must **fully quit and restart ZCode**.
- If ZCode is installed under `Program Files` and the current user lacks write permission, the injector reports "admin required"; run ZCode once as administrator or run the injection script manually.
- If ZCode is installed in a non-default location, set the `ZCODE_ASAR` environment variable to the actual `resources/app.asar`.

## Install

- Inside the official `zai-org/zcode-plugins` marketplace: install `balance-dashboard` from the plugin manager, then fully quit and restart ZCode.
- Standalone repo: add this repository as a marketplace in ZCode (**Plugin Marketplace → Add → Add marketplace**), or download a release zip and add the extracted folder.

After installation the SessionStart hook runs: it copies runtime files, checks `app.asar`, and if the file is locked by a running ZCode it schedules a detached finalizer that completes the swap once ZCode has fully quit. Then **fully quit and reopen ZCode** (including tray/background processes); the widget appears above the profile row in the left sidebar.

## Configuration

Settings can be changed in three places (lowest to highest precedence):

1. ZCode **Settings → Plugins → balance-dashboard** (`userConfig`);
2. Sensitive values in `~/.zcode/cli/plugin-secrets.json`;
3. `~/.zcode/balance-dashboard/runtime/options.json` saved by the sidebar modal (highest).

Environment variables also work. Secrets already configured are never echoed back; leaving a secret field empty keeps the current value.

| Option | Env var | Description |
| --- | --- | --- |
| `deepseek_api_key` | `DEEPSEEK_API_KEY` | DeepSeek platform API key. Empty: auto-read from ZCode's DeepSeek provider config. |
| `volc_access_key_id` | `VOLCENGINE_ACCESS_KEY_ID` | Volcengine Access Key ID. |
| `volc_secret_access_key` | `VOLCENGINE_SECRET_ACCESS_KEY` | Volcengine Secret Access Key. |
| `volc_region` | `VOLC_REGION` | Optional. Coding Plan defaults to `cn-beijing`, billing to `cn-north-1`. |
| `zcode_usage_db` | `ZCODE_USAGE_DB` | Optional. Defaults to `~/.zcode/cli/db/db.sqlite`. |
| `zcode_jwt_token` | `ZCODE_JWT_TOKEN` | Optional. Overrides the ZCode OAuth token; auto-decrypted from `~/.zcode/v2/credentials.json`. |
| `zcode_device_mid` | `ZCODE_DEVICE_MID` | Optional. Auto-read from `telemetry-state.json`. |

Volcengine account balance and Coding Plan quota require **AK/SK signing**. With only an Ark API key, today's local usage estimate is still shown, but official balance/quota cannot be read.

### Display settings

The settings modal has a "display" section controlling which rows appear, saved in `runtime/options.json`:

| Option | Default | Description |
| --- | --- | --- |
| `show_deepseek` | `1` | Show the DeepSeek row |
| `show_volcano` | `1` | Show the Volcengine row |
| `show_zcode` | `1` | Show the ZCode row |
| `hide_unconfigured` | `1` | Hide providers without configured keys |

A row is shown when its switch is on **and** (auto-hide is off **or** the provider is configured). When every row is hidden the card keeps only its header and gear so settings remain reachable.

## Consumption analytics

Clicking a balance row runs `scripts/query-analytics.mjs` on demand against the local usage database:

- Time: today/yesterday bucketed by hour, this week/this month/custom by day, weekly beyond 62 days;
- Projects: grouped by `session.project_id + session.directory`;
- Tasks: main sessions (`session.id + title`); `session_task_link` is currently empty;
- Providers: DeepSeek / Volcengine Coding Plan / Volcengine account / ZCode / other;
- Tokens: `computed_total_tokens` first, `input + output` as fallback; cache/reasoning tokens are not double-counted;
- Cost is estimated from public list prices and labeled "estimated".

All charts are inline SVG with no external chart libraries; colors follow ZCode's `--color-usage-chart-*` theme variables.

## Sidebar injection details

ZCode's plugin system currently has no left-sidebar mount point, so the widget is implemented the same way as the token-usage statusbar plugin:

- One plugin-specific dynamic `import()` line appended to `out/main/index.js` in `app.asar`;
- The main-process loader only injects a renderer script into ZCode's own local pages;
- The widget is mounted before the profile footer inside `aside[data-testid="sidebar"]` and re-asserts its position after React re-renders;
- A one-shot Node collector runs every 60 seconds and pushes data to the renderer; modal requests flow through a `window.__balanceDashboardRequests` queue handled by the main process;
- The widget hides/re-mounts safely when the sidebar collapses or the DOM changes and never breaks ZCode on failure.

Injection markers belong to this plugin only; updates strip only this plugin's line and preserve other plugins' injections (e.g. the token-usage statusbar). Every replacement path validates the staged asar with full SHA-256 checks before swapping, creates a backup first, and rolls back automatically if the post-swap verification fails.

> `app.asar` cannot be replaced while ZCode is running, so the first install usually needs one full quit/reopen. If a status shows "pending restart", quit and reopen once more.

Status is written to `~/.zcode/balance-dashboard/runtime/status.json`.

## Data semantics

- **DeepSeek balance**: `GET https://api.deepseek.com/user/balance`.
- **DeepSeek today's spend**: DeepSeek's API has no usage endpoint, so it is estimated from ZCode's local usage database (rows belonging to DeepSeek providers) and labeled "estimated".
- **Volcengine account balance**: `QueryBalanceAcct` (billing, 2022-01-01).
- **Volcengine today's spend**: `ListBillDetail` (billing, `ExpenseDate` = today); falls back to a local estimate when today's bill is not yet generated.
- **Volcengine Coding Plan**: `GetAFPUsage` (Agent Plan) first, otherwise `GetCodingPlanUsage` (Coding Plan), both via signed Ark APIs.
- **ZCode plan balance**: Start Plan via `zcode-plan/billing/balance`; coding plans via BigModel / Z.ai `monitor/usage/quota/limit`.
- **ZCode today's usage**: local `model_usage` table aggregated by local timezone. The sidebar ZCode row counts only the ZCode provider bucket, matching the analytics view; the all-provider total appears in the expanded details.

Credentials are only stored in ZCode's plugin config, the local `options.json`, or process environment variables; they are never written to logs or caches. Network requests go to the corresponding official domains only.

## Removing the sidebar widget

Run:

```bash
node "${ZCODE_PLUGIN_ROOT}/scripts/unpatch.mjs"
```

or execute `/remove-sidebar-widget` in a session. It removes only this plugin's injection line and preserves other plugins'. Reopen ZCode afterwards.

## Incident & fix notes (0.2.1)

0.2.0's asar repack script had a serious bug: it rewrote each file's `offset` before reading source data with the already-rewritten offset, misaligning 4000+ files after the patch point and failing ZCode's integrity check on startup. 0.2.1 fixed this:

- Original offsets are captured before mutation; copies only ever use original offsets;
- After repacking, every one of the 30k+ entries is re-hashed (SHA-256 plus 4 MB block hashes) and compared against the header integrity;
- `app.asar` is only replaced when full verification passes;
- A backup (`app.asar.balance-dashboard.bak`, NTFS hardlink when possible) is created before replacement, re-verified after, and rolled back automatically on failure;
- `finalize` / `post-patch` / `session-start` validate every staged asar before promotion.

If a broken `app.asar` from 0.2.0 is present, quit ZCode completely and run:

```bash
node "<plugin dir>/scripts/restore-backup.mjs"
```

Without a backup, restore `resources/app.asar` from the official ZCode installer. Do not use `app.asar.broken-*` files.

## Known limitations

- This is an unofficial injection capability. Official ZCode updates rewrite `app.asar`; the SessionStart hook attempts automatic repair. If the sidebar DOM changes in a future version, the widget fails closed (hidden, without affecting the app) until selectors are updated.
- Install/injection requires a restart; if `app.asar` is locked, wait for the finalizer or rerun the injection after fully quitting ZCode.
- DeepSeek's and Volcengine Coding Plan's "today's spend" are local estimates, not provider billing.
