#!/usr/bin/env node
/**
 * Run a plugin Python entrypoint with the interpreter names used by each OS.
 *
 * Python's Windows launcher is preferred there because the official installer
 * does not create a `python3` command. The first interpreter that exists is
 * used; a real script failure is returned unchanged instead of being retried
 * with another interpreter.
 */

import { spawnSync } from "node:child_process";

const [script, ...scriptArgs] = process.argv.slice(2);

if (!script) {
  process.stderr.write("Usage: run_python.mjs <script> [...args]\n");
  process.exit(2);
}

const candidates =
  process.platform === "win32"
    ? [
        ["py", ["-3"]],
        ["python", []],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

for (const [command, prefixArgs] of candidates) {
  let result;
  try {
    result = spawnSync(command, [...prefixArgs, script, ...scriptArgs], {
      env: process.env,
      stdio: "inherit",
    });
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    process.stderr.write(`[video-agent-kit] failed to start ${command}: ${error}\n`);
    process.exit(1);
  }

  if (result.error?.code === "ENOENT") continue;
  if (result.error) {
    process.stderr.write(`[video-agent-kit] failed to start ${command}: ${result.error}\n`);
    process.exit(1);
  }

  if (result.signal) {
    process.stderr.write(`[video-agent-kit] ${command} exited via ${result.signal}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

process.stderr.write(
  "[video-agent-kit] Python 3.10+ was not found; install Python and retry.\n",
);
process.exit(127);
