---
name: hyper3d-3d
description: Use when the user asks to create, generate, or model a 3D asset (game prop, character, figurine, GLB / FBX / OBJ / STL / USDZ file) from a text description or reference images, to make a low-poly (game-ready) version of a model or a low-poly model directly from images or text, to retexture an existing 3D model, or to rig a model and add preset animations, with the ZCode-official Hyper3D service billed to the Coding Plan. Calls submit_hyper3d_task, get_hyper3d_task, and list_hyper3d_animations of the hyper3d-3d plugin and saves the products into the workspace. Not the third-party hyper3d-rodin plugin, which needs the user's own Hyper3D account.
---

# Hyper3D 3D modeling (ZCode official)

Use the tools of the `hyper3d_3d` MCP server: `submit_hyper3d_task`, `get_hyper3d_task`, and `list_hyper3d_animations`.

This plugin is the ZCode-official Hyper3D integration. It uses the signed-in ZCode identity and is billed to the user's Coding Plan, so no Hyper3D account or API key is needed. It is different from the `hyper3d-rodin` plugin, which signs in to the user's own Hyper3D account; use that one only when the user explicitly wants their own Hyper3D account.

## Actions

| `action` | What it does | Input | Result `task_id` |
| --- | --- | --- | --- |
| `generate` | Text and/or image to 3D | `prompt` (up to 1024 characters) and/or `images` (1–5; the first decides the material). Optional `image_labels` (one per image: `F` `FL` `FR` `B` `BL` `BR` `L` `R` `U` `D` `?`), `mesh_mode` (`Raw` / `Quad`), `quality` (`high` / `medium` / `low` / `extra-low`), `material` (`PBR` / `Shaded` / `All` / `Hybrid` / `None`), `format` (`glb` / `usdz` / `fbx` / `obj` / `stl`, default `glb`), `ta_pose`. | `gen:` |
| `polygen` | Smart Low Poly: a low-poly model built directly (not just decimated), for game assets | At least one source: `task_id` (a `generate` task id, starts with `gen:`; that task must have succeeded), `model_url` (https; `.obj` `.glb` `.stl` `.fbx` `.usd` `.usda` `.usdz` `.usdc`, up to 100 MB), `images` (1–5), or `prompt` (up to 1024 characters). `task_id` and `model_url` are mutually exclusive; `images` and `prompt` may accompany `task_id`, and `images` may accompany `model_url` as mesh-refinement references. Optional `face_count` (200–10000; omitted: 4000 for `model_url`, automatic otherwise), `mesh_mode` (`Quad` default / `Raw` / `NGon`), `format` (`obj` default / `glb` / `usdz` / `fbx` / `stl`), `image_labels` (same values as `generate`; may be shorter than `images`, never longer). Texture: with `task_id` / `images` / `prompt`, `material` (`PBR` / `Shaded` / `All` / `Hybrid` / `None`, default `None` = geometry only) and `uhd_texture` (only sharpens newly generated textures; it does not change the resolution); with `model_url`, only `transfer_texture` (default `true` keeps the original texture, `false` = geometry only) — `prompt`, `material`, and `uhd_texture` are refused there. | `poly:` |
| `texture` | Retexture an existing model | `model_url` (https; `.obj` `.stl` `.gltf` `.glb` `.fbx` `.usdz`) and `image` (one reference image). Optional `prompt`, `material` (`PBR` / `Shaded` / `All` / `Hybrid`), `format`. | — |
| `rig` | Add a skeleton and preset animations | Exactly one of `task_id` (a `generate` task id, starts with `gen:`) or `model_url` (https; `.obj` `.glb` `.stl` `.fbx` `.usd` `.usda` `.usdz` `.usdc`). Optional `bone_template` (`auto` / `human` / `quadruped` / `bird` / `dragon` / `kaiju`), `animations` (up to 10 unique ids from `list_hyper3d_animations`), `in_place`, `format` (`glb` / `fbx` / `usdz`). | — |

Choose `quality: "low"` for real-time or mobile use (about 60k faces, same price); the default is about 500k faces with 2K PBR textures (about 26 MB). For a real low-poly game asset (a few hundred to 10000 faces), use `polygen`. `mesh_mode: "NGon"` is accepted only by `polygen`; `generate` takes `Raw` or `Quad`.

## Text-only requests: text → image → 3D

Users often ask for "text to 3D". 3D vendors get the best results from a two-step pipeline: text → image → 3D.

- When the user only has a text description, recommend first creating a reference image with the Seedream plugin (`image-generation`, tool `generate_image`): one object, plain background, the whole object in view (for example a three-quarter front view), no text or extra props. Then call `submit_hyper3d_task` with `action: "generate"` and `images: ["<saved image path>"]` (you may keep a short `prompt` alongside the image).
- Before you call Seedream, tell the user that it adds an image-generation step that is billed separately, on top of the 3D task. Call Seedream only if the user agrees.
- If the user declines the extra step, or asked to generate from text only, do not call Seedream: call `submit_hyper3d_task` with `action: "generate"` and the text as `prompt` directly.
- Direct text generation (`action: "generate"` with only `prompt`) is also the path when Seedream is not installed.
- The same applies to low-poly models: pass the Seedream image to `polygen` as `images`, or call `polygen` with only `prompt` (the service then creates a reference image internally before building the low-poly model).
- The plugins do not call each other: the Agent chains the two calls, so Seedream must be installed and enabled. The Seedream image is billed separately.
- If the Seedream call fails, report the failure. Do not hand-draw or fabricate a reference image (SVG, HTML, canvas, etc.) instead.

## Recommended chains

- **Character with animation:** `generate` (for humanoids set `ta_pose: true`) → `rig` with the returned `task_id` → pick ids from `list_hyper3d_animations` (filter with `category` such as `human`, or `search`) and pass them in `animations`.
- **Low-poly game asset:** `generate` → `polygen` with the returned `task_id` (optionally `face_count`). The default `material: "None"` gives geometry only; set `material` (for example `PBR`) to get a texture, regenerated from the source task's images or prompt (new `images` / `prompt` replace them).
- **Low-poly straight from a picture or a description:** `polygen` with `images` (optionally `image_labels`) or with only `prompt`. Again geometry only unless you set `material`.
- **Low-poly version of your own model:** `polygen` with a public https `model_url`. The original texture is transferred by default; pass `transfer_texture: false` for geometry only.
- **New look for an existing model:** `texture` with a public https `model_url` and a reference `image`.
- Only `generate` task ids (`gen:`) can be chained by `task_id`. Low-poly (`poly:`), textured (`tex:`), or rigged (`rig:`) products **cannot** be rigged or re-polygened by `task_id`. Download the product, make it reachable at a public https URL, and pass it as `model_url`.
- Before you chain a task, the previous task must have succeeded. Pass every `task_id` exactly as returned (it is 600+ characters); never shorten, parse, or rebuild it.

## Inputs and outputs

- Images (`images`, `image`) may be workspace paths, `https://` URLs, or `data:image/...;base64` URLs; png / jpeg / webp up to 10 MiB. Local files and `data:` URLs are uploaded automatically.
- Local 3D model files cannot be uploaded. For your own model, pass a public `https://` `model_url` (up to 100 MB); to rig or low-poly a generated model, chain it by `task_id`.
- Pass `output_dir` only when the user names a folder inside the workspace. Otherwise products go to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-<slug>/` (`get_hyper3d_task` uses the task kind such as `gen`, `poly`, or `tex`; the slug comes from the `prompt`, otherwise `model`). Up to 20 files are downloaded per task. Existing files are never overwritten; a name clash gets `-1`, `-2`.
- `polygen` results are often OBJ files. Every product file (the `.obj`, its `.mtl`, and texture images) is saved under its own name in the same folder, so the OBJ keeps finding its material and textures. Prefer a new or empty `output_dir`: a renamed file (`-1`) would break those references. Safe product names are kept as they are; if the result lists renamed files, tell the user that references inside OBJ / MTL files may need to be fixed by hand.
- Tier, texture mode, and texture resolution are fixed by the service, also for `polygen`; `uhd_texture` only makes newly generated textures sharper and does not change the resolution.
- `invocation_id` is only present when the submitting call itself finishes with products. It is missing when `submit_hyper3d_task` returns still running, and it is `null` in completed `get_hyper3d_task` results.
- Product links expire after 7 days. Any file that failed to download is listed with its link.
- Invalid arguments are rejected locally before any request is sent. Nothing is charged, and the error names the field and its allowed values.

## Waiting and resubmitting

- A task usually takes 1–2 minutes. One call waits up to about four minutes, then downloads the products.
- When a call returns a still-running status with a `task_id`, tell the user the task is in progress and call `get_hyper3d_task` with that `task_id` (and the same `output_dir`). Do **not** call `submit_hyper3d_task` again: every submitted task that succeeds is billed.
- When a call reports that the submission was not confirmed and gives a `request_id`, call `submit_hyper3d_task` again later with the same arguments plus that `request_id`. The first request body is replayed unchanged, so a changed `action`, `prompt`, `task_id`, or `model_url` does not take effect, and the tool says so.
- If the same `request_id` comes back unconfirmed 3 times in a row, stop replaying it. Tell the user that the task may or may not have been created and let them decide whether to wait longer or submit again without `request_id` (which may be billed twice).
- If a replay is rejected outright (the tool says no task was created for that `request_id`), do not replay it again. Adjust the input if needed and submit again without `request_id`; when the reason is that the previous task is not finished yet, wait for it with `get_hyper3d_task` first.
- A replay can also come back unconfirmed together with a rejection (the tool says the service had already accepted the submission). That counts as unconfirmed: keep the `request_id` and apply the 3-times rule above.
- `succeeded_pending_products` means the task already succeeded and is billed, but the service has not returned the product links yet. Call `get_hyper3d_task` once more; if it reports the same again, stop and give the user the `task_id`.
- Stop waiting after about 15 minutes of `get_hyper3d_task` calls on the same task in total. Tell the user the task is still not finished, give them the `task_id`, and let them decide whether to check again later. Never resubmit it.

## Billing

A task is charged only when it succeeds (0.5 credit per `generate`, `polygen`, `texture`, or `rig`). Failed tasks, rejected submissions, and local validation errors are free, and `list_hyper3d_animations` is free.

## Reporting results

Reply with the saved file paths as links, mention any product that was not downloaded together with its link, and give the `task_id` when the user might continue (for example rigging a generated model or making a low-poly version of it).

## Failures

When a tool returns an error, stop and report it to the user, including any `code` and `logid`. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan subscription in this scope;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a rejected submission (content review, unsupported input, previous task not finished, upstream limit) created no task and was not charged; it may be retried with changed input.

Never substitute a hand-made model, an SVG, a procedurally generated mesh, an HTML/Three.js scene, or another plugin's output for a failed task.
