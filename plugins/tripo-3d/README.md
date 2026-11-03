# Tripo 3D

## 0.1.5

Works with both China-mainland and international Tripo accounts: the plugin
ships one MCP server per region, `tripo` for the China site and `tripo-global`
for the international site, and you authorize the one your account belongs to.

A user's explicitly chosen compatible model overrides usage-based defaults.
Game/realtime recipes explicitly prefer **P2** (more credits than H/P1), the
P-series default; **P1** is used only when the user names it or picks it for lower
cost and speed, and v3.1 for film/render/print. Rigs pass the model
explicitly, v3.0 for bipeds and v2.5 for animals (the API's own default, v1.0,
rigs bipeds only), with animation presets selected
from the upstream rig model. Retopology v3.0's
`smart_uv` and standalone `tripo_smart_uv` are distinct billed workflows.
Fast textures require v3.5; `chat_image_1` is retired.

The plugin runs through the Tripo MCP tools only — there is no CLI path, and
missing authorization is never a reason to switch to one. PBR stays off unless
you explicitly ask for it. A plan is advisory, not a price quote or budget lock.
Show estimated or unestimated costs, cite the source, region and date of any
static list estimate, and obtain explicit consent. Never switch accounts silently.
The hook also enforces the PBR default and explicit model/billing decisions.

The official Tripo plugin for ZCode. Generate textured 3D models from a text
prompt or a reference image, with rigging, animation, retopology and format
conversion (GLB/FBX/OBJ/STL/USDZ/3MF), and land the files directly in your
project. Built for games, film, AR and 3D printing.

Connect your Tripo account once in the browser — no API key pasting. Both
**China-mainland** (developers.tripo3d.com) and **international**
(developers.tripo3d.ai) accounts work: the plugin ships one MCP server per
region and you authorize only the one your account belongs to.

## Components

| Component | What it does |
| --- | --- |
| Skill `tripo-3d` | Main workflow: tool check, authorization guidance, MCP workflow, scenario → tool-chain mapping, input handling, credit rules |
| Skill `tripo-game-asset` | Game-asset recipes: budgeted low-poly props, LOD chains, rigged characters with locomotion clips, wiring into Unity/Unreal/Godot/Three.js |
| MCP server `tripo` | China site: remote Streamable HTTP server `https://developers.tripo3d.com/mcp` (OAuth 2.1), including `tripo_plan`, generation, rigging, conversion and `tripo_smart_uv`; available tool schemas are authoritative |
| MCP server `tripo-global` | International site: the same tools on `https://openapi-mcp.tripo3d.ai/mcp` (OAuth 2.1) |
| Hook `SessionStart` | Injects seven rules: async waiting, link expiry, credit confirmation, browser authorization, honest failures, PBR off by default and explicit model/billing decisions, plus a region hint from the system time zone |

## Usage

Install and enable the plugin, then just describe what you need, for example:

- Generate a low-poly treasure chest and export it as FBX for Unity
- Turn this concept image into a textured 3D model and export it as GLB
- Make a 3D-printable knight figurine and export STL
- Create a T-posed robot character, rig it and add a walk animation
- Check my Tripo credit balance

You can also type `/` in the composer and pick `tripo-3d` or `tripo-game-asset`
from the Skills group.

### First-time authorization

Authorize the Tripo MCP server for your account's region once:

1. Open **Settings → MCP Servers**. Under "Plugin MCP servers" there are two Tripo
   rows, both showing "Authorization required": `tripo` for a China-mainland
   account and `tripo-global` for an international account. Click
   **Open authorization** on the row for your account; the other row can stay
   as it is.
2. The system browser opens that site's authorization page: `tripo` uses the
   **China site** (developers.tripo3d.com — +86 SMS sign-in, Alipay top-up),
   `tripo-global` the **international site** (developers.tripo3d.ai — email
   sign-in, Stripe top-up). The page has no region picker. You can sign up on
   the spot; new accounts get free credits.
3. The page shows a one-time verification code and opens the Tripo console:
   sign in, type the code into **Verification code**, click **Authorize**.
4. ZCode reconnects and loads the tools automatically. To revoke access,
   delete the API key you picked during authorization on the console's
   API Keys page.

## Dependencies, network access and side effects

- **Network**: ZCode connects to both MCP endpoints,
  `https://developers.tripo3d.com/mcp` (China site) and
  `https://openapi-mcp.tripo3d.ai/mcp` (international site); tool calls go
  only to the one you authorized, and authorization redirects to that site's
  Tripo console. Results are downloaded from Tripo's CDN through short-lived
  links (about 2 hours).
- **Account and billing**: every generation spends credits from your own
  Tripo account; use task status and the usage ledger for actual charges. Failed
  tasks are refunded automatically. The skill drafts the chain with `tripo_plan`,
  checks the balance and asks before generating a batch.
- **File writes**: only when you ask for the model on disk, the agent
  downloads it into your project with `curl`. The hook and the MCP servers
  write nothing.
- **Command execution**: shell commands run only to upload a local image/model
  (the `curl` returned by `tripo_upload_ticket`) or to download a result. The
  plugin never installs or runs a command-line client, including after an MCP
  failure, missing authorization, batch work or a request to save files locally.
- **Hook**: `hooks/session-start.mjs` needs `node` on PATH. It reads the
  event from stdin and prints the rules plus a region hint derived from the
  system time zone to stdout; no network, no file access.
- **Telemetry**: the plugin has no independent analytics SDK. When enabled on
  the Tripo MCP server you authorized (China or international site; both
  record the same fields), analytics can record tool results, task
  metadata and the Tripo account ID when resolved. Both MCP servers declare the
  non-credential `X-Tripo-Distribution: zcode_plugin` header; if the host
  forwards it, the server records the distribution channel separately from
  the detected client (such as ZCode, Claude, or unknown). Analytics excludes
  prompts, API keys, OAuth tokens, file paths and signed download links.
  Account credentials are managed by ZCode's credential store and never pass
  through the chat.

## Provenance and license

- Plugin: MIT, by [VAST](https://www.tripo3d.ai).
- Both skills are ported from Tripo's official Kimi / Codex plugins (also
  maintained by VAST, MIT).
- Both MCP servers run the official Tripo implementation;
  generated content is subject to the
  [Tripo API content policy](https://platform.tripo3d.ai/docs).
