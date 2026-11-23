# ZCode Meshy 3D Modeling Plugin

[中文](./README_CN.md)

This official ZCode plugin lets the Agent create 3D models with Meshy from a text description or from reference images, then texture, retexture, remesh, convert, rig, and animate them. Products are saved into the workspace. Usage is billed to your Coding Plan, so no Meshy account or API key is needed.

## Components

- MCP server `meshy_3d` (stdio, Node.js), runtime name `plugin:meshy-3d:meshy_3d`, with three tools:
  - `submit_meshy_task` validates the arguments, submits a task, waits for it, and downloads the products;
  - `get_meshy_task` keeps waiting for a task that is already submitted, without submitting again;
  - `list_meshy_animations` lists the preset animation library (free).
- Skill `meshy-3d`, which tells the Agent when and how to call the tools.

## Requirements

- A signed-in ZCode session with a connected Coding Plan (individual or team). Connections that use only an API key or a Start Plan cannot use this plugin.
- A Z.ai account with a phone number (an email address for overseas accounts).
- Nothing to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example:

- "Generate a 3D cartoon knight in A-pose, then texture it with silver armor and a red cape."
- "Turn `assets/robot.png` into a 3D model and export FBX."
- "Remesh the knight, rig it, and make it wave and walk."

The Agent calls `submit_meshy_task` with one `action`:

| `action` | What it does | Required | Optional |
| --- | --- | --- | --- |
| `generate` | Text-to-3D (white model), image-to-3D (1 image), or multi-image-to-3D (2–4 images, the first is the front) | `prompt` (up to 800 characters) **or** `images` | `geometry_only`, `pose_mode` (`a-pose` / `t-pose`), `formats` |
| `refine` | Textures a text-generated white model | `task_id` starting with `preview:` | `texture_prompt`, `texture_image`, `formats` |
| `retexture` | Replaces the texture | `task_id` or `model_url`; `texture_prompt` and/or `texture_image` | `formats` |
| `remesh` | Reduces faces or retopologizes | `task_id` or `model_url` | `topology` (`quad` / `triangle`), `target_polycount` (100–300000), `formats` |
| `convert` | Converts the format | `task_id` or `model_url`; `formats` | — |
| `rig` | Adds a standard humanoid skeleton, with free walking and running clips | `task_id` or `model_url` (`.glb`) | `height_meters`, `include_fingers`, `skeleton_template`, `formats` |
| `animate` | Applies preset animations, merged into one file | `task_id` starting with `rig:`; `action_ids` (1–10, from `list_meshy_animations`) | `formats` |

Every action also accepts `output_dir` (a folder inside the workspace) and `request_id` (only to replay a submission that was reported as unconfirmed). `formats` takes `glb`, `fbx`, `obj`, `usdz`, `stl`, `3mf` (`remesh` and `convert` also accept `blend`); it decides which formats are downloaded, and for `generate`, `remesh`, and `convert` it is also sent as the output format list. Without `formats`, `glb` is downloaded (or the first available format when there is no `glb`). With `formats`, only those formats are downloaded; a requested format that the task did not return is named in the result, and the available links are listed instead of downloading a different format. On a `request_id` replay, `generate`, `remesh`, and `convert` download the formats of the first submission; the other actions download the `formats` passed on the replay.

`get_meshy_task` takes `task_id` and optional `output_dir` and `formats`. `list_meshy_animations` takes optional `category` and `search` filters.

`retexture`, `remesh`, `convert`, and `rig` accept a `task_id` of kind `preview`, `image`, `multi`, `refine`, `retexture`, or `remesh`, or your own model through an `https://` `model_url`.

**Remesh before rigging.** Generated models have about 1.4 million triangles, above Meshy's 380k rigging limit. Recommended chain: `generate` → (`refine` for text) → `remesh` with `target_polycount` ≤ 300000 → `rig` with the remesh `task_id` → `animate`.

## From text to 3D

For the best results, 3D vendors turn text into an image first and then the image into a 3D model. When you only have a text description, the Agent recommends first creating a reference image with the Seedream plugin (`image-generation`) and then generating the 3D model from that image. Before it calls Seedream, the Agent tells you that this adds an image-generation step that is billed separately. If you decline, or ask for text-only generation, the Agent submits your text directly as the `prompt`, without Seedream. Direct text-to-3D generation is also used when Seedream is not installed. The plugins do not call each other, so install and enable Seedream to use this flow.

## Inputs and outputs

- Images can be workspace paths, `https://` URLs, or `data:image/...;base64` URLs (png / jpeg / webp, up to 20 MiB). Local files and `data:` URLs are uploaded to ZCode first.
- Local 3D model files cannot be uploaded. Pass a public `https://` `model_url`, or chain a previous task by `task_id`.
- Products are saved to `output_dir`, or by default to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-<slug>/` in the workspace. `submit_meshy_task` uses the `action` (`generate`, `remesh`, `rig`, …); `get_meshy_task` uses the task kind from the `task_id` prefix (`preview`, `refine`, `image`, `multi`, `retexture`, `remesh`, `convert`, `rig`, `anim`, …; `task` when there is no prefix). The slug is the letters and digits of a text `generate` prompt joined by `-` (at most 24 characters), otherwise `model`. A folder that already exists gets `-1`, `-2`. File names come from the product links, never from the task id. A link whose last path segment has no extension is saved with `.<format>` appended (for example `model` becomes `model.glb`); that alone does not count as a rename. A name that is safe on macOS, Linux, and Windows is kept exactly as the link gives it, including spaces, parentheses, and non-ASCII letters, so the references from an OBJ to its MTL and textures keep working. Only unsafe parts are changed: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and control characters become `_`; leading and trailing dots and spaces are removed (a name made only of dots falls back to `model.<format>`); Windows device names such as `CON`, `NUL`, `COM1`, or `LPT1`, in any case and with or without an extension, get a `_` prefix; and a name longer than 200 bytes is shortened, keeping its extension. Existing files are never overwritten: a name clash gets `-1`, `-2`. When any file is saved under a different name (cleaned or given a clash suffix), the result lists every rename (`renamed_files` and `rename_warning` in the structured result) and warns that references inside OBJ / MTL files may need to be fixed by hand.
- Formats that were not requested, the thumbnail, and any file that failed to download are listed as links. Meshy deletes the files after about 3 days.
- The first product link and every redirect hop follow the same rule (at most five redirects are followed): the link must be `https://` and must not point to `localhost` or to a loopback, private, link-local, CGNAT, unique-local, multicast, or unspecified IP address, including IPv4-mapped and numeric IPv4 forms. Outside local-development mode, the host name of the first link and of every redirect hop is also resolved (all of its addresses) right before it is requested: if any address is in one of those ranges, or the name cannot be resolved, the link is not downloaded. Resolved addresses in `198.18.0.0/15` and `fdfe:dcba:9876::/64` are the exception: proxy tools such as Clash, mihomo, and Surge in fake-IP or TUN mode answer every name with them and then choose the real address themselves, which this check cannot see. Written as an IP address in the link, those ranges are still refused. IP addresses written in the link are checked as written. A DNS-rebinding window remains: the check and the connection look the name up separately, so a DNS server that gives the check a public address and the connection a private one is not caught. Even then the response is only written to a file in the workspace and is never passed back to the model. A redirect from an `https://` link may stay on the same origin. Loopback links, including plain `http://` ones, are accepted only when `ZCODE_BASE_URL` itself is a loopback address (local development). In that local-development mode any `https://` link is accepted as the first link, including one on a private address, and a redirect from a loopback `http://` link may go to any accepted link. A link that breaks the rule, redirects anywhere else, or redirects too often is not downloaded; it is listed as a link with the reason, and the call still succeeds.
- The result also lists the `task_id`, which can be passed verbatim to the next step. The `invocation_id` is only present on the submitting call (`submit_meshy_task`), and only when that call itself finishes the task and the service returned one; a still-running submit result or an error after submission omits it, and it is `null` in `get_meshy_task` results.

## Billing

- A task is charged only when it succeeds. Failed tasks, rejected submissions, and local validation errors cost nothing, and the animation library is free.
- Reference cost in credits: text generate 20, refine 10, image generate 30 (20 with `geometry_only`), retexture 10, remesh 5, convert 1, rig 5, animate 3 per animation id.
- Retries of the same submission reuse one `Idempotency-Key`, so network errors and timeouts never submit twice. Use `get_meshy_task`, not a new submit, to keep waiting.

## Notes and limitations

- A task usually takes one to three minutes. One tool call waits up to about four minutes; if the task is not finished it returns a `task_id`, and `get_meshy_task` continues waiting. Calling `submit_meshy_task` again would create and bill a new task.
- If the service reports a task as succeeded but has not returned its product links yet, the call keeps waiting. If its time runs out first, it returns the status `succeeded_pending_products` with the `task_id`: the task has succeeded and is billed, and `get_meshy_task` can fetch the products later.
- Before you chain with `task_id`, the previous task must have succeeded. Otherwise the submission is rejected with no charge.
- Rigging supports humanoid models only. The Meshy model version, texture resolution, and PBR settings are fixed by the service.
- While a submission is unconfirmed, its request body (action, parameters, image URLs; no identity) and a fingerprint of each argument are kept in the plugin data directory, so a `request_id` replay sends exactly the same request and the tool can name every argument that was changed on the replay and therefore did not take effect. On macOS and Linux the file is created with mode 0600 (directory 0700); on Windows its protection relies on the ACL of the user profile directory. It is deleted once the submission is confirmed or explicitly rejected, or 24 hours after it was first saved (rewriting it on a replay does not extend that). A replay that only ends after those 24 hours does not save the record again, and the tool says so.
- A submission whose result was uncertain, or a `request_id` replay, can be rejected by the upstream service (code 3703 or 3707). If the service never accepted that `request_id` before (it never answered `UNKNOWN`, `CALLING`, a reply without a `task_id`, "same request still in progress" (3702), or another 2xx reply), no task was created for it: the record is deleted and the tool reports a submit failure. Do not replay that `request_id`; adjust the input if needed and submit again without `request_id` (for a 3703 because the previous task is not finished yet, wait for it with `get_meshy_task` first). If the service had already accepted the `request_id`, a later rejection (for example an upstream rate limit or an image link that has expired) does not prove that no task was created, so the `request_id` is handed back again together with the rejection. The same holds for code 3001, which can come from an incomplete team or personal scope rather than from the request, and for every other error.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. API responses larger than 1 MiB are not read. Products are downloaded from the temporary links the service returns, without any identity headers.
- Arguments that a tool does not define (for example a misspelled `target_polycount`) are rejected locally, before any request, with the list of accepted arguments. Nothing is submitted or charged.
- If ZCode cancels a call, the plugin stops waiting, retrying, and downloading at once and returns no result. A task that was already submitted keeps running and is charged if it succeeds. Its `task_id` is only available if it was already shown: the "task submitted" progress message includes it when the host displays progress, and `get_meshy_task` can then fetch the result. Otherwise the result cannot be retrieved through the plugin.
- Local input files and `output_dir` must be inside the workspace.
