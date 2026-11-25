#!/usr/bin/env node
/**
 * Stop hook: show the session statistics card after each completed turn.
 *
 * The hook only injects a continuation context; the assistant then prints the
 * precomputed card verbatim. This costs one extra short model request per turn.
 *
 * Opt out:
 *   - set SESSION_STATS_AUTO_DISABLED=1
 *   - create <project>/.zcode/session-stats.auto-off
 *   - create <plugin data dir>/auto-display.disabled
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const input = readInput();
if (!input) process.exit(0);
if (input.stop_hook_active === true) process.exit(0);

const sessionId = String(input.session_id || "").trim();
if (!sessionId || sessionId.startsWith("sess_subagent_")) process.exit(0);
if (isDisabled(input)) process.exit(0);

const lastMessage = String(input.last_assistant_message || "").trim();
if (!lastMessage) process.exit(0);
const cardMarkers = ["📊 单轮统计卡", "📊 会话统计", "⏱ 单轮统计卡", "⏱ 会话统计"];
if (cardMarkers.some((marker) => lastMessage.includes(marker))) process.exit(0);

const script = fileURLToPath(new URL("../skills/turn-lens/scripts/session-stats.mjs", import.meta.url));
const result = spawnSync(process.execPath, [script, "--session", sessionId, "--auto"], {
  encoding: "utf8",
  timeout: 20000,
  windowsHide: true,
});
if (result.status !== 0 || !result.stdout) process.exit(0);

const card = result.stdout.trim();
if (!card.includes("单轮统计卡")) process.exit(0);

const additionalContext = [
  "用户开启了“单轮统计卡”。",
  "请把下面这张 Markdown 卡片作为本轮最终回复原样输出：不要调用工具，不要添加解释，不要放在代码块里，不要改写数字。",
  "",
  card,
].join("\n");

process.stdout.write(
  JSON.stringify({
    continue: true,
    reason: "Auto session stats",
    additionalContext,
  }),
);

function readInput() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isDisabled(input) {
  const flag = String(process.env.SESSION_STATS_AUTO_DISABLED || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) return true;

  // The panel writes one workspace-independent preference so a session whose
  // cwd is a subdirectory (or a different workspace) still sees the switch.
  const globalPreference = readGlobalPreference();
  if (globalPreference === false) return true;
  if (globalPreference === true) return false;

  const dataDir = process.env.ZCODE_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || "";
  if (dataDir && existsSync(path.join(dataDir, "auto-display.disabled"))) return true;

  const projectDir = input.cwd || process.env.ZCODE_PROJECT_DIR || process.cwd();
  const candidates = new Set(
    [projectDir, process.env.ZCODE_PROJECT_DIR, process.env.ZCODE_WORKSPACE_ROOT, process.cwd()].filter(
      Boolean,
    ),
  );
  return [...candidates].some(hasWorkspaceMarker);
}

function readGlobalPreference() {
  const file = path.join(homedir(), ".zcode", "cli", "plugins", "data", "turn-lens", "auto-display.json");
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    return typeof state.enabled === "boolean" ? state.enabled : null;
  } catch {
    return null;
  }
}

function hasWorkspaceMarker(dir) {
  let current = path.resolve(dir);
  while (true) {
    if (existsSync(path.join(current, ".zcode", "session-stats.auto-off"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
