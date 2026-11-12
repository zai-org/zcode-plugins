// MCP integration tests: spawn the real server and drive the tools over JSON-RPC.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = join(ROOT, "mcp", "server.ts");

// Temp roots are registered here and removed once at file end (node:test
// after): withServer-internal cleanup would break the restart-survival tests
// that run two servers against the same cwd.
const tempRoots: string[] = [];
after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

interface JsonRpcResponse {
  id?: number;
  result?: { content?: Array<{ type?: string; text?: string }> };
  error?: { code: number; message: string };
}

interface McpClient {
  call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse>;
  tool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function tempRepo(
  opts: {
    withMeasure?: boolean;
    withAuto?: boolean;
    commit?: boolean;
    name?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "ar-mcp-"));
  tempRoots.push(root);
  // Nested name lets a test put the repo behind a hostile path segment.
  const cwd = opts.name ? join(root, opts.name) : root;
  mkdirSync(cwd, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  // Developers on Windows often have core.autocrlf=true globally; checkout
  // during rollback would then rewrite LF fixtures to CRLF and break asserts.
  execFileSync("git", ["config", "core.autocrlf", "false"], {
    cwd,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "t@t"], {
    cwd,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
  if (opts.withAuto !== false) {
    mkdirSync(join(cwd, ".auto"), { recursive: true });
    if (opts.withMeasure !== false) {
      writeFileSync(
        join(cwd, ".auto", "measure.sh"),
        '#!/usr/bin/env bash\necho "METRIC time_ms=42"\n',
      );
    }
  }
  writeFileSync(join(cwd, "code.js"), "v1\n");
  if (opts.commit !== false) {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "init"], { cwd, stdio: "ignore" });
  }
  return cwd;
}

// chmod(1) is not on PATH on Windows runners; fs.chmodSync sets the POSIX exec
// bit where it exists and is a harmless mode write where it does not.
function makeExecutable(...files: string[]) {
  for (const file of files) chmodSync(file, 0o755);
}

// Controllable benchmark: prints time_ms from .auto/metric.txt (default 42)
// so tests craft metric chains through the real run→log observation binding
// instead of transcription (which the binding gate now rejects).
function useControlledMeasure(cwd: string) {
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=$(cat .auto/metric.txt 2>/dev/null || echo 42)"\n',
  );
}
function setMetricValue(cwd: string, v: number) {
  writeFileSync(join(cwd, ".auto", "metric.txt"), `${v}\n`);
}
function setMemoryValue(cwd: string, v: number) {
  writeFileSync(join(cwd, ".auto", "memory.txt"), `${v}\n`);
}
function runBenchmark(s: McpClient) {
  return s.tool("run_experiment", { command: "bash .auto/measure.sh" });
}

function connect(cwd: string, env?: NodeJS.ProcessEnv): McpClient {
  // env: optional override for tests that need a curated server environment
  // (e.g. a PATH without bash to reach the spawnError branch). undefined
  // inherits the test process env.
  const proc = spawn(process.execPath, [SERVER], { cwd, env });
  let id = 0;
  let buf = "";
  const pending = new Map<number, (msg: JsonRpcResponse) => void>();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m: JsonRpcResponse = JSON.parse(line);
        const mid = m.id;
        if (mid != null && pending.has(mid)) {
          const cb = pending.get(mid);
          if (cb) {
            cb(m);
            pending.delete(mid);
          }
        }
      } catch {}
    }
  });
  const call = (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse> =>
    new Promise((res, rej) => {
      const i = id++;
      // Deadline: a hung server (the bug class the kill paths guard against)
      // must fail this test with a diagnostic, not stall the suite until the
      // CI job timeout. Slow-but-legit calls pass a larger timeoutMs.
      const timer = setTimeout(() => {
        pending.delete(i);
        rej(
          new Error(
            `${method} call hung >${timeoutMs}ms — server unresponsive or tool never settles`,
          ),
        );
      }, timeoutMs);
      pending.set(i, (m) => {
        clearTimeout(timer);
        res(m);
      });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
      );
    });
  const tool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const m = await call("tools/call", { name, arguments: args });
    return JSON.parse(m.result?.content?.[0]?.text ?? "{}") as Record<
      string,
      unknown
    >;
  };
  // The child's CWD is the temp repo; until the process fully exits, Windows
  // keeps that directory locked and rmSync(cwd) fails with EPERM.
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      proc.once("exit", () => resolve());
      proc.kill();
    });
  return { call, tool, close };
}

async function withServer(
  cwd: string,
  fn: (s: McpClient) => Promise<unknown>,
  env?: NodeJS.ProcessEnv,
): Promise<unknown> {
  const s = connect(cwd, env);
  await s.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
  });
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

test("run_experiment: command omitted defaults to the frozen benchmark", async () => {
  // 2026-11-05: after the freeze .auto/measure.sh is the only legal value, so
  // demanding the command again is pure friction — agents hit the required-
  // field error on first call (observed in the ml-auto dota2-wave1 session).
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {});
    assert.equal(run.ok, true);
    assert.equal(run.metric, 42);
  });
});

test("run_experiment: command still required in free-form mode (no measure.sh)", async () => {
  const cwd = tempRepo({ withMeasure: false });
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {});
    assert.equal(run.ok, false);
    assert.match(String(run.error), /command is required/);
  });
});

test("init_experiment declares .zcode in .git/info/exclude", async () => {
  // 2026-11-05: untracked host session files otherwise reach add -A / status /
  // clean -fd; the local-exclude declaration makes git itself exempt them.
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(init.ok, true);
  });
  const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
  assert.ok(exclude.split(/\r?\n/).includes(".zcode"));
});

test("init_experiment warns when the working tree starts dirty", async () => {
  // 2026-11-11: a discard reverts the whole tree, and work already uncommitted
  // at session start is indistinguishable from experiment changes later —
  // init is the only observable moment to warn before it can be disposed of.
  const cwd = tempRepo();
  writeFileSync(join(cwd, "uncommitted.txt"), "user work\n");
  await withServer(cwd, async (s) => {
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(init.ok, true);
    const message = String(init.message ?? "");
    assert.match(message, /working tree is dirty/);
    assert.match(message, /uncommitted\.txt/);
    assert.match(message, /unrecoverable/);
  });
});

test("init_experiment on a clean tree carries no dirty warning", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(init.ok, true);
    assert.doesNotMatch(String(init.message ?? ""), /working tree is dirty/);
  });
});

test("init_experiment writes config atomically (valid JSON, no temp residue)", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
  });
  const cfg = JSON.parse(
    readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
  );
  assert.ok(cfg.benchmarkHashes);
  assert.ok(!existsSync(join(cwd, ".auto", "config.json.tmp")));
});

test("iteration hooks: before runs before benchmark, after after logging, steer returned", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    '#!/usr/bin/env bash\ncat > /dev/null\necho "BEFORE-STEER"\n',
  );
  writeFileSync(
    join(cwd, ".auto", "hooks", "after.sh"),
    '#!/usr/bin/env bash\necho "AFTER-STEER"\n',
  );
  makeExecutable(
    join(cwd, ".auto", "hooks", "before.sh"),
    join(cwd, ".auto", "hooks", "after.sh"),
  );

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.before_steer, "BEFORE-STEER");
    assert.equal(run.metric, 42);
    appendFileSync(join(cwd, "code.js"), "// change\n");
    const log = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    assert.equal(log.after_steer, "AFTER-STEER");
  });
});

test("iteration hooks: failing hook surfaces an error steer but never blocks the loop", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    '#!/usr/bin/env bash\ncat > /dev/null\necho "hook exploded" >&2\nexit 3\n',
  );
  makeExecutable(join(cwd, ".auto", "hooks", "before.sh"));

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.ok, true);
    assert.equal(run.metric, 42);
    assert.match(String(run.before_steer), /^\[before hook exited 3\]/);
    assert.match(String(run.before_steer), /hook exploded/);
  });
});

test("iteration hooks: payload carries asi (last_run and run_entry)", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  // before hook echoes the previous run's asi.hypothesis (node, no jq)
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    '#!/usr/bin/env bash\nnode -e \'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));if(p.last_run&&p.last_run.asi)console.log("hyp:"+p.last_run.asi.hypothesis)\'\n',
  );
  writeFileSync(
    join(cwd, ".auto", "hooks", "after.sh"),
    '#!/usr/bin/env bash\nnode -e \'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));if(p.run_entry&&p.run_entry.asi)console.log("next:"+p.run_entry.asi.next_action_hint)\'\n',
  );
  makeExecutable(
    join(cwd, ".auto", "hooks", "before.sh"),
    join(cwd, ".auto", "hooks", "after.sh"),
  );

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    // first run: no asi anywhere yet — hooks stay silent (last_run null)
    appendFileSync(join(cwd, "code.js"), "// c1\n");
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
      asi: {
        hypothesis: "cache the sort key",
        next_action_hint: "try memoize",
      },
    });
    // second run: last_run now carries asi → before hook must see it
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.before_steer, "hyp:cache the sort key");
    const log = await s.tool("log_experiment", {
      status: "noop",
      metric: 42,
      description: "second",
      asi: { hypothesis: "h2", next_action_hint: "try lazy init" },
    });
    assert.equal(log.after_steer, "next:try lazy init");
  });
});

test("iteration hooks: session payload carries the session name as goal (pi contract)", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  // pi's shipped example hooks read .session.goal (qmd-search, external-search);
  // mirror one to prove the field survives the payload on zcode too.
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    '#!/usr/bin/env bash\nnode -e \'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("goal:"+p.session.goal)\'\n',
  );
  makeExecutable(join(cwd, ".auto", "hooks", "before.sh"));

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", {
      name: "optimize sort speed",
      metric_name: "time_ms",
    });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.before_steer, "goal:optimize sort speed");
  });
});

test("iteration hooks: every fire appends a type:hook ledger entry", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    "#!/usr/bin/env bash\ncat > /dev/null\nexit 2\n",
  );
  makeExecutable(join(cwd, ".auto", "hooks", "before.sh"));

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    appendFileSync(join(cwd, "code.js"), "// change\n");
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    const raw = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8");
    const entries = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const hooks = entries.filter((e) => e.type === "hook");
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].stage, "before");
    assert.equal(hooks[0].exit_code, 2);
    assert.equal(typeof hooks[0].duration_ms, "number");
    assert.equal(hooks[0].timed_out, false);
    // ledger stays replayable: rebuildState is unaffected by hook entries
    const run2 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run2.ok, true);
    const log2 = await s.tool("log_experiment", {
      status: "discard",
      metric: 42,
      description: "y",
    });
    assert.equal(log2.ok, true);
  });
});

test("clear_experiments deletes ledger but keeps other .auto files", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    assert.ok(existsSync(join(cwd, ".auto", "log.jsonl")));
    const res = await s.tool("clear_experiments", {});
    assert.equal(res.ok, true);
    assert.ok(!existsSync(join(cwd, ".auto", "log.jsonl")));
    assert.ok(existsSync(join(cwd, ".auto", "measure.sh")), "measure.sh kept");
  });
});

test("consecutive failure threshold is honored in next_action_hint", async () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ consecutiveFailures: 1 }),
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const log = await s.tool("log_experiment", {
      status: "discard",
      metric: 42,
      description: "worse",
    });
    assert.match(String(log.next_action_hint), /consecutive failures reached/);
    // Spec (guardrails): the returned streak count shares the rebuildState
    // semantics — same source as the hint text, not a second computation.
    assert.equal(log.consecutive_failures, 1);
  });
});

test("benchmark drift: changing measure.sh after init warns on next run", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // no drift yet
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r1.benchmark_drift, undefined);
    // modify the frozen benchmark
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      '#!/usr/bin/env bash\necho "METRIC time_ms=1"\n',
    );
    const r2 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r2.benchmark_drift, true);
    assert.match(String(r2.warning), /no longer comparable/);
  });
});

test("secondary metric constraints: keep rejected when a constraint is exceeded", async () => {
  const cwd = tempRepo();
  // measure.sh emits a primary + a secondary metric, both file-controlled so
  // each log is attested by a real observation (binding gate)
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=$(cat .auto/metric.txt 2>/dev/null || echo 42)"\necho "METRIC memory_mb=$(cat .auto/memory.txt 2>/dev/null || echo 100)"\n',
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // first run establishes the ledger (baseline; no constraints yet)
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal((r1.metrics as Record<string, number>).memory_mb, 100);
    appendFileSync(join(cwd, "code.js"), "// base\n");
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
      metrics: { time_ms: 42, memory_mb: 100 },
    });
    // constraint within band → keep passes (vs baseline memory_mb=100)
    setMetricValue(cwd, 41);
    setMemoryValue(cwd, 100);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c2\n");
    const ok = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "within band",
      metrics: { time_ms: 41, memory_mb: 100 },
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.constraints, [
      { name: "memory_mb", status: "pass", value: 100, limit: 105 },
    ]);
    // now a keep that blows the constraint → rejected (before any git op,
    // so the change stays in the working tree for the next keep)
    setMetricValue(cwd, 40);
    setMemoryValue(cwd, 110);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c3\n");
    const bad = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "faster but heavier",
      metrics: { time_ms: 40, memory_mb: 110 },
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(bad.ok, false);
    assert.match(
      String(bad.error),
      /constraint violation: secondary metric memory_mb=110/,
    );
    // no constraints → no secondary check
    setMetricValue(cwd, 39);
    setMemoryValue(cwd, 999);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c4\n");
    const free = await s.tool("log_experiment", {
      status: "keep",
      metric: 39,
      description: "no constraints declared",
      metrics: { time_ms: 39, memory_mb: 999 },
    });
    assert.equal(free.ok, true);
    assert.equal(free.constraints, undefined);
  });
});

test("secondary transcription: metrics dict must match the observed aggregation", async () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=$(cat .auto/metric.txt 2>/dev/null || echo 42)"\necho "METRIC memory_mb=$(cat .auto/memory.txt 2>/dev/null || echo 100)"\n',
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// base\n");
    // diverging value → rejected with the observed value named
    const diverged = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "diverging dict",
      metrics: { time_ms: 42, memory_mb: 88 },
    });
    assert.equal(diverged.ok, false);
    assert.match(String(diverged.error), /do not match the aggregation/);
    assert.match(String(diverged.error), /100/);
    // unknown key → rejected, available names listed
    const unknown = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "unknown key",
      metrics: { gpu_ms: 5 },
    });
    assert.equal(unknown.ok, false);
    assert.match(String(unknown.error), /available: time_ms, memory_mb/);
    // full transcription → passes
    const ok = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
      metrics: { time_ms: 42, memory_mb: 100 },
    });
    assert.equal(ok.ok, true);
    // omitting metrics is legal, and the row still records the observation
    setMetricValue(cwd, 41);
    setMemoryValue(cwd, 99);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c2\n");
    const omitted = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "no metrics param",
    });
    assert.equal(omitted.ok, true);
    const lines = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .trim()
      .split("\n");
    const row = JSON.parse(lines[lines.length - 1]) as {
      metrics: Record<string, number>;
    };
    assert.deepEqual(row.metrics, { time_ms: 41, memory_mb: 99 });

    // omitting metrics cannot dodge a violated constraint: the gate reads
    // the observed aggregation
    setMetricValue(cwd, 40);
    setMemoryValue(cwd, 999);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c3\n");
    const bypass = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "omit metrics to dodge the constraint",
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(bypass.ok, false);
    assert.match(
      String(bypass.error),
      /constraint violation: secondary metric memory_mb=999/,
    );

    // malformed constraint entries are rejected loudly, not silently dropped
    const malformed = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "malformed constraints",
      constraints: [{ name: "memory_mb" }, { maxPct: 10 }],
    });
    assert.equal(malformed.ok, false);
    assert.match(String(malformed.error), /malformed constraint entry/);
  });
});

test("invalid AR_BENCHMARK_TIMEOUT_MS falls back to the default with a diagnostic", async () => {
  const cwd = tempRepo();
  // -1 would pass the legacy `||` chain and SIGTERM every run in 1ms; the
  // guard falls back to the default 600s instead.
  await withServer(
    cwd,
    async (s) => {
      await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
      const r = await s.tool("run_experiment", {
        command: "bash .auto/measure.sh",
      });
      assert.equal(r.ok, true);
      assert.equal(r.metric, 42);
      assert.equal(r.timed_out, false);
    },
    { ...process.env, AR_BENCHMARK_TIMEOUT_MS: "-1" },
  );
});

test("unparseable JSON-RPC frame gets a -32700 response", async () => {
  const cwd = tempRepo();
  const proc = spawn(process.execPath, [SERVER], { cwd });
  proc.stdout.setEncoding("utf8");
  const firstLine = new Promise<string>((resolve) =>
    proc.stdout.once("data", (d: string) => resolve(d.split("\n")[0])),
  );
  proc.stdin.write("this is not json\n");
  const line = await firstLine;
  const msg = JSON.parse(line) as JsonRpcResponse & {
    error?: { code: number; message: string };
  };
  assert.equal(msg.id, null);
  assert.equal(msg.error?.code, -32700);
  proc.kill();
});

test("clear_experiments tolerates a corrupt config.json", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    writeFileSync(join(cwd, ".auto", "config.json"), "{corrupt");
    const r = await s.tool("clear_experiments", {});
    assert.equal(r.ok, true);
    assert.ok(!existsSync(join(cwd, ".auto", "log.jsonl")));
  });
});

test("keep with failing ledger append undoes the orphan commit", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// change\n");
    // Make the ledger unwritable: the append (second half of the keep's
    // two-step write) fails with EACCES after the commit succeeded. On
    // Windows chmod maps the write bits to the read-only attribute, which
    // makes appendFileSync fail the same way.
    const logPath = join(cwd, ".auto", "log.jsonl");
    chmodSync(logPath, 0o444);
    const preHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    const r = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "orphan guard",
    });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /commit undone/);
    // branch back at the pre-keep HEAD; the change is back in the tree, uncommitted
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    assert.equal(head, preHead);
    assert.equal(readFileSync(join(cwd, "code.js"), "utf8"), "v1\n// change\n");
    // fix the filesystem issue and retry: the observation is still pending,
    // so the retry looks exactly like the first attempt
    chmodSync(logPath, 0o644);
    const retry = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "orphan guard retry",
    });
    assert.equal(retry.ok, true);
    const files = execFileSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd, encoding: "utf8" },
    ).trim();
    assert.ok(files.includes("code.js"));
  });
});

test("a failed pending-state reset does not unseat the logged row", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// change\n");
    // Occupy the atomic-write temp path AFTER run_experiment persisted its
    // snapshot: the ledger append succeeds (plain append to an existing
    // file needs no directory write), but the pending-state clear fails —
    // the atomic config write must create .auto/config.json.tmp before the
    // rename, and creating a file where a directory stands fails on every
    // platform. 2026-11-11: the previous injection chmod'ed the .auto
    // directory read-only, which only works on POSIX — the windows CI
    // runner ignores the read-only attribute for file creation inside a
    // directory, so the reset silently succeeded there and the warning
    // never fired.
    // The row must stand (ok:true + warning) — returning an error here would
    // invite a retry that the still-pending observation would attest, i.e. a
    // duplicate run row the audit cannot catch.
    mkdirSync(join(cwd, ".auto", "config.json.tmp"));
    const r = await s.tool("log_experiment", {
      status: "discard",
      metric: 42,
      description: "pending reset failure",
    });
    assert.equal(r.ok, true);
    assert.match(String(r.pending_reset_warning), /do not log again/);
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.includes('"type":"run"')).length;
    assert.equal(rows, 1);
  });
});

test("checks gate: keep rejected after failed checks, allowed again after a passing run", async () => {
  const cwd = tempRepo();
  // checks fail while code.js contains "broken"
  writeFileSync(
    join(cwd, ".auto", "checks.sh"),
    "#!/usr/bin/env bash\n! grep -q broken code.js\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    appendFileSync(join(cwd, "code.js"), "// broken\n");
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal((r1.checks as Record<string, unknown>).failed, true);
    // dishonest keep of the checks-failed run → rejected (guardrail live)
    const bad = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "keep despite failed checks",
    });
    assert.equal(bad.ok, false);
    assert.match(String(bad.error), /correctness checks/);
    // honest checks_failed → logged with checksFailed: true, tree rolled back
    const cf = await s.tool("log_experiment", {
      status: "checks_failed",
      metric: 42,
      description: "honest checks_failed row",
    });
    assert.equal(cf.ok, true);
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const cfRow = rows.find(
      (r) => r.type === "run" && r.status === "checks_failed",
    );
    assert.equal(cfRow.checksFailed, true);
    assert.ok(
      !readFileSync(join(cwd, "code.js"), "utf8").includes("broken"),
      "checks_failed rolls back the broken change",
    );
    // fix the code, rerun (checks pass) → keep allowed (no one-way latch)
    appendFileSync(join(cwd, "code.js"), "// fixed\n");
    const r2 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal((r2.checks as Record<string, unknown>).failed, false);
    const good = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "keep after checks pass",
    });
    assert.equal(good.ok, true);
    assert.equal(typeof good.commit, "string");
  });
});

test("checks gate: a checks script that never produced a verdict does not block keeps", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  // exit 127 = the gate never ran (interpreter missing / script not found).
  // Evidence 2026-10-28: a WSL-alias bash turned every checks invocation into
  // 127, and the old rule read that as "checks failed" — vetoing every keep.
  writeFileSync(
    join(cwd, ".auto", "checks.sh"),
    "#!/usr/bin/env bash\nexit 127\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    appendFileSync(join(cwd, "code.js"), "// change\n");
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    const checks = r1.checks as Record<string, unknown>;
    assert.equal(checks.verdict, false);
    assert.equal(checks.failed, false);
    // keep goes through: infra must not veto, the ledger carries the outcome
    const keep = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "kept despite checks infra (no verdict)",
    });
    assert.equal(keep.ok, true);
    // contrast: a real verdict (exit 1) still vetoes keeps
    writeFileSync(
      join(cwd, ".auto", "checks.sh"),
      "#!/usr/bin/env bash\nexit 1\n",
    );
    setMetricValue(cwd, 43);
    const r2 = await runBenchmark(s);
    const checks2 = r2.checks as Record<string, unknown>;
    assert.equal(checks2.verdict, true);
    assert.equal(checks2.failed, true);
    const bad = await s.tool("log_experiment", {
      status: "keep",
      metric: 43,
      description: "keep despite failed checks",
    });
    assert.equal(bad.ok, false);
    assert.match(String(bad.error), /correctness checks/);
  });
});

test("checks: a project path containing a single quote still runs checks.sh", async () => {
  const cwd = tempRepo({ name: "project's dir" });
  writeFileSync(
    join(cwd, ".auto", "checks.sh"),
    "#!/usr/bin/env bash\necho RAN > checks-ran\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    const checks = run.checks as Record<string, unknown>;
    assert.equal(checks.ran, true);
    assert.equal(checks.failed, false);
    assert.equal(checks.exit_code, 0);
    assert.equal(existsSync(join(cwd, "checks-ran")), true);
  });
});

test("benchmark drift: measure.sh created mid-session is recorded, then modification warns", async () => {
  const cwd = tempRepo({ withMeasure: false });
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // first sighting: create the benchmark mid-session → recorded, no warning
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      '#!/usr/bin/env bash\necho "METRIC time_ms=42"\n',
    );
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r1.metric, 42);
    assert.equal(r1.benchmark_drift, undefined);
    const cfg = JSON.parse(
      readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
    );
    assert.equal(typeof cfg.benchmarkHashes?.measure, "string");
    // silently changing the now-recorded benchmark → drift warning
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      '#!/usr/bin/env bash\necho "METRIC time_ms=1"\n',
    );
    const r2 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r2.benchmark_drift, true);
    assert.match(String(r2.warning), /no longer comparable/);
  });
});

test("benchmark drift: deleting a frozen file warns", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r1.benchmark_drift, undefined);
    rmSync(join(cwd, ".auto", "measure.sh"));
    const r2 = await s.tool("run_experiment", {
      command: 'echo "METRIC time_ms=0"',
    });
    assert.equal(r2.benchmark_drift, true);
    assert.match(String(r2.warning), /no longer comparable/);
  });
});

test("keep commit excludes .auto; keep with only session changes is rejected", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    // no code change: only .auto/ has drifted → keep must hit the no-changes audit
    const noopKeep = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "nothing changed",
    });
    assert.equal(noopKeep.ok, false);
    assert.match(String(noopKeep.error), /no changes to commit/);
    // a real change keeps, and the commit carries no .auto files
    appendFileSync(join(cwd, "code.js"), "// change\n");
    const keep = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "real change",
    });
    assert.equal(keep.ok, true);
    const files = execFileSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd, encoding: "utf8" },
    ).trim();
    assert.ok(files.includes("code.js"));
    assert.ok(
      !files.split("\n").some((f) => f.startsWith(".auto/") || f === ".auto"),
      `keep commit must not contain .auto files, got: ${files}`,
    );
  });
});

test("timeout escalates to SIGKILL when the benchmark ignores SIGTERM", async () => {
  const cwd = tempRepo({ withMeasure: false });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\ntrap '' TERM\necho stuck >&2\nsleep 39\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const t0 = Date.now();
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
      timeout_seconds: 1,
    });
    const waited = Date.now() - t0;
    assert.equal(r.timed_out, true);
    // SIGTERM at 1s + 5s grace -> SIGKILL; must return long before sleep 39 ends
    assert.ok(waited < 15_000, `tool call took ${waited}ms`);
  });
  await new Promise((r) => setTimeout(r, 300));
  let stray = "";
  try {
    stray = execFileSync("pgrep", ["-fl", "sleep 39"], { encoding: "utf8" });
  } catch {
    /* pgrep exits 1 when nothing matches — the expected case */
  }
  assert.equal(stray, "", "no stray benchmark process survives");
});

test(
  "run settles when the exited benchmark leaves a detached pipe holder",
  {
    skip:
      process.platform === "win32"
        ? "POSIX pipe semantics; win32 holder/kill covered in win32-kill.test.ts"
        : false,
  },
  async () => {
    // "close" waits for stdio to drain; a detached descendant (own process
    // group, invisible to the group kill) holding the pipes used to hang the
    // tool call forever after the benchmark itself had exited.
    const cwd = tempRepo({ withMeasure: false });
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      String.raw`#!/usr/bin/env bash
node -e 'require("child_process").spawn("sleep",["321"],{detached:true,stdio:"inherit"}).unref()'
echo "METRIC time_ms=42"
`,
    );
    try {
      await withServer(cwd, async (s) => {
        await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
        const t0 = Date.now();
        const r = await s.tool("run_experiment", {
          command: "bash .auto/measure.sh",
        });
        const waited = Date.now() - t0;
        assert.equal(r.exit_code, 0);
        assert.equal(r.timed_out, false);
        assert.equal(r.metric, 42);
        // KILL_GRACE_MS fallback after exit — must not wait out sleep 321 (5+ min)
        assert.ok(waited < 20_000, `tool call took ${waited}ms`);
      });
    } finally {
      // the holder is expected to outlive the run (nothing killed it) — clean up
      try {
        execFileSync("pkill", ["-f", "sleep 321"], { stdio: "ignore" });
      } catch {
        /* pkill exits 1 when nothing matches — fine */
      }
    }
  },
);

test(
  "spawn failure resets pendingChecksFailed alongside the observation",
  {
    skip:
      process.platform === "win32"
        ? "POSIX PATH lookup of bash; git-only PATH via symlink shim"
        : false,
  },
  async () => {
    const cwd = tempRepo();
    // A PATH with git but no bash: the server itself runs on process.execPath,
    // init works, and the benchmark spawn of bash fails with ENOENT — the
    // exact "bash missing" case the spawnError branch exists for.
    const shims = mkdtempSync(join(tmpdir(), "ar-shims-"));
    symlinkSync(
      execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
      join(shims, "git"),
    );
    try {
      await withServer(
        cwd,
        async (s) => {
          await s.tool("init_experiment", {
            name: "t",
            metric_name: "time_ms",
          });
          // Stale verdict seeded as if a previous run had failed checks.
          const cfgPath = join(cwd, ".auto", "config.json");
          const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<
            string,
            unknown
          >;
          cfg.pendingChecksFailed = true;
          writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

          const r = await s.tool("run_experiment", {
            command: "bash .auto/measure.sh",
          });
          assert.equal(r.ok, false);
          assert.match(String(r.error), /could not start the benchmark/);
          const after = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<
            string,
            unknown
          >;
          assert.equal(after.pendingChecksFailed, false);
          const obs = after.pendingObservation as Record<string, unknown>;
          assert.ok(obs, "observation snapshot persisted");
          assert.equal(obs.metric, null);
          // A checks_failed entry is unreachable after a spawn-failed run
          // (metric binding requires the finite observed value first); the
          // reset above is defense-in-depth — the stale verdict must not
          // survive into a state where it could ever attest this run.
        },
        { ...process.env, PATH: shims },
      );
    } finally {
      rmSync(shims, { recursive: true, force: true });
    }
  },
);

test("overflowed output still yields the metric (spill: METRIC at end)", async () => {
  const cwd = tempRepo({ withMeasure: false });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    String.raw`#!/usr/bin/env bash
node -e 'process.stdout.write("x".repeat(3000000)+"\n")'
echo "METRIC time_ms=42"
`,
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.metric, 42);
    assert.ok(r.log_file, "spill log file returned");
    assert.ok(
      String(r.output_tail ?? "").length > 0,
      "output_tail non-empty after spill",
    );
  });
});

test("overflowed output still yields the metric (spill: METRIC at start)", async () => {
  const cwd = tempRepo({ withMeasure: false });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    String.raw`#!/usr/bin/env bash
echo "METRIC time_ms=42"
node -e 'process.stdout.write("x".repeat(3000000)+"\n")'
`,
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.metric, 42);
    assert.ok(r.log_file, "spill log file returned");
  });
});

test("overflowed output: indented METRIC lines parse like the non-spill path", async () => {
  // parseMetricLines trims each line, so "  METRIC x=1" parses in a small
  // output; the spill-path collector must trim too, or a >2MB output would
  // silently lose a primary metric the small output kept.
  const cwd = tempRepo({ withMeasure: false });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    String.raw`#!/usr/bin/env bash
node -e 'process.stdout.write("x".repeat(3000000)+"\n")'
echo "  METRIC time_ms=42"
`,
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.metric, 42, "indented METRIC line lost on the spill path");
    assert.ok(r.log_file, "spill log file returned");
  });
});

test("crash gate fails closed when git status is unreadable", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // a crash that measured nothing: benchmark exits non-zero, no METRIC
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      "#!/usr/bin/env bash\nexit 3\n",
    );
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const log = await s.tool("log_experiment", {
      status: "crash",
      description: "broken",
    });
    assert.equal(log.ok, true);
    // break git: the crash+dirty audit gate must refuse to run on an
    // unknown tree instead of swallowing the status error into "clean"
    rmSync(join(cwd, ".git"), { recursive: true });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /cannot verify working-tree state/);
  });
});

test("repeat>1 aggregates metrics to per-name medians", async () => {
  const cwd = tempRepo({ withMeasure: false });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\nn=$(cat .auto/rep 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .auto/rep\necho "METRIC time_ms=$((40+n))"\necho "METRIC rss_mb=$((100+10*n))"\n',
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
      repeat: 3,
    });
    assert.equal(r.median_metric, 42); // 41/42/43
    assert.deepEqual(r.metrics, { time_ms: 42, rss_mb: 120 }); // 110/120/130
  });
});

test("crash rows record metric null and do not pollute the baseline", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // a benchmark that fails without emitting METRIC lines attests the crash
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      "#!/usr/bin/env bash\nexit 1\n",
    );
    await runBenchmark(s);
    await s.tool("log_experiment", { status: "crash", description: "boom" });
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const crashRow = rows.find((r) => r.type === "run" && r.status === "crash");
    assert.equal(crashRow?.metric, null); // not the 0 placeholder
    // metric chains now go through real observations
    useControlledMeasure(cwd);
    setMetricValue(cwd, 50);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v2\n");
    const keep1 = await s.tool("log_experiment", {
      status: "keep",
      metric: 50,
      description: "first real keep",
    });
    assert.equal(keep1.baseline, 50); // crash's null did not seed baseline 0
    setMetricValue(cwd, 42);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v3\n");
    const keep2 = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "improve",
    });
    assert.equal(keep2.delta, 8); // 42 vs baseline 50, lower=better -> +8 (was reversed before)
    // Regression (bank-seg2, 2026-11-13): a candidate between the baseline and
    // the current best used to report a POSITIVE delta (anchored to the
    // baseline) — the loop's decision gate is the retained value, so the
    // headline number inverted the verdict. Delta anchors to the pre-log
    // retained line: 45 is worse than best 42 by 3 (lower=better) even though
    // it still beats baseline 50.
    setMetricValue(cwd, 45);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v4\n");
    const regress = await s.tool("log_experiment", {
      status: "discard",
      metric: 45,
      description: "between baseline and best",
    });
    assert.equal(regress.delta, -3); // 45 vs retained 42, lower=better -> -3 (was +5 vs baseline)
  });
});

test("init_experiment rejects a non-git research directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "ar-nogit-"));
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  await withServer(cwd, async (s) => {
    const r = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /git/);
  });
  assert.equal(existsSync(join(cwd, ".auto", "log.jsonl")), false);
});

test("logging a crash does not block the next run via .auto dirtiness", async () => {
  const cwd = tempRepo();
  // failing benchmark (no METRIC output) so the crash is attested
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", { status: "crash", description: "boom" });
    // the crash row itself dirtied .auto/log.jsonl — that must not block
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.ok, true);
    // a real (non-.auto) change still trips the crash-unresolved gate
    appendFileSync(join(cwd, "code.js"), "// dirty\n");
    const blocked = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(blocked.ok, false);
    assert.match(String(blocked.error), /crash/);
  });
});

// Regression (evidence 2026-11-04): the crash+dirty-tree gate read the
// segment-scoped lastRun, which a config row resets — so init_experiment
// laundered the gate and the next segment's first keep would `git add -A`
// the crash residue into the "experiment" commit. The gate now reads the
// ledger-wide last run (lastRunEver): a dirty tree is physical state.
test("re-init does not launder the crash+dirty-tree audit gate", async () => {
  const cwd = tempRepo();
  // failing benchmark (no METRIC output) so the crash is attested
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", { status: "crash", description: "boom" });
    appendFileSync(join(cwd, "code.js"), "// dirty\n");
    const blocked = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(blocked.ok, false);
    // opening a new segment must NOT clear the gate
    const reinit = await s.tool("init_experiment", {
      name: "t2",
      metric_name: "time_ms",
    });
    assert.equal(reinit.ok, true);
    const stillBlocked = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(stillBlocked.ok, false);
    assert.match(String(stillBlocked.error), /unrolled-back/);
    // rolling the tree back clears it (discard semantics unchanged)
    execFileSync("git", ["checkout", "--", "."], { cwd, stdio: "ignore" });
    const clear = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(clear.ok, true);
  });
});

// Regression (evidence 2026-11-04): a benchmark that exited non-zero skipped
// checks.sh and left pendingChecksFailed=false with zero signal in the
// response — the keep gate stood open for a failed run, silently. The failure
// is now surfaced (advisory: the keep-gate policy itself is unchanged).
test("benchmark failure surfaces benchmark_warning, checks skip is not silent", async () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=42"\nexit 1\n',
  );
  writeFileSync(
    join(cwd, ".auto", "checks.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.ok, true);
    assert.match(String(r.benchmark_warning), /non-zero or timed out/);
    assert.match(String(r.benchmark_warning), /checks\.sh was NOT executed/);
    assert.deepEqual(r.checks, { ran: false });
  });
});

test("repeat is coerced to an integer; passing runs carry no benchmark_warning", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
      repeat: 2.7,
    });
    assert.equal(r.ok, true);
    assert.equal(r.repeat, 2, "fractional repeat ran 3 times but reported 2.7");
    assert.equal((r.runs as unknown[]).length, 2);
    assert.equal(r.benchmark_warning, undefined);
  });
});

test("initialize reports the plugin.json version (no hardcoded third copy)", async () => {
  const cwd = tempRepo();
  const s = connect(cwd);
  try {
    const resp = await s.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
    });
    const manifest = JSON.parse(
      readFileSync(join(ROOT, ".zcode-plugin", "plugin.json"), "utf8"),
    ) as { version: string };
    const serverInfo = (
      resp.result as unknown as {
        serverInfo?: { name?: string; version?: string };
      }
    )?.serverInfo;
    assert.equal(serverInfo?.name, "autoresearch");
    assert.equal(serverInfo?.version, manifest.version);
  } finally {
    await s.close();
  }
});

test("revisit_nudge: fires when a discard/checks_failed lands and a reasoned discard exists in the segment", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    // no discard rows yet → field omitted entirely
    appendFileSync(join(cwd, "code.js"), "// v2\n");
    const keep1 = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
    });
    assert.equal(keep1.ok, true);
    assert.equal(keep1.revisit_nudge, undefined);
    // a discard without a rollback reason is nothing to revisit
    setMetricValue(cwd, 43);
    await runBenchmark(s);
    const disc1 = await s.tool("log_experiment", {
      status: "discard",
      metric: 43,
      description: "worse, no reason given",
    });
    assert.equal(disc1.ok, true);
    assert.equal(disc1.revisit_nudge, undefined);
    // the decision moment: a reasoned discard fires the nudge on its own
    // landing (no waiting for the next log)
    setMetricValue(cwd, 44);
    await runBenchmark(s);
    const disc2 = await s.tool("log_experiment", {
      status: "discard",
      metric: 44,
      description: "worse again",
      asi: { hypothesis: "h", rollback: "CPU saturated" },
    });
    assert.equal(disc2.ok, true);
    assert.equal(typeof disc2.revisit_nudge, "string");
    assert.match(
      String(disc2.revisit_nudge),
      /invalidates a previous discard's rollback reason/,
    );
    assert.match(String(disc2.revisit_nudge), /asi\.revisits_run/);
    // keep landings are not the decision moment — the nudge is omitted even
    // when a reasoned discard exists (standing visibility is the memory
    // inject's discard-reasons line)
    setMetricValue(cwd, 41);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v3\n");
    const keep2 = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "improvement",
    });
    assert.equal(keep2.ok, true);
    assert.equal(keep2.revisit_nudge, undefined);
    // existing contract fields are untouched by the extra field
    assert.equal(keep2.logged, true);
    assert.equal(keep2.status, "keep");
    assert.equal(keep2.metric, 41);
    assert.equal(typeof keep2.next_action_hint, "string");
    assert.ok(keep2.confidence, "confidence still returned");
    // a new segment resets the trigger: the old discard must not carry over
    await s.tool("init_experiment", { name: "t2", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v4\n");
    const keep3 = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "new segment",
    });
    assert.equal(keep3.ok, true);
    assert.equal(keep3.revisit_nudge, undefined);
  });
});

test("plateau calibration: config threshold and deterministic flag shape detection and hint", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  await withServer(cwd, async (s) => {
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
      plateau_min_improvement: 0.0002,
      deterministic: true,
    });
    assert.equal(init.ok, true);
    assert.deepEqual(init.calibration, {
      plateau_min_improvement: 0.0002,
      deterministic: true,
    });
    // five near-flat runs: best improvement vs the window's first run is
    // ~0.2% — above the calibrated 0.02% (a plateau at the default 1%).
    // noop rows between discards keep the failure streak below the gate.
    const metrics = [50.1, 50, 50.05, 50, 50.02];
    const words = ["alpha", "beta", "gamma", "delta", "epsilon"];
    let last: Record<string, unknown> = {};
    for (let i = 0; i < metrics.length; i++) {
      setMetricValue(cwd, metrics[i]);
      await runBenchmark(s);
      last = await s.tool("log_experiment", {
        status: i % 2 === 0 ? "discard" : "noop",
        metric: metrics[i],
        description: `flat ${words[i]}`,
      });
      assert.equal(last.ok, true);
      assert.equal(last.runs_left, 20 - (i + 1)); // effective default cap 20
    }
    assert.equal(last.plateau, false); // 0.2% ≥ 0.02%: not a plateau
    setMetricValue(cwd, 50.03);
    await runBenchmark(s);
    // the window turns flat (best 50 = first 50) → plateau fires, but the
    // wording carries the calibrated 0.02% and no repeat suggestion
    const sixth = await s.tool("log_experiment", {
      status: "noop",
      metric: 50.03,
      description: "flat zeta",
    });
    assert.equal(sixth.plateau, true);
    assert.match(
      String(sixth.next_action_hint),
      /last 5 runs improved < 0\.02%/,
    );
    assert.doesNotMatch(String(sixth.next_action_hint), /repeat:3/);
    // a re-init without calibration params keeps the stored value
    const reinit = await s.tool("init_experiment", {
      name: "t2",
      metric_name: "time_ms",
    });
    assert.equal(reinit.ok, true);
    const cfg = readFileSync(join(cwd, ".auto", "config.json"), "utf8");
    assert.match(cfg, /"plateauMinImprovement":\s*0\.0002/);
  });
});

test("default plateau wording and the deterministic repeat-suggestion drop", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  setMetricValue(cwd, 50);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
      deterministic: true,
    });
    // flat window: improvement 0% → plateau under any threshold
    const metrics = [50, 50, 50, 50, 50];
    const words = ["alpha", "beta", "gamma", "delta", "epsilon"];
    let last: Record<string, unknown> = {};
    for (let i = 0; i < metrics.length; i++) {
      await runBenchmark(s);
      last = await s.tool("log_experiment", {
        status: i % 2 === 0 ? "discard" : "noop",
        metric: metrics[i],
        description: `flat ${words[i]}`,
      });
    }
    assert.equal(last.plateau, true);
    assert.match(String(last.next_action_hint), /last 5 runs improved < 1%/);
    assert.doesNotMatch(String(last.next_action_hint), /repeat:3/);
  });
});

test("rolled_back: a discard reports the disposal list and the restored HEAD", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  setMetricValue(cwd, 55);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v2\n");
    writeFileSync(join(cwd, "scratch.txt"), "junk\n");
    const d = await s.tool("log_experiment", {
      status: "discard",
      metric: 55,
      description: "worse",
    });
    assert.equal(d.ok, true);
    const rb = d.rolled_back as {
      restored_to: string;
      files: string[];
      total_files: number;
    };
    assert.match(String(rb.restored_to), /^[0-9a-f]{7}$/);
    assert.equal(rb.total_files, 2);
    assert.equal(rb.files.length, 2);
    assert.equal(existsSync(join(cwd, "scratch.txt")), false);
    assert.equal(readFileSync(join(cwd, "code.js"), "utf8"), "v1\n");
    // keep and noop do not report it
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    appendFileSync(join(cwd, "code.js"), "// v3\n");
    const k = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "better",
    });
    assert.equal(k.rolled_back, undefined);
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const n = await s.tool("log_experiment", {
      status: "noop",
      description: "verify",
    });
    assert.equal(n.rolled_back, undefined);
  });
});

test("runs_left counts down and the near-cap hint fires with one or two runs left", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ maxIterations: 5 }),
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    useControlledMeasure(cwd);
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      setMetricValue(cwd, 50 + i);
      await runBenchmark(s);
      last = await s.tool("log_experiment", {
        status: "discard",
        metric: 50 + i,
        description: `d${i}`,
      });
      assert.equal(last.runs_left, 5 - (i + 1));
    }
    // 4th log: one run left → the hint plans the closing experiment
    assert.match(
      String(last.next_action_hint),
      /approaching iteration cap \(4\/5\); 1 run\(s\) left/,
    );
    // 5th log hits the cap → the cap message takes over
    setMetricValue(cwd, 54);
    await runBenchmark(s);
    const fifth = await s.tool("log_experiment", {
      status: "discard",
      metric: 54,
      description: "d4",
    });
    assert.equal(fifth.runs_left, 0);
    assert.match(String(fifth.next_action_hint), /iteration cap reached/);
  });
});

test("asi.revisits_run passes through to ledger and after hook, unvalidated", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "hooks", "after.sh"),
    '#!/usr/bin/env bash\nnode -e \'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));if(p.run_entry&&p.run_entry.asi)console.log("revisits:"+p.run_entry.asi.revisits_run)\'\n',
  );
  makeExecutable(join(cwd, ".auto", "hooks", "after.sh"));
  const runRows = () =>
    readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((r) => r.type === "run");
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    appendFileSync(join(cwd, "code.js"), "// c\n");
    const log = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "retry the parallel build",
      asi: {
        revisits_run: 7,
        hypothesis: "cache warmed, retry parallel build",
      },
    });
    assert.equal(log.ok, true);
    assert.equal(runRows()[0]?.asi?.revisits_run, 7);
    assert.equal(log.after_steer, "revisits:7");
    // advisory passthrough: a dangling run number is recorded, not rejected
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const log2 = await s.tool("log_experiment", {
      status: "noop",
      metric: 42,
      description: "dangling revisits_run",
      asi: { revisits_run: 999 },
    });
    assert.equal(log2.ok, true);
    assert.equal(runRows()[1]?.asi?.revisits_run, 999);
  });
});

test("asi.infra passes through to the ledger unvalidated (infra crash)", async () => {
  const cwd = tempRepo();
  // failing benchmark (no METRIC output) so the crash is attested
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const log = await s.tool("log_experiment", {
      status: "crash",
      description: "network outage during dependency fetch",
      asi: { hypothesis: "parallel build", infra: true },
    });
    assert.equal(log.ok, true);
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((r) => r.type === "run");
    assert.equal(rows[0]?.asi?.infra, true);
  });
});

test("confidence snapshot: ledger row matches the returned value, crash row safe", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v2\n");
    const k1 = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
    });
    // too little data to judge: no returned confidence and no snapshot
    assert.equal(k1.confidence, null);
    setMetricValue(cwd, 43);
    await runBenchmark(s);
    const d2 = await s.tool("log_experiment", {
      status: "discard",
      metric: 43,
      description: "worse",
    });
    assert.equal(d2.confidence, null);
    setMetricValue(cwd, 41);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// v3\n");
    const k3 = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "improve",
    });
    // values 42/43/41: median 42, MAD 1, |best-baseline|/MAD = 1 → yellow;
    // the response carries the unit ("× noise"), the ledger snapshot does not
    assert.deepEqual(k3.confidence, {
      level: "yellow",
      value: 1,
      unit: "× noise",
    });
    const runRows = () =>
      readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
        .filter((r) => r.type === "run");
    assert.equal(runRows()[0]?.confidence, undefined); // legacy-style row
    assert.deepEqual(runRows()[2]?.confidence, { level: "yellow", value: 1 });
    assert.equal(runRows()[2]?.confidence.value, k3.confidence.value);
    // crash row: metric null, snapshot over the existing values, no throw —
    // attested by a failing benchmark that measures nothing
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      "#!/usr/bin/env bash\nexit 1\n",
    );
    await runBenchmark(s);
    const crash = await s.tool("log_experiment", {
      status: "crash",
      description: "boom",
    });
    assert.equal(crash.ok, true);
    const crashRow = runRows()[3];
    assert.equal(crashRow?.metric, null);
    assert.deepEqual(crashRow?.confidence, { level: "yellow", value: 1 });
  });
});

test("live dashboard returns 500 on render failure and keeps serving requests", async () => {
  const cwd = tempRepo();
  try {
    await withServer(cwd, async (s) => {
      const exported = await s.tool("export_dashboard", {});
      assert.equal(exported.ok, true);
      const url = String(exported.url);
      const malformed =
        JSON.stringify({ type: "config", name: { toString: null } }) + "\n";
      writeFileSync(join(cwd, ".auto", "log.jsonl"), malformed);
      const failed = await fetch(url);
      const body = await failed.text();
      const ledger = await fetch(`${url}/autoresearch.jsonl`);
      assert.equal(ledger.status, 200);
      assert.equal(await ledger.text(), malformed);
      assert.equal(failed.status, 500);
      assert.match(body, /dashboard request failed/);
      writeFileSync(join(cwd, ".auto", "log.jsonl"), "");
      const recovered = await fetch(url);
      assert.equal(recovered.status, 200);
      assert.match(await recovered.text(), /<!doctype html>/);
    });
  } finally {
    // A live HTTP server just served fetches here; teardown can outlast the
    // exit event by a beat, so let fs.rm retry its way through the lock.
    rmSync(cwd, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("run_experiment requires an active session", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.ok, false);
    assert.match(String(run.error), /init_experiment/);
    assert.ok(
      !existsSync(join(cwd, ".auto", "config.json")),
      "a rejected run must not create session config",
    );
  });
});

test("clear_experiments is idempotent without .auto", async () => {
  const cwd = tempRepo({ withAuto: false });
  await withServer(cwd, async (s) => {
    const res = await s.tool("clear_experiments", {});
    assert.equal(res.ok, true);
    assert.match(String(res.message), /no active session/);
    assert.ok(!existsSync(join(cwd, ".auto")), "must not create .auto");
  });
});

test("init_experiment rejects a repo without commits", async () => {
  const cwd = tempRepo({ commit: false });
  await withServer(cwd, async (s) => {
    const res = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(res.ok, false);
    assert.match(String(res.error), /commit|baseline/i);
    assert.ok(!existsSync(join(cwd, ".auto", "log.jsonl")));
  });
});

test("init and clear reset autoresearchOff", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    writeFileSync(
      join(cwd, ".auto", "config.json"),
      JSON.stringify({ autoresearchOff: true }),
    );
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(init.ok, true);
    assert.equal(
      JSON.parse(readFileSync(join(cwd, ".auto", "config.json"), "utf8"))
        .autoresearchOff,
      false,
    );

    writeFileSync(
      join(cwd, ".auto", "config.json"),
      JSON.stringify({ autoresearchOff: true }),
    );
    await s.tool("clear_experiments", {});
    assert.equal(
      JSON.parse(readFileSync(join(cwd, ".auto", "config.json"), "utf8"))
        .autoresearchOff,
      false,
    );
  });
});

test("crash response mirrors the null ledger metric", async () => {
  const cwd = tempRepo();
  // failing benchmark (no METRIC output) so the crash is attested
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const crash = await s.tool("log_experiment", {
      status: "crash",
      metric: 7,
      description: "boom",
    });
    assert.equal(crash.metric, null);
    assert.equal(crash.delta, null);
    const row = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .at(-1);
    assert.equal(row.metric, null);
  });
});

test("auditBypass skips secondary metric constraints", async () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ auditBypass: true }),
  );
  // both metrics file-controlled so each keep is attested by a real run
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=$(cat .auto/metric.txt 2>/dev/null || echo 42)"\necho "METRIC memory_mb=$(cat .auto/memory.txt 2>/dev/null || echo 100)"\n',
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    appendFileSync(join(cwd, "code.js"), "// base\n");
    const base = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
      metrics: { time_ms: 42, memory_mb: 100 },
    });
    assert.equal(base.ok, true);

    setMetricValue(cwd, 41);
    setMemoryValue(cwd, 200);
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    appendFileSync(join(cwd, "code.js"), "// faster but heavier\n");
    const keep = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "over budget but bypassed",
      metrics: { time_ms: 41, memory_mb: 200 },
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(keep.ok, true);
  });
});

test("dashboard-only keep is rejected and does not block crash recovery", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    writeFileSync(
      join(cwd, "autoresearch-dashboard.html"),
      "<html>dash</html>\n",
    );
    const keep = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "dashboard only",
    });
    assert.equal(keep.ok, false);
    assert.match(String(keep.error), /no changes to commit/);

    // the crash must be attested by a benchmark that measured nothing
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      "#!/usr/bin/env bash\nexit 1\n",
    );
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", { status: "crash", description: "boom" });
    writeFileSync(
      join(cwd, "autoresearch-dashboard.html"),
      "<html>dash 2</html>\n",
    );
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.ok, true);
  });
});

test("first keep cannot regress against the segment baseline", async () => {
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await runBenchmark(s);
    const baseline = await s.tool("log_experiment", {
      status: "discard",
      metric: 42,
      description: "baseline",
    });
    assert.equal(baseline.ok, true);

    setMetricValue(cwd, 45);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// slower\n");
    const keep = await s.tool("log_experiment", {
      status: "keep",
      metric: 45,
      description: "first keep is slower",
    });
    assert.equal(keep.ok, false);
    assert.match(String(keep.error), /keep_without_improvement/);
  });
});

test("unknown method with an id gets a -32601 response instead of hanging", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    const m = await s.call("ping");
    assert.equal(m.error?.code, -32601);
    assert.match(String(m.error?.message), /method not found/);
  });
});

test("huge timeout_seconds is clamped, not treated as an immediate kill", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // 3_000_000 s * 1000 > 2^31-1: Node's setTimeout would collapse the delay
    // to 1ms and SIGTERM the benchmark instantly (TimeoutOverflowWarning).
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
      timeout_seconds: 3_000_000,
    });
    assert.equal(run.ok, true);
    assert.equal(run.timed_out, false);
    assert.equal(run.metric, 42);
  });
});

test("corrupt config.json fails init loudly instead of being silently reset", async () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, ".auto", "config.json"), "{not json");
  await withServer(cwd, async (s) => {
    // patchSessionConfig throws → the transport layer answers -32000.
    const m = await s.call("tools/call", {
      name: "init_experiment",
      arguments: { name: "t", metric_name: "time_ms" },
    });
    assert.equal(m.error?.code, -32000);
    assert.match(String(m.error?.message), /not valid JSON/);
    // No half-initialized session: the ledger must not carry a config row.
    assert.equal(existsSync(join(cwd, ".auto", "log.jsonl")), false);
  });
  // A valid config lets init proceed normally.
  writeFileSync(join(cwd, ".auto", "config.json"), "{}");
  await withServer(cwd, async (s) => {
    const init = await s.tool("init_experiment", {
      name: "t",
      metric_name: "time_ms",
    });
    assert.equal(init.ok, true);
  });
});

test("attestation gate: checks_failed requires a recorded failed-checks verdict", async () => {
  // The discarded_improvement audit only exempts status=checks_failed, so an
  // agent that wants to drop a real improvement could claim a gate failure
  // nothing recorded. checks_failed must attest: the latest run_experiment
  // must have left a failed-checks verdict (pendingChecksFailed).
  const cwd = tempRepo();
  useControlledMeasure(cwd);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // First keep establishes the retained value (real observation, not a
    // transcribed number — the binding gate would reject that).
    setMetricValue(cwd, 50);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c2\n");
    const k = await s.tool("log_experiment", {
      status: "keep",
      metric: 50,
      description: "first keep",
    });
    assert.equal(k.ok, true);
    // An improving candidate → honest discard is rejected by the audit…
    setMetricValue(cwd, 30);
    await runBenchmark(s);
    appendFileSync(join(cwd, "code.js"), "// c3\n");
    const d = await s.tool("log_experiment", {
      status: "discard",
      metric: 30,
      description: "beats retained, discard",
    });
    assert.equal(d.ok, false);
    assert.match(String(d.error), /discarded_improvement/);
    // …so claiming checks_failed with NO failed checks on record is the only
    // escape — the attestation gate must reject it.
    const cf = await s.tool("log_experiment", {
      status: "checks_failed",
      metric: 30,
      description: "gate failure nobody recorded",
    });
    assert.equal(cf.ok, false);
    assert.match(String(cf.error), /no failed-checks verdict/);
    // Nothing landed: the ledger still holds only config + the keep row.
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    assert.equal(rows.filter((r) => r.type === "run").length, 1);
  });
});

test("observation binding: the snapshot survives a server restart", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    appendFileSync(join(cwd, "code.js"), "// c2\n");
    await runBenchmark(s);
  });
  // A fresh server process over the same workspace: the observation is
  // persisted state (config.json), not server memory — the log still attests.
  await withServer(cwd, async (s) => {
    const k = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "logged after restart",
    });
    assert.equal(k.ok, true);
    assert.equal(k.metric, 42);
  });
});

test("noop: dirty working tree is surfaced as an explicit warning", async () => {
  // noop rolls nothing back (by design), so a dirty tree at noop time would
  // otherwise enter the next measurement silently. Advisory, not a gate: the
  // dirt may be legitimate (user scratch files), but it must be said.
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    appendFileSync(join(cwd, "code.js"), "// scratch\n");
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const dirty = await s.tool("log_experiment", {
      status: "noop",
      metric: 42,
      description: "verification rerun, nothing changed",
    });
    assert.equal(dirty.ok, true);
    assert.match(String(dirty.warning), /working tree/i);
    // the mechanical fact lands on the row regardless of status
    const rows = readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const noopRow = rows.find((r) => r.type === "run" && r.status === "noop");
    assert.equal(noopRow.treeDirty, true);
  });
});

test("noop: clean tree stays silent", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const clean = await s.tool("log_experiment", {
      status: "noop",
      metric: 42,
      description: "clean noop",
    });
    assert.equal(clean.ok, true);
    assert.equal(clean.warning, undefined);
  });
});

test("observation binding: no-run logs, metric mismatch and fake crash are rejected", async () => {
  // Root cause (worth-fix 2026-11-06): run_experiment is the only observer,
  // but its observation died with the response — everything in the ledger was
  // agent transcription. The snapshot now persists (pendingObservation) and
  // every log must attest against it: one log per run, metric equal to what
  // was measured, crash only when nothing was measured.
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    appendFileSync(join(cwd, "code.js"), "// c2\n");
    // no run ever happened → nothing to attest the log against
    const noRun = await s.tool("log_experiment", {
      status: "keep",
      metric: 50,
      description: "fabricated",
    });
    assert.equal(noRun.ok, false);
    assert.match(String(noRun.error), /run_experiment/);
    // the benchmark observes 42; a different number is a transcription
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    const mismatch = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "nicer number",
    });
    assert.equal(mismatch.ok, false);
    assert.match(String(mismatch.error), /does not match/);
    // a valid metric was observed → "measured nothing" (crash) is not attested
    const fakeCrash = await s.tool("log_experiment", {
      status: "crash",
      description: "it ran fine, actually",
    });
    assert.equal(fakeCrash.ok, false);
    assert.match(String(fakeCrash.error), /observed a valid metric/);
    // the honest log passes and consumes the observation (one log per run)
    const honest = await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "honest",
    });
    assert.equal(honest.ok, true);
    const spent = await s.tool("log_experiment", {
      status: "noop",
      metric: 42,
      description: "double log",
    });
    assert.equal(spent.ok, false);
    assert.match(String(spent.error), /run_experiment/);
  });
});

test("observation binding: stale pending state does not survive init/clear boundaries", async () => {
  // Root cause (worth-fix 2026-11-07): pendingObservation was missing from
  // both reset lists (clear and init only reset pendingChecksFailed /
  // autoresearchOff by hand), so an unconsumed observation from a PREVIOUS
  // session survived the boundary and attested run #1 of the new segment —
  // the red repro logged metric 123 into a session that never ran anything.
  // Boundary rule: every `pending*` key is server cross-call state, cleared
  // wholesale at init/clear (see SessionConfig in types.ts).
  const seed = (cwd: string) =>
    writeFileSync(
      join(cwd, ".auto", "config.json"),
      JSON.stringify({
        benchmarkHashes: { measure: null, checks: null },
        pendingChecksFailed: true,
        pendingObservation: {
          metric: 123,
          metrics: {},
          exit_code: 0,
          timed_out: false,
          at: new Date().toISOString(),
        },
      }),
    );
  // clear's early-exit path (no log.jsonl) must still reset pending* state
  const cleared = tempRepo();
  seed(cleared);
  await withServer(cleared, async (s) => {
    const r = await s.tool("clear_experiments", {});
    assert.equal(r.ok, true);
    assert.match(String(r.message), /no active session/);
    const cfg = JSON.parse(
      readFileSync(join(cleared, ".auto", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("pendingObservation" in cfg, false);
    assert.equal("pendingChecksFailed" in cfg, false);
    assert.ok("benchmarkHashes" in cfg); // non-pending keys survive
  });
  // init path: the new segment must not inherit the stale attestation
  const cwd = tempRepo();
  seed(cwd);
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "fresh", metric_name: "time_ms" });
    const stale = await s.tool("log_experiment", {
      status: "discard",
      metric: 123,
      description: "attested by the previous session's stale observation",
    });
    assert.equal(stale.ok, false);
    assert.match(String(stale.error), /run_experiment/);
    const cfg = JSON.parse(
      readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.ok("benchmarkHashes" in cfg); // session baseline preserved
    assert.equal("pendingChecksFailed" in cfg, false);
    assert.equal("pendingObservation" in cfg, false);
    // a fresh observation inside THIS segment still logs normally
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.ok, true);
    assert.equal(run.metric, 42);
    const honest = await s.tool("log_experiment", {
      status: "discard",
      metric: 42,
      description: "fresh observation in this segment",
    });
    assert.equal(honest.ok, true);
  });
});

test("observation binding: a failing benchmark attests an honest crash", async () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const r = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(r.ok, true); // advisory warning, observation still persisted
    const c = await s.tool("log_experiment", {
      status: "crash",
      description: "boom",
    });
    assert.equal(c.ok, true);
    assert.equal(c.metric, null);
  });
});
