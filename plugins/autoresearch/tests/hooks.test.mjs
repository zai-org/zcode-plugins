// Hook contract tests: pipe stdin JSON, assert stdout JSON / exit codes.
// These protect the hook runner path (not exercised by headless CLI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOKS = join(ROOT, "hooks");

function runHook(name, cwd, stdin) {
  const out = execFileSync("node", [join(HOOKS, name), cwd], {
    input: stdin,
    encoding: "utf8",
  });
  return out;
}

function tempCwd() {
  return mkdtempSync(join(tmpdir(), "ar-hook-"));
}

function seedLedger(cwd, entries) {
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "log.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

const cfgLine = {
  type: "config",
  segment: 1,
  name: "s",
  metricName: "m",
  direction: "lower",
};

test("guard-frozen denies writes to frozen scripts, allows others", () => {
  const cwd = tempCwd();
  const deny = runHook(
    "guard-frozen.mjs",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(cwd, ".auto/measure.sh") },
    }),
  );
  const d = JSON.parse(deny);
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /frozen/);

  const allow = runHook(
    "guard-frozen.mjs",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, "solution.js") },
    }),
  );
  assert.equal(allow, "");
});

test("memory-inject injects ledger progress when runs exist, silent otherwise", () => {
  const cwd = tempCwd();
  // no ledger -> no output
  assert.equal(
    runHook(
      "memory-inject.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "x" }),
    ),
    "",
  );

  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 10,
      description: "b",
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "keep",
      metric: 8,
      description: "impr",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "memory-inject.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /baseline=10/);
  assert.match(out.hookSpecificOutput.additionalContext, /best=8/);
});

test("memory-inject aggregates tried directions and trajectory", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 100,
      description: "try sqrt cutoff",
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "keep",
      metric: 50,
      description: "try eratosthenes sieve",
    },
    {
      type: "run",
      run: 3,
      segment: 1,
      status: "discard",
      metric: 60,
      description: "try sqrt cutoff variant",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "memory-inject.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /已尝试方向：/);
  assert.match(ctx, /best 轨迹：100 → 50/);
  // the deduped directions line lists "sqrt cutoff" only once
  const dirLine = ctx.split("\n").find((l) => l.startsWith("已尝试方向"));
  assert.equal((dirLine.match(/sqrt cutoff/g) || []).length, 1);
});

test("memory-inject warns on doom loop", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 5,
      description: "sieve approach",
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "keep",
      metric: 5,
      description: "bitpacking",
    },
    {
      type: "run",
      run: 3,
      segment: 1,
      status: "keep",
      metric: 5,
      description: "sieve approach v2",
    },
    {
      type: "run",
      run: 4,
      segment: 1,
      status: "keep",
      metric: 5,
      description: "bitpacking v2",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "memory-inject.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /震荡/);
});

test("stop-continue blocks while the loop is unfinished, with progress", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 10,
      description: "b",
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "discard",
      metric: 12,
      description: "worse",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "stop-continue.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "Stop" }),
    ),
  );
  assert.equal(out.decision, "block");
  assert.match(out.reason, /实验循环未结束/);
  assert.match(out.reason, /baseline=10/);
});

test("stop-continue reports plateau convergence", () => {
  const cwd = tempCwd();
  const flat = [cfgLine];
  for (let i = 1; i <= 5; i++)
    flat.push({
      type: "run",
      run: i,
      segment: 1,
      status: "keep",
      metric: 42,
      description: `flat ${i}`,
    });
  seedLedger(cwd, flat);
  const out = JSON.parse(
    runHook(
      "stop-continue.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "Stop" }),
    ),
  );
  assert.equal(out.decision, "block");
  assert.match(out.reason, /平台期/);
});

test("session-start announces an existing session", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [cfgLine]);
  const out = JSON.parse(
    runHook(
      "session-start.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    ),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /autoresearch 会话/);
});

test("session-start respects autoresearchOff decision", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [cfgLine]);
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ autoresearchOff: true }),
  );
  assert.equal(
    runHook(
      "session-start.mjs",
      cwd,
      JSON.stringify({ hook_event_name: "SessionStart" }),
    ),
    "",
  );
});

test("permission-gate denies experiment tools without a session, allows with one", () => {
  const cwd = tempCwd();
  // no session → deny init_experiment
  const deny = JSON.parse(
    runHook(
      "permission-gate.mjs",
      cwd,
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        tool_name: "run_experiment",
      }),
    ),
  );
  assert.equal(deny.hookSpecificOutput.decision.behavior, "deny");
  assert.match(deny.hookSpecificOutput.decision.message, /没有实验会话/);
  // non-experiment tool → silent
  assert.equal(
    runHook(
      "permission-gate.mjs",
      cwd,
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
      }),
    ),
    "",
  );
  // with a session → allow (silent)
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 1,
      description: "b",
    },
  ]);
  assert.equal(
    runHook(
      "permission-gate.mjs",
      cwd,
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        tool_name: "log_experiment",
      }),
    ),
    "",
  );
});
