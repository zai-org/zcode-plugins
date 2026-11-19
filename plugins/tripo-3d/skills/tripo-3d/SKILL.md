---
name: tripo-3d
description: Generate a 3D model from a text prompt, a reference image, or an existing mesh, and deliver it as GLB, FBX, OBJ, STL, USDZ or 3MF. Use when the user asks for a 3D asset, model, mesh, prop, character or texture for a game, renderer, viewer, AR scene or 3D print — including requests like "make me a low-poly X", "turn this image into 3D", "rig this character", "convert this model to FBX", or "generate placeholder assets", and the same requests in any language (text-to-3D, image-to-3D, rigging, character animation, texturing, low-poly or face reduction, 3D-printed figurines, format conversion). Also use to re-run, convert or inspect a previous Tripo generation, or to answer questions about Tripo model selection, supported parameters, and credits.
---

# Tripo 3D

Generate engine-ready 3D assets with the Tripo MCP tools.
Use a live estimate if available. A dated list-price estimate may be shown with
its source, region and date, but is not a live quote; disclose any unestimated
steps and obtain explicit consent before any billed task. A plan is advisory,
not a budget limit or an authorization ticket.

## Before you start

The tool list must contain the Tripo tools (`tripo_text_to_3d`,
`tripo_task_wait`, ...; ZCode prefixes them with the MCP server id, e.g.
`mcp__…__tripo_text_to_3d` — the rest of this skill uses the bare names). The
server id in the prefix tells the region: `tripo` is the China site,
`tripo-global` is the international site.

If they are missing, the plugin's MCP servers are almost always waiting for
authorization or switched off, not absent. Stop, ask which site the user's
Tripo account is on, and tell them: open **Settings → MCP Servers**, find that
region's server under "Plugin MCP servers", click **Open authorization** if the
row says "Authorization required" (if it says "Plugin disabled", enable the
Tripo 3D plugin first), then start a new session. See Authorization below.
Do not describe generations as if they had run.

MCP is the only execution path. Never install or run a command-line client
instead — not for a balance check, not because a local login or
`TRIPO_API_KEY` happens to exist (that may be a different account, and the
user installed this plugin to use MCP). Local files and bulk jobs stay on MCP
too: `tripo_upload_ticket` covers both images and mesh files (see Inputs
below). Use `curl` to save results into the project when the user requests a
local file or project integration (see Deliver).

## Authorization

Tool calls fail with an authorization error until the user connects a Tripo
account. ZCode runs the OAuth flow but never opens a browser on its own — the
user has to click once. Your job is to guide them through the pages; never ask
for an API key in the chat.

**The plugin ships one MCP server per Tripo region.** An account lives in
exactly one region, and neither authorization page offers a region picker:

| MCP server | Region | Console |
| --- | --- | --- |
| `tripo` (`https://developers.tripo3d.com/mcp`) | China site — mainland China | developers.tripo3d.com, +86 SMS sign-in, Alipay top-up |
| `tripo-global` (`https://openapi-mcp.tripo3d.ai/mcp`) | International site | developers.tripo3d.ai, email sign-in, Stripe top-up |

Ask once whether the user's account is on the China site or the international
site, unless they already said. The session context may carry a time-zone region
hint; use it only to phrase the question, never to choose for the user. No
account yet? Users in mainland China pick the China site, everyone else the
international site; they can sign up during authorization and new accounts get
free credits. Only the chosen server needs authorizing; the other row keeps
showing "Authorization required", which is expected. ZCode shows these labels
in its UI language.

1. **Settings → MCP Servers** → group "Plugin MCP servers" → the chosen
   server's row (`tripo` or `tripo-global`) shows "Authorization required" →
   click **Open authorization**. The system browser opens that region's
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
the console's API Keys page — any other client sharing that key loses access
too.

If tools from both servers are available and the user has not chosen an
account, ask before planning or uploading. Keep the whole task chain on the
chosen server. Task IDs, file tokens and balances belong to that region.
Never switch servers silently.

## Text prompts for new 3D assets

When the user describes a new asset in words and has not supplied reference
images, start with a concept image:

1. Plan and confirm only `tripo_generate_image`. Use the text prompt without
   `input` or `inputs`. State the image model, options and cost or
   `not_estimated`. For a humanoid to be rigged, describe the T-pose in this
   prompt. The 3D model and its costs stay out of this first plan.
2. After the user confirms the image cost, generate the image and wait for
   success. Get the generated image from the image task's `output_urls`
   and show it as a Markdown image (`![Concept image](<image-url>)`). If
   inline display is unavailable, offer one labeled link to the image and
   ask the user to open it before deciding. Use `tripo_task_status` on the same
   task to refresh an expired link. End the turn and wait for explicit
   acceptance of the image or a request to revise it. If the user cannot see
   the image, help them open it and keep the 3D step pending.
3. After the user accepts the image, plan `tripo_image_to_3d` with its successful
   image task ID as `input`, plus any requested post-processing. Show that
   plan's model, options and costs and wait for separate spending confirmation
   before starting it. A replacement concept needs a new image plan and
   confirmation.

Use `tripo_text_to_3d` for a new asset only if the user explicitly asks to
skip the concept image. If the image tool is unavailable, explain and ask
whether the user wants to supply an image or skip the concept step. If the user
supplied an image or a multiview set, plan `tripo_image_to_3d` or
`tripo_multiview_to_3d` directly using their input.

## Workflow

1. **Plan** — call `tripo_plan` for the billed steps being confirmed now.
   For the first phase of Text prompts, this is only `tripo_generate_image`.
   For `tripo_text_to_3d`, `tripo_image_to_3d` and `tripo_multiview_to_3d`
   steps only, supply a structured `generation` object; include the exact
   `prompt` for text-to-3D. Never attach `generation` to other tools, including
   `tripo_image_to_splat`. Free-text `params` alone leave the model unresolved.
   For these three generation tools, review the exact payload with `dry_run` only
   when the connected tool schema exposes it. For other steps review their actual
   schemas and current pricing without inventing a `dry_run` argument. Resolve
   conflicts with explicit requirements before billing; do not accept silently
   stripped requirements.
   Show each billed step, selected model, options and estimate or
   `not_estimated` to the user, and wait for explicit confirmation. Skip the
   plan only for pure reads (`tripo_balance`, `tripo_usage`, `tripo_task_status`
   / `tripo_task_list`). Re-plan and reconfirm changed paid steps.
2. **Create** — use the tool in the confirmed plan. New 3D assets from words
   follow Text prompts above, including its separate image and 3D confirmations.
   Creation tools return a `task_id` immediately. If creation times out without
   a `task_id`, do not automatically retry. Check the original account's
   balance and task history when available, then ask before another submission.
3. **Wait** — call `tripo_task_wait` with the `task_id`; each call returns
   within about 55 s, so call it again while status is still `queued`/`running`
   (a generation takes 1–4 minutes). Do not invent your own sleep loop and do
   not treat the `task_id` as completion.
4. **Judge** — on `success`, check the result before building on it. Inspect
   the rendered preview if available. For a concept image, show the single
   generated image by following Text prompts above. On `failed`/`banned`,
   report `failure_reason` honestly. Failed-task credits are refunded automatically.
   Do not silently re-roll a disappointing result — say what is off and ask;
   re-rolling means creating a new task with the same prompt.
5. **Post-process** (each asynchronous task requires `tripo_task_wait`; check
   billing for each step — `tripo_rig_check` is free. `input` takes a model
   task_id, a `file_token` or a public model URL unless noted):
   - `tripo_texture` — texture or re-texture a model. Provide guidance for an
     imported mesh; it may be omitted for a Tripo-generated model. Re-supply
     the original reference image when re-texturing a model made from one.
   - `tripo_rig_check` → `tripo_rig` — check riggability before spending rig
     credits, then add a skeleton with the `rig_type` the check returned.
     Prompt humanoids in a **T-pose** and use `spec` only for `biped`
     (e.g. `"unity"` for Unity Humanoid or `"mixamo"` for Mixamo pipelines).
     Pass `model` explicitly by body type: `"v3.0"` for `biped` and `others`,
     `"v2.5"` for `quadruped`, `hexapod`, `octopod`, `avian`, `serpentine`
     and `aquatic`.
     The API's own default is still `v1.0-20240301`, which rigs bipeds only.
     The `tripo_rig` result says which preset family the rig takes.
   - `tripo_animate` — presets on a **successful rig task** (≤5 per call,
     billed per animation). Preset names follow the rig model reported by
     `tripo_rig`: explicit legacy v1.0 rigs take `preset:biped:walk`,
     `preset:biped:idle`, …; v3.0 and v2.5 rigs take `preset:walk`,
     `preset:idle`, … on bipeds and only their body-type clip on creatures
     (`preset:quadruped:walk`, …; avian has none); `animate_in_place: true`
     when game code drives movement.
   - `tripo_convert` — export GLTF/USDZ/FBX/OBJ/STL/3MF, optional retopology
     via `face_limit`/`quad`. Quads cannot export GLTF. Any `face_limit`, or a
     non-default `quad`, `flatten_bottom`, `texture_size`, `texture_format`,
     `pivot_to_center_bottom` or `scale_factor`, bills as "complex convert".
   - `tripo_decimate` — high-poly → low-poly (`face_limit` 500–20000, bakes the
     original textures); `tripo_segment` → `tripo_mesh_complete` — split into
     parts and close the cuts. `tripo_mesh_edit` can redo one region of an
     existing mesh with P2 (`bbox` required). It is experimental; use it only
     when the connected server's actual tool list exposes it. Stylize (lego /
     voxel / voronoi / minecraft) has been retired — there is no `tripo_stylize` tool.
6. **Deliver** — result links are short-lived. If a link is stale or missing,
   refresh it with `tripo_task_status`. Offer the model
   as a single labeled download link. Only save a local file when the user
   asks for a file on disk or for project integration. With a shell available,
   download it to the requested or appropriate project path
   (`curl -fL -o "<path>" "<model_url>"`) and report the path in backticks. If
   saving was requested but the shell is unavailable or the download failed,
   report that and provide the fresh link. Do not paste raw URLs or the full
   `output_urls` list. After `tripo_convert`, fetch the native GLB through
   `tripo_task_status` on the original task whenever it is needed.
   Call `tripo_usage` with all workflow task IDs and report actual total and
   per-task charges; if the ledger is unavailable, say the amount is pending.

## Scenario → tool chain

Pick the chain from what the user is building; each asynchronous task must
finish before a dependent step runs. Check each tool's billing and input rules:
`tripo_rig_check` is free and rig uses the original model, not the check task.
The examples pick 3D options after any required concept-image approval. Use
the model compatible with the user's requirements before applying these
suggestions. GLB is the native output — a `tripo_convert` step is only worth
its credits when the target needs another format.

- **Game prop, mobile / WebGL / many instances** — generate with
  explicit `model: "P2"` and a confirmed `face_limit` →
  `tripo_convert` `format: "FBX"` (`texture_size: 2048`) for Unity/Unreal;
  Three.js/Godot take the GLB as is.
- **Game hero asset, PC / console** — explicit `model: "P2"`,
  `texture_quality: "detailed"` → FBX only if the engine needs it.
- **Film / render / close-ups** — `v3.1` with `geometry_quality: "detailed"`
  and `texture_quality: "detailed"` (both cost extra credits).
- **3D print / figurine** — `texture: false, pbr: false` → `tripo_convert`
  `format: "STL"` (`flatten_bottom: true` for a stable base); `3MF` also works.
- **AR / iOS Quick Look** — `auto_size: true` (real-world meters) →
  `tripo_convert` `format: "USDZ"`; WebXR uses the GLB directly.
- **Animated character** — use the accepted T-pose concept or supplied image
  for `tripo_image_to_3d`, then `tripo_rig_check` → `tripo_rig` (explicit model
  by body type; `spec: "unity"` only for a Unity Humanoid biped) →
  `tripo_animate` with the preset family named in the `tripo_rig` result: v3.0 humanoids
  `["preset:walk", "preset:idle"]`; creatures use their body-specific presets
  (e.g. `preset:quadruped:walk`); explicit v1.0 humanoids alone use
  `preset:biped:*`.
- **LOD chain** — generate once → one `tripo_decimate` per level, each using
  the original generation task as input, not the previous LOD (`face_limit` is
  a target, not a hard ceiling — say so when the project has a strict budget).
- **Better views of one image** — `tripo_image_to_multiview` →
  `tripo_multiview_to_3d` with `multiview_task_id`; when the user already has
  2–4 orthographic views, `tripo_multiview_to_3d` takes them directly.
- **User's existing mesh** — a public URL goes straight into any processing
  tool's `input`; a local file goes through `tripo_upload_ticket`
  (`kind: "model"`, `format: "glb"`) → `tripo_import_model`, which yields a
  reusable task_id with a preview (`.gltf` is rejected — export `.glb`).
- **Not a mesh** — `tripo_image_to_splat` outputs a Gaussian-splat `.splat`
  scene for viewers, not an editable model; say so before running it. If the
  result has no `model_url`, deliver the `.splat` result from `output_urls`.

## Parameters that matter

- **Choose the generation model explicitly**: the user's explicitly chosen model
  wins over usage-based defaults. If it conflicts with required features, explain
  the conflict and ask before changing model or dropping a requirement. If the
  user did not specify a model, first filter by required capabilities and then
  apply the scenario preference. For example, use `v3.1` for `generate_parts`,
  `smart_low_poly` or `geometry_quality: "detailed"` even for a game asset.
  Among compatible models, P2 is preferred for game/realtime topology (costs
  more credits than H/P1). For choices within the P series the default is P2,
  and P1 is used only when the user names it or picks it for lower cost and speed. Use v3.1 for film/render/print. This is
  plugin policy, not an API requirement. Confirm the model, texture options and
  cost; re-confirm any paid model change.
- **PBR is opt-in.** Send `pbr: false` on every `tripo_text_to_3d`,
  `tripo_image_to_3d`, `tripo_multiview_to_3d` and `tripo_texture` call unless
  the user explicitly asks for PBR materials (for example "with
  PBR" or "PBR materials", in any language); only then send `pbr: true`, which also forces
  `texture: true`. The API turns PBR on when `pbr` is left out, so never omit
  it. Detailed or high-quality textures do not mean PBR. PBR can still be added
  later: when the user asks for it after a model is already generated, do not
  regenerate. Call `tripo_texture` with that task as `input` and `pbr: true`: it
  bills only the texture step, not the generation again, and keeps the geometry,
  but the textures are regenerated, so pass the original reference image again if
  there was one. Confirm that cost like any other paid step.
- 3D printing / untextured output: `texture: false, pbr: false` skips texture
  credits entirely; convert to `STL` (add `flatten_bottom: true` for stability).
- `quad: true` (v3.1 or P2) is delivered as FBX directly, so FBX needs no
  `tripo_convert`; a convert with `quad: true` always outputs FBX (GLTF is
  rejected). P1 does not support `quad`; if the user requests both, stop and
  ask which requirement to change before creating a paid task.

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
  and read `file_token` from the JSON response.
- Model files (GLB/FBX/OBJ/STL, ≤150 MB) use the same ticket with
  `kind: "model"` and `format`; the `file_token` then feeds
  `tripo_import_model` or any processing tool directly. Tell the user if the
  import reports a `normalize_scale` other than 1, since it changed the model size.
- For larger local inputs, use `tripo_upload_presign` when the connected server
  exposes it and supports the file format. Follow its returned upload command
  and use the file token after the upload succeeds.
- Task ids chain: use a successful model task where the processing tool accepts
  it. Animation requires a successful rig task, mesh completion a segment task,
  and smart segmentation a file token or URL. Rig uses the original model task,
  not a rig-check task. A task id only resolves under the API key that created
  it; when an older task is not found, upload the local model file instead.

## Other tools

- `tripo_plan` — free draft of the intended tool chain before any billed call.
- `tripo_task_status` — fresh links for any task; `steps: true` adds the
  per-stage breakdown when a chain misbehaves.
- `tripo_task_list` — status of up to 100 task ids in one call (batches).
- `tripo_usage` — recent per-task credit spend (includes per-task breakdown).
- `tripo_mesh_edit` — experimental P2 regional regenerate (`bbox` + optional
  `ref_image`); use only if the connected server lists it.

## Spending the user's credits

- Use `tripo_balance` before spending on several assets. Confirm the steps and
  cost for each phase of the batch, and call the tools one asset at a time.
  For concept-first batches, present each image for acceptance before planning
  its 3D generation, then confirm the 3D costs before generating any models.
  Report the actual charges from `tripo_usage` after the work.
- Error `2000` means that category's concurrency pool is full and no task was
  created: retry after `Retry-After` or once a running task of the same
  category finishes. Error `1007` is the request rate limit: wait a few
  seconds and retry the same call. Never resubmit in a loop.
- Insufficient balance errors: give the `plans_url` from `tripo_balance`
  (informational pricing page for this deployment's region) instead of retrying.

---

# Capability reference

Model versions, generation/processing parameters, 2D steps and list prices:
read [`references/capability.md`](references/capability.md). `tripo_plan`
is advisory and requires confirmation before spend; `tripo_mesh_edit` redoes a
P2 region only when the connected server lists the experimental tool.

Retopology: `tripo_decimate` with explicit `model: "v3.0", smart_uv: true`
combines retopology and UVs; check current pricing. Standalone
`tripo_smart_uv` is a separate billed UV-layout task for inputs up to 80,000
equivalent triangles; confirm the choice and cost. See the capability reference.
