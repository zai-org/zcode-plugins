---
name: meshy-3d
description: Use when the user asks to create a 3D model, 3D asset, or game character from a text description or from one to four reference images, or to texture, retexture, remesh (reduce polygons), convert the format of (glb, fbx, obj, usdz, stl, 3mf, blend), rig, or animate a 3D model with Meshy. Official ZCode plugin billed to the Coding Plan; calls submit_meshy_task, get_meshy_task, and list_meshy_animations of the meshy-3d plugin and saves the models into the workspace.
---

# Meshy 3D modeling (ZCode official)

Use the tools of the `meshy_3d` MCP server: `submit_meshy_task`, `get_meshy_task`, and `list_meshy_animations`.

This plugin is the ZCode-official Meshy integration. It uses the signed-in ZCode identity and is billed to the user's Coding Plan, so no Meshy account or API key is needed.

## Actions

| `action` | What it does | Input | Result `task_id` |
| --- | --- | --- | --- |
| `generate` | Text, single-image, or multi-image to 3D | `prompt` (up to 800 characters, untextured white model) **or** `images` (1 image = image-to-3D, 2–4 = multi-view, first is the front; textured unless `geometry_only: true`). Optional `pose_mode` (`a-pose` / `t-pose`, helps later rigging) and `formats`. | `preview:` / `image:` / `multi:` |
| `refine` | Texture a text-generated white model | `task_id` starting with `preview:`; optional `texture_prompt` and/or `texture_image` (both may be left out) | `refine:` |
| `retexture` | Replace the texture | `task_id` **or** `model_url`, plus `texture_prompt` and/or `texture_image` (at least one) | `retexture:` |
| `remesh` | Reduce faces or retopologize | `task_id` **or** `model_url`; optional `topology` (`quad` / `triangle`), `target_polycount` (100–300000), `formats` | `remesh:` |
| `convert` | Convert the format | `task_id` **or** `model_url`; `formats` is required | `convert:` |
| `rig` | Standard humanoid rigging (free walking and running clips) | `task_id` **or** `model_url` (`.glb`); optional `height_meters`, `include_fingers`, `skeleton_template`. Humanoid models only. | `rig:` |
| `animate` | Apply preset animations, merged into one file | `task_id` starting with `rig:`, plus `action_ids` (1–10 unique ids from `list_meshy_animations`) | `anim:` |

`retexture`, `remesh`, `convert`, and `rig` accept `task_id` values of kind `preview`, `refine`, `image`, `multi`, `retexture`, or `remesh` — not `convert`, `rig`, or `anim`.

## Text-only requests: text → image → 3D

Users often ask for "text to 3D". 3D vendors get the best results from a two-step pipeline: text → image → 3D.

- When the user only has a text description, recommend first creating a reference image with the Seedream plugin (`image-generation`, tool `generate_image`): one object, plain background, the whole object in view (for example a three-quarter front view), no text or extra props. Then call `submit_meshy_task` with `action: "generate"` and `images: ["<saved image path>"]`.
- Before you call Seedream, tell the user that it adds an image-generation step that is billed separately, on top of the 3D task. Call Seedream only if the user agrees.
- If the user declines the extra step, or asked to generate from text only, do not call Seedream: call `submit_meshy_task` with `action: "generate"` and the text as `prompt` directly (then `refine`).
- Direct text generation (`action: "generate"` with only `prompt`, then `refine`) is also the path when Seedream is not installed.
- The plugins do not call each other: the Agent chains the two calls, so Seedream must be installed and enabled. The Seedream image is billed separately.
- If the Seedream call fails, report the failure. Do not hand-draw or fabricate a reference image (SVG, HTML, canvas, etc.) instead.

## Recommended chains

- **Text to animated character:** `generate` with `prompt` (add `pose_mode: "a-pose"`) → `refine` → `remesh` with `target_polycount` ≤ 300000 → `rig` with the **remesh** `task_id` → `animate`.
- **Image to animated character:** `generate` with `images` → `remesh` → `rig` → `animate`.
- **Always remesh before rigging.** Generated models have about 1.4 million triangles, above the 380k rigging limit; a direct `rig` on a `preview` / `refine` / `image` / `multi` / `retexture` task is rejected.
- Before you chain a task, the previous task must have succeeded. Pass every `task_id` exactly as returned; never shorten, parse, or rebuild it.

## Inputs and outputs

- Images (`images`, `texture_image`) may be workspace paths, `https://` URLs, or `data:image/...;base64` URLs; png / jpeg / webp up to 20 MiB. Local files and `data:` URLs are uploaded automatically.
- Local 3D model files cannot be uploaded. For your own model, pass a public `https://` `model_url`; for a model this plugin produced, chain it by `task_id`.
- `formats` chooses which formats are downloaded; for `generate`, `remesh`, and `convert` it is also sent as the output format list. Without `formats`, `glb` is downloaded (or the first available format). With `formats`, only those are downloaded; a requested format the task did not return is reported, with the available links, instead of a different format being downloaded.
- Pass `output_dir` only when the user names a folder inside the workspace. Otherwise products go to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-<slug>/` (`get_meshy_task` uses the task kind such as `preview`, `refine`, `remesh`, `rig`, `anim`; the slug comes from a text `generate` prompt, otherwise `model`). Existing files are never overwritten; a name clash gets `-1`, `-2`. Safe product names are kept as they are; if the result lists renamed files, tell the user that references inside OBJ / MTL files may need to be fixed by hand.
- `invocation_id` is only present on the submitting call, and only when that call itself finishes the task. A still-running submit result or an error after submission omits it, and it is `null` in `get_meshy_task` results.
- Other formats, the thumbnail, and any file that failed to download are listed as links. Product links expire after about 3 days.
- Invalid arguments are rejected locally before any request is sent. Nothing is charged, and the error names the field and its allowed values. Use only the documented argument names: an unknown or misspelled name (for example `target_polycounts`) is rejected, not ignored.

## Waiting and resubmitting

- A task usually takes one to three minutes. One call waits up to about four minutes, then downloads the products.
- When a call returns a still-running status with a `task_id`, tell the user the task is in progress and call `get_meshy_task` with that `task_id` (and the same `output_dir` / `formats`). Do **not** call `submit_meshy_task` again: every submitted task that succeeds is billed.
- When a call reports that the submission was not confirmed and gives a `request_id`, call `submit_meshy_task` again later with the same arguments plus that `request_id`. The first request body is replayed unchanged, so any changed argument (including `images`, `texture_prompt`, `texture_image`, numbers, and the `formats` of `generate` / `remesh` / `convert`, which also download the first submission's formats) does not take effect, and the tool lists every changed argument. For the other actions `formats` only chooses what is downloaded and the replay uses the value passed now, so keep `formats` unchanged on a replay.
- If the same `request_id` comes back unconfirmed 3 times in a row, stop replaying it. Tell the user that the task may or may not have been created and let them decide whether to wait longer or submit again without `request_id` (which may be billed twice).
- If a replay is rejected outright (the tool says no task was created for that `request_id`), do not replay it again. Adjust the input if needed and submit again without `request_id`; when the reason is that the previous task is not finished yet, wait for it with `get_meshy_task` first.
- A replay can also come back unconfirmed together with a rejection (the tool says the service had already accepted the submission). That counts as unconfirmed: keep the `request_id` and apply the 3-times rule above.
- `succeeded_pending_products` means the task already succeeded and is billed, but the service has not returned the product links yet. Call `get_meshy_task` once more; if it reports the same again, stop and give the user the `task_id`.
- Stop waiting after about 15 minutes of `get_meshy_task` calls on the same task in total. Tell the user the task is still not finished, give them the `task_id`, and let them decide whether to check again later. Never resubmit it.

## Billing

A task is charged only when it succeeds. Failed tasks, rejected submissions, and local validation errors are free, and `list_meshy_animations` is free. Reference cost in credits: text generate 20, refine 10, image generate 30 (20 with `geometry_only`), retexture 10, remesh 5, convert 1, rig 5, animate 3 per animation id.

## Reporting results

Reply with the saved file paths as links, mention any product that was not downloaded together with its link, and give the `task_id` when the user might continue (for example remeshing, rigging, or animating).

## Failures

When a tool returns an error, stop and report it to the user, including any `code` and `logid`. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan subscription in this scope;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a rejected submission (content review, unsupported input, previous task not finished, upstream limit) created no task and was not charged; it may be retried with changed input;
- a rejected `rig` usually means the model was not remeshed first or is not humanoid.

Never substitute a hand-made model, an SVG, a procedurally generated mesh, an HTML/Three.js scene, or another plugin's output for a failed task.
