# ZCode Hyper3D 3D Modeling Plugin

[中文](./README_CN.md)

This official ZCode plugin lets the Agent create 3D models with Hyper3D from text and/or images, build low-poly models (Smart Low Poly), retexture an existing model, or rig a model and add preset animations. Products are saved into the workspace. Usage is billed to your Coding Plan, so no Hyper3D account or API key is needed. This makes it different from the `hyper3d-rodin` plugin, which signs in to your own Hyper3D account.

## Components

- MCP server `hyper3d_3d` (stdio, Node.js), runtime name `plugin:hyper3d-3d:hyper3d_3d`, with three tools:
  - `submit_hyper3d_task` validates the arguments, submits a task, waits for it, and downloads the products;
  - `get_hyper3d_task` keeps waiting for a task that is already submitted, without submitting again;
  - `list_hyper3d_animations` lists the preset animation library (free).
- Skill `hyper3d-3d`, which tells the Agent when and how to call the tools.

## Requirements

- A signed-in ZCode session with a connected Coding Plan (individual or team). Connections that use only an API key or a Start Plan cannot use this plugin.
- A Z.ai account with a phone number (an email address for overseas accounts).
- Nothing to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example:

- "Generate a 3D model of a small wooden treasure chest and save it as GLB."
- "Turn `assets/hero.png` into a 3D character in T-pose, then rig it with a walking animation."
- "Retexture `https://example.com/knight.glb` with silver armor using `assets/armor-ref.png`."
- "Make a low-poly OBJ (about 2000 faces) of the treasure chest you just generated, with a PBR texture."

The Agent calls `submit_hyper3d_task` with one `action`:

| `action` | What it does | Required | Optional |
| --- | --- | --- | --- |
| `generate` | Text and/or image to 3D | `prompt` (up to 1024 characters) and/or `images` (1–5) | `image_labels` (view per image: `F`, `FL`, `FR`, `B`, `BL`, `BR`, `L`, `R`, `U`, `D`, `?`), `mesh_mode` (`Raw` / `Quad`), `quality` (`high` / `medium` / `low` / `extra-low`), `material` (`PBR` / `Shaded` / `All` / `Hybrid` / `None`), `format` (`glb` / `usdz` / `fbx` / `obj` / `stl`, default `glb`), `ta_pose` |
| `polygen` | Smart Low Poly: builds a low-poly model directly (not just decimation), for game assets | At least one of `task_id` (from a `generate` task, starts with `gen:`), `model_url` (https; `.obj`, `.glb`, `.stl`, `.fbx`, `.usd`, `.usda`, `.usdz`, `.usdc`), `images` (1–5), or `prompt` (up to 1024 characters); `task_id` and `model_url` are mutually exclusive | `face_count` (200–10000; default 4000 for `model_url`, automatic otherwise), `mesh_mode` (`Quad` default / `Raw` / `NGon`), `format` (`obj` default / `glb` / `usdz` / `fbx` / `stl`), `image_labels` (may be shorter than `images`, never longer). Without `model_url`: `material` (`PBR` / `Shaded` / `All` / `Hybrid` / `None`, default `None` = geometry only) and `uhd_texture` (only sharpens newly generated textures; the resolution stays fixed). With `model_url`: `images` as mesh references and `transfer_texture` (default `true` keeps the original texture, `false` = geometry only); `prompt`, `material`, and `uhd_texture` are refused |
| `texture` | Retextures an existing model | `model_url` (https; `.obj`, `.stl`, `.gltf`, `.glb`, `.fbx`, `.usdz`) and `image` (one reference image) | `prompt`, `material` (`PBR` / `Shaded` / `All` / `Hybrid`), `format` |
| `rig` | Adds a skeleton and preset animations | Exactly one of `task_id` (from a `generate` task, starts with `gen:`) or `model_url` (https; `.obj`, `.glb`, `.stl`, `.fbx`, `.usd`, `.usda`, `.usdz`, `.usdc`) | `bone_template` (`auto` / `human` / `quadruped` / `bird` / `dragon` / `kaiju`), `animations` (up to 10 ids from `list_hyper3d_animations`), `in_place`, `format` (`glb` / `fbx` / `usdz`) |

`mesh_mode: "NGon"` is only accepted by `polygen`. `polygen` with `task_id` reuses the generated asset (the source task must have succeeded); a `material` other than `None` regenerates the texture from the source task's images or prompt, and new `images` / `prompt` replace them.

Every action also accepts `output_dir` (a folder inside the workspace) and `request_id` (only to replay a submission that was reported as unconfirmed).

`get_hyper3d_task` takes `task_id` and an optional `output_dir`. `list_hyper3d_animations` takes an optional `category` (`human`, `canine`, `bird`, `fish`, `heavyhooved`, `leanhooved`, `lizard`, `rodentia`, `seaturtle`) and an optional local `search` filter.

## From text to 3D

For the best results, 3D vendors turn text into an image first and then the image into a 3D model. When you only have a text description, the Agent recommends first creating a reference image with the Seedream plugin (`image-generation`) and then generating the 3D model from that image. Before it calls Seedream, the Agent tells you that this adds an image-generation step that is billed separately. If you decline, or ask for text-only generation, the Agent submits your text directly as the `prompt`, without Seedream. Direct text-to-3D generation is also used when Seedream is not installed. `polygen` also works the same way: from the Seedream image, or directly from a `prompt`. The plugins do not call each other, so install and enable Seedream to use this flow.

## Inputs and outputs

- Images can be workspace paths, `https://` URLs, or `data:image/...;base64` URLs (png / jpeg / webp, up to 10 MiB). Local files and `data:` URLs are uploaded to ZCode first.
- Local 3D model files cannot be uploaded. Pass a public `https://` `model_url` (up to 100 MB), or chain a `generate` task by `task_id` for `rig` or `polygen`.
- Products are saved to `output_dir`, or by default to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-<slug>/` in the workspace. `submit_hyper3d_task` uses the `action` (`generate`, `polygen`, `texture`, `rig`); `get_hyper3d_task` uses the task kind from the `task_id` prefix (for example `gen`, `poly`, or `tex`; `task` when there is no prefix). The slug is the letters and digits of the `prompt` (of `generate`, `polygen`, or `texture`) joined by `-` (at most 24 characters), otherwise `model`. A folder that already exists gets `-1`, `-2`. Up to 20 files are downloaded per task. File names come from the product names or links, never from the task id. A name that is safe on macOS, Linux, and Windows is kept exactly as the service gives it, including spaces, parentheses, and non-ASCII letters, so the references from an OBJ to its MTL and textures keep working. Only unsafe parts are changed: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and control characters become `_`; leading and trailing dots and spaces are removed (a name made only of dots falls back to `file-<n>`); Windows device names such as `CON`, `NUL`, `COM1`, or `LPT1`, in any case and with or without an extension, get a `_` prefix; and a name longer than 200 bytes is shortened, keeping its extension. Existing files are never overwritten: a name clash gets `-1`, `-2`. When any file is saved under a different name (cleaned or given a clash suffix), the result lists every rename (`renamed_files` and `rename_warning` in the structured result) and warns that references inside OBJ / MTL files may need to be fixed by hand.
- `polygen` results are often OBJ files. All product files (the `.obj`, its `.mtl`, and texture images) are saved in the same folder, under their own names whenever those names are safe, so the OBJ keeps working. Use a new or empty `output_dir`, because a renamed file (an unsafe name or a `-1` clash suffix) would break those references; any rename is listed in the result.
- Product links are valid for 7 days and are not re-hosted. Any file that failed to download is listed with its link.
- The first product link and every redirect hop follow the same rule (at most five redirects are followed): the link must be `https://` and must not point to `localhost` or to a loopback, private, link-local, CGNAT, unique-local, multicast, or unspecified IP address, including IPv4-mapped and numeric IPv4 forms. Outside local-development mode, the host name of the first link and of every redirect hop is also resolved (all of its addresses) right before it is requested: if any address is in one of those ranges, or the name cannot be resolved, the link is not downloaded. Resolved addresses in `198.18.0.0/15` and `fdfe:dcba:9876::/64` are the exception: proxy tools such as Clash, mihomo, and Surge in fake-IP or TUN mode answer every name with them and then choose the real address themselves, which this check cannot see. Written as an IP address in the link, those ranges are still refused. IP addresses written in the link are checked as written. A DNS-rebinding window remains: the check and the connection look the name up separately, so a DNS server that gives the check a public address and the connection a private one is not caught. Even then the response is only written to a file in the workspace and is never passed back to the model. A redirect from an `https://` link may stay on the same origin. Loopback links, including plain `http://` ones, are accepted only when `ZCODE_BASE_URL` itself is a loopback address (local development). In that local-development mode any `https://` link is accepted as the first link, including one on a private address, and a redirect from a loopback `http://` link may go to any accepted link. A link that breaks the rule, redirects anywhere else, or redirects too often is not downloaded; it is listed as a link with the reason, and the call still succeeds.
- The result also lists the `task_id` (600+ characters, pass it verbatim to the next step). The `invocation_id` is only present when the submitting call (`submit_hyper3d_task`) itself finishes with products and the service returned one. A submit that returns while the task is still running does not include it (the field is missing), and it is `null` in completed `get_hyper3d_task` results.

## Billing

- A task is charged only when it succeeds: 0.5 credit for each `generate`, `polygen`, `texture`, or `rig`. Failed tasks, rejected submissions, and local validation errors cost nothing, and the animation library is free.
- Retries of the same submission reuse one `Idempotency-Key`, so network errors and timeouts never submit twice. Use `get_hyper3d_task`, not a new submit, to keep waiting.

## Notes and limitations

- A task usually takes 1–2 minutes. One tool call waits up to about four minutes; if the task is not finished it returns a `task_id`, and `get_hyper3d_task` continues waiting. Calling `submit_hyper3d_task` again would create and bill a new task.
- If the service reports a task as succeeded but has not returned its product links yet, the call keeps waiting. If its time runs out first, it returns the status `succeeded_pending_products` with the `task_id`: the task has succeeded and is billed, and `get_hyper3d_task` can fetch the products later.
- Before you chain with `task_id`, the previous task must have succeeded. Only `generate` task ids (`gen:`) can be chained: low-poly (`poly:`), textured, or rigged products cannot be rigged or passed to `polygen` by `task_id`; download them and pass them as an https `model_url`.
- Tier, texture mode, and texture resolution are fixed by the service, also for `polygen`. `uhd_texture` (`polygen` only) just makes newly generated textures sharper; it does not change the texture resolution. Part splitting, image generation, custom skeletons, and uploaded animations are not offered.
- While a submission is unconfirmed, its request body (action, parameters, image and model URLs; no identity) and a fingerprint of each argument are kept in the plugin data directory, so a `request_id` replay sends exactly the same request and the tool can name every argument that was changed on the replay and therefore did not take effect. On macOS and Linux the file is created with mode 0600 (directory 0700); on Windows its protection relies on the ACL of the user profile directory. It is deleted once the submission is confirmed or explicitly rejected, or 24 hours after it was first saved (rewriting it on a replay does not extend that). A replay that only ends after those 24 hours does not save the record again, and the tool says so.
- A submission whose result was uncertain, or a `request_id` replay, can be rejected by the upstream service (code 3703 or 3707). If the service never accepted that `request_id` before (it never answered `UNKNOWN`, `CALLING`, a reply without a `task_id`, "same request still in progress" (3702), or another 2xx reply), no task was created for it: the record is deleted and the tool reports a submit failure. Do not replay that `request_id`; adjust the input if needed and submit again without `request_id` (for a 3703 because the previous task is not finished yet, wait for it with `get_hyper3d_task` first). If the service had already accepted the `request_id`, a later rejection (for example an upstream rate limit or an image link that has expired) does not prove that no task was created, so the `request_id` is handed back again together with the rejection. The same holds for code 3001, which can come from an incomplete team or personal scope rather than from the request, and for every other error.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. API responses larger than 1 MiB are not read. Products are downloaded from the temporary links the service returns, without any identity headers.
- Arguments that a tool does not define (for example a misspelled `bone_template`) are rejected locally, before any request, with the list of accepted arguments. Nothing is submitted or charged.
- If ZCode cancels a call, the plugin stops waiting, retrying, and downloading at once and returns no result. A task that was already submitted keeps running and is charged if it succeeds. Its `task_id` is only available if it was already shown: the "task submitted" progress message includes it when the host displays progress, and `get_hyper3d_task` can then fetch the result. Otherwise the result cannot be retrieved through the plugin.
- Local input files and `output_dir` must be inside the workspace.
