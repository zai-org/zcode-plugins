---
name: viralkey-media
description: Generate or edit images and videos using the user's connected Viralkey account, existing credits and available models. Use when the user selects Viralkey for media generation or wants to inspect its models, costs or generation results.
---

<!-- @generated AI-assisted -->
# Viralkey media

Use the connected Viralkey MCP tools after the user completes a single authorization in the browser. If authentication has expired, ask the user to reconnect through their client's MCP settings. If a service is unavailable, report that instead of requesting more permissions. Do not install an unrelated provider, copy browser cookies, read stored tokens, or treat this skill as authorization to spend credits.

## Choose and prepare

- Honor the user's model and output intent. Call `list_models`, then `get_model_schema` for the chosen model. Read its actual modes, fields, resolution casing and reference constraints; model availability and prices are not fixed in this skill.
- If the user has not selected a model, choose an eligible model that fits the requested workflow and state the choice briefly. Do not silently replace an explicitly selected model.
- References currently require asset IDs already uploaded to the same Viralkey account. This remote server cannot read local files and has no upload tool. Ask the user to upload a local reference through Viralkey first; do not pretend that a local path, arbitrary URL or base64 is an asset ID.

## Estimate, generate and recover

1. Use `get_account` to check credits when needed. Call `estimate_generation` with the complete model request. It returns the current credit cost and a `revision` without creating a task or reserving credits.
2. Report the selected model and estimated cost. For the user's requested generation, send the same complete media inputs to `generate_image` or `generate_video`, adding the returned `revision` and one UUID `request_id`. Normal Viralkey account billing applies; the estimate is not a saved or locked-price ticket. If the server rejects changed settings or pricing, estimate again and report the new cost before submitting.
3. Keep the complete request, `request_id` and returned `run_id`. Poll `get_generation` with `{ "id": "<run_id>" }` using its suggested interval and a bounded wait. Use `list_generations` to find existing model runs after reconnecting.
4. Use `get_asset` for media metadata and usable delivery links. Show the real result and, if requested, save it using the client's permitted file tools without overwriting an existing file. Never send the MCP OAuth bearer token to a returned media URL.

A timeout, disconnect or `submission_unknown` is not a failed generation: query the existing run or replay the identical request with the same `request_id`. Do not invent a new ID to retry unknown acceptance. When media is ready but settlement is pending, deliver the existing result and explain the pending credit state; do not regenerate. Changed content or an explicit request for another output is a new generation.

Insufficient credits or an unavailable model requires a user decision, not automatic purchase, repeated attempts, or silent model switching. Surface a useful short error and keep recoverable task identities. Never claim delivery, a refund or final charges until the server reports them.
