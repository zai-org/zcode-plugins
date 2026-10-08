---
name: hyper3d-rodin
description: Generate Hyper3D Rodin Gen-2.5 models from text or images, split completed models with BANG, track progress, and retrieve result pages or requested model files.
---

# Hyper3D Rodin

Use the tools discovered from the `hyper3d-rodin` MCP server in ZCode. Match
logical names below to the actual session tools; do not construct tool prefixes.
Use live tool descriptions and schemas for parameters, limits, and defaults.
Leave optional settings unset unless needed for the user's request. For highly
reflective reference images, consider recommending `texture_delight`.

Connect through ZCode's MCP OAuth flow. If authorization is missing, use the
host's login/reconnect flow; never request credentials in chat. Billing uses
the workspace selected during OAuth. Generation and BANG consume credits:
explain this before the first paid submission and submit only for a requested
generation or split. Connection tests and status checks do not authorize one.

## Generate and retrieve

1. For image input, complete the upload workflow below first. Call
   `rodin_generate` once with the user's prompt, uploaded references, or both.
   For image-only generation, omit `prompt` rather than sending an empty string.
2. Save the returned `generation_id`. Monitor it with `rodin_get_status`,
   leaving a reasonable interval between checks rather than busy-polling.
   Keep the user informed; stage counts are not percentages or time estimates.
3. A monitoring timeout does not mean generation failed. Check the same ID.
   If reads keep failing, report the last known state and ID. On a failed task,
   report the error; do not automatically generate again or fetch its results.
4. On completion, call `rodin_get_result` and present its permanent
   `display_url`. Use temporary file URLs only for user-requested downloads.
   Select the requested model files and any required textures or sidecars,
   then return the downloaded local artifacts.

## Reference images

Use actual files from the user's paths or attachments. Do not use
`rodin_import_images` in ZCode; that tool is for ChatGPT Chat attachments.

1. Inspect the files and check them against the live upload schema. Derive
   MIME types and byte sizes from the actual files.
2. Call `rodin_create_uploads`. PUT each matching file to its returned
   `upload_url`, using the supplied method and headers before `expires_at`.
   Confirm every upload succeeds before submitting generation.
3. Pass the returned `upload_id` values as `reference_upload_ids` in the
   original image order. These IDs are consumed by a successful submission;
   prepare fresh uploads for a new generation, never to retry an uncertain one.

If the host requires network permission for PUT, use its permission flow.
If uploading remains unavailable, report the limitation and direct the user
to https://hyper3d.ai. Do not silently omit images or switch to text-only.

## BANG part splitting

Use a completed Rodin generation owned by the authorized user. Pass its
`generation_id` as `asset_id` to `rodin_generate_bang`, not a file URL or upload
ID. Arbitrary local model uploads are not supported by this workflow.

Supply `instruction` when the user names parts to separate; otherwise leave it
unset for automatic planning. Treat `strength` as guidance, not a guaranteed
part count. Leave other options to the live schema and the user's request.

Submit once, save the new `generation_id`, and follow the same status/result
workflow as generation.

## Recovery and handling

- Generation and BANG are not idempotent. Never automatically retry a paid
  submission after a timeout or connection error. Query the known ID; if none
  was returned, ask the user to inspect Hyper3D Mine before submitting again.
- Report insufficient-credit or entitlement errors without changing the
  billing workspace or downgrading requested settings. Reconnect through OAuth
  to change accounts or workspaces. Do not infer balance or price from this MCP.
- Read only the authorized user's tasks; group billing does not grant access
  to other members' models.
- Do not echo signed URLs or sensitive headers. They may remain in host tool
  history, so exclude them from shared logs and use host redaction when available.
  Safely quote shell arguments when uploading or downloading files.
- This Skill covers generation and retrieval; DCC integration requires its own
  tools or workflow.
