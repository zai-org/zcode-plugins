// dashboard-server behavior: the live page follows a mid-process workingDir
// change, and a disconnecting SSE client can never crash the host process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import {
  ensureDashboardServer,
  broadcastDashboardUpdate,
  stopDashboardServer,
} from "../mcp/lib/dashboard-server.ts";

function sessionDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ar-dash-"));
  mkdirSync(join(dir, ".auto"), { recursive: true });
  writeFileSync(
    join(dir, ".auto", "log.jsonl"),
    JSON.stringify({
      type: "config",
      segment: 1,
      name,
      metricName: "time_ms",
      direction: "lower",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) + "\n",
  );
  return dir;
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function openEvents(url: string): Promise<{
  onClosed: Promise<void>;
  destroy(): void;
}> {
  return new Promise((resolve, reject) => {
    const req = get(`${url}/events`);
    req.on("response", (res) => {
      res.resume();
      const onClosed = new Promise<void>((r) => res.once("close", () => r()));
      resolve({ onClosed, destroy: () => req.destroy() });
    });
    req.on("error", reject);
  });
}

test("live dashboard follows a mid-process workingDir change", async () => {
  const a = sessionDir("alpha-seg");
  const b = sessionDir("beta-seg");
  try {
    const first = await ensureDashboardServer(a);
    assert.match(await fetchText(first.url), /alpha-seg/);
    // Same dir → the same server is reused.
    const again = await ensureDashboardServer(a);
    assert.equal(again.port, first.port);
    // Different dir → the server restarts and serves the new ledger.
    const second = await ensureDashboardServer(b);
    assert.notEqual(second.port, first.port);
    assert.match(await fetchText(second.url), /beta-seg/);
  } finally {
    stopDashboardServer();
  }
});

test("SSE clients of the old server are closed on restart", async () => {
  const a = sessionDir("alpha-restart");
  const b = sessionDir("beta-restart");
  try {
    const first = await ensureDashboardServer(a);
    const ev = await openEvents(first.url);
    await ensureDashboardServer(b);
    // The old server is torn down: the client's connection must end.
    await Promise.race([
      ev.onClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SSE client not closed")), 2000),
      ),
    ]);
  } finally {
    stopDashboardServer();
  }
});

test("a disconnecting SSE client cannot crash the host process", async () => {
  const a = sessionDir("alpha-disconnect");
  try {
    const { url } = await ensureDashboardServer(a);
    const conns = await Promise.all([
      openEvents(url),
      openEvents(url),
      openEvents(url),
    ]);
    for (const c of conns) c.destroy();
    // Broadcast before the server has processed the TCP close: exercises the
    // write-into-a-dying-socket path. The res 'error' listener is the guard;
    // the race window itself is not deterministically reproducible, so this
    // is a stress check that the server stays healthy afterwards.
    broadcastDashboardUpdate();
    broadcastDashboardUpdate();
    await new Promise((r) => setTimeout(r, 100));
    broadcastDashboardUpdate();
    assert.match(await fetchText(url), /alpha-disconnect/);
  } finally {
    stopDashboardServer();
  }
});
