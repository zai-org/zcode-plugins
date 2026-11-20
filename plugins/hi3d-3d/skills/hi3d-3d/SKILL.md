---
name: hi3d-3d
description: Use when the user asks to turn one or more reference images (single image or multi-view front/back/left/right) into a 3D model (or from a text description, by first creating a reference image with the Seedream image-generation plugin), to texture a white/untextured 3D model from a reference image, or to split a 3D model into parts (character or general object) with Hi3D. Official ZCode plugin billed to the Coding Plan (no Hi3D account needed); calls submit_hi3d_task and get_hi3d_task of the hi3d-3d plugin and saves the model and cover image into the workspace.
---

# Hi3D 3D modeling (ZCode official)

Use the tools of the `hi3d_3d` MCP server: `submit_hi3d_task` and `get_hi3d_task`.

This plugin is the ZCode-official Hi3D integration. It uses the signed-in ZCode identity and is billed to the user's Coding Plan, so no Hi3D account or API key is needed.

## Actions

| `action` | What it does | Input | Result `task_id` |
| --- | --- | --- | --- |
| `generate` | Image or multi-view images to 3D | `images`: 1–4 reference images. One image is a single-image generation; with 2–4 images Hi3D treats them as views, and one must be the front. Optional `views` (same length as `images`, unique `front` / `back` / `left` / `right`; default order front, back, left, right), `geometry_only: true` (untextured model, cheaper), `face` (100000–2000000). | `gen:` |
| `texture` | Texture a white model | Exactly one of `task_id` (a `gen:` id only) or `model_url` (an https `.glb`), plus a required reference `image` | `tex:` |
| `split` | Split a model into parts | Exactly one of `task_id` (a `gen:` or `tex:` id) or `model_url` (an https `.glb` / `.obj` / `.stl`). `type`: `character` (default; optional `part` a–f, `joint` none/ball/dovetail/pin, `merge` yes/no) or `general` (optional `level` low/medium/high). | `split:` |

All actions accept `format`: `glb` (default), `obj`, `stl`, `fbx`, `usdz`, or `3mf`. Each task produces one format. A character split with template `a` gives 6 parts without material; a general split gives about 25 parts with material.

## Text-only requests: text → image → 3D

Users often ask for "text to 3D". 3D vendors solve this with a two-step pipeline: text → image → 3D, and Hi3D only accepts images.

- When the user only has a text description, the reference image has to be created first with the Seedream plugin (`image-generation`, tool `generate_image`): one object, plain background, the whole object in view (for example a three-quarter front view), no text or extra props. Then call `submit_hi3d_task` with `action: "generate"` and `images: ["<saved image path>"]`.
- Before you call Seedream, tell the user that the reference image will be generated with Seedream and billed separately, on top of the 3D task. Call Seedream only if the user agrees.
- If the user declines the extra step, do not call Seedream: ask the user for a reference image instead. Hi3D has no text-only generation, so never submit the text itself.
- If Seedream is not installed or enabled, ask the user for a reference image instead.
- The plugins do not call each other: the Agent chains the two calls, so Seedream must be installed and enabled. The Seedream image is billed separately.
- If the Seedream call fails, report the failure. Do not hand-draw or fabricate a reference image (SVG, HTML, canvas, etc.) instead.

## Recommended chains

- **Images to a textured model:** `generate`.
- **Untextured first, texture later:** `generate` with `geometry_only: true` → `texture` with the returned `gen:` task id and a reference `image`.
- **Printable or kit model:** `generate` (or `texture`) → `split` with the returned `gen:` or `tex:` task id.
- Before you chain a task, the previous task must have succeeded; otherwise the submission is rejected with no charge, so wait with `get_hi3d_task` first. Pass every `task_id` exactly as returned; never shorten, parse, or rebuild it.

## Inputs and outputs

- Images (`images`, `image`) may be workspace paths, `https://` URLs, or `data:image/...;base64` URLs; png / jpeg / webp up to 10 MiB. Local files and `data:` URLs are uploaded automatically.
- Local 3D model files cannot be uploaded. For your own model, pass a public `https://` `model_url`; for a model this plugin produced, chain it by `task_id`.
- Pass `output_dir` only when the user names a folder inside the workspace. Otherwise the model and cover image go to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-model/` (`get_hi3d_task` uses the task kind `gen`, `tex`, or `split`). Existing files are never overwritten; a name clash gets `-1`, `-2`.
- `invocation_id` is only present on the submitting call, and only when that call itself finishes the task. A still-running submit result (for example a `texture` task) or an error after submission omits it, and it is `null` in `get_hi3d_task` results, so do not wait for it or ask the user for it.
- Product links expire after 1 hour. If a download fails because a link expired, the tool queries the task once more and retries with fresh links; afterwards `get_hi3d_task` with the same `task_id` returns fresh links again (it only queries and does not submit a new task).
- Invalid arguments are rejected locally before any request is sent. Nothing is charged, and the error names the field and its allowed values. Use only the documented argument names: an unknown or misspelled name (for example `geometryonly`) is rejected, not ignored.

## Waiting and resubmitting

- Most tasks finish within a minute, but texturing can take about 7 minutes. One call waits up to about four minutes, then downloads the products.
- When a call returns a still-running status with a `task_id`, tell the user the task is in progress and call `get_hi3d_task` with that `task_id` (and the same `output_dir`). Do **not** call `submit_hi3d_task` again: every submitted task that succeeds is billed.
- When a call reports that the submission was not confirmed and gives a `request_id`, call `submit_hi3d_task` again later with the same arguments plus that `request_id`. The first request body is replayed unchanged, so any changed argument (including `images`, `image`, `views`, `format`, and `face`) does not take effect, and the tool lists every changed argument.
- If the same `request_id` comes back unconfirmed 3 times in a row, stop replaying it. Tell the user that the task may or may not have been created and let them decide whether to wait longer or submit again without `request_id` (which may be billed twice).
- If a replay is rejected outright (the tool says no task was created for that `request_id`), do not replay it again. Adjust the input if needed and submit again without `request_id`; when the reason is that the previous task is not finished yet, wait for it with `get_hi3d_task` first.
- A replay can also come back unconfirmed together with a rejection (the tool says the service had already accepted the submission). That counts as unconfirmed: keep the `request_id` and apply the 3-times rule above.
- `succeeded_pending_products` means the task already succeeded and is billed, but the service has not returned the product links yet. Call `get_hi3d_task` once more; if it reports the same again, stop and give the user the `task_id`.
- Stop waiting after about 15 minutes of `get_hi3d_task` calls on the same task in total. Tell the user the task is still not finished, give them the `task_id`, and let them decide whether to check again later. Never resubmit it.

## Billing

A task is charged only when it succeeds. Failed tasks, rejected submissions, and local validation errors are free. `geometry_only` generation costs less than textured generation; `face` does not affect the price.

## Reporting results

Reply with the saved model and cover paths as links, mention any product that was not downloaded together with its link, and give the `task_id` when the user might continue (texturing or splitting).

## Failures

When a tool returns an error, stop and report it to the user, including any `code` and `logid`. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan subscription in this scope;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a rejected submission (content review, unsupported input, previous task not finished, upstream limit) created no task and was not charged; it may be retried with changed input.

Never substitute a hand-made model, an SVG, a procedurally generated mesh, an HTML/Three.js scene, or another plugin's output for a failed task.
