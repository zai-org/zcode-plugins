# Capability reference (both paths)

Mirrors the official API docs so the agent never has to send the user there.
Parameter names are identical on both paths: pass them as MCP tool arguments,
or as `-p key=value` (generation) / `step:key=value` (`--then`) on the CLI.
Both paths auto-fix the linkage rules below (pbr→texture, model-specific
strips, quad→FBX) and report what they changed (`notes` / warnings).

## Models

| model | MCP `model` / CLI `--model` | use for | limits |
| --- | --- | --- | --- |
| **v3.1** (default) | `v3.1` / `tripo-v3.1` | high fidelity: film, render, print | full parameter set |
| **P1** | `P1` / `tripo-p1` | optional low-poly for lower cost and speed | `face_limit` 50–20000; no `quad`, `smart_low_poly`, `generate_parts`, `geometry_quality`; adds `export_uv` |
| **P2** | `P2` / `tripo-p2` → wire `P2-20260801` | preferred for game/realtime topology, with explicit user confirmation | `face_limit` 48–50000 tri / 48–25000 quad; supports `quad`, still no `smart_low_poly`, `generate_parts`, `geometry_quality`; costs more credits than H/P1, and price depends on input and texture options; confirm the estimate. Pass the generation model explicitly |
| v3.0, v2.5 | `v3.0` / `tripo-v3.0`, `v2.5` / `tripo-v2.5` | legacy, only when the user asks | v2.5 has no `geometry_quality` |

Website model names map to these rows: H3.1 → `v3.1`, P1.0 → `P1`, P2.0 → `P2`.

Selection policy: explicitly choose P2 for game/realtime topology;
keep P1 available for lower cost and speed and v3.1 for film/render/print.
This is plugin guidance, not an API requirement. Do not rely on implicit routing
or infer a generation model from face_limit. Confirm the model, texture options
and estimated cost before a billed call; re-confirm any paid model change.
CLI generation aliases resolve to dated wire values (P2-20260801, v3.1-20260211).
`tripo-turbo` and `tripo-v2.0` appear in older docs but the server rejects them.

## Generation parameters

Apply to `tripo_text_to_3d` / `tripo_image_to_3d` / `tripo_multiview_to_3d`
and to `tripo make` / `tripo generate *-to-model`.

| param | default | notes |
| --- | --- | --- |
| `prompt`, `negative_prompt` | – | text input only; ≤1024 / ≤255 chars |
| `face_limit` | adaptive | upper bound on triangles. v3.1 any; P1 50–20000; P2 48–50000 |
| `texture`, `pbr` | `true`, `true` | `pbr=true` forces `texture=true`. `texture=false pbr=false` = bare geometry, no texture credits |
| `texture_quality` | `standard` | `standard` / `detailed` (HD, +10 credits) / `extreme` (8K, +20). API also has `fast` (v3.5 textures only; same price/size as `standard`); CLI 0.8.0 accepts it with `texture_version=v3.5-20260815`; other texture versions are incompatible |
| `texture_version` | derived from `model` | pins the texture model independently of geometry: `v3.5-20260815` (newest), `v3.0-20250812` (default for v3.x and P-series), `v2.5-20250123` (default for v2.5). All generation models incl. P1/P2 |
| `delight` | `true` | v3.5 textures only (`texture_version=v3.5-20260815`): remove baked-in lighting from the reference image; `false` keeps original shading. Older texture versions ignore it |
| `geometry_quality` | `standard` | `detailed` = Ultra geometry, finer detail up to 2M faces (+20). v3.x only |
| `quad` | `false` | quad mesh (+5); **delivered as FBX** — quads cannot be stored in GLB. v3.x and P2 |
| `smart_low_poly` | `false` | hand-modelled-style low-poly topology (+10); requires `face_limit` 500–20000 tri / 500–10000 quad. v3.x only |
| `generate_parts` | `false` | editable segmented parts (+20). Requires `texture=false pbr=false` (both paths flip them and warn — re-texture afterwards with `tripo_texture` / `--then texture`); `quad` is ignored; `smart_low_poly` wins and suppresses parts. v3.x only |
| `auto_size` | `false` | scale the model to real-world metres (AR, engines) |
| `compress` | – | `geometry` = meshopt-compressed output. v3.x only |
| `model_seed`, `texture_seed`, `image_seed` | random | reproducibility: same seed → same geometry / textures / text-to-image stage. Keep `model_seed`, vary `texture_seed` to re-texture the same shape. CLI `--seed` sets `model_seed` |
| `enable_image_autofix` | `false` | image input: repair a low-quality / blurry / cropped photo first (slower) |
| `texture_alignment` | `original_image` | image/multiview: `original_image` matches the picture, `geometry` matches the mesh |
| `orientation` | `default` | image/multiview: `align_image` faces the model like the input viewpoint |
| `export_uv` | `true` | P series only: `false` skips UV unwrap (faster, smaller file; UVs are created when texturing) |
| `export_orientation` | `+x` | forward axis `+x` `-x` `+y` `-y`. **Generation only**: downstream steps (texture, rig, convert…) read the default orientation and return a wrongly oriented `success` with no error. When a chain follows, leave it unset and pass `export_orientation` to the final convert step instead |

Multiview (2–4 images): `front` is mandatory and at least two views are needed;
`left`/`back`/`right` are optional. MCP takes them as named arguments (or
`multiview_task_id` for a finished `tripo_image_to_multiview` /
`tripo_edit_multiview` sheet); the CLI reads `front|back|left|right` from the
filenames, otherwise positional order front, left, back, right.


## Retopology and UV workflows

CLI equivalents: `--then decimate:model=v3.0,face_limit=5000,smart_uv=true`
or `tripo mesh decimate <input> --model v3.0 --face-limit 5000 --smart-uv`;
standalone `tripo mesh uv <input>` / `--then uv`. Run a dry-run and confirm cost first.

`tripo_decimate` defaults to v2.0. Explicit `model: "v3.0"` supports
`smart_uv: true` in the same task: 35 credits triangle / 40 quad, versus
30 for v2.0; smart_uv adds no extra charge. Confirm this model/cost change
before submitting. v2.0/v3.0 targets: 500–20000 triangles or 500–10000 quads.
The face budget is a target, not a ceiling. The combined task has no UV preview.

Standalone `tripo_smart_uv` is separately billed: re-unwrap UVs and remap existing
textures, rigging and animation. Input must be at most 80,000 equivalent triangles
(one quad counts as two); decimate larger meshes first. `bake` defaults true;
false keeps geometry + UVs only. Optional `export_orientation` and `compress`
follow the exposed schema. Its `output_urls.uv_render_url` is a UV-layout preview,
not the model download; show it when requested. Do not substitute this separate
paid task for integrated smart_uv without confirming the extra cost.

## Processing steps

Every step takes a model task_id, a `file_token` or a model URL as `input`,
except: `tripo_animate` / `retarget` (a successful rig task), `tripo_mesh_complete`
/ `complete` (a successful segment task) and `tripo_smart_segment` /
`smartsegment` (file_token or URL only, never a task_id). CLI `--then` maps a
bare value to the primary argument (`convert:fbx`, `decimate:5000`).

| MCP tool / CLI step | arguments and constraints |
| --- | --- |
| `tripo_texture` / `texture` | `texture_quality` `standard`/`detailed`/`extreme`/`fast` (fast requires v3.5); `pbr` (true); `texture_seed`; `texture_alignment`; `model` `v3.0` / `v3.0-20250812` (default) / `v3.5-20260815` (newest; unlocks `delight` and `texture_quality=fast` on MCP and CLI 0.8.0) / `v2.5`; `bake`; `part_names` (segmented models); `compress`. MCP also takes guidance — exactly one of `prompt` (+ optional `style_image`), `image`, or `images` (4 views front/left/back/right). Re-textures any model, including imported files |
| `tripo_mesh_edit` | P2 regional regenerate: `input` (task_id / file_token / URL) + axis-aligned `bbox` in model space; optional `ref_image`. Rest of mesh kept. Billed separately |
| `tripo_plan` | Free draft of the tool chain **before** any billed call; show the user and wait for confirmation. Skip only for pure reads (balance / usage / task status) |
| `tripo_convert` / `convert` | `format` `GLTF` `USDZ` `FBX` `OBJ` `STL` `3MF` (3MF = single-colour print). Mesh: `quad`, `force_symmetry` (quad only), `face_limit` (default: keep), `flatten_bottom` + `flatten_bottom_threshold` (0.01). Texture: `texture_size` (4096), `texture_format` `JPEG`/`PNG`/`WEBP`/`BMP`/`TIFF`/`TARGA`/`HDR`/`DPX`/`OPEN_EXR`, `bake` (true), `pack_uv`, `export_vertex_colors` (OBJ/GLTF only). Export: `pivot_to_center_bottom`, `scale_factor`, `auto_size`, `with_animation` (true), `animate_in_place`, `part_names`, `export_orientation`, `fbx_preset` `blender`/`3dsmax`/`mixamo` (FBX only). `quad` with `GLTF` is rejected. Any non-default option bills the complex tier (10 credits instead of 5) |
| `tripo_import_model` / `import` | GLB/GLTF/FBX/OBJ/STL ≤150 MB via `file_token` or URL (`.gltf` only as a URL — upload `.glb`). `tripo make <file>` runs it implicitly |
| `tripo_rig_check` / `rig-check` | free. GLB input. Result: `riggable` and recommended `rig_type`: `biped` `quadruped` `hexapod` `octopod` `avian` `serpentine` `aquatic`. Gate step — not riggable → stop; riggable → rig the **original model task**, not the check task |
| `tripo_rig` / `rig` | `model`: `v3.0-20260909` (`v3.0`) for biped/default, `others` and `actorcore`/`unity`/`unreal`/`vrm` specs; `v2.5-20260210` (`v2.5`) for the six creature body types. Both take `preset:walk` / `preset:idle` on bipeds and body-type clips on creatures. Explicit `v1.0-20240301` (`v1.0`) is legacy biped-only for 90+ `preset:biped:*` clips. Read the returned model before animation. `rig_type` comes from rig-check; rig the original model, not the check task. `spec` is biped-only; `out_format` is `glb`/`fbx`. CLI default is v3.0; use `rig:model=rig-v3.0`, `rig-v2.5` for creatures or explicit `rig-v1.0` for legacy biped clips. |
| `tripo_animate` / `retarget` | needs a rig task. MCP `animations: [...]` (≤5, billed per clip); CLI one clip per `--then retarget:preset:walk`, several via `tripo anim retarget --animation preset:idle preset:walk`. `out_format` `glb`/`fbx`, `animate_in_place` (no root motion — game code drives movement), `export_with_geometry` (true); `bake_animation` is deprecated — do not pass it (it is ignored) |
| `tripo_segment` / `segment` | `model` `v1.0-20250506` (geometry-based, default) or `v2.0-20260430` (semantic, beta) with `segmentation_granularity` `simple`/`balanced`/`detailed`, `split_by_connectivity` (true), `ref_image` (overrides the other two). MCP switches to v2.0 automatically when a v2-only argument is set |
| `tripo_mesh_complete` / `complete` | needs a segment task. `completion_mode` `ai_completion` (default) / `quick_cap` (hole fill, cheaper); `part_names` (default all) |
| `tripo_decimate` / `decimate` | `face_limit` target 500–20000 tri / 500–10000 with `quad=true` (docs quote 1000–20000); `bake` (true) bakes textures onto the low-poly; `part_names`. `model: "v1.0"` accepts up to 2 000 000 tri / 150 000 quad but requires `face_limit` and has no `bake`/`part_names`. The budget is a target, not a ceiling |
| `tripo_smart_segment` / `smartsegment` | file_token/URL only. `seg_type` `model` (existing **GLB only**, 55 credits; default) or `image` (photo → auto-model → parts, 85); `granularity` `coarse`/`medium`/`fine`; `hint` describing the parts to find. Output: part labels, a PNG mask, the segmented GLB and the inner task ids. Unlike `segment`, it is an end-to-end pipeline |

Animation presets depend on the rig model of the upstream rig task — on MCP
read it from the `tripo_rig` result (biped defaults to v3.0). v3.0 and v2.5 biped rigs: `preset:idle` `preset:walk` `preset:run` `preset:dive`
`preset:climb` `preset:jump` `preset:slash` `preset:shoot` `preset:hurt`
`preset:fall` `preset:turn`; creature rigs take only their body type's clip: `preset:quadruped:walk` `preset:hexapod:walk`
`preset:octopod:walk` `preset:serpentine:march` `preset:aquatic:march` (avian and others have none). v1.0 rig
(biped only, 90+ clips as `preset:biped:<name>`): `idle` `walk` `run` `jump`
`sit` `swim`, `dance_01`…`dance_06`, `greet_01`…`greet_04`, `wave_goodbye_01`,
`clap` `bow` `cry` `laugh_01`, `angry_01`…, `box_01`…`box_03`, `front_kick_01`,
`cast_a_spell`, `basketball_shot`, `golf`, `make_a_call_01`, …

## 2D steps before 3D

MCP: `tripo_generate_image` (text→image when no `input`; edit/fusion with `input`
or `inputs`), `tripo_image_to_multiview`, `tripo_edit_multiview`,
`tripo_image_to_splat`. CLI: `tripo generate text-to-image|image-to-image|
image-to-multiview|edit-multiview|image-to-splat`. An image task_id is a valid
`input` for `tripo_image_to_3d` — no re-upload.

- **Templates** (`template`): choose from the documented endpoint whitelist:
  - Text-to-image templates: `asset_extraction`, `character_completion`, `t_pose`, `variants`, `figure`.
  - Image-to-image templates: `t_pose`, `character_completion`, `3d_enhance`, `variants`, `figure`.
  - `head_extraction` and `print_clay` are not in the documented endpoint whitelists.
    CLI 0.8.0's image validator currently passes these template strings through
    without checking those whitelists; local acceptance is not server support.
    Do not recommend them as supported templates or claim a local rejection.
  - `-p t_pose=true` and `-p sketch_to_render=true` are raw parameters, not verified
    template shortcuts. The CLI does not normalize these booleans into `template`.
    Use `-p template=t_pose` for T-pose or a supported template/explicit prompt
    for editing. `image-to-image` still requires `prompt` and/or `template`;
    a boolean alone does not satisfy that command-level check. Text-to-image
    requires a prompt. Negative prompts go inside `prompt` after `--no`.
- **Image models** (`model`): `seedream_v4` (text-to-image default; **not accepted
  by image editing**), `seedream_v5` (editing default), Google Gemini as
  `banana` (= gemini-2.5-flash, fast), `banana_pro` (= gemini-3-pro, quality),
  `banana2` (= gemini-3.1-flash, latest fast) — MCP may take these `banana*`
  names; the CLI accepts only `banana`, `banana_pro`, `banana2`, not Gemini display names — and OpenAI `chat_image_2`,
  `chat_image_2.5_flare` (faster), `chat_image_2.5_sunburst` (edits keep
  untouched regions closer to the original). `chat_image_1` is retired (2026-10-23)
  and `chat_image_1.5` retires on 2026-12-01: pick `chat_image_2` or a 2.5 model.
  GPT-image options: `quality` `low`/`medium`/`high` (`chat_image_2`; 2.5 also
  `xhigh`/`max`; omitted = `low`); `background` `auto`/`opaque`/`transparent`
  (2.5 only; `transparent` needs `output_format=png`). Both paths accept `fast` only with texture model v3.5.
- **Several references** (`inputs`): seedream ≤4, gemini ≤10, chat_image ≤16;
  refer to them in the prompt as `[image 1]`, `[image 2]`.
### Image size by model

CLI 0.8.0 validates an explicitly supplied `size` per model:

| model | accepted explicit size / CLI constraints |
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

Do not apply one size/default to every model. Omitted `size` is not filled by
this CLI validator. Official model-specific docs list Seedream defaults as
2048x2048, banana_pro/banana2 as 2K, chat_image_1.5 as auto, and chat_image_2/2.5
as 2048x2048. For banana, omission behavior is unverified: the docs also print
2048x2048 as a default despite the fixed-size whitelist. Prefer an explicit
whitelisted size; do not turn that inconsistent default into a CLI argument.
Seedream exact pixel-count limits unverified: official ranges are rounded
(v4 approximately 3.69–16.78 MP; v5 approximately 3.69–10.40 MP). Do not invent
exact server pixel thresholds from those figures. CLI acceptance is not proof
of server acceptance; server validation still applies, including banana_pro
custom pixel sizes. Chat example: 1536x864 is valid, 1080x1920 is not divisible
by 16; use 1088x1920 instead. No 1K/2K/4K tiers for chat_image models.

`aspect_ratio` is honoured by the banana family only; Seedream/chat use size.
`watermark` control is Seedream-only; `output_format` is `png`/`jpeg`.

### Other image steps
- `image-to-multiview` → a 4-view sheet (front/left/back/right); `edit-multiview`
  takes that task plus 1–4 `{view, prompt}` edits; either task feeds
  `tripo_multiview_to_3d` (`multiview_task_id`).
- `image-to-splat` returns a Gaussian-splat file (30 credits, ~4 min): no
  texture, rig or convert downstream — use image-to-3D when a mesh is needed.
  Input PNG/JPEG/WebP ≤20 MB, ≥256×256 px, subject clear and centred.

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
| add-ons per generation | `texture_quality=detailed` +10, `extreme` +20, `geometry_quality=detailed` +20, `quad` +5, `smart_low_poly` +10, `generate_parts` +20 |
| texture step | 10 standard / 20 detailed / 30 extreme |
| convert | 5, or 10 with any non-default option |
| decimate | 35 tri / 40 quad (v3.0; smart_uv included), 30 (v2.0), 10 (v1.0) |
| segment / complete | 40 / 50 (`quick_cap` 30) |
| smartsegment | 85 image / 55 model |
| rig-check / rig / animate | free / 25 / 10 per clip |
| text-to-image, image editing | 5 (seedream, banana 1K) – 20 (banana_pro 4K) by model and size tier |
| image-to-multiview / edit-multiview / image-to-splat | 10 / 5 per edited view / 30 |

Credits are frozen at submission and released on failure, ban or cancellation —
failed tasks are never charged. Task states: `queued` → `running` (with
`progress` 0–100) → `success` / `failed` / `banned` (content policy) /
`cancelled`; `expired` means the output files are gone and the task must be
re-run.

## Spending the user's credits

Every generation costs credits from the user's account, and `credits_consumed` is
reported on each result.

- Confirm the request before generating more than one asset in a batch.
- Run `tripo balance` first when the user asks for several assets, and report the
  cost back after finishing.
- For 3D printing and other untextured output, add `-p texture=false -p pbr=false`
  — it skips texture credits entirely.
- Do not silently re-roll a disappointing result. Show the user the preview and ask.

## Result shape

```json
{
  "task_id": "...",
  "type": "convert_model",
  "status": "success",
  "credits_consumed": 25,
  "credits_breakdown": [
    { "task_id": "<generation>", "type": "text_to_model", "credits_consumed": 20 },
    { "task_id": "<convert>", "type": "convert_model", "credits_consumed": 5 }
  ],
  "output_dir": "tripo-out/knight-1a2b3c4d",
  "files": ["model.fbx", "preview.png", "task.json"],
  "model_file": ".../model.fbx",
  "preview": ".../preview.png",
  "chain": [{ "task_id": "...", "type": "texture_model" }]
}
```

`model_file` and `preview` describe the **final** chain step. After a convert
step the native GLB and `preview.png` live on the earlier generation task —
fetch them free with `tripo task get <chain task_id> --download` instead of
paying for another conversion.

## Presenting the finished asset

Every file is already on the user's disk when `tripo make` exits — never offer
a "download". Do not render the model file as a clickable link either: the chat
UI opens local-file links in a preview pane that cannot display binary meshes,
so the link just looks broken when clicked. Instead:

- show `preview.png` — images render fine;
- give the model's location as a plain path in backticks;
- offer the next real action: reveal it in the file manager (`open -R <path>`
  on macOS, `explorer /select,<path>` on Windows) or wire it into the project.

## Other commands

| command                          | purpose                              |
| -------------------------------- | ------------------------------------ |
| `tripo task get <id> --download` | fetch or re-download an earlier task |
| `tripo balance` / `tripo usage`  | credits remaining / recent spend     |
| `tripo redo [@last]`             | same request, new seed               |
| `tripo files upload <path>`      | get a `file_token` for an image      |
| `tripo batch run manifest.yaml`  | bulk jobs, resumable                 |
| `tripo docs --topic <topic>`     | full docs for any command or recipe  |

Download URLs returned by the API expire in about five minutes — never cache one.
Re-run `tripo task get <id> --download` instead.
