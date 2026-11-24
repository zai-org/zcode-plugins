# Tripo 3D

[中文文档](./README_CN.md)

## 0.1.5

Tripo 3D supports both Tripo sites in one plugin. Authorize `tripo` for the
China site and `tripo-global` for the international site. You can use either
account or keep both connected.

A user's explicitly chosen compatible model overrides usage-based defaults.
Choose from models that support the required features before applying the
scenario preference. If an explicitly chosen model conflicts with a required
feature, ask before changing the model or dropping the requirement.
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
The hook also provides the PBR default and explicit model/billing guidance.

The official Tripo plugin for ZCode. Generate textured 3D models from a text
prompt or a reference image, with rigging, animation, retopology and format
conversion (GLB/FBX/OBJ/STL/USDZ/3MF). You can ask to save the files in your
project. Built for games, film, AR and 3D printing.

## Components

| Component | What it does |
| --- | --- |
| Skill `tripo-3d` | Main workflow: tool check, authorization guidance, MCP workflow, scenario → tool-chain mapping, input handling, credit rules |
| Skill `tripo-game-asset` | Game-asset recipes: budgeted low-poly props, LOD chains, rigged characters with locomotion clips, wiring into Unity/Unreal/Godot/Three.js |
| MCP server `tripo` | China site: remote Streamable HTTP server `https://developers.tripo3d.com/mcp` (OAuth 2.1), including `tripo_plan`, generation, rigging, conversion and `tripo_smart_uv`; available tool schemas are authoritative |
| MCP server `tripo-global` | International site: remote Streamable HTTP server `https://openapi-mcp.tripo3d.ai/mcp` (OAuth 2.1) |
| Hook `SessionStart` | Injects eight rules covering async waiting, short-lived links, credit confirmation, browser authorization, honest failures, PBR, model selection and concept-image confirmation |

## Usage

Install and enable the plugin, then just describe what you need, for example:

- Generate a low-poly treasure chest and export it as FBX for Unity
- Turn this concept image into a textured 3D model and export it as GLB
- Make a 3D-printable knight figurine and export STL
- Create a T-posed robot character, rig it and add a walk animation
- Check my Tripo China credit balance
- Check my Tripo International credit balance

You can also type `/` in the composer and pick `tripo-3d` or `tripo-game-asset`
from the Skills group.

For a text-only model request, the skill first plans and asks you to confirm
the concept-image cost. It generates and shows the image, then waits for your
acceptance before planning and asking for separate confirmation of the 3D step
and any requested post-processing. You can explicitly ask to skip the image and
generate directly from text. An image or multiview set you already supplied can
be used directly for 3D generation.

### First-time authorization

Authorize each site you want to use:

1. Open **Settings → MCP Servers** and find **Tripo 3D**. Click **Open authorization**
   on the row you want to connect. Each row shows its own connection status.
2. Sign in to the corresponding site in the browser: `developers.tripo3d.com`
   for `tripo` or `developers.tripo3d.ai` for `tripo-global`.
3. The page shows a one-time verification code and opens the Tripo console:
   sign in, type the code into **Verification code**, click **Authorize**.
4. Once the row shows connected, start a new chat or run `/reload` in an
   existing chat if its tools are missing.

If you connect both accounts, name the region in each new request. If the
region is unclear, the agent asks before calling either server. Task IDs,
file tokens and balances stay with the originating server.

## Dependencies, network access and side effects

- **Network**: ZCode connects to both MCP endpoints,
  `https://developers.tripo3d.com/mcp` (China site) and
  `https://openapi-mcp.tripo3d.ai/mcp` (international site). Each task runs
  through its selected server. Results are available through short-lived Tripo
  CDN links.
  `tripo_task_status` refreshes them when needed.
- **Account and billing**: every generation spends credits from your own
  Tripo account; use task status and the usage ledger for actual charges. Failed
  tasks are refunded automatically. The skill drafts billed steps with
  `tripo_plan` and asks for explicit confirmation before they run. For a batch,
  it checks the balance and confirms the cost of each phase before that phase runs.
- **File writes**: when you ask to save or integrate a model, the agent
  downloads it into your project with `curl`. The hook and the MCP servers
  write nothing.
- **Command execution**: shell commands run only to upload a local image/model
  (using the command returned by `tripo_upload_ticket` or, for larger files when
  the connected server supports it, `tripo_upload_presign`) or to download a result. The
  plugin never installs or runs a command-line client, including after an MCP
  failure, missing authorization, batch work or a request to save files locally.
- **Hook**: `hooks/session-start.mjs` needs `node` on PATH. It reads the
  event from stdin and prints the workflow rules to stdout.
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
