# Tripo 3D

[中文](./README_CN.md)

The official Tripo plugin for ZCode. Generate textured 3D models from a text
prompt or a reference image, with rigging, animation, retopology and format
conversion (GLB/FBX/OBJ/STL/USDZ/3MF), and land the files directly in your
project. Built for games, film, AR and 3D printing.

Connect your **China-mainland** Tripo account once in the browser
(developers.tripo3d.com) — no API key pasting. This build's MCP endpoint is
China-only; overseas-site accounts need the overseas Tripo 3D plugin build, or
the CLI with `--region ov`.

## Components

| Component | What it does |
| --- | --- |
| Skill `tripo-3d` | Main workflow: execution-path selection, authorization guidance, MCP workflow, scenario → tool-chain mapping, input handling, credit rules; plus the fallback `tripo-cli` path |
| Skill `tripo-game-asset` | Game-asset recipes: budgeted low-poly props, LOD chains, rigged characters with locomotion clips, wiring into Unity/Unreal/Godot/Three.js |
| MCP server `tripo` | Remote Streamable HTTP server `https://developers.tripo3d.com/mcp` (OAuth 2.1) exposing 26 tools such as `tripo_plan`, `tripo_text_to_3d`, `tripo_image_to_3d`, `tripo_task_wait`, `tripo_mesh_edit`, `tripo_rig`, `tripo_animate`, `tripo_convert` |
| Hook `SessionStart` | Injects five hard rules (async waiting, link expiry, credit confirmation / `tripo_plan`, browser authorization, honest failure reporting) so they hold even when no skill was triggered |

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

The Tripo MCP server needs a one-time authorization:

1. Open **Settings → MCP**, find the Tripo row under "Plugin MCP servers"
   (it shows "Authorization required") and click **Open authorization**.
2. The system browser opens the Tripo authorization page for the **China site**
   (developers.tripo3d.com — +86 SMS sign-in, Alipay top-up). There is no
   region picker on this page. You can sign up on the spot; new accounts get
   free credits. An international-site account will not authorize against this
   build — use the overseas plugin or `tripo-cli` with `--region ov`.
3. The page shows a one-time verification code and opens the Tripo console:
   sign in, type the code into **Verification code**, click **Authorize**.
4. ZCode reconnects and loads the tools automatically. To revoke access,
   delete the API key you picked during authorization on the console's
   API Keys page.

## Dependencies, network access and side effects

- **Network**: MCP tool calls go to `https://developers.tripo3d.com/mcp`;
  authorization redirects to the China Tripo console
  (developers.tripo3d.com). Results are downloaded from Tripo's CDN through
  short-lived links (about 5 minutes).
- **Account and billing**: every generation spends credits from your own
  Tripo account; each tool reports `credits_consumed`, failed tasks are
  refunded automatically. The skill drafts the chain with `tripo_plan`,
  checks the balance and asks before generating a batch.
- **File writes**: only when you ask for the model on disk, the agent
  downloads it into your project with `curl`. The hook and the MCP server
  write nothing.
- **Command execution**: on the MCP path, shell commands run only to upload a
  local image/model (the `curl` returned by `tripo_upload_ticket`) or to
  download a result. The fallback CLI path downloads and runs
  [tripo-cli](https://www.npmjs.com/package/tripo-cli) (MIT, via
  `npx tripo-cli@latest`), only for jobs that need it (e.g. bulk generation),
  and says so first.
- **Hook**: `hooks/session-start.mjs` needs `node` on PATH. It reads the
  event from stdin and prints a fixed text to stdout; no network, no file
  access.
- **No data collection**: the plugin contains no telemetry; account
  credentials are managed by ZCode's credential store and never pass through
  the chat.

## Provenance and license

- Plugin: MIT, by [VAST](https://www.tripo3d.ai).
- Both skills are ported from Tripo's official Kimi / Codex plugins (also
  maintained by VAST, MIT).
- The MCP server and `tripo-cli` are official Tripo implementations;
  generated content is subject to the
  [Tripo API content policy](https://platform.tripo3d.ai/docs).
