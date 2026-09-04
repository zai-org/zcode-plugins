// Dashboard live server + workingDir tests (spawn the real MCP server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "../mcp/lib/dashboard.ts";
import type { LedgerRun, SessionState } from "../mcp/lib/types.ts";

function sampleState(
  runs: Array<[status: string, metric: number | null]> = [
    ["keep", 100],
    ["discard", 105],
    ["keep", 60],
    ["noop", null],
    ["keep", 40],
  ],
): SessionState {
  const entries: LedgerRun[] = runs.map(([status, metric], i) => ({
    type: "run",
    run: i + 1,
    segment: 1,
    status: status as LedgerRun["status"],
    metric,
    description: status === "noop" ? "no code change" : `hypothesis ${i + 1}`,
  }));
  return {
    config: {
      type: "config",
      segment: 1,
      name: "t",
      metricName: "time_ms",
      direction: "lower",
    },
    segment: 1,
    runs: entries,
    baseline: 100,
    best: 40,
    lastRunChecksFailed: false,
    lastRun: entries[entries.length - 1],
    totalExperiments: entries.length,
    consecutiveFailures: 0,
    confidence: { confidence: 3.0, level: "green" },
    plateau: false,
    failureThreshold: 3,
  };
}

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
  const cwd = mkdtempSync(join(tmpdir(), "ar-dash-"));
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

test("export_dashboard starts a live server with HTML, ledger and SSE routes", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    // keep requires a real (non-.auto) change since the .auto exclusion fix
    appendFileSync(join(cwd, "code.js"), "// change\n");
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    const exp = await s.tool("export_dashboard", {});
    assert.equal(exp.ok, true);
    assert.match(String(exp.url), /^http:\/\/127\.0\.0\.1:\d+$/);

    const html = await (await fetch(String(exp.url) + "/")).text();
    assert.match(html, /<table/);
    assert.match(html, /EventSource\('\/events'\)/);

    const ledger = await (
      await fetch(String(exp.url) + "/autoresearch.jsonl")
    ).text();
    assert.match(ledger, /"type":"config"/);
    assert.match(ledger, /"type":"run"/);

    const sseRes = await fetch(String(exp.url) + "/events");
    assert.equal(sseRes.status, 200);
    assert.match(
      sseRes.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    await sseRes.body?.cancel();
  });
});

test("SSE broadcasts jsonl-updated after log_experiment (live refresh)", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const exp = await s.tool("export_dashboard", {});
    const ctrl = new AbortController();
    const sseRes = await fetch(String(exp.url) + "/events", {
      signal: ctrl.signal,
    });
    const reader = sseRes.body!.getReader();
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    const { value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("no SSE event within 3s")), 3000),
      ),
    ]);
    const text = new TextDecoder().decode(value ?? new Uint8Array());
    assert.match(text, /jsonl-updated/);
    ctrl.abort();
  });
});

test("workingDir redirects the ledger, benchmark and git to the research dir", async () => {
  const cwd = tempRepo();
  // project config points to a work/ subdir; measure lives there
  mkdirSync(join(cwd, "work", ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "config.json"),
    JSON.stringify({ workingDir: "work" }),
  );
  writeFileSync(
    join(cwd, "work", ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=7"\n',
  );

  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const run = await s.tool("run_experiment", {
      command: "bash .auto/measure.sh",
    });
    assert.equal(run.metric, 7);
    // keep requires a real (non-.auto) change in the research dir
    writeFileSync(join(cwd, "work", "code.js"), "v2\n");
    await s.tool("log_experiment", {
      status: "keep",
      metric: 7,
      description: "x",
    });
    assert.ok(
      existsSync(join(cwd, "work", ".auto", "log.jsonl")),
      "ledger in work dir",
    );
    assert.ok(
      !existsSync(join(cwd, ".auto", "log.jsonl")),
      "no ledger in project dir",
    );
    const state = readFileSync(join(cwd, "work", ".auto", "log.jsonl"), "utf8");
    assert.match(state, /"type":"run"/);
  });
});

test("live server survives a deleted ledger (404) and dead SSE clients", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const exp = await s.tool("export_dashboard", {});
    // an SSE client connects, then dies abruptly (aborted fetch)
    const ctrl = new AbortController();
    const sseRes = await fetch(String(exp.url) + "/events", {
      signal: ctrl.signal,
    });
    ctrl.abort();
    // the ledger legitimately disappears (clear_experiments)
    await s.tool("clear_experiments", {});
    const gone = await fetch(String(exp.url) + "/autoresearch.jsonl");
    assert.equal(gone.status, 404);
    // a later broadcast (init writes the ledger again) must not crash the
    // process even though a dead client may still be in the broadcast set
    await s.tool("init_experiment", { name: "t2", metric_name: "time_ms" });
    const home = await fetch(String(exp.url) + "/");
    assert.equal(home.status, 200);
    await sseRes.body?.cancel().catch(() => {});
  });
});

test("renderer: equal-width card grid, dual theme, overflow guards, neutral no-op", () => {
  const html = renderDashboard(sampleState());
  assert.match(html, /box-sizing: border-box/);
  assert.match(
    html,
    /grid-template-columns: repeat\(auto-fit, minmax\(110px, 1fr\)\)/,
  );
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /class="tablewrap"/);
  assert.match(html, /overflow-x: auto/);
  // no-op is neutral, never the crash-red fallback
  assert.match(html, /badge noop">no-op/);
  assert.doesNotMatch(html, /badge crash">no-op/);
  // confidence card carries its value next to the level
  assert.match(html, /confidence 3\.00/);
});

test("renderer: SVG trend line with per-status points and baseline reference", () => {
  const html = renderDashboard(sampleState());
  assert.match(html, /<svg viewBox="0 0 860 120"/);
  assert.match(html, /<polyline class="line"/);
  // 4 valid metric points (100/105/60/40; the no-op row has none)
  assert.equal((html.match(/<circle class="c-/g) ?? []).length, 4);
  assert.match(html, /class="base"/); // dashed baseline reference
  assert.match(html, /baseline 100/);
  assert.match(html, /class="gline"/); // light horizontal grid ticks
  assert.match(html, />50<\/text>/); // nice ticks land on round values
  assert.match(html, />75<\/text>/);
  assert.match(html, />100<\/text>/);
  assert.match(html, /c-keep/); // keep points filled
  assert.match(html, /c-discard/); // discard points hollow
});

test("renderer: no trend below two valid points", () => {
  const html = renderDashboard(
    sampleState([
      ["keep", 100],
      ["noop", null],
      ["crash", null],
    ]),
  );
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /badge noop">no-op/);
});
