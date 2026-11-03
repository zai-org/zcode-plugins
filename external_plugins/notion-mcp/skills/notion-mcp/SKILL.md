---
name: notion-mcp
description: Use when the user asks to read, create or update Notion pages and databases, work with page comments and discussions, browse page version history, or search/read Notion chat session history. Also covers first-time OAuth setup and 401 troubleshooting for the Notion MCP server.
---

# Notion MCP

The `notion` MCP server (official `https://mcp.notion.com/mcp`) exposes ~70 tools:
pages and databases (`notion-search`, `notion-fetch`, `notion-create-pages`,
`notion-update-page`, `notion-move-pages`, `notion-query-data-sources`), comments
and discussions (`notion-get-comments`, `notion-create-comment`,
`notion-set-discussion-resolved`), page version history
(`notion-get-version-changes`, `notion-view-version`, `notion-restore-version`),
chat sessions (`notion-search-sessions`, `notion-query-sessions`,
`notion-read-session-event`, `notion-send-message-to-session`), calendar and
meeting notes, and file uploads/downloads.

## First-time setup (OAuth)

The Notion MCP server only whitelists a fixed list of OAuth client names, and
ZCode is not on it — a plain connect fails at client registration. The
one-time workaround is an authorization helper script:

```bash
git clone https://github.com/Jommmain/zcode-notion-mcp
cd zcode-notion-mcp && npm install
node notion-mcp-auth.mjs
```

The script opens a browser: the user logs in to Notion, selects the pages to
share, and clicks Allow. It then injects the tokens into ZCode's encrypted
credential store. Afterwards restart ZCode (or reconnect the `notion` server).
Full details: https://github.com/Jommmain/zcode-notion-mcp

## Troubleshooting

- **401 from `notion` tools**: the access token expired. Re-run
  `node notion-mcp-auth.mjs` from the helper repository, then restart ZCode.
- **A page is not found / not visible**: the connection only sees pages the
  user shared during authorization. Tell the user to open the page in Notion →
  `···` → Connections → grant access, then retry.

## Working rules

- Prefer `notion-search` first; never invent page or database ids.
- Chat session history: `notion-search-sessions` / `notion-query-sessions`,
  then `notion-read-session-event` for details.
- Deleting pages (`notion-delete-pages`) moves them to trash — confirm with
  the user before destructive calls.
