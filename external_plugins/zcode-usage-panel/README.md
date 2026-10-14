# zcode-usage-panel

[中文](./README_CN.md)

A ZCode MCP App plugin that pins a live **Usage Panel** in the session sidebar, showing what the current session is spending in real time.

## Features

- **Top summary**: total tokens (input/output/cache split), model call count, tool call count, average/current TPS, currently running tools
- **TPS sparkline**: generation-phase TPS (`output / (duration − TTFT)`) over the last 40 model calls, with a mean reference line
- **Prompt composition** (v0.2.0): breakdown of the system prompt — AGENTS.md instructions (user-global + project), memory entries, skill manifests (user / plugin / built-in sources, with both "manifest-resident estimate" and "full-text characters" readings), MCP server declarations vs. servers actually called this session, and subagent definitions. When the session's model-io JSONL header has not yet been rotated away, real injection records (per-module character counts + tool list) are shown too
- **Collapsible detail sections** (expand state survives reopen):
  - Tools: built-in / MCP (grouped by server) / Skill (by skill name), with call counts, count/time share, total/average duration, output volume (bytes), and error counts
  - Models: token breakdown by model × agent × source (main conversation / subagent / compaction…), with shares and average TPS
  - Recent turns
- **Subsession rollup** (v0.2.0): model and tool calls from subagents (parent_id) are merged into session stats; model details keep a "source" distinction
- **Session switching**: follows the latest interactive session by default (auto mode), or can be pinned to one of the recent 20 sessions
- **Live updates**: `resources/subscribe` push (~1s), falling back to 2s polling when subscription is unavailable

## Requirements

- ZCode Desktop with MCP App support (session sidebar panels)
- **Node.js ≥ 24** on `PATH` (the server uses the built-in `node:sqlite` module; no native dependencies)

## Install

Install **zcode-usage-panel** from the official ZCode plugin marketplace, then open it from the "+" menu in the right sidebar of a task **with an active session**.

## Permissions & side effects

- **Read-only access to `~/.zcode/cli/db/db.sqlite`** (ZCode's local usage database), opened with `mode=ro`. The plugin never writes to it or to any other file.
- **No network access**, no command execution, no hooks, no third-party services.
- The panel page and server are self-contained bundles; runtime has zero npm dependencies. Build-time dependencies (esbuild, TypeScript, MCP SDK) are not shipped in the install payload.
- No third-party code, assets, or services are bundled beyond open-source build tooling (see `package.json`; all MIT/Apache-2.0 licensed).

## Known limitations

- The panel only appears in the sidebar "+" menu of tasks with an active session (host `availability: "session"` behavior).
- `db.sqlite` is a ZCode-internal schema (verified against 0.16.x); a ZCode upgrade may break queries — the panel then shows a degradation error instead of a blank page.
- The host caps HTML resources at 4 MiB (current payload is ~610 KB).

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # bundles to payload/dist/ (server.mjs + index.html)
npm run smoke       # full MCP JSON-RPC round trip against the real server bundle
```

`SERVER_PATH` / `NODE_BIN` environment variables can point `npm run smoke` at an alternative bundle or runtime (used to verify the published payload with the system Node).

## License

[MIT](./LICENSE)
