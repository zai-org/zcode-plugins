# Capability reference

Mirrors the official API docs so the agent never has to send the user there.
Pass these parameters as MCP tool arguments. The tools auto-fix the linkage
rules below (pbr→texture, model-specific strips, quad→FBX) and report what they
changed in `notes`.

## Models

| model | MCP `model` | use for | limits |
| --- | --- | --- | --- |
| **v3.1** (default) | `v3.1` | high fidelity: film, render, print | full parameter set |
| **P1** | `P1` | P series alternative, only when the user names it or picks it for lower cost and speed | `face_limit` 50–20000; no `quad`, `smart_low_poly`, `generate_parts`, `geometry_quality`; adds `export_uv` |
| **P2** | `P2` → wire `P2-20260801` | default P-series model, preferred for game/realtime topology, with explicit user confirmation | `face_limit` 48–50000 tri / 48–25000 quad; supports `quad`, still no `smart_low_poly`, `generate_parts`, `geometry_quality`; costs more credits than H/P1, and price depends on input and texture options; confirm the estimate. Pass the generation model explicitly |
| v3.0, v2.5 | `v3.0`, `v2.5` | legacy, only when the user asks | v2.5 has no `geometry_quality` |

Website model names map to these rows: H3.1 → `v3.1`, P1.0 → `P1`, P2.0 → `P2`.

Selection policy: explicitly choose P2 for game/realtime topology; within the
P series the default is P2, and P1 is used only when the user names it or picks
it for lower cost and speed; v3.1 for film/render/print.
This is plugin guidance, not an API requirement. Do not rely on implicit routing
or infer a generation model from face_limit. Confirm the model, texture options
and estimated cost before a billed call; re-confirm any paid model change.
Short names resolve to dated wire values (P2-20260801, v3.1-20260211).
`tripo-turbo` and `tripo-v2.0` appear in older docs but the server rejects them.

## Generation parameters

Apply to `tripo_text_to_3d` / `tripo_image_to_3d` / `tripo_multiview_to_3d`.

| param | default | notes |
| --- | --- | --- |
| `prompt`, `negative_prompt` | – | text input only; ≤1024 / ≤255 chars |
| `face_limit` | adaptive | upper bound on triangles. v3.1 any; P1 50–20000; P2 48–50000 |
| `texture`, `pbr` | `true`, see notes | **send `pbr: false` unless the user explicitly asks for PBR** (the API itself defaults it to true); `pbr: true` forces `texture: true`. `texture: false, pbr: false` = bare geometry, no texture credits |
| `texture_quality` | `standard` | `standard` / `detailed` (HD, +10 credits) / `extreme` (8K, +20). API also has `fast` (v3.5 textures only; same price/size as `standard`): it needs `texture_version: "v3.5"` (`v3.5-20260815`), which the tool picks when `texture_version` is omitted; other texture versions are incompatible |
| `texture_version` | derived from `model` | pins the texture model independently of geometry: `v3.5` (`v3.5-20260815`, newest), `v3.0` (`v3.0-20250812`, default for v3.x and P-series), `v2.5` (`v2.5-20250123`, default for v2.5). Pass the short name. All generation models incl. P1/P2 |
| `delight` | `true` | v3.5 textures only (`texture_version: "v3.5"`): remove baked-in lighting from the reference image; `false` keeps original shading. Older texture versions ignore it |
| `geometry_quality` | `standard` | `detailed` = Ultra geometry, finer detail up to 2M faces (+20). v3.x only |
| `quad` | `false` | quad mesh (+5); **delivered as FBX** — quads cannot be stored in GLB. v3.x and P2 |
| `smart_low_poly` | `false` | hand-modelled-style low-poly topology (+10); requires `face_limit` 500–20000 tri / 500–10000 quad. v3.x only |
| `generate_parts` | `false` | editable segmented parts (+20). Requires `texture: false, pbr: false` (the tool flips them and notes it — re-texture afterwards with `tripo_texture`); `quad` is ignored; `smart_low_poly` wins and suppresses parts. v3.x only |
| `auto_size` | `false` | scale the model to real-world metres (AR, engines) |
| `compress` | – | `geometry` = meshopt-compressed output. v3.x only |
| `model_seed`, `texture_seed`, `image_seed` | random | reproducibility: same seed → same geometry / textures / text-to-image stage. Keep `model_seed`, vary `texture_seed` to re-texture the same shape |
| `enable_image_autofix` | `false` | image input: repair a low-quality / blurry / cropped photo first (slower) |
| `texture_alignment` | `original_image` | image/multiview: `original_image` matches the picture, `geometry` matches the mesh |
| `orientation` | `default` | image/multiview: `align_image` faces the model like the input viewpoint |
| `export_uv` | `true` | P series only: `false` skips UV unwrap (faster, smaller file; UVs are created when texturing) |
| `export_orientation` | `+x` | forward axis `+x` `-x` `+y` `-y`. **Only for output that is not processed further**: downstream steps (texture, rig, convert…) read the default orientation and return a wrongly oriented `success` with no error. When a chain follows, leave it unset and pass `export_orientation` to the final `tripo_convert` instead |

Multiview (2–4 images): `front` is mandatory and at least two views are needed;
`left`/`back`/`right` are optional. Pass them as named arguments (or
`multiview_task_id` for a finished `tripo_image_to_multiview` /
`tripo_edit_multiview` sheet).


## Retopology and UV workflows

`tripo_decimate` defaults to v2.0. Explicit `model: "v3.0"` supports
`smart_uv: true` in the same task: 35 credits triangle / 40 quad, versus
30 for v2.0; smart_uv adds no extra charge. Confirm this model/cost change
before submitting. With any other model, `smart_uv: true` is rejected and no
task is created. v2.0/v3.0 targets: 500–20000 triangles or 500–10000 quads.
The face budget is a target, not a ceiling. The combined task has no UV preview.

Standalone `tripo_smart_uv` is separately billed: re-unwrap UVs and remap existing
textures, rigging and animation. Input must be at most 80,000 equivalent triangles
(one quad counts as two); decimate larger meshes first. `bake` defaults true;
false keeps geometry + UVs only. Optional `export_orientation` and `compress`
follow the exposed schema. Its `output_urls.uv_render_url` is a UV-layout preview,
not the model download; show it when requested. Do not substitute this separate
paid task for integrated smart_uv without confirming the extra cost.

## Processing steps

Every tool takes a model task_id, a `file_token` or a model URL as `input`,
except: `tripo_animate` (`task_id` of a successful rig task),
`tripo_mesh_complete` (`task_id` of a successful segment task) and
`tripo_smart_segment` (file_token or URL only, never a task_id).

| MCP tool | arguments and constraints |
| --- | --- |
| `tripo_texture` | `texture_quality` `standard`/`detailed`/`extreme`/`fast` (fast requires v3.5); `pbr` (send `false` unless the user explicitly asks for PBR); `texture_seed`; `texture_alignment`; `model` `v3.0` (`v3.0-20250812`, default) / `v3.5` (`v3.5-20260815`, newest; unlocks `delight` and `texture_quality: "fast"`) / `v2.5`; `bake`; `part_names` (segmented models); `compress`. Guidance — exactly one of `prompt` (+ optional `style_image`), `image`, or `images` (4 views front/left/back/right). Re-textures any model, including imported files |
| `tripo_mesh_edit` | P2 regional regenerate: `input` (task_id / file_token / URL) + axis-aligned `bbox` in model space; optional `ref_image`. Rest of mesh kept. Billed separately |
| `tripo_plan` | Free draft of the tool chain **before** any billed call; show the user and wait for confirmation. Skip only for pure reads (balance / usage / task status) |
| `tripo_convert` | `format` `GLTF` `USDZ` `FBX` `OBJ` `STL` `3MF` (3MF = single-colour print). Mesh: `quad`, `force_symmetry` (quad only), `face_limit` (default: keep), `flatten_bottom` + `flatten_bottom_threshold` (0.01). Texture: `texture_size` (4096), `texture_format` `JPEG`/`PNG`/`WEBP`/`BMP`/`TIFF`/`TARGA`/`HDR`/`DPX`/`OPEN_EXR`, `bake` (true), `pack_uv`, `export_vertex_colors` (OBJ/GLTF only). Export: `pivot_to_center_bottom`, `scale_factor`, `auto_size`, `with_animation` (true), `animate_in_place`, `part_names`, `export_orientation`, `fbx_preset` `blender`/`3dsmax`/`mixamo` (FBX only). `quad` with `GLTF` is rejected. Any non-default option bills the complex tier (10 credits instead of 5) |
| `tripo_import_model` | GLB/GLTF/FBX/OBJ/STL ≤150 MB via `file_token` or URL (`.gltf` only as a URL — upload `.glb`) |
| `tripo_rig_check` | free. GLB input. Result: `riggable` and recommended `rig_type`: `biped` `quadruped` `hexapod` `octopod` `avian` `serpentine` `aquatic`. Gate step — not riggable → stop; riggable → rig the **original model task**, not the check task |
| `tripo_rig` | `model`: `v3.0-20260909` (`v3.0`) for biped/default, `others` and `actorcore`/`unity`/`unreal`/`vrm` specs; `v2.5-20260210` (`v2.5`) for the six creature body types. Both take `preset:walk` / `preset:idle` on bipeds and body-type clips on creatures. Explicit `v1.0-20240301` (`v1.0`) is legacy biped-only for 90+ `preset:biped:*` clips. Read the returned model before animation. `rig_type` comes from rig-check; rig the original model, not the check task. `spec` is biped-only; `out_format` is `glb`/`fbx`. |
| `tripo_animate` | needs a rig task. `animations: [...]` (≤5, billed per clip). `out_format` `glb`/`fbx`, `animate_in_place` (no root motion — game code drives movement), `export_with_geometry` (true); `bake_animation` is deprecated — do not pass it (it is ignored) |
| `tripo_segment` | `model` `v1.0-20250506` (geometry-based, default) or `v2.0-20260430` (semantic, beta) with `segmentation_granularity` `simple`/`balanced`/`detailed`, `split_by_connectivity` (true), `ref_image` (overrides the other two). The tool switches to v2.0 automatically when a v2-only argument is set |
| `tripo_mesh_complete` | needs a segment task. `completion_mode` `ai_completion` (default) / `quick_cap` (hole fill, cheaper); `part_names` (default all) |
| `tripo_decimate` | `face_limit` target 500–20000 tri / 500–10000 with `quad: true` (docs quote 1000–20000); `bake` (true) bakes textures onto the low-poly; `part_names`. `model: "v1.0"` accepts up to 2 000 000 tri / 150 000 quad but requires `face_limit` and has no `bake`/`part_names`. The budget is a target, not a ceiling |
| `tripo_smart_segment` | file_token/URL only. `seg_type` `model` (existing **GLB only**, 55 credits; default) or `image` (photo → auto-model → parts, 85); `granularity` `coarse`/`medium`/`fine`; `hint` describing the parts to find. Output: part labels, a PNG mask, the segmented GLB and the inner task ids. Unlike `tripo_segment`, it is an end-to-end pipeline |

Animation presets depend on the rig model of the upstream rig task — read it
from the `tripo_rig` result (biped defaults to v3.0). v3.0 and v2.5 biped rigs: `preset:idle` `preset:walk` `preset:run` `preset:dive`
`preset:climb` `preset:jump` `preset:slash` `preset:shoot` `preset:hurt`
`preset:fall` `preset:turn`; creature rigs take only their body type's clip: `preset:quadruped:walk` `preset:hexapod:walk`
`preset:octopod:walk` `preset:serpentine:march` `preset:aquatic:march` (avian and others have none). v1.0 rig
(biped only, 90+ clips as `preset:biped:<name>`): `idle` `walk` `run` `jump`
`sit` `swim`, `dance_01`…`dance_06`, `greet_01`…`greet_04`, `wave_goodbye_01`,
`clap` `bow` `cry` `laugh_01`, `angry_01`…, `box_01`…`box_03`, `front_kick_01`,
`cast_a_spell`, `basketball_shot`, `golf`, `make_a_call_01`, …

## 2D steps before 3D

`tripo_generate_image` (text→image when no `input`; edit/fusion with `input`
or `inputs`), `tripo_image_to_multiview`, `tripo_edit_multiview`,
`tripo_image_to_splat`. An image task_id is a valid `input` for
`tripo_image_to_3d` — no re-upload.

- **Templates** (`template`): choose from the documented endpoint whitelist:
  - Text-to-image templates: `asset_extraction`, `character_completion`, `t_pose`, `variants`, `figure`.
  - Image-to-image templates: `t_pose`, `character_completion`, `3d_enhance`, `variants`, `figure`.
  - `head_extraction` and `print_clay` are not in the documented endpoint whitelists,
    and the `template` argument does not accept them; do not recommend them as
    supported templates.
  - Image editing requires `prompt` and/or `template`; text-to-image requires a
    prompt. Negative prompts go inside `prompt` after `--no`.
- **Image models** (`model`): `seedream_v4` (text-to-image default; **not accepted
  by image editing**), `seedream_v5` (editing default), Google Gemini as
  `banana` (= gemini-2.5-flash, fast), `banana_pro` (= gemini-3-pro, quality),
  `banana2` (= gemini-3.1-flash, latest fast) — pass these `banana*` names —
  and OpenAI `chat_image_2`,
  `chat_image_2.5_flare` (faster), `chat_image_2.5_sunburst` (edits keep
  untouched regions closer to the original). `chat_image_1` is retired (2026-10-23)
  and `chat_image_1.5` retires on 2026-12-01: pick `chat_image_2` or a 2.5 model.
  GPT-image options: `quality` `low`/`medium`/`high` (`chat_image_2`; 2.5 also
  `xhigh`/`max`; omitted = `low`); `background` `auto`/`opaque`/`transparent`
  (2.5 only; `transparent` needs `output_format: "png"`).
- **Several references** (`inputs`): seedream ≤4, gemini ≤10, chat_image ≤16;
  refer to them in the prompt as `image[1]`, `image[2]`.
### Image size by model

Each model accepts its own explicit `size` values:

| model | accepted explicit size |
| --- | --- |
| `banana` | Fixed pixel whitelist only: `1024x1024`, `832x1248`, `1248x832`, `864x1184`, `1184x864`, `896x1152`, `1152x896`, `768x1344`, `1344x768`, `1536x672` |
| `banana2` | Tiers only: `0.5K`, `1K`, `2K`, `4K`; no explicit pixels |
| `banana_pro` | `1K`, `2K`, `4K`, or positive-integer `WxH` |
| `seedream_v4` | `2K`, `4K`, or positive-integer `WxH` with width/height in [1/16, 16]; text-to-image only |
| `seedream_v5` | `2K`, `3K`, or positive-integer `WxH` with width/height in [1/16, 16] |
| `chat_image_1.5` | `1024x1024`, `1024x1536`, `1536x1024`, `auto`; observe the retirement date above |
| `chat_image_2` | `auto` or positive-integer `WxH`: each edge ≤3840 and divisible by 16; long edge ≤3 × short edge; total pixels 655360–8294400 inclusive |
| `chat_image_2.5_flare` | `auto` or positive-integer `WxH`: each edge ≤3840 and divisible by 16; long edge ≤3 × short edge; total pixels 655360–8294400 inclusive |
| `chat_image_2.5_sunburst` | `auto` or positive-integer `WxH`: each edge ≤3840 and divisible by 16; long edge ≤3 × short edge; total pixels 655360–8294400 inclusive |

Do not apply one size/default to every model. Official model-specific docs list
Seedream defaults as 2048x2048, banana_pro/banana2 as 2K, chat_image_1.5 as auto,
and chat_image_2/2.5 as 2048x2048. For banana, omission behavior is unverified:
the docs also print 2048x2048 as a default despite the fixed-size whitelist.
Prefer an explicit whitelisted size; do not pass that inconsistent default as an
explicit `size`.
Seedream exact pixel-count limits unverified: official ranges are rounded
(v4 approximately 3.69–16.78 MP; v5 approximately 3.69–10.40 MP). Do not invent
exact server pixel thresholds from those figures. Schema acceptance is not proof
of server acceptance; server validation still applies, including banana_pro
custom pixel sizes. Chat example: 1536x864 is valid, 1080x1920 is not divisible
by 16; use 1088x1920 instead. No 1K/2K/4K tiers for chat_image models.

`aspect_ratio` is honoured by the banana family only; Seedream/chat use size.
`watermark` control is Seedream-only; `output_format` is `png`/`jpeg`.

### Other image steps
- `tripo_image_to_multiview` → a 4-view sheet (front/left/back/right);
  `tripo_edit_multiview` takes that task plus 1–4 `{view, prompt}` edits; either
  task feeds `tripo_multiview_to_3d` (`multiview_task_id`).
- `tripo_image_to_splat` returns a Gaussian-splat file (30 credits, ~4 min): no
  texture, rig or convert downstream — use `tripo_image_to_3d` when a mesh is
  needed. Input PNG/JPEG/WebP ≤20 MB, ≥256×256 px, subject clear and centred.

## Prices

Historical examples only, not a current regional estimate. The effective region
and date of the retained numbers below have not been verified.
Numeric prices and add-ons anywhere in this file (including processing tables)
are historical illustrations, not a price quote or dry-run estimate. A current
estimate must name its source, region and date and match the exact model/options.
If current regional pricing cannot estimate the request, report **not_estimated**
(unestimated), not zero; disclose that uncertainty and obtain consent before
billing. Never infer a fixed P2/P1 ratio or fill a plan with these static numbers.
Afterwards use the usage ledger and task `credits_consumed` for actual spending;
`balance` and `credits_consumed` are decimals, not integers:

| operation (historical example only) | historical credits, not an estimate |
| --- | --- |
| text-to-3D, v3.1 | 10 bare / 20 textured |
| image- or multiview-to-3D, v3.1 | 20 bare / 30 textured |
| text-to-3D, P1 | 30 bare / 40 textured (P2: 100 / 110) |
| image- or multiview-to-3D, P1 | 40 bare / 50 textured (P2: 100 / 110) |
| add-ons per generation | `texture_quality: "detailed"` +10, `"extreme"` +20, `geometry_quality: "detailed"` +20, `quad` +5, `smart_low_poly` +10, `generate_parts` +20 |
| `tripo_texture` | 10 standard / 20 detailed / 30 extreme |
| `tripo_convert` | 5, or 10 with any non-default option |
| `tripo_decimate` | 35 tri / 40 quad (v3.0; smart_uv included), 30 (v2.0), 10 (v1.0) |
| `tripo_segment` / `tripo_mesh_complete` | 40 / 50 (`quick_cap` 30) |
| `tripo_smart_segment` | 85 image / 55 model |
| `tripo_rig_check` / `tripo_rig` / `tripo_animate` | free / 25 / 10 per clip |
| `tripo_generate_image` | 5 (seedream, banana 1K) – 20 (banana_pro 4K) by model and size tier |
| `tripo_image_to_multiview` / `tripo_edit_multiview` / `tripo_image_to_splat` | 10 / 5 per edited view / 30 |

Credits are frozen at submission and released on failure, ban or cancellation —
failed tasks are never charged. Task states: `queued` → `running` (with
`progress` 0–100) → `success` / `failed` / `banned` (content policy) /
`cancelled`; `expired` means the output files are gone and the task must be
re-run.

## Spending the user's credits

Every generation costs credits from the user's account, and `credits_consumed` is
reported on each result.

- Confirm the request before generating more than one asset in a batch.
- Call `tripo_balance` first when the user asks for several assets, and report
  the cost back after finishing.
- For 3D printing and other untextured output, pass `texture: false, pbr: false`
  — it skips texture credits entirely.
- Do not silently re-roll a disappointing result. Show the user the preview and ask.
