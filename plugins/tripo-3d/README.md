# Tripo 3D

[中文文档](./README_CN.md)

## 0.1.5

This plugin connects to the Tripo China site through its `tripo` MCP server.
It requires a Tripo mainland China account.

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

Connect your Tripo mainland China account (developers.tripo3d.com) once in
the browser, without pasting an API key into the chat.

## Components

| Component | What it does |
| --- | --- |
| Skill `tripo-3d` | Main workflow: tool check, authorization guidance, MCP workflow, scenario → tool-chain mapping, input handling, credit rules |
| Skill `tripo-game-asset` | Game-asset recipes: budgeted low-poly props, LOD chains, rigged characters with locomotion clips, wiring into Unity/Unreal/Godot/Three.js |
| MCP server `tripo` | China site: remote Streamable HTTP server `https://developers.tripo3d.com/mcp` (OAuth 2.1), including `tripo_plan`, generation, rigging, conversion and `tripo_smart_uv`; available tool schemas are authoritative |
| Hook `SessionStart` | Injects eight rules covering async waiting, short-lived links, credit confirmation, browser authorization, honest failures, PBR, model selection and concept-image confirmation |

## Usage

Install and enable the plugin, then just describe what you need, for example:

- Generate a low-poly treasure chest and export it as FBX for Unity
- Turn this concept image into a textured 3D model and export it as GLB
- Make a 3D-printable knight figurine and export STL
- Create a T-posed robot character, rig it and add a walk animation
- Check my Tripo credit balance

You can also type `/` in the composer and pick `tripo-3d` or `tripo-game-asset`
from the Skills group.

For a text-only model request, the skill first plans and asks you to confirm
the concept-image cost. It generates and shows the image, then waits for your
acceptance before planning and asking for separate confirmation of the 3D step
and any requested post-processing. You can explicitly ask to skip the image and
generate directly from text. An image or multiview set you already supplied can
be used directly for 3D generation.

### First-time authorization

Authorize the Tripo China MCP server once:

1. Open **Settings → MCP Servers**. Under "Plugin MCP servers", find the
   `tripo` row and click **Open authorization**.
2. The browser opens the **China site** authorization page
   (developers.tripo3d.com, +86 SMS sign-in, Alipay top-up). The page has no
   region picker. You can sign up on the spot.
3. The page shows a one-time verification code and opens the Tripo console.
   Sign in, type the code into **Verification code**, and click **Authorize**.
4. ZCode reconnects and loads the tools automatically. To revoke access,
   delete the API key you picked during authorization on the console's
   API Keys page.

## Dependencies, network access and side effects

- **Network**: MCP tool calls go to `https://developers.tripo3d.com/mcp`;
  authorization redirects to the Tripo China console (developers.tripo3d.com).
  Results are available through short-lived Tripo CDN links.
  `tripo_task_status` refreshes them when needed.
- **Account and billing**: every generation spends credits from your own
  Tripo account; use task status and the usage ledger for actual charges. Failed
  tasks are refunded automatically. The skill drafts billed steps with
  `tripo_plan` and asks for explicit confirmation before they run. For a batch,
  it checks the balance and confirms the cost of each phase before that phase runs.
- **File writes**: when you ask to save or integrate a model, the agent
  downloads it into your project with `curl`. The hook and the MCP server
  write nothing.
- **Command execution**: shell commands run only to upload a local image/model
  (using the command returned by `tripo_upload_ticket` or, for larger files when
  the connected server supports it, `tripo_upload_presign`) or to download a result. The
  plugin never installs or runs a command-line client, including after an MCP
  failure, missing authorization, batch work or a request to save files locally.
- **Hook**: `hooks/session-start.mjs` needs `node` on PATH. It reads the
  event from stdin and prints the rules to stdout; no network, no file access.
- **Telemetry**: the plugin has no independent analytics SDK. When enabled on
  the deployed Tripo China MCP server, analytics can record tool results, task
  metadata and the Tripo account ID when resolved. The plugin declares the
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
- The MCP server runs the official Tripo implementation;
  generated content is subject to the
  [Tripo API content policy](https://platform.tripo3d.ai/docs).
