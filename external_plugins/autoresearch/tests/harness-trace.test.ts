// Mandatory harness trace: editable-surface changes must reach the ledger
// without agent cooperation (edit rows / experience.md are advisory). The
// integration tests drive the real server over JSON-RPC, so the trace is
// exercised on the exact path production uses; the schema-safety test pins
// that the new row types leave loop state untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { rebuildState, readLedger } from "../mcp/lib/ledger.ts";
import { validateLedger } from "../mcp/lib/validate.ts";
import {
  currentHarnessHashes,
  diffHarnessEdits,
  EDITABLE_SURFACE_FILES,
} from "../mcp/lib/harness.ts";
import type { LedgerConfig, LedgerEntry, LedgerRun } from "../mcp/lib/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = join(ROOT, "mcp", "server.ts");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function ledgerRows(cwd: string): LedgerEntry[] {
  return readLedger(cwd);
}

function harnessEdits(cwd: string): LedgerEntry[] {
  return ledgerRows(cwd).filter((e) => e.type === "harness_edit");
}

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

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ar-trace-"));
  mkdirSync(join(root, ".auto"), { recursive: true });
  writeFileSync(
    join(root, ".auto", "measure.sh"),
    '#!/usr/bin/env bash\necho "METRIC time_ms=42"\n',
  );
  writeFileSync(join(root, "code.js"), "v1\n");
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "t@t"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "t"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "init"], {
    cwd: root,
    stdio: "ignore",
  });
  return root;
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
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {}
  }
}

const cfgRow: LedgerConfig = {
  type: "config",
  segment: 1,
  name: "s",
  metricName: "m",
  direction: "lower",
};
const runRow: LedgerRun = {
  type: "run",
  run: 1,
  segment: 1,
  status: "keep",
  metric: 40,
  commit: null,
};

test("harness trace: init records the editable-surface baseline", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const cfg = JSON.parse(
      readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
    ) as Record<string, Record<string, string | null>>;
    assert.ok(cfg.harnessHashes, "init must record a harness baseline");
    for (const file of EDITABLE_SURFACE_FILES) {
      assert.ok(file in cfg.harnessHashes, `baseline covers ${file}`);
    }
    assert.equal(cfg.harnessHashes[".auto/prompt.md"], null);
  });
});

test("harness trace: editing a surface before log_experiment leaves a row", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // the run→log observation binding requires a real measurement per log
    writeFileSync(
      join(cwd, ".auto", "measure.sh"),
      '#!/usr/bin/env bash\necho "METRIC time_ms=41"\n',
    );
    const run = async () => {
      await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    };
    const content = "# charter\nrevised by the edit step\n";
    writeFileSync(join(cwd, ".auto", "prompt.md"), content);
    await run();
    const log = await s.tool("log_experiment", {
      status: "discard",
      metric: 41,
      description: "x",
    });
    assert.equal(log.ok, true);
    const rows = harnessEdits(cwd);
    assert.equal(rows.length, 1);
    const row = rows[0] as Extract<LedgerEntry, { type: "harness_edit" }>;
    assert.equal(row.file, ".auto/prompt.md");
    assert.equal(row.segment, 1);
    assert.equal(row.digest_before, null, "prompt.md did not exist at init");
    assert.equal(row.digest_after, sha256(content));
    // The baseline moved with the trace: a second log with no further edits
    // must not repeat the row.
    await run();
    await s.tool("log_experiment", {
      status: "discard",
      metric: 41,
      description: "y",
    });
    assert.equal(harnessEdits(cwd).length, 1);
  });
});

test("harness trace: a clean cycle writes no rows", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    assert.equal(harnessEdits(cwd).length, 0);
  });
});

test("harness trace: export_dashboard closes tail edits", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    await s.tool("log_experiment", {
      status: "discard",
      metric: 41,
      description: "x",
    });
    writeFileSync(
      join(cwd, ".auto", "experience.md"),
      "lesson: profile first\n",
    );
    await s.tool("export_dashboard", {});
    const rows = harnessEdits(cwd);
    assert.equal(rows.length, 1);
    assert.equal(
      (rows[0] as Extract<LedgerEntry, { type: "harness_edit" }>).file,
      ".auto/experience.md",
    );
  });
});

test("harness trace: legacy session gets a silent baseline, then rows", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    // Simulate a pre-trace session: config.json without harnessHashes.
    const cfgPath = join(cwd, ".auto", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete cfg.harnessHashes;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    writeFileSync(join(cwd, ".auto", "prompt.md"), "legacy edit\n");
    await s.tool("log_experiment", {
      status: "discard",
      metric: 41,
      description: "x",
    });
    assert.equal(
      harnessEdits(cwd).length,
      0,
      "first sighting after a baseline-less config must not backfill rows",
    );
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<
      string,
      Record<string, string | null>
    >;
    assert.ok(after.harnessHashes, "silent baseline was recorded");
    // The next real change is traceable against the new baseline.
    writeFileSync(join(cwd, ".auto", "prompt.md"), "second edit\n");
    await s.tool("log_experiment", {
      status: "discard",
      metric: 41,
      description: "y",
    });
    const rows = harnessEdits(cwd);
    assert.equal(rows.length, 1);
    const row = rows[0] as Extract<LedgerEntry, { type: "harness_edit" }>;
    assert.equal(row.digest_before, sha256("legacy edit\n"));
    assert.equal(row.digest_after, sha256("second edit\n"));
  });
});

test("harness trace: trace rows never pollute loop state or the audit", () => {
  const traceRows: LedgerEntry[] = [
    {
      type: "harness_edit",
      ts: "2026-10-31T00:00:00.000Z",
      segment: 1,
      file: ".auto/prompt.md",
      digest_before: null,
      digest_after: "a".repeat(64),
    },
    {
      type: "frozen_attempt",
      ts: "2026-10-31T00:00:01.000Z",
      file: ".auto/goal.md",
      tool: "Edit",
    },
  ];
  const withTrace = [cfgRow, ...traceRows, runRow];
  const withoutTrace = [cfgRow, runRow];

  const stateWith = rebuildStateLedger(withTrace);
  const stateWithout = rebuildStateLedger(withoutTrace);
  assert.deepEqual(
    {
      runs: stateWith.runs.length,
      confidence: stateWith.confidence,
      failures: stateWith.consecutiveFailures,
      violations: validateLedger(stateWith.runs, cfgRow),
    },
    {
      runs: stateWithout.runs.length,
      confidence: stateWithout.confidence,
      failures: stateWithout.consecutiveFailures,
      violations: validateLedger(stateWithout.runs, cfgRow),
    },
  );
  assert.equal(stateWith.runs.length, 1);
  assert.deepEqual(validateLedger(stateWith.runs, cfgRow), []);
});

// rebuildState needs a real directory; route the pure rows through a temp cwd.
function rebuildStateLedger(entries: LedgerEntry[]) {
  const cwd = mkdtempSync(join(tmpdir(), "ar-trace-unit-"));
  try {
    mkdirSync(join(cwd, ".auto"), { recursive: true });
    writeFileSync(
      join(cwd, ".auto", "log.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    return rebuildState(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("harness trace: diffHarnessEdits is a pure baseline compare", () => {
  const baseline = currentHarnessHashesFixture();
  const current = { ...baseline, ".auto/ideas.md": "b".repeat(64) };
  assert.deepEqual(diffHarnessEdits(baseline, current), [".auto/ideas.md"]);
  assert.deepEqual(diffHarnessEdits(baseline, { ...baseline }), []);
});

function currentHarnessHashesFixture(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of EDITABLE_SURFACE_FILES) {
    out[f] = "a".repeat(64);
  }
  return out;
}

// Guard against accidental drift: the traced set is exactly the spec's
// editable surface (harness-edit-loop whitelist + experience.md).
test("harness trace: the traced set matches the editable-surface whitelist", () => {
  assert.deepEqual(Object.keys(currentHarnessHashes("/nonexistent")).sort(), [
    ".auto/experience.md",
    ".auto/hooks/after.sh",
    ".auto/hooks/before.sh",
    ".auto/ideas.md",
    ".auto/prompt.md",
  ]);
  assert.ok(!existsSync("/nonexistent/.auto"));
});
