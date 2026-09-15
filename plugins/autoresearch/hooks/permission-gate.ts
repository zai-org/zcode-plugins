#!/usr/bin/env node
// PermissionRequest hook: approximate tool gate (pi-gap M3, #1).
// When the workspace has no active experiment session (.auto/log.jsonl), deny
// permission prompts for the experiment tools so the loop cannot be started by
// accident. With a session, allow. This is an approximation — calls that are
// auto-approved never reach PermissionRequest; tool-internal checks and the
// skill remain the backstop.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";

interface PermissionRequestInput {
  tool_name?: string;
  toolName?: string;
}

const projectCwd = process.argv[2] || process.cwd();
const cwd = resolveWorkCwd(projectCwd);
const EXPERIMENT_TOOLS = new Set([
  "init_experiment",
  "run_experiment",
  "log_experiment",
  "export_dashboard",
  "clear_experiments",
]);

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin as AsyncIterable<string>) raw += chunk;

let input: PermissionRequestInput = {};
try {
  input = raw.trim() ? (JSON.parse(raw) as PermissionRequestInput) : {};
} catch {
  process.exit(0); // fail open
}

const tool = input.tool_name || input.toolName || "";
if (!EXPERIMENT_TOOLS.has(tool)) process.exit(0);

const hasSession = existsSync(join(cwd, ".auto", "log.jsonl"));
if (hasSession) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message: `[autoresearch] 当前工作区没有实验会话（.auto/log.jsonl 不存在），${tool} 已被拦截。请先通过 /autoresearch:autoresearch 建立会话。`,
      },
    },
  }),
);
