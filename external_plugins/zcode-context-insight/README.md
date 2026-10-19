
# zcode-context-insight

[中文](README_CN.md)

**Context insight and management for ZCode, adapted from [dsh-context](https://github.com/bowenliang123/dsh-context).**

`zcode-context-insight` turns what ZCode already records on your machine into a session side panel:

- **Context** — a compact DSH-style dashboard for the current request: composition, Token and Timing stats, the per-request trend, the request browser, context events, and file activity.
- **Fleet** — the current agent, its parents, siblings and every subagent, with live status, billed tokens, estimated cost and context occupancy.
- **Insights** — cross-session usage: KPI band, 7-day chart, 8-week heatmap, token mix, aggregate composition, and searchable session cards.
- **`/context`** — a read-only report for the current session, without leaving the chat.
- **Preferences** — per-user defaults for the trend, sorting, currency, language and context-window override.

It is read-only and offline: no session edits, no model calls, no network.

## Install / update

**Requirements:** ZCode Desktop **3.15.1+** with the official MCP Apps UI contract, and **Node.js 24+** on `PATH` (`node -v`). Runtime dependencies are bundled in `dist/`; no npm or build tools are needed after installation.

### From the ZCode plugin marketplace

Install **zcode-context-insight** from **Settings → Plugin Management**, then enable it. In a session, open the right-side panel switcher (`+`) and choose **Context / 上下文**.

### Local checkout (standalone repository)

```sh
npm install
npm run build
npm run package
```

`npm run package` writes the installable plugin to `plugins/zcode-context-insight/` and a local catalog to `plugins/marketplace.json`.

1. Open **Settings → Plugin Management → Discover**.
2. Add the absolute path to `<checkout>/plugins` as a plugin marketplace.
3. Install **zcode-context-insight**, then enable it.
4. Restart ZCode once if the app was already running when you installed it.
5. In a session, open the right-side panel switcher (`+`) and choose **Context / 上下文**.

To update: run `npm run build && npm run package`, refresh the marketplace, and reinstall/update the plugin. Keep the same local market name.

For development, `npm run watch` rebuilds on changes and mirrors the runtime into the installed plugin cache. UI-only changes are picked up by closing and reopening the panel; server or worker changes need a ZCode restart.

### From GitHub (standalone repository)

Add `bowenliang123/zcode-context-insight` (or the full repository URL) as a plugin marketplace, install **zcode-context-insight**, and enable it. In the standalone repository, the root `marketplace.json` points at the packaged plugin under `plugins/zcode-context-insight`.

## Use it

The Context panel follows DSH's right-sidebar arrangement: a compact metrics strip, Token Stats, Timing Stats, Current Context and Context Trend. Browser, Context Events and File Activity sit behind a slim detail switcher below the trend, so the sidebar stays readable.

![The Context panel](docs/images/context-panel.png)

| Area | What it answers |
| --- | --- |
| **Metrics strip** | Turns, steps, tool calls, agent family size, cache-hit rate, estimated cost — with an expandable full stats card. |
| **Token Stats** | Where the billed tokens went, split by composition and closed by the provider-exact output. |
| **Timing Stats** | How active time split across waiting for the first token, generation, tool runs and overhead. |
| **Current Context** | What the window carries right now, against the model's window, including the output reserve and compaction headroom. |
| **Context Trend** | One bar per request, with Step/Turn, Total/Delta, a continuous Overview, DNA fingerprints, Adaptive scaling and a duration curve. |
| **Context Browser** | What any selected request was assembled from: categories, search, sort, changes, DNA order and full element content. |
| **Context Events** | Injections, compactions, model switches and rewinds, with a drill-down into what a compaction summarized. |
| **File Activity** | Read, written and searched paths, line deltas and the per-operation log. |

The step selector at the top pins a request. **Load earlier requests** extends the loaded window. When new requests arrive while you are reading history, the panel offers **N newer** and **Latest** instead of stealing your selection.

### 🧱 Current Context

A segment bar against the resolved context window: system prompt, tool schemas, user messages, injected context, skill injections, assistant replies and tool results, each with its ≈token figure and share. The hatched tail is the output reserve; the remaining space is compaction headroom.

The provider-reported prompt total anchors the bar, so the headline figure matches the request bill. When the system prompt and tool schemas were not retained for an older request, the panel says so and records the missing remainder as **Unrecorded** rather than inventing a split.

### 📈 Context Trend

![Overview area](docs/images/context-overview.png)

- **Steps / Turns** — one bar per model request, or one per turn using the turn's last request.
- **Total / Delta** — cumulative composition, or the signed change against the previous record.
- **Overview** — the whole loaded session as one continuous stacked area, scaled to the session-wide maximum. It has five axis labels, turn labels and a duration curve; hover to scrub, click to pin. This is not a per-request 100% ribbon: growth and compaction drops stay visible.
- **DNA** — the newest 120 loaded trend bars become per-item fingerprints, and the browser switches to the flat DNA list. Older bars keep their category colors. Bands are fetched as a compact per-request series and kept across polling refreshes.

![DNA fingerprints and browser](docs/images/context-dna.png)

- **Adaptive** scales the chart to the visible maximum; **Duration** overlays each request's active time.
- **Hover & pin** — scrub for a request tooltip; click to pin the step. The brief below the chart shows **User / In / Response**, the provider's **Actual prompt / Output / Cache**, and opens the exact item in the browser.

### 🧭 Context Browser

![Context Browser](docs/images/context-browser.png)

Choose **Categories**, **Changes** or **DNA**:

- **Categories** — collapsible groups, token totals, counts and change badges. Search, sort by size/name/prompt order/calls, and load further pages.
- **Changes** — diff the selected request against the previous step or turn: added, removed, changed, with signed token deltas.
- **DNA** — a flat prompt-order list, newest first, with position, category, entering step and token price.

Click any item to read its full content: system prompt, tool schema, message text, reasoning, tool arguments and result body. Tool cards include status, argument table, raw JSON and Markdown/text views; large content is loaded in pages.

Tool schema rows carry a source chip (`built-in`, `plugin`, or `mcp:<server>`) and a call count. The assistant category can be filtered by **Thinking / Tools / Answer**.

### ⚡ Context Events

Every runtime injection, compaction, model switch and rewind is listed with its producer, net token delta, step and time. Filter chips cover the kinds present in the session.

Click a compaction to open **What was summarized**: tokens before/after, summarized and kept counts, duration, and the messages on the active branch. The browser can compare the request before and after. An interrupted or boundary-less compaction says its summarized content is unavailable instead of failing.

### 📁 File Activity

![File Activity](docs/images/file-activity.png)

Open **File Activity** from the detail switcher:

- Read / Written / Searched / Images filters and a path search.
- Sort by operations, latest, path, name or added lines.
- Expand a file for its per-operation log; each op jumps to the corresponding tool result.
- Edits use exact recorded additions/deletions when available; writes fall back to content line counts; shell-derived operations are marked as estimates.

## 🚢 Fleet

![Fleet](docs/images/fleet.png)

Open the **Fleet** tab to see the current agent, its parents, siblings and every descendant as one card each:

- role (current / parent / sibling / subagent), task type and model;
- billed tokens, estimated cost and cache-hit rate;
- latest context size and occupancy;
- running/completed/error status, with a pulse for a running agent.

Click a card for the initial prompt, latest reply, usage, timing and direct children. The panel host does not expose session switching, so Fleet is informational; open another session from ZCode's session list.

## 🗂️ Insights

![Insights](docs/images/insights.png)

The **Insights** tab aggregates the local store across sessions:

- **KPIs** — sessions, billed tokens, estimated cost, cache-hit rate, model calls and average latest context.
- **7-day chart** — daily billed tokens with estimated cost.
- **Heatmap** — the last 8 weeks of daily billed tokens; click a day to filter the session cards.
- **Token mix** — prompt, cache reads and output.
- **Aggregate composition** — across the 12 most recent sessions, with the count stated.
- **Session cards** — title, workspace, model, tokens, cost, cache hit and context occupancy; filter by range, search, sort and group by workspace.

Range, day, search and sorting apply to the cards. Usage comes only from sessions whose local usage rows are still retained; the panel says so. When the payload budget trims the card list, it also states how many of the total sessions are shown.

## ⌨️ `/context`

Type `/context` in the composer. The plugin's model-visible `get_context_report` tool reads the current session and returns a concise report: prompt size, occupancy, composition, counts, cost, recent events and coverage. The command asks the agent to present it without inventing figures; the interactive browser remains in the panel.

## ⚙️ Preferences

![Preferences](docs/images/settings.png)

The gear opens per-user preferences:

- default view, trend granularity and mode, comparison baseline;
- duration curve, file and tool sort;
- currency and language;
- context-window override (when ZCode's provider config and the bundled catalog cannot resolve one);
- compact cards.

Preferences are stored under the plugin data directory (`ZCODE_PLUGIN_DATA`, or `~/.zcode/zcode-context-insight/preferences.json`) and never change the session.

## Good to know

**Estimates vs actuals.** Category figures use a script-weighted heuristic (≈4 ASCII / 1.5 CJK / 2 other characters per token) and are anchored to the provider-reported prompt total. Prompt, output and cache counts are exact. The trend tooltip and brief print the provider-reported actuals next to the estimates.

**Context windows.** Resolution order: your override → ZCode's provider config → bundled models.dev snapshot → unknown. Unknown windows stay unknown; the panel does not fabricate a percentage. Costs are list-price estimates from the same offline snapshot; unknown models show `—`.

**Messages vs headers.** Message composition is reconstructed from ZCode's complete SQLite session store, including tool calls/results, synthetic reminders, compaction summaries, images and attachments. System prompts and tool schemas come from model-I/O trajectories. Under ZCode's default bounded retention, older headers may be approximated from the nearest recorded request; the Coverage card and footer say when.

**Retention.** Enable **Settings → General → Keep complete model I/O** in ZCode for exact historical headers. It applies to future requests only; already discarded records cannot be recovered. The plugin never changes this setting.

**Pruning and rewinds.** A request after a compaction excludes the summarized messages; the active rewind branch is followed for items, while session-wide counts and historical activity remain whole-session facts.

**Adaptation limits.** ZCode exposes session-scoped `ui.surfaces` only, so Fleet and Insights are internal tabs rather than first-class sidebar pages, and the host has no session-switch API. There is no prompt prefix/suffix injection. DNA forces Total mode (per-item DNA Delta is not implemented) and covers the newest 120 loaded requests. Image and file attachments show metadata and text where recorded; no external resources are loaded. Fleet, file preview and session-jump behavior therefore differ from DSH.

**I18n.** English and 简体中文.

## Development

These commands belong to the standalone repository. In the marketplace source package, build with `pnpm install --frozen-lockfile` and `pnpm build` from the marketplace repository root, and run tests with `node --test test/*.test.mjs`.

```sh
npm install          # esbuild + MCP SDK
npm run build        # dist/server.mjs, dist/worker.mjs, dist/context.html
npm run watch        # rebuild on changes + sync the installed dev plugin
npm run register     # build, package, register/enable the local plugin
npm test             # domain tests
npm run check        # manifest, build, syntax and environment checks
npm run smoke        # live local database smoke
npm run mcp-smoke    # stdio MCP handshake, tools, binding, Insights
npm run preview      # browser preview over the real read-only service
npm run test-host    # MCP Apps AppBridge + iframe handshake
npm run package      # packaged plugin + local marketplace
```

`npm run preview` serves the built panel on `127.0.0.1:4180` with real local data; append `?theme=dark` or `?lang=en`. `npm run test-host` serves the same panel through a real `@modelcontextprotocol/ext-apps` AppBridge on `127.0.0.1:4190`.

Watch loop details: UI-only edits are picked up by closing and reopening the Context panel (the MCP resource is re-read on open). Server/worker edits require restarting ZCode because the running MCP process keeps its module graph.

Key paths:

```text
src/server.mjs          MCP stdio server and session binding
src/worker.mjs          read-only SQLite worker
src/service.mjs         cached session view, aggregate, payload fitting
src/data/db.mjs         schema-tolerant bounded SQL
src/data/rollout.mjs    model-I/O full/delta/tail reader
src/domain/compose.mjs  composition, trend, diff, brief, compaction cuts
src/domain/items.mjs    element extraction and token estimates
src/domain/events.mjs   injections, compactions, model switches, rewinds
src/domain/files.mjs    file operations and aggregation
src/domain/detail.mjs   element and summarized-message content
ui/app.mjs              MCP App UI
ui/styles.css           card/chart visual system
```

## Privacy

- Reads local ZCode data only: `~/.zcode/cli/db/db.sqlite` and its WAL, `rollout/`, `debug/`, `log/`, plus the model rules in `~/.zcode/v2/provider_config.json` and the retention flag in `~/.zcode/v2/setting.json`.
- SQLite is opened `readOnly` with `PRAGMA query_only`; no migrations, writes or locks.
- No network, telemetry or model calls. The HTML resource declares an empty CSP allowlist.
- Full tool outputs are read one element at a time and chunked; result-producing tools are capped under ZCode's 64 KiB `structuredContent` budget, with pages for large content.

## Compatibility

- ZCode Desktop **3.15.1+**; tested on **3.15.3**.
- Node.js **24+** (`node:sqlite`, worker threads).
- See [docs/verification.md](docs/verification.md) for the tested host, commands, coverage caveats and known limits.

## Like it?

If `zcode-context-insight` helped you see what your agent is carrying around, a ⭐ on [GitHub](https://github.com/bowenliang123/zcode-context-insight) is much appreciated. Issues and PRs are welcome.

## License

[Apache-2.0](LICENSE). Feature and interaction design adapted from [dsh-context](https://github.com/bowenliang123/dsh-context); model metadata and list prices from [models.dev](https://models.dev).
