// Local HTTP + SSE dashboard server, hosted inside the MCP server process.
// Routes: / (live HTML), /autoresearch.jsonl (ledger raw), /events (SSE).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildState, readSessionConfig } from "./ledger.mjs";
import { renderLiveDashboard } from "./dashboard.mjs";

const clients = new Set();
let server = null;
let boundPort = null;

function broadcast() {
  for (const res of clients) {
    res.write(`event: jsonl-updated\ndata: ${Date.now()}\n\n`);
  }
}

function start(workCwd) {
  if (server) return { port: boundPort, url: `http://127.0.0.1:${boundPort}` };
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/autoresearch.jsonl") {
      const log = join(workCwd, ".auto", "log.jsonl");
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
      });
      res.end(readFileSync(log, "utf8"));
      return;
    }
    if (url.pathname === "/" || url.pathname === "") {
      const state = rebuildState(workCwd, {
        maxIterations: Number(readSessionConfig(workCwd).maxIterations) || 20,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderLiveDashboard(state));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      boundPort = addr.port;
      server = srv;
      resolve({ port: boundPort, url: `http://127.0.0.1:${boundPort}` });
    });
  });
}

export function ensureDashboardServer(workCwd) {
  return start(workCwd);
}

export function broadcastDashboardUpdate() {
  if (server) broadcast();
}

export function dashboardServerInfo() {
  return server ? { url: `http://127.0.0.1:${boundPort}` } : null;
}
