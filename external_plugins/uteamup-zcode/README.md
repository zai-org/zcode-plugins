# UteamUP CMMS for ZCode

Connect ZCode to your [UteamUP](https://uteamup.com) workspace and ask about your
assets and work orders in natural language. The plugin ships one remote MCP
server and one skill; it contains no local code, hooks, or commands.

## How it works

The `uteamup` MCP server connects to the production read-only endpoint
`https://api.uteamup.com/mcp/read-only` and authenticates with your own UteamUP
account over OAuth 2.0 (the plugin registers itself automatically and ZCode
opens the UteamUP consent page on first use). The requested scope is `mcp:read`.

Prerequisites (one-time, done in UteamUP, not in ZCode):

1. A tenant administrator turns on **Allow members to connect AI assistants**
   in the company's **API Keys** tab.
2. On first use, sign in on the UteamUP consent page and pick the company.
   Only companies where you are the owner or hold a license are offered.

No API keys or secrets are needed. The connection uses the member's own
permissions in the chosen company. A member disconnects under
**Profile → Accounts**; an administrator sees and revokes every link in the
API Keys tab.

## Tools

- `uteamup_asset_list` — list assets in the connected workspace
- `uteamup_asset_get_by_guid` — fetch one asset by its GUID
- `uteamup_asset_search` — search assets (name, free text)
- `uteamup_workorder_list` — list work orders in the connected workspace
- `uteamup_workorder_search` — search work orders (title, description, free text)

Only these read tools are advertised; write or admin calls are denied
server-side. Reads do not invoke a UteamUP AI provider and spend no UteamUP AI
credits.

## Try it

- "List the first five assets in my workspace."
- "Find assets whose name contains pump."
- "Show my open work orders."

## Network access, side effects, and provenance

- Network: outbound HTTPS to `https://api.uteamup.com/mcp/read-only` and the
  UteamUP OAuth endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/register`).
  No other network destinations are configured.
- Local side effects: none. No file writes, no command execution, no hooks, no
  bundled binaries. The plugin declares only an MCP server and a skill.
- Third-party services and code: UteamUP is the publisher of this plugin and
  operates the only contacted service. No third-party code is bundled. The logo
  asset is owned by UteamUP. Requests and responses are processed by Z.ai
  (ZCode) and UteamUP under their respective policies; UteamUP retains stored
  records under its privacy policy and workspace retention settings.
- License: MIT. Privacy policy: https://app.uteamup.com/privacypolicy.
  Terms: https://app.uteamup.com/terms.
  Support: https://github.com/UteamUP/uteamup-mcp/issues.
  Canonical source maintained at https://github.com/UteamUP/uteamup-mcp
  (`plugins/uteamup-zcode`), also installable from UteamUP's own marketplace.
