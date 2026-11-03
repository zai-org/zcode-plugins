# figma-mcp

Connect ZCode to Figma through the official **Figma MCP server**
(`https://mcp.figma.com/mcp`): pull screenshots and structured design context,
read variables and design tokens, work with code connect mappings and FigJam
boards, and turn code into designs.

## What's included

- **MCP server declaration** for the official remote Figma MCP server. After
  authorization it exposes ~45 tools, including:
  - `get_screenshot` — render a file/frame/node to an image
  - `get_design_context` — structured layout data for a selection
  - `get_variable_defs`, `get_metadata`, `get_figjam`
  - code connect: `get_code_connect_map`, `send_code_connect_mappings`,
    `send_code_to_figma`
  - `use_figma` and other higher-level design operations
- **Setup skill** that guides first-time OAuth authorization and 401
  troubleshooting.

## First-time setup (one time)

The Figma MCP server only whitelists a fixed list of OAuth client names, and
ZCode is not on it, so the out-of-the-box flow fails at client registration.
Authorize once with the helper script:

```bash
git clone https://github.com/Jommmain/zcode-figma-mcp
cd zcode-figma-mcp && npm install
node figma-mcp-auth.mjs
```

The script opens a browser: log in to Figma and click Authorize. It injects
the tokens into ZCode's encrypted credential store
(`~/.zcode/v2/credentials.json`, backup is written alongside). Restart ZCode
(or reconnect the `figma` server) afterwards.

Access tokens expire after roughly 90 days; when ZCode starts receiving 401s,
re-run the script.

## Dependencies, network access and side effects

- Network: connections to `https://mcp.figma.com` (MCP + OAuth), initiated by
  ZCode after installation. The helper script additionally runs a local
  callback server on `localhost:3000` during authorization.
- Service dependency: a Figma account with access to the files the user asks
  about.
- File writes: none by the plugin itself. The optional helper script writes
  only to `~/.zcode/v2/credentials.json` (plus a `.backup` copy).
- Command execution: the setup skill instructs running the helper script from
  https://github.com/Jommmain/zcode-figma-mcp when authorization is needed.

## Third-party code and services

- **Figma MCP server** — remote service operated by Figma; subject to Figma's
  terms of service.
- **zcode-figma-mcp helper** (optional) —
  https://github.com/Jommmain/zcode-figma-mcp , a fork of
  https://github.com/DarkGenius/zcode-figma-mcp ; the OAuth flow depends on
  the `@modelcontextprotocol/sdk` (MIT).

## Category

`productivity`
