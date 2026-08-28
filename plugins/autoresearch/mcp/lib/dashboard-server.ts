// Local HTTP + SSE dashboard server, hosted inside the MCP server process.
// Routes: / (live HTML), /autoresearch.jsonl (ledger raw), /events (SSE).
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildState, readSessionConfig } from "./ledger.ts";
import { renderLiveDashboard } from "./dashboard.ts";

const clients = new Set<ServerResponse>();
let server: Server | null = null;
let boundPort: number | null = null;

function broadcast(): void {
  for (const res of clients) {
    res.write(`event: jsonl-updated\ndata: ${Date.now()}\n\n`);
  }
}

function start(workCwd: string): Promise<{ port: number; url: string }> {
  if (server) {
    return Promise.resolve({
      port: boundPort ?? 0,
      url: `http://127.0.0.1:${boundPort ?? 0}`,
    });
  }
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
      if (addr && typeof addr === "object") {
        boundPort = addr.port;
        server = srv;
        resolve({ port: boundPort, url: `http://127.0.0.1:${boundPort}` });
      } else {
        reject(new Error("dashboard server failed to bind"));
      }
    });
  });
}

export function ensureDashboardServer(workCwd: string): Promise<{
  port: number;
  url: string;
}> {
  return start(workCwd);
}

export function broadcastDashboardUpdate(): void {
  if (server) broadcast();
}

export function dashboardServerInfo(): { url: string } | null {
  return server ? { url: `http://127.0.0.1:${boundPort ?? 0}` } : null;
}
