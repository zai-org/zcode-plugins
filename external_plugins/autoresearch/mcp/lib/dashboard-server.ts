// Local HTTP + SSE dashboard server, hosted inside the MCP server process.
// Routes: / (live HTML), /autoresearch.jsonl (ledger raw), /events (SSE).
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readLedger, rebuildHistory } from "./ledger.ts";
import { renderLiveDashboard } from "./dashboard.ts";
import { safeShortHash } from "./git.ts";

const clients = new Set<ServerResponse>();
let server: Server | null = null;
let boundPort: number | null = null;
let boundWorkCwd: string | null = null;

function stopServer(): void {
  if (!server) return;
  for (const res of clients) {
    clients.delete(res);
    try {
      res.destroy();
    } catch {
      /* already gone */
    }
  }
  // close() waits for idle connections; the ephemeral-port rebind below has
  // no conflict with it, so the callback is not awaited.
  server.close();
  server = null;
  boundPort = null;
  boundWorkCwd = null;
}

function broadcast(): void {
  // The MCP server process hosts this HTTP server: a single dead client must
  // never take the whole process down. Skip and evict broken connections.
  for (const res of clients) {
    if (res.destroyed) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(`event: jsonl-updated\ndata: ${Date.now()}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

function start(workCwd: string): Promise<{ port: number; url: string }> {
  if (server) {
    if (boundWorkCwd === workCwd) {
      return Promise.resolve({
        port: boundPort ?? 0,
        url: `http://127.0.0.1:${boundPort ?? 0}`,
      });
    }
    // The research dir moved mid-process (.auto/config.json workingDir edit):
    // restart so the live page follows instead of serving the old ledger.
    stopServer();
  }
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    // A disconnecting client can turn any write into an async EPIPE 'error'
    // event; swallow it — a dead connection is eviction (req 'close'), never
    // a reason for the hosting MCP process to die.
    res.on("error", () => {});
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
      // The ledger legitimately disappears (clear_experiments); respond 404
      // instead of throwing ENOENT inside the MCP server process.
      if (!existsSync(log)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("ledger not found (no active session)");
        return;
      }
      const ledger = readFileSync(log, "utf8");
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
      });
      res.end(ledger);
      return;
    }
    if (url.pathname === "/" || url.pathname === "") {
      const history = rebuildHistory(readLedger(workCwd));
      const html = renderLiveDashboard(history, {
        pin: safeShortHash(workCwd),
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  };
  const srv = createServer((req, res) => {
    // A malformed/hand-edited ledger must not take the MCP server process
    // down with it: isolate every request and return 500 instead.
    try {
      handle(req, res);
    } catch (err) {
      process.stderr.write(
        `[autoresearch] dashboard request failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      try {
        if (res.headersSent) res.end();
        else {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("dashboard request failed");
        }
      } catch {
        /* client already gone */
      }
    }
  });
  return new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        boundPort = addr.port;
        boundWorkCwd = workCwd;
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

/** Shut the live server down (research dir teardown, tests). */
export function stopDashboardServer(): void {
  stopServer();
}

export function broadcastDashboardUpdate(): void {
  if (server) broadcast();
}
