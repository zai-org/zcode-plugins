// MCP integration tests: spawn the real server and drive the tools over JSON-RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = join(ROOT, "mcp", "server.ts");

interface JsonRpcResponse {
  id?: number;
  result?: { content?: Array<{ type?: string; text?: string }> };
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
  close(): void;
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "ar-mcp-"));
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], {
    cwd,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=42"\n',
  );
  writeFileSync(join(cwd, "code.js"), "v1\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "init"], { cwd, stdio: "ignore" });
  return cwd;
}

function connect(cwd: string): McpClient {
  const proc = spawn("node", [SERVER], { cwd });
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
  ): Promise<JsonRpcResponse> =>
    new Promise((res) => {
      const i = id++;
      pending.set(i, res);
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
  const close = () => proc.kill();
  return { call, tool, close };
}

async function withServer(
  cwd: string,
  fn: (s: McpClient) => Promise<unknown>,
): Promise<unknown> {
  const s = connect(cwd);
  await s.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
  });
  try {
    return await fn(s);
  } finally {
    s.close();
  }
}

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
  execFileSync("chmod", [
    "+x",
    join(cwd, ".auto", "hooks", "before.sh"),
    join(cwd, ".auto", "hooks", "after.sh"),
  ]);

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.before_steer, "BEFORE-STEER");
    assert.equal(run.metric, 42);
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
  execFileSync("chmod", ["+x", join(cwd, ".auto", "hooks", "before.sh")]);

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
  execFileSync("chmod", [
    "+x",
    join(cwd, ".auto", "hooks", "before.sh"),
    join(cwd, ".auto", "hooks", "after.sh"),
  ]);

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    // first run: no asi anywhere yet — hooks stay silent (last_run null)
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

test("iteration hooks: every fire appends a type:hook ledger entry", async () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto", "hooks"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "hooks", "before.sh"),
    "#!/usr/bin/env bash\ncat > /dev/null\nexit 2\n",
  );
  execFileSync("chmod", ["+x", join(cwd, ".auto", "hooks", "before.sh")]);

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
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
  // measure.sh emits a primary + a secondary metric
  writeFileSync(
    join(cwd, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=42"\necho "METRIC memory_mb=100"\n',
  );
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // first run establishes the ledger (baseline; no constraints yet)
    const r1 = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal((r1.metrics as Record<string, number>).memory_mb, 100);
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "baseline",
      metrics: { memory_mb: 100 },
    });
    // constraint within band → keep passes (vs baseline memory_mb=100)
    const ok = await s.tool("log_experiment", {
      status: "keep",
      metric: 41,
      description: "within band",
      metrics: { memory_mb: 100 },
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.constraints, [
      { name: "memory_mb", status: "pass", value: 100, limit: 105 },
    ]);
    // now a keep that blows the constraint → rejected
    const bad = await s.tool("log_experiment", {
      status: "keep",
      metric: 40,
      description: "faster but heavier",
      metrics: { memory_mb: 110 },
      constraints: [{ name: "memory_mb", maxPct: 105 }],
    });
    assert.equal(bad.ok, false);
    assert.match(
      String(bad.error),
      /constraint violation: secondary metric memory_mb=110/,
    );
    // no constraints → no secondary check
    const free = await s.tool("log_experiment", {
      status: "keep",
      metric: 39,
      description: "no constraints declared",
      metrics: { memory_mb: 999 },
    });
    assert.equal(free.ok, true);
    assert.equal(free.constraints, undefined);
  });
});
