---
name: tripo-3d
description: Generate a 3D model from a text prompt, a reference image, or an existing mesh, and deliver it as GLB, FBX, OBJ, STL, USDZ or 3MF. Use when the user asks for a 3D asset, model, mesh, prop, character or texture for a game, renderer, viewer, AR scene or 3D print — including requests like "make me a low-poly X", "turn this image into 3D", "rig this character", "convert this model to FBX", or "generate placeholder assets". 中文触发词：生成3D模型、建模、3D素材、把图片变成3D、图生3D、文生3D、骨骼绑定、绑骨、角色动画、贴图、纹理、低模、低多边形、减面、3D打印、手办、格式转换（FBX/GLB/OBJ/STL/USDZ/3MF）。Also use to re-run, convert or inspect a previous Tripo generation.
---

# Tripo 3D

Generate engine-ready 3D assets with Tripo. Two execution paths exist; pick one
before doing anything else, and never pretend to run what this environment
cannot run.

## Pick the execution path

1. **MCP path** — the tool list contains Tripo tools (`tripo_text_to_3d`,
   `tripo_task_wait`, ...; ZCode prefixes them with the MCP server id, e.g.
   `mcp__…__tripo_text_to_3d` — the rest of this skill uses the bare names).
   This is the default path.
2. **Tripo tools missing** — the plugin's MCP server is almost always waiting
   for authorization or switched off, not absent. Stop and tell the user first:
   open **设置 → MCP**, find the Tripo server under 「Plugin MCP 服务器」,
   click **打开授权** if the row says 「需要授权」 (or enable it), then start a
   new session. See Authorization below. **Do not switch to `tripo-cli`
   instead** — not for a balance check, not because a local `tripo login`
   or `TRIPO_API_KEY` happens to exist (that may be a different account, and
   the user installed this plugin to use MCP). Offer the CLI only as an
   explicit alternative in the same message, and take it only if the user
   picks it.
3. **CLI path** — the user explicitly asked for the CLI, or the Tripo MCP
   tools are present but the job needs what only a shell gives: bulk
   generation (`tripo batch`) or artifacts written straight into the project
   tree without a download step. Drive `tripo-cli` as described in the second
   half of this skill.
4. **Neither** — stop here and say so; do not describe generations as if
   they had run.

Local *files* do not require the CLI — MCP's `tripo_upload_ticket` covers both
images and mesh files (see Inputs below).

---

# MCP path

## Authorization

Tool calls fail with an authorization error until the user connects a Tripo
account. ZCode runs the OAuth flow but never opens a browser on its own — the
user has to click once. Your job is to guide them through the pages; never ask
for an API key in the chat.

**This plugin build talks to the China-mainland MCP**
(`https://developers.tripo3d.com/mcp`). The authorization page does **not**
offer a region picker — it always opens the **国内站** console
(developers.tripo3d.com, +86 SMS sign-in, Alipay top-up). An overseas-site
account (developers.tripo3d.ai) will not work here: tell the user to install
the overseas Tripo 3D plugin build, or use the CLI path with
`login --region ov`.

1. **设置 → MCP** → group 「Plugin MCP 服务器」 → the Tripo row shows
   「需要授权」 → click **打开授权**. The system browser opens the Tripo
   authorization page.
2. The page shows a one-time verification code and opens the Tripo console:
   sign in (or sign up — new accounts get free credits), type the code into
   the **"Verification code"** field, click **Authorize**. Nothing is ever
   copied or pasted into the chat.
3. ZCode reconnects and loads the tools automatically. If the tools still do
   not show up, start a new session.

Generations spend credits from the account the user connected. The connection
is bound to the API key the user picked on the Tripo console during
authorization (an account with no key gets `cli-default` created automatically;
with exactly one key it is used as is). To revoke access, delete that key on
the console's API Keys page — any other client sharing it (e.g. `tripo-cli`)
loses access too.

## Workflow

1. **Plan** — for any billed generation or chain, call `tripo_plan` first,
   show the draft to the user, and wait for explicit confirmation. Skip only
   for pure reads (`tripo_balance`, `tripo_usage`, `tripo_task_status` /
   `tripo_task_list`).
2. **Create** — `tripo_text_to_3d` for prompts (Chinese or English, concrete
   nouns + style + materials), `tripo_image_to_3d` for images. Both return a
   `task_id` immediately.
3. **Wait** — call `tripo_task_wait` with the `task_id`; each call returns
   within about 55 s, so call it again while status is still `queued`/`running`
   (a generation takes 1–4 minutes). Do not invent your own sleep loop and do
   not treat the `task_id` as completion.
4. **Judge** — on `success`, look at `preview_image_url` and show it to the
   user before building on the result. On `failed`/`banned`, report
   `failure_reason` honestly; failed-task credits are refunded automatically.
   Do not silently re-roll a disappointing result — show the preview and ask;
   re-rolling means creating a new task with the same prompt.
5. **Post-process** (each step is a new billed task: create → `tripo_task_wait`;
   `input` takes a model task_id, a `file_token` or a public model URL unless
   noted):
   - `tripo_texture` — texture or re-texture a model.
   - `tripo_rig_check` → `tripo_rig` — check riggability before spending rig
     credits, then add a skeleton with the `rig_type` the check returned.
     Prompt characters as **T-pose** at generation time; `spec: "mixamo"` for
     Unity Humanoid / Mixamo pipelines. Leave `model` unset: `tripo_rig` picks
     the humanoid v1.0 rig for `biped` and the creature v2.5 rig for the other
     body types, and its result says which preset family the rig takes.
   - `tripo_animate` — presets on a **successful rig task** (≤5 per call,
     billed per animation). Preset names follow the rig model reported by
     `tripo_rig`: humanoid (v1.0) rigs take `preset:biped:walk`,
     `preset:biped:idle`, …; creature (v2.5) rigs take `preset:walk`,
     `preset:idle`, …; `animate_in_place: true` when game code drives movement.
   - `tripo_convert` — export GLTF/USDZ/FBX/OBJ/STL/3MF, optional retopology
     via `face_limit`/`quad`. Quads cannot export GLTF. Any non-default option
     bills as "complex convert".
   - `tripo_decimate` — high-poly → low-poly (`face_limit` 500–20000, bakes the
     original textures); `tripo_segment` → `tripo_mesh_complete` — split into
     parts and close the cuts; `tripo_mesh_edit` — redo one region of an
     existing mesh with P2 Preview (`bbox` required). Stylize (lego / voxel /
     voronoi / minecraft) is **CLI-only** (`--then stylize`) — there is no
     `tripo_stylize` MCP tool.
6. **Deliver** — result URLs (`model_url`, `preview_image_url`) **expire in
   about 5 minutes**; never cache or re-print an old one — call
   `tripo_task_status` for fresh links. Download the file into the project
   (`curl -L -o <path> "<url>"`) and give the local path as plain text in
   backticks — never as a clickable link, the chat preview cannot render
   meshes. Only when no shell is available give the fresh link and say it is
   short-lived, offering to refresh it on request.

## Scenario → tool chain

Pick the chain from what the user is building; every arrow is a billed task
followed by `tripo_task_wait`. GLB is the native output — a `tripo_convert`
step is only worth its credits when the target really needs another format.

- **Game prop, mobile / WebGL / many instances** — generate with
  `face_limit` ≤ 20000 (auto-selects the low-poly `P1` model) →
  `tripo_convert` `format: "FBX"` (`texture_size: 2048`) for Unity/Unreal;
  Three.js/Godot take the GLB as is.
- **Game hero asset, PC / console** — default `v3.1`, `pbr: true`,
  `texture_quality: "detailed"` → FBX only if the engine needs it.
- **Film / render / close-ups** — `v3.1` with `geometry_quality: "detailed"`
  and `texture_quality: "detailed"` (both cost extra credits).
- **3D print / figurine** — `texture: false, pbr: false` → `tripo_convert`
  `format: "STL"` (`flatten_bottom: true` for a stable base); `3MF` also works.
- **AR / iOS Quick Look** — `auto_size: true` (real-world meters) →
  `tripo_convert` `format: "USDZ"`; WebXR uses the GLB directly.
- **Animated character** — T-pose reference first (`tripo_generate_image`
  with `template: "t_pose"` turns a character image into one) →
  `tripo_image_to_3d`/`tripo_text_to_3d` → `tripo_rig_check` → `tripo_rig`
  (`spec: "mixamo"` for Unity Humanoid) → `tripo_animate` with the preset
  family named in the `tripo_rig` result: humanoids
  `["preset:biped:walk", "preset:biped:idle"]`, creatures (quadruped and the
  other body types) `["preset:walk", "preset:idle"]`.
- **LOD chain** — generate once → one `tripo_decimate` per level
  (`face_limit` is a target, not a hard ceiling — say so when the project has
  a strict budget).
- **Better views of one image** — `tripo_image_to_multiview` →
  `tripo_multiview_to_3d` with `multiview_task_id`; when the user already has
  2–4 orthographic views, `tripo_multiview_to_3d` takes them directly.
- **User's existing mesh** — a public URL goes straight into any processing
  tool's `input`; a local file goes through `tripo_upload_ticket`
  (`kind: "model"`, `format: "glb"`) → `tripo_import_model`, which yields a
  reusable task_id with a preview (`.gltf` is rejected — export `.glb`).
- **Not a mesh** — `tripo_image_to_splat` outputs a Gaussian-splat `.ply`
  scene for viewers, not an editable model; say so before running it.

## Parameters that matter

- **Generation model version is chosen automatically**: `v3.1` high fidelity
  by default, `P1` when the prompt smells low-poly or `face_limit ≤ 20000`.
  Only pass `model` to the generation tools when the user explicitly asks
  (`P2` / `P2-20260801` Preview for quads or a bigger low-poly budget). The
  rig model is likewise chosen from `rig_type` by `tripo_rig` (see above).
- 3D printing / untextured output: `texture: false, pbr: false` skips texture
  credits entirely; convert to `STL` (add `flatten_bottom: true` for stability).
- `quad: true` (v3.1 or P2) needs a `tripo_convert` to FBX/OBJ/USDZ at the end;
  P1 rejects `quad`.

## Inputs

- Image inputs, three routes: a **publicly reachable URL** goes straight into
  `tripo_image_to_3d` (Tripo's servers fetch it — auth-protected, region-locked
  or slow-origin links break). A signed/short-lived or uncertain URL goes
  through `tripo_upload_image` first: the server re-hosts it and returns a
  `file_token`, failing fast instead of wasting a task. A **local image file**
  (a file in the project, or one the user attached to the chat whose path is
  known — ask for the path if only the picture is visible) goes through
  `tripo_upload_ticket`: run the `how_to` curl it returns in the shell
  (`curl -sS -X POST --data-binary @<file> -H "Content-Type: application/octet-stream" "<upload_url>"`)
  and read `file_token` from the JSON response — no CLI login involved.
- Model files (GLB/FBX/OBJ/STL, ≤150 MB) use the same ticket with
  `kind: "model"` and `format`; the `file_token` then feeds
  `tripo_import_model` or any processing tool directly.
- Task ids chain: a successful generation task is a valid `input` for every
  processing tool, so never re-upload what Tripo already has.

## Other tools

- `tripo_plan` — free draft of the intended tool chain before any billed call.
- `tripo_task_status` — fresh links for any task; `steps: true` adds the
  per-stage breakdown when a chain misbehaves.
- `tripo_task_list` — status of up to 100 task ids in one call (batches).
- `tripo_usage` — recent per-task credit spend (includes per-task breakdown).
- `tripo_mesh_edit` — P2 Preview regional regenerate (`bbox` + optional
  `ref_image`).

## Spending the user's credits

- `tripo_balance` first when the user asks for several assets; confirm before
  generating more than one in a batch, and report `credits_consumed` after.
- Insufficient balance errors: give the `plans_url` from `tripo_balance`
  (informational pricing page for this deployment's region) instead of retrying.

---

# CLI path

Everything below runs through the shell. One command turns a prompt or an
image into local files: a model, a `preview.png` render, and a `task.json`
record.

## Before the first generation

```bash
npx tripo-cli@latest doctor     # verifies key, network, region, balance
```

Auth resolves from `TRIPO_API_KEY` (a `tsk_...` key) or a previous `tripo login`.
If `doctor` reports no key, start the device login yourself — do not ask for
permission first, and never ask the user to paste a key into the chat.

Tripo has two regions with separate accounts and consoles:

| region                | console                        | sign-in / top-up               |
| --------------------- | ------------------------------ | ------------------------------ |
| `cn` — China mainland | https://developers.tripo3d.com | +86 SMS sign-in, Alipay top-up |
| `ov` — International  | https://developers.tripo3d.ai  | email sign-in, Stripe top-up   |

Pick the region yourself only when the context already says which site the
user's account is on — they mentioned it, `tripo whoami` shows a profile, or
`TRIPO_REGION` is set. Otherwise ask one question before starting the login:
"你的 Tripo 账号在国内站还是海外站？" An account lives in exactly one region,
and starting the device flow on the wrong console sends the user to a site
where their account does not exist. No account yet? China-mainland users
should pick `cn` (Alipay top-up), everyone else `ov` — signing up during the
login flow is fine and new accounts get free credits.

```bash
npx tripo-cli@latest login --region cn --yes    # or: --region ov
```

`--yes` forces the non-interactive device flow. The command prints a
verification URL and a one-time code right away, then blocks until the user
approves in a browser — up to 15 minutes. Do not kill it early, and do not
wait for it to exit before talking to the user: read the URL and code from
its output while it is still running (run it in the background or stream its
stderr). **Show the user the full verification URL and the code verbatim**,
plus the matching console address (`cn`: https://developers.tripo3d.com,
`ov`: https://developers.tripo3d.ai), and walk them through every step —
assume they have never seen this page:

1. Open the verification URL in a browser.
2. If the page asks to sign in, they are not logged in on the web either:
   sign in — or sign up at the console address above; new accounts get
   free credits — then return to the verification page.
3. Type the one-time code into the **"Verification code"** field.
4. An account that already has several API keys is asked to pick one — any
   of them works, the CLI will use the chosen key. With no keys, one is
   created automatically and there is nothing to choose.
5. Click the **Authorize** button. The key arrives in the CLI and is stored —
   nothing to copy by hand.

When the command exits 0, re-run `doctor` and continue. Exit code 3 means the
code expired or was denied — run the same login command again for a fresh
code. If an older CLI rejects headless login with a usage error, fall back to
asking the user to run `npx tripo-cli@latest login` in their own terminal.

Installing globally (`npm install -g tripo-cli`) makes repeated calls faster and
is what makes the bare `tripo` command exist — ask before doing it. Without a
global install, run every `tripo ...` command in this and related skills as
`npx tripo-cli@latest ...`; npx downloads the CLI on first use, so a fresh machine
needs no manual install. If `npx` itself is missing, Node.js is not installed —
have the user install Node.js LTS first. On China-mainland networks, when the
npx download stalls, switch to the npmmirror registry and retry:
`npm config set registry https://registry.npmmirror.com`.

Exit code 3 means auth failed; run `tripo doctor`, which diagnoses key-vs-region
mismatches (`ov` = international, `cn` = China mainland) and prints the exact fix.

## The command

```bash
tripo make "a stylized treasure chest" --for game-mobile --json --yes
tripo make concept.png --for game-pc --json --yes
tripo make front.png back.png --json --yes           # 2-4 images -> multiview
tripo make hero.glb --then texture,rig --json --yes  # import an existing mesh
tripo make @last --then convert:fbx --json --yes     # continue from the last task
```

Input type is auto-detected: quoted text, an image path or URL, 2-4 images, a model
file, or a task reference (`@last`, `@name`, a task id).

A local image file is uploaded by the CLI itself — always reliable. An image
URL is passed straight to the API and **fetched by Tripo's servers**, so when
the user gives a URL, tell them explicitly: it must be publicly reachable and
served through a CDN or globally accelerated host, or the server-side fetch
can fail or time out (auth-protected, region-locked and slow-origin links all
break). When in doubt, download the image locally first and pass the file
path instead.

- `--for <scenario>` picks model, parameters, chain and export format:
  `game-mobile` `game-pc` `film` `print` `ar-web` `anim` `toy`.
  The base generation already outputs GLB; some preset chains append a **paid**
  convert step (`game-mobile`/`game-pc` → FBX, `print` → STL, `ar-web` → USDZ).
  When the user only wants GLB, that convert buys a format nobody asked for —
  use a chain-free preset instead (`toy` for low-poly, with `-p face_limit=...`)
  or tell the user the extra format costs credits before running.
- `--then <steps>` overrides the chain. Steps: `texture` `stylize` `convert`
  `import` `rig-check` `rig` `retarget` `segment` `complete` `decimate` `smartsegment`.
  Arguments use `step:key=value`; a bare value maps to the step's primary argument
  (`convert:fbx`, `stylize:lego`, `decimate:5000`).
- `-o, --out <dir>` sets the **parent** directory, not the artifact directory. `make`
  always creates `<dir>/tripo-out/<name>-<id8>/` underneath it, so `-o ./assets` writes
  `./assets/tripo-out/<name>-<id8>/model.glb`. Pass `-o` to keep artifacts inside the
  project instead of the shell's working directory, but when the user asked for a file
  at a specific path, **move it there after the run and report the final path** — `-o`
  alone cannot put it there. (`tripo task get <id> --download -o <dir>` is the
  exception: its `-o` is the final directory.)
- `-p key=value` passes an API parameter, repeatable. Useful ones: `face_limit=15000`,
  `texture=false pbr=false` (bare geometry, skips texture credits), `auto_size=true`,
  `texture_quality=detailed`, `negative_prompt=...`. `--model` forces the generation
  model (`tripo-v3.1` / `tripo-p1` / `tripo-p2` → wire `v3.1-20260211` /
  `P1-20260311` / `P2-20260801`). `--dry-run` plans and validates with zero network
  calls (no credits, no key) and prints the chosen wire-value `model`,
  `steps[].payload`, `warnings` and `errors`; only run for real when `valid` is true.
  After a chained run, report `credits_consumed` (total) and `credits_breakdown`
  (per task); if the field is missing, `tripo task get <id> --json` each chain entry.

## Rules that matter

1. **`tripo make` is blocking.** It submits, polls, downloads, then exits. Wait for
   the process to finish. Do not re-implement polling, do not set a timeout shorter
   than the CLI's own (default 1800s), and do not treat a `task_id` appearing in the
   logs as completion.
2. **stdout is the contract.** With `--json`, stdout carries exactly one final JSON
   line; progress goes to stderr. Parse the last stdout line, not the logs.
3. **Branch on exit codes**, don't parse error text:
   `0` ok · `1` fatal, and what `doctor` returns when a critical check fails ·
   `2` bad parameters · `3` auth · `4` insufficient credits · `5` content
   policy · `6` task failed (credits auto-refunded, `tripo redo` often succeeds) ·
   `7` network · `8` not found — a task id only resolves under the key that created
   it, so when an older task 404s, fall back to passing the local model file ·
   `9` rate limit (retry with backoff).
4. **Judge the result before moving on.** The result JSON gives `model_file` and
   `preview`. Read `preview.png` to check the asset actually matches the request; if
   it does not, `tripo redo` re-rolls with a new seed.
5. **Never invent parameters.** Run `tripo docs --topic commands/make` for the full
   flag list, or `tripo docs --topic common-errors` for the error table.
6. **Let the CLI choose the model version.** It selects `tripo-v3.1` (high fidelity)
   or `tripo-p1` (low-poly, face budget 50-20000) automatically. Only pass `--model`
   when the user explicitly asks for one (`tripo-p2` Preview for quads).

Download URLs returned by the API expire in about five minutes — never cache one.
Re-run `tripo task get <id> --download` instead.


---

# Capability reference

Model versions, generation/processing parameters, 2D steps, list prices, CLI
result shape and other commands: read [`references/capability.md`](references/capability.md)
(same parameter names on MCP and CLI). Stylize is **CLI-only** (`--then stylize`);
MCP instead has `tripo_plan` (confirm before spend) and `tripo_mesh_edit` (P2 regional redo).
