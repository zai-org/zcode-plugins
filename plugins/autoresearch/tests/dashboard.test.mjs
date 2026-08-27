// Dashboard live server + workingDir tests (spawn the real MCP server).
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
const SERVER = join(ROOT, "mcp", "server.mjs");

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

function connect(cwd) {
  const proc = spawn("node", [SERVER], { cwd });
  let id = 0,
    buf = "";
  const pending = new Map();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.id != null && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
        }
      } catch {}
    }
  });
  const call = (method, params) =>
    new Promise((res) => {
      const i = id++;
      pending.set(i, res);
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
      );
    });
  const tool = async (name, args) => {
    const m = await call("tools/call", { name, arguments: args });
    return JSON.parse(m.result.content[0].text);
  };
  const close = () => proc.kill();
  return { call, tool, close };
}

async function withServer(cwd, fn) {
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
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    const exp = await s.tool("export_dashboard", {});
    assert.equal(exp.ok, true);
    assert.match(exp.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const html = await (await fetch(exp.url + "/")).text();
    assert.match(html, /<table/);
    assert.match(html, /EventSource\('\/events'\)/);

    const ledger = await (await fetch(exp.url + "/autoresearch.jsonl")).text();
    assert.match(ledger, /"type":"config"/);
    assert.match(ledger, /"type":"run"/);

    const sseRes = await fetch(exp.url + "/events");
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get("content-type"), /text\/event-stream/);
    await sseRes.body?.cancel();
  });
});

test("SSE broadcasts jsonl-updated after log_experiment (live refresh)", async () => {
  const cwd = tempRepo();
  await withServer(cwd, async (s) => {
    await s.tool("init_experiment", { name: "t", metric_name: "time_ms" });
    const exp = await s.tool("export_dashboard", {});
    const ctrl = new AbortController();
    const sseRes = await fetch(exp.url + "/events", { signal: ctrl.signal });
    const reader = sseRes.body.getReader();
    await s.tool("run_experiment", { command: "bash .auto/measure.sh" });
    await s.tool("log_experiment", {
      status: "keep",
      metric: 42,
      description: "x",
    });
    const { value } = await Promise.race([
      reader.read(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("no SSE event within 3s")), 3000),
      ),
    ]);
    const text = new TextDecoder().decode(value);
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
