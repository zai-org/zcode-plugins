#!/usr/bin/env node
// SessionStart hook: inject the Tripo hard rules as additionalContext.
// Reads one JSON event from stdin, writes one JSON object to stdout.
// Keep this text in sync with skills/tripo-3d/SKILL.md.

const RULES = `Tripo 3D — rules that apply whenever Tripo tools (tripo_*) are used. These hold even when the tripo-3d skill was not loaded; load it for the full workflow.
1. Generation is asynchronous. Every tripo_* generation or processing tool returns a task_id immediately. Call tripo_task_wait with it and keep calling while status is queued/running — each call returns within about 55 seconds, a generation usually takes 1–4 minutes. Never present a result before status is success, and never treat a task_id as a finished model.
2. Result links are short-lived. Refresh with tripo_task_status and offer one labeled download link. Save a local file only when the user requests a file on disk or project integration and a shell is available. Report the path in backticks. Do not paste raw URLs or the full output_urls list. For concept images, follow rule 8.
3. Credits belong to the user. Call tripo_plan and get confirmation before any billed generation or chain; supply structured generation only for tripo_text_to_3d, tripo_image_to_3d and tripo_multiview_to_3d, including the exact text prompt for text-to-3D; never add generation to other steps such as tripo_image_to_splat. For those three use dry_run only when the connected schema exposes it; validate other steps against their schemas and current pricing. Resolve user-requested parameter conflicts before billing. Plan estimates are advisory, not a budget lock; label unknown costs not_estimated, and cite source, region and date for any static list estimate. Use tripo_usage for all task_ids to report actual total and per-task charges; if unavailable say the amount is pending. Check tripo_balance and confirm the costs for each phase before generating a batch; on insufficient balance give the returned plans_url instead of retrying. Never silently re-roll a disappointing result — say what is off and ask first.
4. Authorization is a browser flow, never a pasted key. This plugin uses the China-mainland tripo MCP server at https://developers.tripo3d.com/mcp and requires a Tripo China-site account. If tools are missing or authorization fails, tell the user to open ZCode Settings → MCP Servers, find tripo under "Plugin MCP servers" and click "Open authorization", then sign in and authorize on developers.tripo3d.com. Keep each workflow on the authorized account; do not silently switch accounts or servers after authorization or balance errors. Do not ask for an API key or verification code in the chat. MCP is the only execution path: never install or run a command-line client instead, even when a local login or API key exists.
5. Failures are reported, not hidden. On failed/banned, relay failure_reason (and error_code) honestly; failed-task credits are refunded automatically. Never invent parameters — the tool schemas are authoritative. If a creation call times out without a task_id, do not automatically retry: check the original account's balance and task history when available and ask before another submission. Stylize has been retired: there is no tripo_stylize tool. tripo_mesh_edit is experimental; use it only if the connected server lists it.
6. PBR is opt-in. Send pbr: false on every tripo_text_to_3d, tripo_image_to_3d, tripo_multiview_to_3d and tripo_texture call unless the user explicitly asks for PBR (e.g. "with PBR" or "PBR materials", in any language); only then send pbr: true, which also forces texture: true. The API turns PBR on when pbr is omitted, so never leave it out. Detailed or high-quality textures do not mean PBR.
7. Choose models explicitly: the user's explicit compatible model wins over usage-based defaults; if an explicit model conflicts with requirements, explain and ask before changing it or dropping a requirement. Without an explicit model, filter by required capabilities before applying scenario preferences (use v3.1 for generate_parts, smart_low_poly or detailed geometry). P2 is preferred for game/realtime topology and costs more credits than H/P1; within the P series the default is P2, and P1 is used only when the user names it or picks it for lower cost and speed; v3.1 for film/render/print. Do not infer the model from face_limit. Cost is not estimated by this text or guaranteed by tripo_plan: disclose uncertainty and obtain consent before billing. Pass the rig model explicitly: v3.0 for biped and others, v2.5 for animal body types, and use spec only for biped; use preset:walk, reserving preset:biped:* for explicit v1.0 rigs. Retopology v3.0 with smart_uv and standalone tripo_smart_uv are separate workflows, not interchangeable free export switches. Load the capability reference before running either. chat_image_1 is retired; never fall back to it. chat_image_1.5 remains usable where supported before 2026-12-01; never silently replace a user-selected paid image model. fast textures require texture model v3.5: pass the short name v3.5, or omit the version and the tool picks it.
8. Start a new 3D asset described only in words with a concept image unless the user explicitly asks to skip it. Plan and confirm only tripo_generate_image first. On success show the generated image from output_urls as a Markdown image, or provide one labeled link if inline display is unavailable. End the turn and wait for the user to accept that image. Only then plan tripo_image_to_3d using the accepted image task ID and ask separately for confirmation of the 3D costs. For a supplied image or multiview set, plan the corresponding 3D workflow directly.
`;

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let eventName = "SessionStart";
try {
  const input = raw.trim() ? JSON.parse(raw) : {};
  eventName = input.hook_event_name || input.hookEventName || eventName;
} catch (err) {
  process.stderr.write(`[tripo-3d] invalid SessionStart stdin: ${err}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: RULES },
  }),
);
