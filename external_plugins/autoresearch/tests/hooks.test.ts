// Hook contract tests: pipe stdin JSON, assert stdout JSON / exit codes.
// These protect the hook runner path (not exercised by headless CLI).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LedgerConfig, LedgerEntry, LedgerRun } from "../mcp/lib/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOKS = join(ROOT, "hooks");

function runHook(name: string, cwd: string, stdin: string): string {
  const out = execFileSync("node", [join(HOOKS, name), cwd], {
    input: stdin,
    encoding: "utf8",
  });
  return out;
}

/** Same as runHook but returns stderr (the Stop hook's advisory channel). */
function runHookStderr(name: string, cwd: string, stdin: string): string {
  const r = spawnSync("node", [join(HOOKS, name), cwd], {
    input: stdin,
    encoding: "utf8",
  });
  return r.stderr ?? "";
}

// Temp cwds are removed once at file end (node:test after).
const tempRoots: string[] = [];
after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "ar-hook-"));
  tempRoots.push(dir);
  return dir;
}

function seedLedger(cwd: string, entries: LedgerEntry[]): void {
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "log.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

const cfgLine: LedgerConfig = {
  type: "config",
  segment: 1,
  name: "s",
  metricName: "m",
  direction: "lower",
};

test("guard-frozen denies rewrites of existing frozen scripts, allows others", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "measure.sh"), "#!/usr/bin/env bash\n");
  const deny = runHook(
    "guard-frozen.ts",
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
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, "solution.js") },
    }),
  );
  assert.equal(allow, "");
});

// Regression (evidence 2026-11-04): ApplyPatch payloads carry only patch_text
// (no file_path/path), so the guard found no target and exited 0 — the whole
// patch tool bypassed freeze protection despite being in the matcher. Targets
// are now parsed from the `*** <op> File:` / `*** Move to:` header lines.
test("guard-frozen denies ApplyPatch rewrites of frozen files via patch_text", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "goal.md"), "original goal\n");
  writeFileSync(join(cwd, "code.py"), "x = 1\n");

  const patch = [
    "*** Begin Patch",
    "*** Update File: code.py",
    "@@",
    "-x = 1",
    "+x = 2",
    "*** Update File: .auto/goal.md",
    "@@",
    "-original goal",
    "+moved goalpost",
    "*** End Patch",
  ].join("\n");
  const deny = runHook(
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "ApplyPatch",
      tool_input: { patch_text: patch },
    }),
  );
  const d = JSON.parse(deny);
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /goal\.md/);
  // the denied attempt is a fact: frozen_attempt lands in the ledger
  const ledger = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8");
  assert.match(ledger, /frozen_attempt/);
  assert.match(ledger, /goal\.md/);

  // a patch touching only non-frozen files passes, with no ledger row
  const benign = [
    "*** Begin Patch",
    "*** Update File: code.py",
    "@@",
    "-x = 1",
    "+x = 2",
    "*** End Patch",
  ].join("\n");
  assert.equal(
    runHook(
      "guard-frozen.ts",
      cwd,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "ApplyPatch",
        tool_input: { patch_text: benign },
      }),
    ),
    "",
  );

  // first creation through a patch is allowed (setup semantics unchanged)
  const add = [
    "*** Begin Patch",
    "*** Add File: .auto/scope.md",
    "+scope boundary",
    "*** End Patch",
  ].join("\n");
  assert.equal(
    runHook(
      "guard-frozen.ts",
      cwd,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "ApplyPatch",
        tool_input: { patch_text: add },
      }),
    ),
    "",
  );
});

// Frozen means "immutable once recorded", not "never written": setup creates
// the goal/scope/script files before any segment exists. The regression this
// pins: the guard used to deny even that first creation (deny-on-absent),
// contradicting setup-guide's Write instructions with a deny reason that
// spoke of a record that did not exist yet.
test("guard-frozen allows first creation of frozen files, denies rewrites", () => {
  const cwd = tempCwd();
  for (const target of [
    ".auto/measure.sh",
    ".auto/checks.sh",
    ".auto/goal.md",
    ".auto/scope.md",
  ]) {
    const allow = runHook(
      "guard-frozen.ts",
      cwd,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(cwd, target) },
      }),
    );
    assert.equal(allow, "", `${target} creation must pass the guard`);
  }

  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "goal.md"), "user goal\n");
  const deny = runHook(
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(cwd, ".auto/goal.md") },
    }),
  );
  const d = JSON.parse(deny);
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /deep goal/);
});

test("guard-frozen denies deep-goal edits, allows charter and ideas", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "goal.md"), "user goal\n");
  writeFileSync(join(cwd, ".auto", "scope.md"), "# Files in scope\n");
  const goal = runHook(
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, ".auto/goal.md") },
    }),
  );
  const g = JSON.parse(goal);
  assert.equal(g.hookSpecificOutput.permissionDecision, "deny");
  assert.match(g.hookSpecificOutput.permissionDecisionReason, /deep goal/);

  const scope = runHook(
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, ".auto/scope.md") },
    }),
  );
  const s = JSON.parse(scope);
  assert.equal(s.hookSpecificOutput.permissionDecision, "deny");
  assert.match(s.hookSpecificOutput.permissionDecisionReason, /scope boundary/);

  for (const editable of [".auto/prompt.md", ".auto/ideas.md"]) {
    const allow = runHook(
      "guard-frozen.ts",
      cwd,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: join(cwd, editable) },
      }),
    );
    assert.equal(allow, "", `${editable} must stay editable`);
  }
});

test("memory-inject injects ledger progress when runs exist, silent otherwise", () => {
  const cwd = tempCwd();
  // no ledger -> no output
  assert.equal(
    runHook(
      "memory-inject.ts",
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
      "memory-inject.ts",
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
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /已尝试方向：/);
  assert.match(ctx, /best 轨迹：100 → 50/);
  // the deduped directions line lists "sqrt cutoff" only once
  const dirLine = ctx
    .split("\n")
    .find((l: string) => l.startsWith("已尝试方向"));
  assert.equal((dirLine.match(/sqrt cutoff/g) || []).length, 1);
});

// Cap-reached gating: the memory inject must hand the loop's closing states
// the same verdict the server and the Stop hook already use — a finished
// segment gets closing guidance, never a continuation nudge. Without this
// gate a post-cap prompt (worst: right after a compaction, when this inject
// is the agent's main anchor) actively pushes a new run the server will
// refuse at the cap (evidence: bank-seg2 15/15 ledger, 2026-11-13).
function capFixture(n: number): LedgerRun[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "run" as const,
    run: i + 1,
    segment: 1,
    status: (i + 1) % 3 === 0 ? "keep" : "discard",
    metric: 10 - Math.floor(i / 3) * 0.5,
    description: `run ${i + 1}`,
  }));
}

function seedCapLedger(cwd: string, runs: number, maxIterations: number): void {
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ maxIterations }),
  );
  seedLedger(cwd, [cfgLine, ...capFixture(runs)]);
}

function memoryInjectContext(cwd: string): string {
  return JSON.parse(
    runHook(
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "x" }),
    ),
  ).hookSpecificOutput.additionalContext as string;
}

test("memory-inject: cap reached gets closing guidance, not a continuation nudge", () => {
  const cwd = tempCwd();
  seedCapLedger(cwd, 15, 15);
  const ctx = memoryInjectContext(cwd);
  assert.match(ctx, /已跑 15\/15/);
  assert.match(ctx, /迭代上限已到（15\/15）/);
  assert.match(ctx, /init_experiment/);
  assert.doesNotMatch(ctx, /请基于上述进度选择下一个假设/);
});

test("memory-inject: below the cap keeps the continuation nudge", () => {
  const cwd = tempCwd();
  seedCapLedger(cwd, 13, 15);
  const ctx = memoryInjectContext(cwd);
  assert.match(ctx, /已跑 13\/15/);
  assert.match(ctx, /请基于上述进度选择下一个假设并继续 run_experiment/);
  assert.doesNotMatch(ctx, /迭代上限已到/);
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
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /震荡/);
});

const discardLine = (ctx: string): string | undefined =>
  ctx.split("\n").find((l: string) => l.startsWith("弃用方向与理由"));

test("memory-inject injects discard reasons from outside the 3-run window", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "discard",
      metric: 60,
      description: "parallel build",
      asi: { rollback: "CPU 已满载" },
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "keep",
      metric: 50,
      description: "improvement two",
    },
    {
      type: "run",
      run: 3,
      segment: 1,
      status: "keep",
      metric: 48,
      description: "improvement three",
    },
    {
      type: "run",
      run: 4,
      segment: 1,
      status: "keep",
      metric: 47,
      description: "improvement four",
    },
    {
      type: "run",
      run: 5,
      segment: 1,
      status: "keep",
      metric: 46,
      description: "improvement five",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  const ctx = out.hookSpecificOutput.additionalContext;
  const line = discardLine(ctx);
  assert.ok(line, "discard-reasons line injected");
  assert.match(line, /#1 CPU 已满载/);
});

test("memory-inject truncates discard reasons and caps the list at 8", () => {
  const cwd = tempCwd();
  const entries: LedgerEntry[] = [cfgLine];
  for (let i = 1; i <= 10; i++) {
    entries.push({
      type: "run",
      run: i,
      segment: 1,
      status: "discard",
      metric: 60 + i,
      description: `direction number ${i}`,
      asi: { rollback: i === 5 ? "a".repeat(130) : `reason ${i}` },
    } as LedgerRun);
  }
  seedLedger(cwd, entries);
  const out = JSON.parse(
    runHook(
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  const line = discardLine(out.hookSpecificOutput.additionalContext);
  assert.ok(line, "discard-reasons line injected");
  // a 130-char reason is cut to 120 chars plus an ellipsis (2026-11-02
  // 校准：60 → 120 换回完整结论；70 字符以内的理由不再被拦腰)
  assert.match(line, /#5 a{120}…/);
  assert.doesNotMatch(line, /a{121}/);
  // the window keeps only the last 8 qualifying rows (#3..#10)
  const items = line!
    .replace(/^弃用方向与理由：/, "")
    .replace(/。$/, "")
    .split("；");
  assert.equal(items.length, 8);
  assert.ok(items[0].startsWith("#3 "));
  assert.ok(items[items.length - 1].startsWith("#10 "));
});

test("memory-inject omits the discard-reason line when nothing qualifies", () => {
  const cwd = tempCwd();
  // keeps plus a reason-less discard → no line
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 10,
      description: "baseline keep",
    },
    {
      type: "run",
      run: 2,
      segment: 1,
      status: "discard",
      metric: 12,
      description: "worse without a reason",
    },
  ]);
  const out = JSON.parse(
    runHook(
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(discardLine(ctx), undefined);
  assert.match(ctx, /已尝试方向：/, "other injection content unaffected");
  // a discard from an earlier segment does not leak into the current one
  const cwd2 = tempCwd();
  seedLedger(cwd2, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "discard",
      metric: 12,
      description: "old segment",
      asi: { rollback: "old reason" },
    },
    {
      type: "config",
      segment: 2,
      name: "s2",
      metricName: "m",
      direction: "lower",
    },
    {
      type: "run",
      run: 1,
      segment: 2,
      status: "keep",
      metric: 10,
      description: "new segment baseline",
    },
  ]);
  const out2 = JSON.parse(
    runHook(
      "memory-inject.ts",
      cwd2,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
  );
  assert.equal(
    discardLine(out2.hookSpecificOutput.additionalContext),
    undefined,
  );
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
      "stop-continue.ts",
      cwd,
      JSON.stringify({ hook_event_name: "Stop" }),
    ),
  );
  assert.equal(out.decision, "block");
  assert.match(out.reason, /实验循环未结束/);
  assert.match(out.reason, /baseline=10/);
  // Unattended nudge (add-cron-chained-continuation task 3): conditional
  // advisory sentence rides along in the block reason; no state, no branching.
  assert.match(out.reason, /unattended 规程/);
  assert.match(out.reason, /CronCreate/);
});

test("stop-continue allows the stop on plateau convergence (spec: 放行)", () => {
  const cwd = tempCwd();
  const flat: LedgerEntry[] = [cfgLine];
  for (let i = 1; i <= 5; i++)
    flat.push({
      type: "run",
      run: i,
      segment: 1,
      status: "keep",
      metric: 42,
      description: `flat ${i}`,
    } as LedgerRun);
  seedLedger(cwd, flat);
  // plateau → the hook must NOT block; advisory goes to stderr, stdout empty
  assert.equal(
    runHook(
      "stop-continue.ts",
      cwd,
      JSON.stringify({ hook_event_name: "Stop" }),
    ),
    "",
  );
});

test("stop-continue plateau advisory follows the calibrated threshold", () => {
  const cwd = tempCwd();
  const flat: LedgerEntry[] = [cfgLine];
  for (let i = 1; i <= 5; i++)
    flat.push({
      type: "run",
      run: i,
      segment: 1,
      status: "keep",
      metric: 42,
      description: `flat ${i}`,
    } as LedgerRun);
  seedLedger(cwd, flat);
  // 0.02% threshold + deterministic bench: the advisory carries the
  // calibrated numbers and drops the repeat suggestion (2026-11-02 校准)
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ plateauMinImprovement: 0.0002, deterministic: true }),
  );
  const stderr = runHookStderr(
    "stop-continue.ts",
    cwd,
    JSON.stringify({ hook_event_name: "Stop" }),
  );
  assert.match(stderr, /最近 5 轮改善 < 0\.02%/);
  assert.doesNotMatch(stderr, /repeat:3/);
});

test("session-start announces an existing session", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [cfgLine]);
  const out = JSON.parse(
    runHook(
      "session-start.ts",
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
      "session-start.ts",
      cwd,
      JSON.stringify({ hook_event_name: "SessionStart" }),
    ),
    "",
  );
});

test("stop-continue and memory-inject respect autoresearchOff", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    cfgLine,
    {
      type: "run",
      run: 1,
      segment: 1,
      status: "keep",
      metric: 10,
      description: "baseline",
      commit: "abc1234",
    },
  ]);
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ autoresearchOff: true }),
  );

  // Without the flag, stop-continue would block (loop unfinished) and
  // memory-inject would emit the ledger summary. Both must stay silent.
  assert.equal(runHook("stop-continue.ts", cwd, JSON.stringify({})), "");
  assert.equal(
    runHook(
      "memory-inject.ts",
      cwd,
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "go" }),
    ),
    "",
  );
});

test("session-start respects autoresearchOff set in the project config under workingDir", () => {
  const project = tempCwd();
  mkdirSync(join(project, ".auto"), { recursive: true });
  mkdirSync(join(project, "work", ".auto"), { recursive: true });
  // the ledger lives in the research dir; the off switch in the project config
  writeFileSync(
    join(project, ".auto", "config.json"),
    JSON.stringify({ workingDir: "work", autoresearchOff: true }),
  );
  writeFileSync(
    join(project, "work", ".auto", "log.jsonl"),
    JSON.stringify(cfgLine) + "\n",
  );
  assert.equal(
    runHook(
      "session-start.ts",
      project,
      JSON.stringify({ hook_event_name: "SessionStart" }),
    ),
    "",
  );
  // without the off switch the resume hint comes back
  writeFileSync(
    join(project, ".auto", "config.json"),
    JSON.stringify({ workingDir: "work" }),
  );
  const out = JSON.parse(
    runHook(
      "session-start.ts",
      project,
      JSON.stringify({ hook_event_name: "SessionStart" }),
    ),
  );
  assert.match(out.hookSpecificOutput.additionalContext, /autoresearch 会话/);
});

// The tests above spawn hook scripts directly by path, so a renamed script
// would stay green here while the installed plugin silently loses the hook:
// nothing else checks hooks.json (local suite, upstream validate.py, upstream
// artifact tests all skip it). Assert every plugin-root reference in the
// manifest resolves to a real file.
test("hooks.json references point to existing files", () => {
  const manifest = JSON.parse(
    readFileSync(join(HOOKS, "hooks.json"), "utf8"),
  ) as unknown;
  const refs = new Set<string>();
  const REF = /\$\{ZCODE_PLUGIN_ROOT\}\/([^\s"'`]+)/g;
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(REF)) refs.add(match[1]);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(manifest);
  assert.ok(
    refs.size > 0,
    "no ZCODE_PLUGIN_ROOT references found in hooks.json; the scan itself broke",
  );
  for (const ref of refs) {
    assert.ok(
      existsSync(join(ROOT, ref)),
      `hooks.json references missing file: ${ref}`,
    );
  }
});

// The attempt itself is a fact: a denied rewrite of a frozen record must
// reach the ledger (goalpost-moving shows up in the archive), while the
// first-creation path — an allow — must not leave rows.
test("guard-frozen records a frozen_attempt row on deny, nothing on allow", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "goal.md"), "user goal\n");
  const deny = runHook(
    "guard-frozen.ts",
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(cwd, ".auto/goal.md") },
    }),
  );
  const d = JSON.parse(deny);
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    d.hookSpecificOutput.permissionDecisionReason,
    /recorded to the ledger/,
  );
  const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const attempts = rows.filter((r) => r.type === "frozen_attempt");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].file, ".auto/goal.md");
  assert.equal(attempts[0].tool, "Edit");

  // First creation (allow path) must not create a ledger, let alone rows.
  const fresh = tempCwd();
  runHook(
    "guard-frozen.ts",
    fresh,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(fresh, ".auto/goal.md") },
    }),
  );
  assert.equal(existsSync(join(fresh, ".auto", "log.jsonl")), false);
});
