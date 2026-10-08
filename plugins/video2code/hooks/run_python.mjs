#!/usr/bin/env node
/** Run a plugin Python entrypoint with platform-appropriate interpreter names. */

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

const childEnv = { ...process.env };
if (childEnv.PYTHONUTF8 === undefined) childEnv.PYTHONUTF8 = "1";
if (childEnv.PYTHONIOENCODING === undefined) childEnv.PYTHONIOENCODING = "utf-8";

for (const [command, prefixArgs] of candidates) {
  const probe = spawnSync(
    command,
    [
      ...prefixArgs,
      "-c",
      "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)",
    ],
    { env: childEnv, stdio: "ignore" },
  );

  if (probe.error?.code === "ENOENT") continue;
  if (probe.error || probe.status !== 0) continue;

  const result = spawnSync(command, [...prefixArgs, script, ...scriptArgs], {
    env: childEnv,
    stdio: "inherit",
  });

  if (result.error) {
    process.stderr.write(`[video2code] failed to start ${command}: ${result.error}\n`);
    process.exit(1);
  }
  if (result.signal) {
    process.stderr.write(`[video2code] ${command} exited via ${result.signal}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

process.stderr.write(
  "[video2code] No compatible Python interpreter was found; install Python 3.10+ and retry.\n",
);
process.exit(127);
