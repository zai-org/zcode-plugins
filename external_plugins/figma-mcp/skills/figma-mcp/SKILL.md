---
name: figma-mcp
description: Use when the user asks to inspect or extract from Figma designs — screenshots, design context, variables/tokens, component code connect, FigJam boards — or to create designs from code. Also covers first-time OAuth setup and 401 troubleshooting for the Figma MCP server.
---

# Figma MCP

The `figma` MCP server (official `https://mcp.figma.com/mcp`) exposes ~45 tools,
including `get_screenshot` (render a frame/node to an image), `get_design_context`
(structured layout data for a selection), `get_variable_defs` (design tokens),
`get_metadata`, `get_figjam`, code-connect tools (`get_code_connect_map`,
`send_code_to_figma`), and `use_figma` (higher-level design operations).

## First-time setup (OAuth)

The Figma MCP server only whitelists a fixed list of OAuth client names, and
ZCode is not on it — a plain connect fails at client registration. The
one-time workaround is an authorization helper script:

```bash
git clone https://github.com/Jommmain/zcode-figma-mcp
cd zcode-figma-mcp && npm install
node figma-mcp-auth.mjs
```

The script opens a browser: the user logs in to Figma and clicks Authorize. It
then injects the tokens into ZCode's encrypted credential store. Afterwards
restart ZCode (or reconnect the `figma` server). Full details:
https://github.com/Jommmain/zcode-figma-mcp (fork of
https://github.com/DarkGenius/zcode-figma-mcp)

## Troubleshooting

- **401 from `figma` tools**: the access token expired (~90 days). Re-run
  `node figma-mcp-auth.mjs` from the helper repository, then restart ZCode.
- **`Safari can't connect to "localhost"` after Authorize**: make sure port
  3000 is free (`lsof -i :3000`).

## Working rules

- Ask the user for a Figma URL (file, frame or node) when none is given;
  never guess file keys.
- Prefer `get_screenshot` for visual review and `get_design_context` for
  extracting structured layout data to rebuild a design.
