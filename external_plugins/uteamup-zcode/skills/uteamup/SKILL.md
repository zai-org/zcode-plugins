---
name: uteamup
description: Use when the user asks about their UteamUP CMMS data — assets, work orders, maintenance, or equipment lookups (e.g. "list my assets", "find work orders about pump", "what assets do we have in Building A"), or wants to search UteamUP records by name, GUID, status, or free text. Read-only; not for writing or updating records.
---

# UteamUP CMMS (read-only)

This skill uses the `uteamup` MCP server (tools prefixed `uteamup_`) to read the
user's UteamUP workspace: companies (tenants), assets, and work orders.

## Connection

The server connects to `https://api.uteamup.com/mcp/read-only` and authenticates
with the user's own UteamUP account over OAuth.

Prerequisites (one-time, done in UteamUP, not in ZCode):

1. A tenant administrator turns on **Allow members to connect AI assistants** in
   the company's **API Keys** tab.
2. On first use ZCode opens the UteamUP consent page; the member signs in,
   picks the company (only companies where they are owner or hold a license are
   listed), and allows access.

No API key or secret is needed. The connection uses the member's own
permissions in the chosen company. A member disconnects under
**Profile → Accounts**; administrators can revoke links in the API Keys tab.

## Tools

- `uteamup_asset_list` — list assets in the connected workspace
- `uteamup_asset_get_by_guid` — fetch one asset by its GUID
- `uteamup_asset_search` — search assets (name, free text)
- `uteamup_workorder_list` — list work orders in the connected workspace
- `uteamup_workorder_search` — search work orders (title, description, free text)

Only these read tools are available; guessed write or admin calls are denied
server-side. Reads do not invoke a UteamUP AI provider and spend no AI credits.

## Usage notes

- Prefer `list` tools for browsing and `search` tools when the user names
  something ("find assets containing 'pump'").
- Assets and work orders are identified by GUID in results; use
  `uteamup_asset_get_by_guid` for follow-up detail on a specific asset.
- If a tool call returns 401 `invalid_token`, the member's license or the
  company setting ended, or the link was revoked — tell the user to reconnect
  or contact their administrator.
- If the tools are missing entirely, the plugin's MCP server is not connected
  yet: ask the user to complete the sign-in flow (Settings → MCP → uteamup).

## Examples

- "List the first five assets in my workspace." → `uteamup_asset_list`
- "Find assets whose name contains pump." → `uteamup_asset_search`
- "Show my open work orders." → `uteamup_workorder_list` / `uteamup_workorder_search`
- "Give me details for asset with GUID …" → `uteamup_asset_get_by_guid`
