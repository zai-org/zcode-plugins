#!/usr/bin/env node
// SessionStart hook: inject the Tripo hard rules and a time-zone region hint as additionalContext.
// Reads one JSON event from stdin, writes one JSON object to stdout.
// Keep this text in sync with skills/tripo-3d/SKILL.md.

const RULES = `Tripo 3D — rules that apply whenever Tripo tools (tripo_*) are used. These hold even when the tripo-3d skill was not loaded; load it for the full workflow.
1. Generation is asynchronous. Every tripo_* generation or processing tool returns a task_id immediately. Call tripo_task_wait with it and keep calling while status is queued/running — each call returns within about 55 seconds, a generation usually takes 1–4 minutes. Never present a result before status is success, and never treat a task_id as a finished model.
2. Deliver the file, then one link. On success, download model_url to a local file when a shell is available and give its path as plain text in backticks, never as a clickable link (chat previews cannot render meshes); then also offer model_url as a single markdown download link. Do not paste URLs from output_urls into the reply. Result URLs expire after about 2 hours: never re-print an old one — call tripo_task_status for fresh links.
3. Credits belong to the user. Call tripo_plan and get confirmation before any billed generation or chain; supply structured generation only for tripo_text_to_3d, tripo_image_to_3d and tripo_multiview_to_3d, including the exact text prompt for text-to-3D; never add generation to other steps such as tripo_image_to_splat. For those three use dry_run only when the connected schema exposes it; validate other steps against their schemas and current pricing. Resolve user-requested parameter conflicts before billing. Plan estimates are advisory, not a budget lock; label unknown costs not_estimated, and cite source, region and date for any static list estimate. Use tripo_usage for all task_ids to report actual total and per-task charges; if unavailable say the amount is pending. Check tripo_balance and confirm before generating more than one asset in a batch; on insufficient balance give the returned plans_url instead of retrying. Never silently re-roll a disappointing result — say what is off and ask first.
4. Authorization is a browser flow, never a pasted key. The plugin has one MCP server per Tripo region, and an account exists in only one region: tripo is the China site (developers.tripo3d.com, +86 SMS sign-in), tripo-global is the international site (developers.tripo3d.ai, email sign-in); neither auth page has a region picker. If Tripo tools are missing or a call reports an authorization error, ask which site the user's Tripo account is on unless they already said, then tell them to open ZCode Settings → MCP Servers, find that server under "Plugin MCP servers" and click "Open authorization" (ZCode shows these labels in its UI language), then sign in on that site's console and Authorize. The other server keeps showing "Authorization required", which is expected. If tools from both servers are available, ask which account to spend credits from and keep each task chain on that server: task IDs, file tokens and balances do not carry across regions. Never switch servers silently. Do not ask for an API key in the chat. MCP is the only execution path: never install or run a command-line client instead, even when a local login or API key exists.
5. Failures are reported, not hidden. On failed/banned, relay failure_reason (and error_code) honestly; failed-task credits are refunded automatically. Never invent parameters — the tool schemas are authoritative. If a creation call times out without a task_id, do not automatically retry: check the original account's balance and task history when available and ask before another submission. Stylize has been retired: there is no tripo_stylize tool. tripo_mesh_edit is experimental; use it only if the connected server lists it.
6. PBR is opt-in. Send pbr: false on every tripo_text_to_3d, tripo_image_to_3d, tripo_multiview_to_3d and tripo_texture call unless the user explicitly asks for PBR (e.g. "with PBR" or "PBR materials", in any language); only then send pbr: true, which also forces texture: true. The API turns PBR on when pbr is omitted, so never leave it out. Detailed or high-quality textures do not mean PBR.
7. Choose models explicitly: the user's explicit compatible model wins over usage-based defaults; if requirements conflict, explain and ask before changing model or dropping a requirement. P2 is preferred for game/realtime topology and costs more credits than H/P1; within the P series the default is P2, and P1 is used only when the user names it or picks it for lower cost and speed; v3.1 for film/render/print. Do not infer the model from face_limit. Cost is not estimated by this text or guaranteed by tripo_plan: disclose uncertainty and obtain consent before billing. Pass the rig model explicitly: v3.0 for bipeds, v2.5 for animal body types (the API's own default is v1.0, which rigs bipeds only); use preset:walk, reserving preset:biped:* for explicit v1.0 rigs. Retopology v3.0 with smart_uv and standalone tripo_smart_uv are separate workflows, not interchangeable free export switches. Load the capability reference before running either. chat_image_1 is retired; never fall back to it. chat_image_1.5 remains usable where supported before 2026-12-01; never silently replace a user-selected paid image model. fast textures require texture model v3.5: pass the short name v3.5, or omit the version and the tool picks it.
`;

const CHINA_TIME_ZONES = new Set(["Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing", "Asia/Chungking", "Asia/Harbin", "Asia/Kashgar", "PRC"]);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const regionHint = timeZone
  ? `Region hint: the system time zone is ${timeZone}, which suggests ${CHINA_TIME_ZONES.has(timeZone) ? "the China site (tripo)" : "the international site (tripo-global)"}. Use it only to phrase the question in rule 4; never choose a server for the user on this guess.\n`
  : "";

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
    hookSpecificOutput: { hookEventName: eventName, additionalContext: RULES + regionHint },
  }),
);
