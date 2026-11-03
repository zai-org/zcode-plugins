# notion-mcp

Connect ZCode to your Notion workspace through the official **Notion MCP
server** (`https://mcp.notion.com/mcp`): read, create and update pages and
databases, work with comments and discussions, browse page version history,
and search/read Notion chat session history.

## What's included

- **MCP server declaration** for the official remote Notion MCP server. After
  authorization it exposes ~70 tools, grouped as:
  - Pages & documents: `notion-search`, `notion-fetch`, `notion-create-pages`,
    `notion-update-page`, `notion-move-pages`, `notion-duplicate-page`
  - Databases: `notion-create-database`, `notion-query-data-sources`
  - Comments & discussions: `notion-get-comments`, `notion-create-comment`,
    `notion-set-discussion-resolved`
  - Chat session history: `notion-search-sessions`, `notion-query-sessions`,
    `notion-read-session-event`, `notion-send-message-to-session`
  - Page version history: `notion-get-version-changes`, `notion-view-version`,
    `notion-restore-version`
  - Calendar & meetings, files & attachments
- **Setup skill** that guides first-time OAuth authorization and 401
  troubleshooting.

## First-time setup (one time)

The Notion MCP server only whitelists a fixed list of OAuth client names, and
ZCode is not on it, so the out-of-the-box flow fails at client registration.
Authorize once with the helper script:

```bash
git clone https://github.com/Jommmain/zcode-notion-mcp
cd zcode-notion-mcp && npm install
node notion-mcp-auth.mjs
```

The script opens a browser: log in to Notion, pick the pages to share, click
Allow. It injects the tokens into ZCode's encrypted credential store
(`~/.zcode/v2/credentials.json`, backup is written alongside). Restart ZCode
(or reconnect the `notion` server) afterwards.

When access tokens expire (ZCode starts receiving 401s), re-run the script.

## Dependencies, network access and side effects

- Network: connections to `https://mcp.notion.com` (MCP + OAuth), initiated
  by ZCode after installation. The helper script additionally runs a local
  callback server on `localhost:3000` during authorization.
- Service dependency: a Notion account with pages the user shares with the
  connection. The connection only sees pages explicitly shared during
  authorization.
- File writes: none by the plugin itself. The optional helper script writes
  only to `~/.zcode/v2/credentials.json` (plus a `.backup` copy).
- Command execution: the setup skill instructs running the helper script from
  https://github.com/Jommmain/zcode-notion-mcp when authorization is needed.

## Third-party code and services

- **Notion MCP server** — remote service operated by Notion Labs; subject to
  Notion's terms of service.
- **zcode-notion-mcp helper** (optional, MIT) —
  https://github.com/Jommmain/zcode-notion-mcp — MIT-licensed, depends on the
  `@modelcontextprotocol/sdk` (MIT) for the OAuth flow.

## Category

`productivity`
