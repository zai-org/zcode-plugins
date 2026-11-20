---
name: tripo-game-asset
description: Recipes for producing game-ready 3D assets with Tripo and wiring them into a game project - low-poly props on a face budget, detailed hero assets, LOD chains, and rigged characters with locomotion clips for Unity, Unreal, Godot or Three.js. Use when the user is building a game or real-time 3D scene and needs props, characters, placeholder art, LODs, or an animated rig, rather than a single one-off model. Also covers walk/run/jump clips and importing models into Unity, Unreal or Godot, whatever language the request is in. 中文触发词：游戏资产、游戏素材、游戏模型、低模道具、面数预算、LOD、角色绑骨、走跑跳动画、Unity/Unreal/Godot 模型导入。
---

# Game asset pipeline

Recipes on top of the `tripo-3d` skill. Read that skill first — it covers
authorization, the `tripo_task_wait` loop (call again while
`queued`/`running`), credit rules and the full parameter reference. Every
recipe runs through the Tripo MCP tools only. Wait for every asynchronous task
before its dependent step; billing and inputs vary: `tripo_rig_check` is free,
and rig uses the original model task rather than the check task. Each
`tripo_text_to_3d`, `tripo_image_to_3d`, `tripo_multiview_to_3d` and
`tripo_texture` call sends `pbr: false` unless the user explicitly asks for PBR.

For a subject described in words, follow the `tripo-3d` concept-image workflow:
plan and confirm the billed `tripo_generate_image` step, wait for it, show the
image, and stop for the user's acceptance. Only after acceptance, plan and
confirm `tripo_image_to_3d` and any requested post-processing, then use the
accepted image task ID as `input`. Call `tripo_text_to_3d` only when the user
explicitly asks to skip the image. A user-supplied image or multiview set goes
directly to `tripo_image_to_3d` or `tripo_multiview_to_3d` respectively.

Download the final file into the project only when the user asks to save it or
integrate it there. Result links are short-lived; call `tripo_task_status` for
a fresh link before use. Report the saved path when a file is downloaded.

## Pick a budget first

An explicitly requested model takes priority over these recipes. If it cannot
support a requested feature, explain the conflict and ask before changing the
model or dropping the feature. When no model was specified, select a model that
supports the required features first: v3.1 supports `generate_parts`,
`smart_low_poly` and `geometry_quality: "detailed"`. Otherwise, explicitly choose
P2 for game/realtime topology; within the P series the default is P2, and P1 is
used only when the user names it or picks it for lower cost and speed; v3.1 for
film/render/print. Confirm the selected model, texture options and estimated or
unestimated cost before the billed model step; re-confirm any paid model change.
The example calls below use defaults only and start after image acceptance.

| target                        | generation call                                              | export                                       |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| mobile, WebGL, many instances | explicit `model: "P2"`, `face_limit: 15000`  | `tripo_convert` `format: "FBX"`, `texture_size: 2048` |
| PC / console hero asset       | explicit `model: "P2"`, `texture_quality: "detailed"`  | FBX only if the engine needs it; GLB is native |
| animated character            | T-pose model → `tripo_rig_check` → `tripo_rig` → `tripo_animate` | `out_format: "fbx"` for Unity/Unreal        |

Two budget-related choices the defaults do not make for you:

- **Quads at low poly** — P1 does not support `quad`. If the user requested both,
  ask which to change before submitting; otherwise use `model: "P2", quad: true`
  (face_limit 48–25000 quads, price depends on texture options;
  confirm the estimate, output is FBX) or v3.1 with
  `smart_low_poly: true, quad: true` (face_limit 500–10000).
- **v3.1 quality under a face cap** — explicitly set `model: "v3.1"` when the
  user wants v3.1 geometry with a budget.

Override the face budget when the project has a stricter one. For example, after
accepting a concept image of a health potion bottle and confirming this 3D chain:
`tripo_image_to_3d` `{ input: <accepted image task>, model: "P2", face_limit: 3000, pbr: false }` →
`tripo_convert` `{ format: "FBX", texture_size: 1024 }`.

## Props

For an ornate fantasy treasure chest, first create and show a concept image as
above. After the user accepts it and confirms the 3D chain, use
`tripo_image_to_3d` `{ input: <accepted image task>, model: "P2", texture_quality: "detailed", pbr: false }`
→ deliver the GLB (or → `tripo_convert` `{ format: "FBX" }` for Unity/Unreal).

For a set of props, plan and confirm the estimated or unestimated cost of the
image batch first (`tripo_plan`, `tripo_balance`), then show the images and wait
for acceptance. After acceptance, plan and confirm the 3D and post-processing
steps before running them. Generate assets one at a time and check each result
before continuing. Use `tripo_task_list` to check many task IDs in one call.

## LOD chain from one source

Generate once, then one `tripo_decimate` per level — each with the **original
generation task** as `input`, not the previous LOD:

After the user accepts a stone golem concept image and confirms the 3D chain:

`tripo_image_to_3d` `{ input: <accepted image task>, model: "P2", pbr: false }` (LOD0)
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

1. **Character source.** For a humanoid described in words, include a T-pose in
   the concept-image request (for example, `"a knight in full armor, T-pose, standing
   straight"`) and use `template: "t_pose"` when the connected image tool supports
   it. Confirm the image cost, show the image, and wait for acceptance as above.
   A supplied character image or multiview set can be used directly. If the user
   asks to make a T-pose image first, confirm and run `tripo_generate_image`
   `{ input: <image>, template: "t_pose" }`, then show it and wait for acceptance.
2. After any required image acceptance, plan and confirm the model and
   requested post-processing. Use `tripo_image_to_3d`
   `{ input: <accepted image task or supplied image>, model: "P2", pbr: false }`
   or `tripo_multiview_to_3d` for supplied multiviews. Use
   `tripo_text_to_3d` only for an explicit request to skip the image. Pass
   `pbr: false` unless the user requested PBR. The result is the character model task.
3. `tripo_rig_check` `{ input: <model task> }` — free. It gates the chain: not
   riggable → stop before spending rigging credits. Read the recommended
   `rig_type` (`biped` `quadruped` `hexapod` `octopod` `avian` `serpentine` `aquatic` `others`).
4. `tripo_rig` on the **original model task** using the returned body type:
   - Biped: `{ input: <model task>, model: "v3.0", rig_type: "biped", spec: "mixamo", out_format: "fbx" }`.
     `spec: "mixamo"` gives Mixamo bone names; use `"unity"` for Unity Humanoid
     or `"unreal"` for the UE Mannequin.
   - Animal: `{ input: <model task>, model: "v2.5", rig_type: <animal type>, out_format: "fbx" }`
     for `quadruped`, `hexapod`, `octopod`, `avian`, `serpentine` or `aquatic`.
   - Other: `{ input: <model task>, model: "v3.0", rig_type: "others", out_format: "fbx" }`.

   `spec` applies only to `biped`. The API's own default, v1.0, rigs bipeds
   only. The result names the preset family to use next.
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

When the user asks to integrate the asset into the project, download the final
`model_url` into the project's art directory and use that path for the import.
Do the integration work the user asked for — add the loader call, register the
prefab, or update the asset manifest. Check the preview first so a wrong asset
does not get wired in.

Retopology: `tripo_decimate` with explicit `model: "v3.0", smart_uv: true`
combines retopology and UVs; check current pricing. Standalone
`tripo_smart_uv` is a separate billed UV-layout task for inputs up to 80,000
equivalent triangles; confirm the choice and cost. See the capability reference.
