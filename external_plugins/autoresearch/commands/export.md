---
description: Render .auto/log.jsonl into autoresearch-dashboard.html. Usage: /autoresearch:export
---

Export the autoresearch experiment dashboard.

1. Call the `export_dashboard` tool (prefer the MCP tool; the same export logic also lives in `${ZCODE_PLUGIN_ROOT}/mcp/server.ts`). Besides writing the static file, it starts a live SSE dashboard on `127.0.0.1` (auto-refreshing) and returns its `url`.
2. If the tool is unavailable, fall back to reading `.auto/log.jsonl` yourself, summarizing experiments (status, metric, delta vs baseline, direction), and writing a self-contained `autoresearch-dashboard.html` in the workspace root.
3. Open the live `url` **once** in the user's browser (`open` / `xdg-open` / `cmd /c start`) — once per session, not per export; SSE auto-refreshes the page afterward. Skip the open command when headless (SSH / CI / remote executor) or when the user declined watching — then hand over the URL in text only. Always tell the user the static file path (`autoresearch-dashboard.html`; an export-time snapshot, not per-round updated) plus a 2-3 line summary of progress (experiments run, kept, best metric).

If there is no `.auto/log.jsonl`, say so and suggest `/autoresearch:autoresearch` to start a session first.
