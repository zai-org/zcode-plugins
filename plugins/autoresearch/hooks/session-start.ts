#!/usr/bin/env node
// SessionStart hook: point the model at an existing autoresearch session
// (auto-activation prompt). Respects an explicit `autoresearchOff: true`
// decision in .auto/config.json — after /autoresearch:off no resume hint is
// injected, though the session can still be entered manually.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";

const cwd = resolveWorkCwd(process.argv[2] || process.cwd());
const log = join(cwd, ".auto", "log.jsonl");
if (!existsSync(log)) process.exit(0);

let off = false;
try {
  const cfg = JSON.parse(
    readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
  ) as { autoresearchOff?: unknown };
  off = cfg.autoresearchOff === true;
} catch {
  /* no config → treat as active */
}

if (off) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        `本工作区存在 autoresearch 会话（.auto/log.jsonl）。` +
        `可用 /autoresearch:autoresearch 继续循环，或 /autoresearch:export 导出 dashboard；` +
        `暂停可用 /autoresearch:off，重置可用 /autoresearch:clear。`,
    },
  }),
);
