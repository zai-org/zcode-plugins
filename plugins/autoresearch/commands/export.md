---
description: Render .auto/log.jsonl into autoresearch-dashboard.html. Usage: /autoresearch:export
---

Export the autoresearch experiment dashboard.

1. Call the `export_dashboard` tool (prefer the MCP tool; the same export logic also lives in `${ZCODE_PLUGIN_ROOT}/mcp/server.ts`).
2. If the tool is unavailable, fall back to reading `.auto/log.jsonl` yourself, summarizing experiments (status, metric, delta vs baseline, direction), and writing a self-contained `autoresearch-dashboard.html` in the workspace root.
3. Tell the user the file path (`autoresearch-dashboard.html`) and a 2-3 line summary of progress (experiments run, kept, best metric).

If there is no `.auto/log.jsonl`, say so and suggest `/autoresearch:autoresearch` to start a session first.
