---
name: tripo-game-asset
description: Recipes for producing game-ready 3D assets with Tripo and wiring them into a game project - low-poly props on a face budget, detailed hero assets, LOD chains, and rigged characters with locomotion clips for Unity, Unreal, Godot or Three.js. Use when the user is building a game or real-time 3D scene and needs props, characters, placeholder art, LODs, or an animated rig, rather than a single one-off model. 中文触发词：游戏资产、游戏素材、游戏模型、低模道具、面数预算、LOD、角色绑骨、走跑跳动画、Unity/Unreal/Godot 模型导入。
---

# Game asset pipeline

Recipes on top of the `tripo-3d` skill. Read that skill first — it covers
authorization, the `tripo_task_wait` loop (call again while
`queued`/`running`), credit rules and the full parameter reference. Every
recipe runs through the Tripo MCP tools only. Every arrow below is a billed
task followed by `tripo_task_wait`; the `input` of each step is the previous
step's `task_id`. Every generation and `tripo_texture` call sends `pbr: false`
unless the user explicitly asks for PBR.

The point of these recipes is that assets land in the project's own directory
structure: after each final step download the file with
`curl -L -o <project-art-dir>/<name>.<ext> "<model_url>"` (links expire in about
5 minutes — fetch fresh ones with `tripo_task_status` if needed) and report the
local path.

## Pick a budget first

Explicitly choose P2 for game/realtime topology; within the P series the default
is P2, and P1 is used only when the user names it or picks it for lower cost and
speed; v3.1 for film/render/print. Confirm the selected
model, texture options and estimated cost; re-confirm any paid model change.

| target                        | generation call                                              | export                                       |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| mobile, WebGL, many instances | explicit `model: "P2"`, `face_limit: 15000`  | `tripo_convert` `format: "FBX"`, `texture_size: 2048` |
| PC / console hero asset       | explicit `model: "P2"`, `texture_quality: "detailed"`  | FBX only if the engine needs it; GLB is native |
| animated character            | T-pose model → `tripo_rig_check` → `tripo_rig` → `tripo_animate` | `out_format: "fbx"` for Unity/Unreal        |

Two budget-related choices the defaults do not make for you:

- **Quads at low poly** — P1 rejects `quad`; use `model: "P2", quad: true`
  (face_limit 48–25000 quads, price depends on input and texture options;
  confirm the estimate, output is FBX) or v3.1 with
  `smart_low_poly: true, quad: true` (face_limit 500–10000).
- **v3.1 quality under a face cap** — explicitly set `model: "v3.1"` when the
  user wants v3.1 geometry with a budget.

Override the face budget when the project has a stricter one, e.g.
`tripo_text_to_3d` `{ model: "P2", prompt: "a health potion bottle", face_limit: 3000, pbr: false }` →
`tripo_convert` `{ format: "FBX", texture_size: 1024 }`.

## Props

`tripo_text_to_3d` `{ model: "P2", prompt: "an ornate treasure chest, fantasy style", texture_quality: "detailed", pbr: false }`
→ download the GLB (or → `tripo_convert` `{ format: "FBX" }` for Unity/Unreal).

For a set of props, generate them one at a time and check each
`preview_image_url` before continuing — a bad seed early is cheaper to catch
than at the end of a batch. Confirm the total cost of the whole set with the
user first (`tripo_plan`, `tripo_balance`), then call the tools one asset at a
time, and use `tripo_task_list` to check the status of many task ids in one
call.

## LOD chain from one source

Generate once, then one `tripo_decimate` per level — each with the **original
generation task** as `input`, not the previous LOD:

`tripo_text_to_3d` `{ model: "P2", prompt: "a stone golem", pbr: false }` (LOD0)
→ `tripo_decimate` `{ input: <gen task>, face_limit: 5000 }` (LOD1)
→ `tripo_decimate` `{ input: <gen task>, face_limit: 1500 }` (LOD2)
→ `tripo_convert` `{ input: <each LOD task>, format: "FBX" }` if the engine needs FBX.

`tripo_decimate` bakes textures by default (`bake: true`), so the low LODs keep
the silhouette detail of the source.

**`tripo_decimate`'s face budget is a target, not a ceiling** — a 1500-face
request can come back at ~1900 triangles. Read the actual triangle count from
the result before handing an LOD to a project with a hard budget, and reduce it
locally if it overshoots. Generation's own `face_limit` does hold as an upper
bound, so this caveat is specific to decimation.

For a budget above 20000 faces use `tripo_decimate` `model: "v1.0"` with an
explicit `face_limit` (up to 2 000 000, no bake). `model: "v3.0"` is the newest
retopology and the only one that takes `smart_uv: true` (see the end of this
skill).

## Characters with animation

1. **T-pose source.** Prompt for it (`"a knight in full armor, T-pose, standing straight"`)
   or turn a character image into one with `tripo_generate_image`
   `{ input: <image>, template: "t_pose" }` — rigging quality depends heavily on it.
2. `tripo_text_to_3d` / `tripo_image_to_3d` with explicit `model: "P2"` → the
   character model task.
3. `tripo_rig_check` `{ input: <model task> }` — free. It gates the chain: not
   riggable → stop before spending rigging credits. Read the recommended
   `rig_type` (`biped` `quadruped` `hexapod` `octopod` `avian` `serpentine` `aquatic`).
4. `tripo_rig` `{ input: <model task>, rig_type: <from check>, spec: "mixamo", out_format: "fbx" }`
   — rig the **original model task**, not the check task. `spec: "mixamo"`
   produces a Unity Humanoid-compatible skeleton. Leave `model` unset: `biped`
   gets v3.0, the six creature body types get v2.5, and the
   result names the preset family to use next.
5. `tripo_animate` `{ task_id: <rig task>, animations: [...], out_format: "fbx", animate_in_place: true }`
   — at most five clips, billed per clip. Explicit legacy v1.0 rigs take
   `preset:biped:idle` `preset:biped:walk` `preset:biped:run` `preset:biped:jump`
   plus emotes, dances and sports clips (`preset:biped:dance_01`,
   `preset:biped:wave_goodbye_01`, …); v3.0 and v2.5 biped rigs take `preset:idle`
   `preset:walk` `preset:run` `preset:jump` `preset:fall` `preset:turn`
   `preset:climb` `preset:dive` `preset:slash` `preset:shoot` `preset:hurt`;
   creature rigs take only their body-type clip (`preset:quadruped:walk`, …;
   avian has none). `animate_in_place: true`
   for locomotion driven by game code rather than root motion.

To animate a mesh the project already has: `tripo_upload_ticket`
`{ kind: "model", format: "glb" }` → run the returned curl to upload the file →
`tripo_import_model` `{ input: <file_token> }` → continue from step 3.

## Format notes

- **Three.js / web**: GLB as generated; `auto_size: true` for real-world scale.
- **Unity / Unreal**: FBX via `tripo_convert` `{ format: "FBX" }`
  (`fbx_preset: "mixamo"` for a Unity-Humanoid-oriented export of rigged models).
- Quads (`quad: true`) force FBX — glTF cannot store them, so `tripo_convert`
  `format: "GLTF"` combined with quads is rejected.
- `texture_size` is set on the convert step, not at generation:
  `tripo_convert` `{ format: "FBX", texture_size: 2048 }`.

## Wiring into the project

After a successful chain, download the final `model_url` into the project's
art directory and use that path for the import. Do the integration work the
user actually asked for — add the loader call, register the prefab, update the
asset manifest — rather than stopping at "the file is generated". Check the
preview first so a wrong asset does not get wired in.

Retopology: `tripo_decimate` with explicit `model: "v3.0", smart_uv: true`
combines retopology and UVs (35 tri / 40 quad credits). Standalone
`tripo_smart_uv` is a separate billed UV-layout task for inputs up to 80,000
equivalent triangles; confirm the choice and cost. See the capability reference.
