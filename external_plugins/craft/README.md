# Craft Connector for ZCode

A ZCode plugin that connects the agent to [Craft](https://www.craft.do) (craft.do) on macOS:

- **Create notes** (`/craft-notiz`) – new document with a title and Markdown content
- **Search & read notes** (`/craft-suche`) – full-text search via `documents/search`
- **Daily notes** (`/craft-daily`) – read today's note and append entries
- **Open in Craft** – `craftdocs://` deep links for pages, search and daily notes

The primary path is the official [Craft API](https://connect.craft.do/api-docs);
the `craftdocs://` URL scheme is used for opening things in the app.
Source and issue tracker: <https://github.com/dbrussig/craft-connector>

## Requirements

- macOS with the Craft desktop app
- A Craft API connection: in Craft, open your space's **Connect** area, create an
  API connection (e.g. "connect all documents"). Craft shows **two** values that
  belong together: the **connection URL** (`https://connect.craft.do/links/<id>/api/v1`)
  and the **key** (`pdk_…`).

## One-time setup (API credentials)

Store both values in a local env file, outside any project. Use a terminal so
nothing lands in your shell history (zsh syntax below):

```bash
mkdir -p ~/.config/craft-connector && chmod 700 ~/.config/craft-connector
umask 077
printf 'CRAFT_API_URL=%s\n' 'YOUR-CONNECTION-URL' > ~/.config/craft-connector/craft.env
read -s "CRAFT_API_KEY?Paste key and press Enter: "
printf 'CRAFT_API_KEY=%s\n' "$CRAFT_API_KEY" >> ~/.config/craft-connector/craft.env
unset CRAFT_API_KEY
chmod 600 ~/.config/craft-connector/craft.env
```

Sanity check (shows only space name/timezone, never the key):

```bash
set -a; source ~/.config/craft-connector/craft.env; set +a
curl -sS -H "Authorization: Bearer $CRAFT_API_KEY" "${CRAFT_API_URL%/}/connection"
```

URL and key are credentials. Never print them, paste them into chats, or commit them.

## Installation

- **Official marketplace (recommended):** ZCode → plugin manager → search for
  **Craft Connector** → install → enable → restart ZCode.
- **From source / own GitHub marketplace:** add
  <https://github.com/dbrussig/craft-connector> as a plugin marketplace
  (Plugin Marketplace → Add) and install the `craft` plugin from it.

## Components

- `skills/craft/SKILL.md` – core knowledge: env handling, safety, API flows
- `commands/craft-notiz.md`, `commands/craft-suche.md`, `commands/craft-daily.md`
- No bundled MCP server, no background processes, no hooks

## Known API behavior (live-verified 2026-11-07)

- `POST /documents` **ignores** the `content` field – create documents with a title
  only, then append content as blocks via `pageId` (the skill documents the
  reliable two-step flow).
- The `documentId` inside `clickableLink` differs from the API-addressable page ID
  (`items[].id`); the link opens Craft, but the ID is not usable with
  `GET /blocks?id=`.
- `GET /documents?id=…` does not filter by ID, it returns the space's document list.

## Network access & side effects

- **Network:** the plugin talks only to the user's own Craft Connect API endpoint
  (`https://connect.craft.do/links/<id>/api/v1`, shown when creating an API
  connection in Craft), authenticated with the user's own credentials from the
  local env file. No telemetry, no third-party services, no automatic cloud calls.
- **Writes:** the agent can append blocks to daily notes and pages and create new
  documents in the connected Craft space – only within the scope of the user's
  task. Deletions happen only on explicit per-object user requests.
- **Credentials:** read from `~/.config/craft-connector/craft.env` (outside any
  project); never printed, logged or committed.
- **No hooks, no MCP server, no background processes** – the plugin is one skill
  plus three slash commands executed by the agent.
- **Third-party service:** Craft (craft.do) and its Connect API; the
  `craftdocs://` URL scheme opens the local Craft desktop app. This plugin is not
  affiliated with or endorsed by Craft.

## License

MIT – see [LICENSE](./LICENSE).
