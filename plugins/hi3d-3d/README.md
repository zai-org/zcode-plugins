# ZCode Hi3D 3D Modeling Plugin

[中文](./README_CN.md)

This official ZCode plugin lets the Agent create 3D models with Hi3D from one reference image or from multi-view images, then texture a white model or split a model into parts. The model and its cover image are saved into the workspace. Usage is billed to your Coding Plan, so no Hi3D account or API key is needed.

## Components

- MCP server `hi3d_3d` (stdio, Node.js), runtime name `plugin:hi3d-3d:hi3d_3d`, with two tools:
  - `submit_hi3d_task` validates the arguments, submits a task, waits for it, and downloads the products;
  - `get_hi3d_task` keeps waiting for a task that is already submitted, or fetches fresh product links, without submitting again.
- Skill `hi3d-3d`, which tells the Agent when and how to call the tools.

## Requirements

- A signed-in ZCode session with a connected Coding Plan (individual or team). Connections that use only an API key or a Start Plan cannot use this plugin.
- A Z.ai account with a phone number (an email address for overseas accounts).
- Nothing to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example:

- "Turn `assets/robot.png` into a 3D model in glb format."
- "Generate an untextured model from these front and left views."
- "Texture the model from the last Hi3D task using `assets/style.png`."
- "Split the model from the last Hi3D task into character parts."

The Agent calls `submit_hi3d_task` with one `action`:

| `action` | What it does | Required | Optional |
| --- | --- | --- | --- |
| `generate` | Single-image or multi-view image to 3D | `images`: 1–4 reference images (with 2–4 images Hi3D treats them as views, and one must be the front) | `views` (`front` / `back` / `left` / `right`, same length as `images`, unique), `geometry_only` (`true` for an untextured model), `face` (100000–2000000), `format` |
| `texture` | Textures a white model | `task_id` of a `generate` task (`gen:`) **or** `model_url` (https `.glb`); plus a reference `image` | `format` |
| `split` | Splits a model into parts | `task_id` of a `generate` or `texture` task (`gen:` / `tex:`) **or** `model_url` (https `.glb` / `.obj` / `.stl`) | `type` (`character` default, or `general`); for `character`: `part` (a–f), `joint` (`none` / `ball` / `dovetail` / `pin`), `merge` (`yes` / `no`); for `general`: `level` (`low` / `medium` / `high`); `format` |

Every action also accepts `output_dir` (a folder inside the workspace) and `request_id` (only to replay a submission that was reported as unconfirmed). `format` is `glb` (default), `obj`, `stl`, `fbx`, `usdz`, or `3mf`; each task produces one format.

`get_hi3d_task` takes `task_id` and an optional `output_dir`.

## From text to 3D

Hi3D only accepts images. When you only have a text description, the Agent offers to first create a reference image with the Seedream plugin (`image-generation`) and then generate the 3D model from that image. Before it calls Seedream, the Agent tells you that the reference image will be generated with Seedream and billed separately. If you decline, or Seedream is not installed, the Agent asks you for a reference image instead; Hi3D cannot generate from text alone. The plugins do not call each other, so install and enable Seedream to use this flow.

## Inputs and outputs

- Images can be workspace paths, `https://` URLs, or `data:image/...;base64` URLs (png / jpeg / webp, up to 10 MiB). Local files and `data:` URLs are uploaded to ZCode first.
- Local 3D model files cannot be uploaded. Pass a public `https://` `model_url`, or chain a previous task by `task_id`.
- The model and its cover image are saved to `output_dir`, or by default to `generated-3d/<YYYYMMDD-HHMMSS>-<action or task kind>-model/` in the workspace. `submit_hi3d_task` uses the `action` (`generate`, `texture`, `split`); `get_hi3d_task` uses the task kind from the `task_id` prefix (`gen`, `tex`, `split`; `task` when there is no prefix). Hi3D has no text prompt, so the last part is always `model`. A folder that already exists gets `-1`, `-2`. File names come from the product links, never from the task id. A name that is safe on macOS, Linux, and Windows is kept exactly as the link gives it, including spaces, parentheses, and non-ASCII letters, so references from one product file to another keep working. Only unsafe parts are changed: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and control characters become `_`; leading and trailing dots and spaces are removed (a name made only of dots falls back to `model` or `cover`); Windows device names such as `CON`, `NUL`, `COM1`, or `LPT1`, in any case and with or without an extension, get a `_` prefix; and a name longer than 200 bytes is shortened, keeping its extension. Existing files are never overwritten: a name clash gets `-1`, `-2`. When any file is saved under a different name (cleaned or given a clash suffix), the result lists every rename (`renamed_files` and `rename_warning` in the structured result) and warns that references inside OBJ / MTL files may need to be fixed by hand.
- Product links expire after **1 hour** and are not re-hosted. If a download fails because a link has expired, the plugin queries the task again once and retries with fresh links. Afterwards, `get_hi3d_task` with the same `task_id` returns fresh links again.
- The first product link and every redirect hop follow the same rule (at most five redirects are followed): the link must be `https://` and must not point to `localhost` or to a loopback, private, link-local, CGNAT, unique-local, multicast, or unspecified IP address, including IPv4-mapped and numeric IPv4 forms. Outside local-development mode, the host name of the first link and of every redirect hop is also resolved (all of its addresses) right before it is requested: if any address is in one of those ranges, or the name cannot be resolved, the link is not downloaded. Resolved addresses in `198.18.0.0/15` and `fdfe:dcba:9876::/64` are the exception: proxy tools such as Clash, mihomo, and Surge in fake-IP or TUN mode answer every name with them and then choose the real address themselves, which this check cannot see. Written as an IP address in the link, those ranges are still refused. IP addresses written in the link are checked as written. A DNS-rebinding window remains: the check and the connection look the name up separately, so a DNS server that gives the check a public address and the connection a private one is not caught. Even then the response is only written to a file in the workspace and is never passed back to the model. A redirect from an `https://` link may stay on the same origin. Loopback links, including plain `http://` ones, are accepted only when `ZCODE_BASE_URL` itself is a loopback address (local development). In that local-development mode any `https://` link is accepted as the first link, including one on a private address, and a redirect from a loopback `http://` link may go to any accepted link. A link that breaks the rule, redirects anywhere else, or redirects too often is not downloaded; it is listed as a link with the reason, and the call still succeeds. Fresh links fetched after an expired link follow the same rule.
- The result also lists the `task_id`, which can be passed verbatim to the next step. The `invocation_id` is only present on the submitting call (`submit_hi3d_task`), and only when that call itself finishes the task and the service returned one. A submit result that is still running (for example `texture`, which takes longer than one call waits) or that ends in an error after submission does not include it, and it is `null` in `get_hi3d_task` results, so a long task never shows it.

## Billing

- A task is charged only when it succeeds. Failed tasks, rejected submissions, and local validation errors cost nothing.
- An untextured `generate` (`geometry_only`) costs less than a textured one. `face` does not affect the price.
- Retries of the same submission reuse one `Idempotency-Key`, so network errors and timeouts never submit twice. Use `get_hi3d_task`, not a new submit, to keep waiting.

## Notes and limitations

- Most tasks finish within a minute, but texturing can take about 7 minutes. One tool call waits up to about four minutes; if the task is not finished it returns a `task_id`, and `get_hi3d_task` continues waiting. Calling `submit_hi3d_task` again would create and bill a new task.
- If the service reports a task as succeeded but has not returned its product links yet, the call keeps waiting. If its time runs out first, it returns the status `succeeded_pending_products` with the `task_id`: the task has succeeded and is billed, and `get_hi3d_task` can fetch the products later.
- Before you chain with `task_id`, the previous task must have succeeded. Otherwise the submission is rejected with no charge.
- The model version, resolution, and PBR materials are fixed by the service. Embroidery, relief, multicolor, and rigging are not supported.
- While a submission is unconfirmed, its request body (action, parameters, image URLs; no identity) and a fingerprint of each argument are kept in the plugin data directory, so a `request_id` replay sends exactly the same request and the tool can name every argument that was changed on the replay and therefore did not take effect. On macOS and Linux the file is created with mode 0600 (directory 0700); on Windows its protection relies on the ACL of the user profile directory. It is deleted once the submission is confirmed or explicitly rejected, or 24 hours after it was first saved (rewriting it on a replay does not extend that). A replay that only ends after those 24 hours does not save the record again, and the tool says so.
- A submission whose result was uncertain, or a `request_id` replay, can be rejected by the upstream service (code 3703 or 3707). If the service never accepted that `request_id` before (it never answered `UNKNOWN`, `CALLING`, a reply without a `task_id`, "same request still in progress" (3702), or another 2xx reply), no task was created for it: the record is deleted and the tool reports a submit failure. Do not replay that `request_id`; adjust the input if needed and submit again without `request_id` (for a 3703 because the previous task is not finished yet, wait for it with `get_hi3d_task` first). If the service had already accepted the `request_id`, a later rejection (for example an upstream rate limit or an image link that has expired) does not prove that no task was created, so the `request_id` is handed back again together with the rejection. The same holds for code 3001, which can come from an incomplete team or personal scope rather than from the request, and for every other error.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. API responses larger than 1 MiB are not read. Products are downloaded from the temporary links the service returns, without any identity headers.
- Arguments that a tool does not define (for example a misspelled `geometry_only`) are rejected locally, before any request, with the list of accepted arguments. Nothing is submitted or charged.
- If ZCode cancels a call, the plugin stops waiting, retrying, and downloading at once and returns no result. A task that was already submitted keeps running and is charged if it succeeds. Its `task_id` is only available if it was already shown: the "task submitted" progress message includes it when the host displays progress, and `get_hi3d_task` can then fetch the result. Otherwise the result cannot be retrieved through the plugin.
- Local input files and `output_dir` must be inside the workspace.
