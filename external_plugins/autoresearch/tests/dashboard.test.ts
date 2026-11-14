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
import {
  niceTicks,
  renderDashboard,
  renderLiveDashboard,
} from "../mcp/lib/dashboard.ts";
import { rebuildHistory } from "../mcp/lib/ledger.ts";
import type { LedgerEntry, LedgerRun } from "../mcp/lib/types.ts";

type RunTuple = [status: string, metric: number | null];

function entriesWithRuns(runs: RunTuple[], timestamps = false): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    {
      type: "config",
      segment: 1,
      name: "t",
      metricName: "time_ms",
      direction: "lower",
    },
  ];
  runs.forEach(([status, metric], i) => {
    const run: LedgerRun = {
      type: "run",
      run: i + 1,
      segment: 1,
      status: status as LedgerRun["status"],
      metric,
      description: status === "noop" ? "no code change" : `hypothesis ${i + 1}`,
    };
    if (timestamps)
      run.timestamp = `2026-10-2${Math.floor(i / 4)}T0${(i % 9) + 1}:00:00.000Z`;
    entries.push(run);
  });
  return entries;
}

function sampleHistory(runs?: RunTuple[]): ReturnType<typeof rebuildHistory> {
  return rebuildHistory(
    entriesWithRuns(
      runs ?? [
        ["keep", 100],
        ["discard", 105],
        ["keep", 60],
        ["noop", null],
        ["keep", 40],
      ],
    ),
  );
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
  close(): Promise<void>;
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "ar-dash-"));
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], {
    cwd,
    stdio: "ignore",
  });
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
  const proc = spawn(process.execPath, [SERVER], { cwd });
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
  // The child's CWD is the temp repo; until the process fully exits, Windows
  // keeps that directory locked and rmSync(cwd) would fail with EPERM.
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
): Promise<unknown> {
  const s = connect(cwd);
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
    assert.match(html, /class="ledger"/);
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
    appendFileSync(join(cwd, "code.js"), "// change\n");
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

test("renderer: console hero with KPI cards, dark-first tokens, neutral no-op", () => {
  const html = renderDashboard(sampleHistory());
  assert.match(html, /box-sizing: border-box/);
  // dark-first: deep-navy token set is the default, light re-maps via media query
  assert.match(html, /color-scheme: dark/);
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /overflow-wrap: anywhere/);
  // result composition: baseline → best with the overall delta in accent
  assert.match(html, /class="result"/);
  assert.match(
    html,
    /<div class="fig past"><div class="n">100<\/div><div class="l">baseline/,
  );
  assert.match(html, /<div class="n">40<\/div><div class="l">best/);
  assert.match(html, /<div class="fig delta up"><div class="n">−60%<\/div>/);
  // KPI cards carry the process counts (NO-OP not counted as reverted)
  assert.match(html, /class="kpis"/);
  assert.match(
    html,
    /<div class="kpi-n">5<\/div><div class="kpi-l">实验总数<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">3<\/div><div class="kpi-l">保留<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">1<\/div><div class="kpi-l">回退<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">1<\/div><div class="kpi-l">无改动<\/div>/,
  );
  // meta line: confidence verdict only (counts moved to KPI cards)
  assert.match(html, /class="meta"/);
  assert.match(html, /<span class="conf-green">通过<\/span> 2\.67× 噪声/);
  assert.doesNotMatch(html, /class="band"/);
  assert.match(html, /class="ledger"/);
  // no-op is neutral, never the crash-red fallback
  assert.match(html, /r-stamp noop">无改动/);
  assert.doesNotMatch(html, /r-stamp crash">无改动/);
});

test("renderer: SVG trend line across the ledger with baseline reference", () => {
  const html = renderDashboard(sampleHistory());
  // two variants rendered (desktop + mobile 1:1); CSS picks per viewport
  assert.match(html, /<svg class="chart-d" viewBox="0 0 960 240"/);
  assert.match(html, /<svg class="chart-m" viewBox="0 0 390 240"/);
  assert.match(html, /<polyline class="ln"/);
  // 4 valid metric points (100/105/60/40; the no-op row has none) per variant
  assert.equal((html.match(/<circle class="d[kh]"/g) ?? []).length, 8);
  assert.match(html, /class="base"/); // dashed baseline reference
  assert.match(html, /baseline 100/);
  assert.match(html, /class="gl"/); // light horizontal grid ticks
  assert.match(html, />50<\/text>/); // nice ticks land on round values
  assert.match(html, />75<\/text>/);
  assert.match(html, />100<\/text>/);
  assert.match(html, /class="dk"/); // keep points filled
  assert.match(html, /class="dh"/); // non-keep points hollow
  // no per-point ordinal text; X axis is a sparse "全局轮次" integer scale
  assert.doesNotMatch(html, /class="dv"/);
  assert.match(html, /class="xt"/);
  assert.match(html, /全局轮次/);
  // named legend + semantics note + summary strip under the chart
  assert.match(html, /轨迹连线<i class="lg-keep"><\/i>保留/);
  assert.match(html, /实心为保留 · 空心为未保留 · 虚线为分段边界/);
  assert.match(
    html,
    /<div class="t-stats"><span>分段数 <b>1<\/b><\/span><span>轮次数 <b>4<\/b><\/span><span>保留数 <b>3<\/b><\/span><span>首轮→最优 <b class="up">−60<\/b><\/span><\/div>/,
  );
  // tooltip data attributes carry real ledger values on each point anchor
  assert.match(
    html,
    /<a class="pt" href="#run-1" data-run="1" data-metric="100" data-delta="±0" data-dcls="neut" data-status="保留"/,
  );
  assert.match(
    html,
    /data-run="3" data-metric="60" data-delta="\+40" data-dcls="up" data-status="保留"/,
  );
  assert.match(html, /data-status="回退"/);
});

test("renderer: X axis stays sparse on long runs (no per-point ordinals)", () => {
  const runs = Array.from({ length: 30 }, (_, i) =>
    i % 3 === 2
      ? (["discard", 100 + (i % 5)] as RunTuple)
      : (["keep", 90 + (i % 4)] as RunTuple),
  );
  const html = renderDashboard(sampleHistory(runs));
  const xt = html.match(/class="xt"/g) ?? [];
  // 30 runs → step 5 → ticks 5..30 → 6 per variant, ≤8 by design
  assert.ok(xt.length >= 4 && xt.length <= 16, `x tick count ${xt.length}`);
  assert.doesNotMatch(html, /class="dv"/);
  assert.ok((html.match(/<circle class="d[kh]"/g) ?? []).length === 60);
});

test("rebuildHistory: segmentCount counts distinct segments with runs", () => {
  const one = rebuildHistory(entriesWithRuns([["keep", 100]]));
  assert.equal(one.segmentCount, 1);
  const two = rebuildHistory([
    {
      type: "config",
      segment: 1,
      name: "a",
      metricName: "m",
      direction: "lower",
    },
    { type: "run", run: 1, status: "keep", metric: 100, description: "" },
    {
      type: "config",
      segment: 2,
      name: "b",
      metricName: "m",
      direction: "lower",
    },
    { type: "run", run: 1, status: "keep", metric: 90, description: "" },
    // a config-only segment has no runs → not counted
    {
      type: "config",
      segment: 3,
      name: "c",
      metricName: "m",
      direction: "lower",
    },
  ]);
  assert.equal(two.segmentCount, 2);
});

test("renderer: no trend below two valid points", () => {
  const html = renderDashboard(
    sampleHistory([
      ["keep", 100],
      ["noop", null],
      ["crash", null],
    ]),
  );
  // no trend chart (page icons are svg, the chart is not)
  assert.doesNotMatch(html, /<svg class="chart/);
  assert.doesNotMatch(html, /id="chart-tip"/);
  assert.match(html, /r-stamp noop">无改动/);
});

test("renderer: empty ledger shows the empty state without KPI cards", () => {
  const html = renderDashboard(rebuildHistory([]));
  assert.match(html, /class="empty"/);
  assert.doesNotMatch(html, /class="kpis"/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /class="result"/);
});

test("renderer: KPI card counts follow the real ledger", () => {
  const html = renderDashboard(
    sampleHistory([
      ["keep", 100],
      ["keep", 90],
      ["discard", 120],
      ["crash", null],
      ["checks_failed", null],
      ["noop", null],
      ["noop", null],
    ]),
  );
  // total 7 · kept 2 · reverted 3 (discard+crash+checks_failed) · no-op 2
  assert.match(
    html,
    /<div class="kpi-n">7<\/div><div class="kpi-l">实验总数<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">2<\/div><div class="kpi-l">保留<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">3<\/div><div class="kpi-l">回退<\/div>/,
  );
  assert.match(
    html,
    /<div class="kpi-n">2<\/div><div class="kpi-l">无改动<\/div>/,
  );
});

test("renderer: long descriptions render full text in a clamp line (no details)", () => {
  // 2026-11-13: one clamp language for every long value — no <details>, no
  // preview duplication; JS clamps overflowing items to one faded line and
  // expands on click, without JS the full text stays readable.
  const entries = entriesWithRuns([
    ["keep", 100],
    ["keep", 90],
  ]);
  const runs = entries.filter((e) => e.type === "run") as LedgerRun[];
  const long = "把热点路径从同步 fs 写改为批量异步写，".repeat(20);
  runs[0].description = long;
  runs[1].description = "short one";
  const html = renderDashboard(rebuildHistory(entries));
  // no details/summary anywhere; full text present exactly once
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /class="d-more"/);
  assert.ok(html.includes(long), "full description present");
  // the clamp value is the one reading surface (aria-labels also repeat it)
  assert.match(html, /<div class="clamp-line"><span class="clamp-v">/);
  assert.match(html, /<span class="clamp-v">short one<\/span>/);
  assert.match(renderLiveDashboard(rebuildHistory(entries)), /clamp-line/);
});

test("renderer: delta of exactly zero renders neutral ±0 (no arrow mismatch)", () => {
  const html = renderDashboard(
    sampleHistory([
      ["keep", 100],
      ["keep", 100],
      ["keep", 90],
    ]),
  );
  assert.match(html, /<span class="d neut">±0<\/span>/);
  assert.doesNotMatch(html, /▲ \+0</);
  assert.doesNotMatch(html, /▼ −0</);
});

test("renderer: mid-ledger config rows never split the flat ledger", () => {
  const entries: LedgerEntry[] = [
    {
      type: "config",
      segment: 1,
      name: "phase-one",
      metricName: "time_ms",
      direction: "lower",
    },
    { type: "run", run: 1, status: "keep", metric: 100, description: "base" },
    {
      type: "config",
      segment: 2,
      name: "phase-two",
      metricName: "time_ms",
      direction: "lower",
    },
    {
      type: "run",
      run: 1,
      status: "keep",
      metric: 90,
      description: "seg2 base",
    },
    {
      type: "run",
      run: 2,
      status: "keep",
      metric: 80,
      description: "seg2 win",
    },
  ];
  const history = rebuildHistory(entries);
  const html = renderDashboard(history);
  // all runs render in one flat ledger — no list-level grouping anywhere
  assert.equal((html.match(/class="run"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /seg 0/);
  assert.doesNotMatch(html, /seg-div/);
  assert.doesNotMatch(html, /class="bound"/);
  // the trend chart marks the segment boundary (fact annotation, not grouping)
  assert.match(html, /class="seg-line"/);
  assert.match(html, /分段 2<\/text>/);
  assert.match(html, /分段数 <b>2<\/b>/);
  // title follows the latest config
  assert.match(html, /<h1>phase-two<\/h1>/);
  // hero stats are global: baseline 100, best 80
  assert.match(html, /<div class="n">100<\/div><div class="l">baseline/);
  // Δ is computed against the global baseline (100): run #2 (90) → ▲ +10
  assert.match(html, /<span class="d up">▲ \+10<\/span>/);
  assert.match(html, /Δ 相对基线/);
  // global best 80 → overall improvement shows in the hero stat
  assert.match(html, /class="n">−20%<\/div><div class="l">overall/);
});

test("renderer: footer pins the git hash when provided and dates the export", () => {
  const entries = entriesWithRuns(
    [
      ["keep", 100],
      ["keep", 90],
    ],
    true,
  );
  const runs = entries.filter((e) => e.type === "run") as LedgerRun[];
  runs[1].timestamp = "2026-10-27T15:07:00.000Z"; // last run drives the date
  const history = rebuildHistory(entries);
  assert.match(renderDashboard(history, { pin: "abc1234" }), /锚定 abc1234/);
  assert.match(renderDashboard(history), /10 次实验|2 次实验/);
  assert.doesNotMatch(renderDashboard(history), /锚定/);
  const html = renderDashboard(history, { pin: "abc1234" });
  assert.match(html, /autoresearch · 2026-10-27/);
  assert.match(html, /2 次实验 · 锚定 abc1234/);
});

test("rebuildHistory: flat runs, latest-config direction, leading runs tolerated", () => {
  // runs before any config row still flatten; no config → neutral fallbacks
  const withLead = rebuildHistory([
    { type: "run", run: 1, status: "keep", metric: 100, description: "orphan" },
  ]);
  assert.equal(withLead.config, null);
  assert.equal(withLead.runs.length, 1);
  assert.equal(withLead.totalRuns, 1);
  assert.equal(withLead.firstMetric, 100);
  assert.equal(withLead.confidence, null);

  const two = rebuildHistory([
    {
      type: "config",
      segment: 1,
      name: "a",
      metricName: "m",
      direction: "lower",
    },
    { type: "run", run: 1, status: "keep", metric: 100, description: "" },
    { type: "run", run: 2, status: "keep", metric: 60, description: "" },
    {
      type: "config",
      segment: 2,
      name: "b",
      metricName: "m",
      direction: "higher",
    },
    { type: "run", run: 1, status: "keep", metric: 200, description: "" },
  ]);
  // flat: config rows do not split the run sequence
  assert.equal(two.runs.length, 3);
  assert.equal(two.totalRuns, 3);
  assert.equal(two.kept, 3);
  assert.equal(two.firstMetric, 100);
  // the latest config wins for title/direction: higher → 200 is best
  assert.equal(two.config?.name, "b");
  assert.equal(two.bestMetric, 200);
});

test("renderer: revisits_run marker renders only for positive integers", () => {
  const entries = entriesWithRuns([
    ["keep", 100],
    ["discard", 105],
    ["keep", 60],
    ["noop", null],
  ]);
  const runs = entries.filter((e) => e.type === "run") as LedgerRun[];
  runs[0].asi = { revisits_run: 3 }; // valid → ↻ Revisiting #3
  runs[1].asi = { revisits_run: -1 }; // non-positive → plain row
  runs[2].asi = { revisits_run: 0 }; // non-positive → plain row
  runs[3].asi = { revisits_run: "2" }; // not an integer → plain row
  const html = renderDashboard(rebuildHistory(entries));
  assert.match(html, /↻ Revisiting #3/);
  assert.doesNotMatch(html, /Revisiting #0/);
  assert.doesNotMatch(html, /Revisiting #-1/);
  assert.doesNotMatch(html, /Revisiting #2/);
  // the rest of the marked row renders unchanged
  assert.match(html, /<span class="clamp-v revisits">↻ Revisiting #3<\/span>/);
  // the live dashboard shares the same render path
  assert.match(renderLiveDashboard(rebuildHistory(entries)), /↻ Revisiting #3/);
});

test("renderer: negative baselines preserve improvement direction", () => {
  for (const [direction, best, text] of [
    ["lower", -20, "−100%"],
    ["higher", -5, "+50%"],
  ] as const) {
    const entries = entriesWithRuns([
      ["keep", -10],
      ["keep", best],
    ]);
    const config = entries[0];
    if (config.type === "config") config.direction = direction;
    const html = renderDashboard(rebuildHistory(entries));
    assert.ok(
      html.includes(`<div class="fig delta up"><div class="n">${text}</div>`),
    );
  }
});

test("rebuildHistory: footer follows ledger order after clock rollback", () => {
  const entries = entriesWithRuns([
    ["keep", 10],
    ["keep", 9],
  ]);
  const runs = entries.filter((e): e is LedgerRun => e.type === "run");
  runs[0].timestamp = "2026-10-28T01:00:00.000Z";
  runs[1].timestamp = "2026-10-27T23:00:00.000Z";
  const history = rebuildHistory(entries);
  assert.equal(history.lastRunAt, runs[1].timestamp);
  assert.match(renderDashboard(history), /autoresearch · 2026-10-27/);
});

test("renderer: evidence links, escaped labels and accessible filters", () => {
  const entries = entriesWithRuns([
    ["keep", 100],
    ["discard", 110],
    ["noop", null],
  ]);
  const config = entries[0];
  if (config.type === "config") config.metricUnit = "ms";
  const run = entries[1];
  if (run.type === "run") run.description = '<img src=x onerror="bad()">';
  const html = renderDashboard(rebuildHistory(entries));
  assert.match(html, /time_ms \/ ms/);
  assert.match(html, /href="#run-1"/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /data-filter="all" aria-pressed="true"/);
  assert.match(html, /class="filters" hidden/);
  assert.match(html, /id="run-3" data-status="noop"/);
});

test("dashboard tolerates non-string timestamps and escapes HTML", () => {
  const numeric = entriesWithRuns([["keep", 10]], true);
  (numeric[1] as unknown as { timestamp: unknown }).timestamp = 123;
  const html = renderDashboard(rebuildHistory(numeric));
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /autoresearch<\/span>/);

  const xss = entriesWithRuns([["keep", 10]], true);
  (xss[1] as unknown as { timestamp: unknown }).timestamp = "<b>hi</b>";
  const escaped = renderDashboard(rebuildHistory(xss));
  assert.match(escaped, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.doesNotMatch(escaped, /<b>hi<\/b>/);
});

test("niceTicks decimals hold at any magnitude (sub-micro spans)", () => {
  // step 2.5e-7: the exponential String form must not collapse labels to 0.0000
  const ticks = niceTicks(0, 5e-7, 2);
  assert.ok(ticks.length > 0);
  assert.equal(ticks[0].decimals, 8); // 0.00000025
  // regular magnitudes keep their shapes
  assert.equal(niceTicks(0, 10, 3)[0].decimals, 0);
  assert.equal(niceTicks(0, 0.2, 2)[0].decimals, 1);
  assert.equal(niceTicks(0, 0.25, 1)[0].decimals, 2); // 2.5 mantissa → +1 digit
  // the whole (2, 2.5] norm band selects the 2.5 coefficient, not just
  // norm === 2.5 exactly: span 0.63 → step 0.25, gridline must read "0.25"
  // (norm 2.1 previously missed the +1 and labeled it "0.3")
  assert.equal(niceTicks(0, 0.63)[0].decimals, 2);
  assert.ok(
    niceTicks(0, 0.63).some(
      (t) => t.value === 0.25 && t.value.toFixed(t.decimals) === "0.25",
    ),
  );
  // span 6.3e-7 → step 2.5e-7 → 8 decimals (7 collapsed it to 0.0000002)
  assert.equal(niceTicks(0, 6.3e-7)[0].decimals, 8);
});
