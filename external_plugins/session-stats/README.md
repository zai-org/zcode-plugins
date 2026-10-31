# session-stats

Session statistics for ZCode: turns/steps, model vs tool time, TTFT, TPS (average +
latest request), token usage and cache hit rate — inspired by the DeepSeek Harness
session stats. Zero third-party dependencies.

## Components

- **MCP tool `get_stats`** — statistics for the current session (including subagents,
  aggregated via `session.parent_id`) or today's aggregate across sessions.
- **MCP App side panel** (`ui.surfaces`) — stat pills with a details popup
  (timings, token buckets, cache hit, per-model breakdown), auto-refresh every 5 s,
  follows session switching and the live theme.
- **`/stats` command** — text card rendering of the same numbers.
- **SessionStart hook** — writes the current session id into the plugin data dir so
  the server can resolve "current session" without extra round-trips.

## Data source and metric definitions

Everything is read **read-only** from the local session database
`~/.zcode/cli/db/db.sqlite` (SQLite URI `mode=ro`, `busy_timeout=5000`, WAL-safe).
Measured against ZCode 3.17.1:

| Metric | Definition |
| --- | --- |
| Turns | distinct `turn_id` of the main session |
| Steps | distinct `logical_request_id` (retries excluded; failed/cancelled counted) |
| Model time | Σ `duration_ms` |
| Tool time | Σ `tool_usage.duration_ms` |
| TTFT avg | AVG(`time_to_first_token_ms`) |
| TPS | Σ output ÷ Σ(completed_at − first_token_at); "live" TPS = latest completed request |
| Tokens | Σ input + Σ output (`input_tokens` already includes cache reads — measured) |
| Cache hit | cache_read ÷ input |

The database schema is an implementation detail of the host (not a stable API) and
usage rows are retained for 30 days; queries degrade gracefully when columns are
missing.

## Side effects

- Reads the local session database (read-only).
- Starts a loopback-only HTTP service (`127.0.0.1:31710`) that serves the statistics
  JSON and the panel's dynamic script to ZCode's renderer. It answers only requests
  without a cross-origin `Origin` header (i.e. the app's own `file://` pages); other
  origins get 403.
- The SessionStart hook writes one small file (`current_session`) into the
  plugin-owned data directory.
- No network access, no credentials, no telemetry.

## Install

ZCode Desktop → **Plugin Marketplace** → add the marketplace that carries this plugin
(the official `zcode-plugins` marketplace after review, or a local directory) →
**Install session-stats** → restart or open a new session → run `/stats` or open the
"Session Stats" side panel.

## Optional composer pills (host patch, experimental)

A stats strip centered under the composer input can be enabled with a patch to the
host `app.asar` (see the upstream project's `patches/` directory). The patch is
idempotent, backs up the host file per version and supports restore; it must be
re-applied after ZCode updates. This is **not** part of the marketplace plugin and
is purely optional.

## License

MIT
