---
name: colab-mcp
description: Use when the user wants ZCode to interact with a live Google Colab notebook through the official colab-mcp server (run/inspect cells, use the notebook's kernel state, work inside the user's browser Colab session). Covers pairing ZCode with a browser Colab session, the dynamic tool list, and troubleshooting. Does not cover the headless google-colab-cli workflow - that is the colab-cli skill.
---

# colab-mcp — pairing ZCode with a browser Colab session

Official Google repo: https://github.com/googlecolab/colab-mcp (Apache-2.0).

## What this server is

`colab-mcp` is a **local proxy MCP server**: it bridges the ZCode MCP client to a
Google Colab notebook open in the user's browser. It is NOT a remote/HTTP MCP server —
it must run on the user's device. When connected, the Colab notebook frontend pushes its
own set of notebook tools through the proxy, so the tool list is **dynamic** and only
appears after pairing.

## Requirements

- The plugin's `.mcp.json` launches the server as
  `python -m uv tool run git+https://github.com/googlecolab/colab-mcp` (equivalent to
  `uvx git+...`; chosen so it works even when uv's Scripts dir is not on PATH). It needs
  the `uv` package importable by `python` (`pip install uv`). If a non-default package
  index is configured (e.g. a mirror), add `--index https://pypi.org/simple` to the args
  if the build fails.
- ZCode supports `notifications/tools/list_changed`, which the server requires.
- The user must be able to open colab.research.google.com in a browser and be signed in
  to their Google account.

## Pairing flow (do this whenever Colab tools are empty)

1. Check whether Colab tools are present. If the `colab-mcp` server is connected but no
   notebook tools are listed, the session is not paired yet.
2. Call the injected tool `open_colab_browser_connection`.
3. The tool opens the browser at
   `https://colab.research.google.com/notebooks/empty.ipynb#mcpProxyToken=...&mcpProxyPort=...`
   (token+port are URL fragments). The Colab frontend then connects back to the local
   WebSocket server. The server waits up to 60 seconds for the handshake.
4. Tell the user: keep the Colab tab open; sign in to Google if prompted; if the notebook
   asks to connect/execute, connect to a runtime.
5. After the connection lands, the server fires `tools/list_changed` — re-list the tools
   and use them. If nothing lands within the window, call the tool again.

## Troubleshooting

- **No Colab tools / server has only the pairing tool**: not paired yet — run the pairing
  flow above. Keep the tab open or it disconnects (the proxy notifies again when it drops).
- **Server fails to start / `python -m uv` missing**: `pip install uv`, then restart ZCode
  so the MCP server starts fresh.
- **Build failed while uvx pulled the package**: if a mirror index is configured, try
  args `["git+https://github.com/googlecolab/colab-mcp", "--index", "https://pypi.org/simple"]`
  in the plugin's `.mcp.json`.
- **Browser opened but no connection**: the user must be logged into
  colab.research.google.com; corporate blockers can kill WebSockets to localhost.
  Call `open_colab_browser_connection` again to re-open with a fresh token.
- **Remote/headless work**: if the user wants code run without a browser session (e.g.
  provision a GPU VM and run a script), use the headless CLI instead — see the
  [[colab-cli]] skill.
