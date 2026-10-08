#!/usr/bin/env node
// SessionStart hook: inject the Tripo hard rules as additionalContext.
// Reads one JSON event from stdin, writes one JSON object to stdout.
// Keep this text in sync with skills/tripo-3d/SKILL.md.

const RULES = `Tripo 3D — rules that apply whenever Tripo tools (tripo_*) are used. These hold even when the tripo-3d skill was not loaded; load it for the full workflow.
1. Generation is asynchronous. Every tripo_* generation or processing tool returns a task_id immediately. Call tripo_task_wait with it and keep calling while status is queued/running — each call returns within about 55 seconds, a generation usually takes 1–4 minutes. Never present a result before status is success, and never treat a task_id as a finished model.
2. Show the result, then the link. On success, embed preview_image_url as a markdown image and give model_url as the download link. Both URLs expire in about 5 minutes: never re-print an old one — call tripo_task_status for fresh links. If you saved the file locally, give its path as plain text in backticks, never as a clickable link (chat previews cannot render meshes).
3. Credits belong to the user. Call tripo_plan and get confirmation before any billed generation or chain. Every billed tool reports credits_consumed. Check tripo_balance and confirm before generating more than one asset in a batch; on insufficient balance give the returned plans_url instead of retrying. Never silently re-roll a disappointing result — show the preview and ask first.
4. Authorization is a browser flow, never a pasted key. This build's MCP is China-mainland only (developers.tripo3d.com/mcp); the auth page has no region picker. If Tripo tools are missing or a call reports an authorization error, tell the user to open ZCode 设置 → MCP, find the Tripo server under「Plugin MCP 服务器」and click「打开授权」, then sign in on the 国内站 console and Authorize. An overseas-site account needs the overseas plugin build or CLI login --region ov. Do not ask for an API key in the chat, and do not run tripo-cli instead just because a local login or TRIPO_API_KEY exists — offer the CLI only as an explicit alternative and use it only if the user picks it.
5. Failures are reported, not hidden. On failed/banned, relay failure_reason (and error_code) honestly; failed-task credits are refunded automatically. Never invent parameters — the tool schemas are authoritative. There is no tripo_stylize on MCP (use CLI --then stylize); use tripo_mesh_edit for P2 regional redo.`;

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
