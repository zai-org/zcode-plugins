// zcode-usage-panel MCP server（stdio）
// 资源：
//   ui://zcode-usage-panel/index.html  面板页面（text/html;profile=mcp-app）
//   usage://current                    当前（最新交互）会话用量快照
//   usage://session/{sessionId}        指定会话用量快照
// 订阅：标准 resources/subscribe，DB 变化后推送 notifications/resources/updated
import { readFile } from "node:fs/promises";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { UsageDb } from "./db.js";
import { DbWatcher } from "./watch.js";
import { buildPromptComposition } from "./prompt.js";

const VERSION = "0.2.0";
const PANEL_URI = "ui://zcode-usage-panel/index.html";
const AUTO_URI = "usage://current";

const db = new UsageDb();
const subscribers = new Set<string>();
const server = new McpServer(
  { name: "zcode-usage-panel", version: VERSION },
  { capabilities: { resources: { subscribe: true } } },
);

const watcher = new DbWatcher(db, () => {
  for (const uri of subscribers) {
    void server.server.notification({
      method: "notifications/resources/updated",
      params: { uri },
    });
  }
});

let htmlCache: { body: string; at: number } | null = null;

async function readPanelHtml(): Promise<string> {
  const { stat } = await import("node:fs/promises");
  const file = new URL("./index.html", import.meta.url);
  const mtime = (await stat(file)).mtimeMs;
  if (htmlCache && htmlCache.at === mtime) return htmlCache.body;
  const body = await readFile(file, "utf8");
  htmlCache = { body, at: mtime };
  return body;
}

server.resource(
  "panel",
  PANEL_URI,
  { mimeType: "text/html;profile=mcp-app" },
  async () => ({
    contents: [{ uri: PANEL_URI, mimeType: "text/html;profile=mcp-app", text: await readPanelHtml() }],
  }),
);

server.resource(
  "usage-current",
  AUTO_URI,
  { mimeType: "application/json" },
  async () => ({
    contents: [{ uri: AUTO_URI, mimeType: "application/json", text: snapshotJson("auto", null) }],
  }),
);

server.resource(
  "usage-session",
  new ResourceTemplate("usage://session/{sessionId}", { list: undefined }),
  { mimeType: "application/json" },
  async (uri, vars) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: snapshotJson("pinned", String(vars.sessionId)),
      },
    ],
  }),
);

// 提示词构成：静态扫描（打开/切换会话时读一次即可，不订阅）
server.resource(
  "usage-prompt",
  new ResourceTemplate("usage://prompt/{sessionId}", { list: undefined }),
  { mimeType: "application/json" },
  async (uri, vars) => {
    try {
      const comp = await buildPromptComposition(db, String(vars.sessionId));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(comp) }] };
    } catch (e) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ scannedAt: Date.now(), errors: [e instanceof Error ? e.message : String(e)] }),
          },
        ],
      };
    }
  },
);

function snapshotJson(mode: "auto" | "pinned", sessionId: string | null): string {
  try {
    return JSON.stringify(db.buildSnapshot(mode, sessionId));
  } catch (e) {
    // 库整体不可读时也返回合法 JSON，面板负责展示错误
    return JSON.stringify({
      generatedAt: Date.now(),
      mode,
      session: null,
      sessions: [],
      totals: null,
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
}

// 低层处理订阅请求（McpServer 高层 API 不代管）
server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
  subscribers.add(req.params.uri);
  watcher.start();
  return {};
});
server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
  subscribers.delete(req.params.uri);
  if (subscribers.size === 0) watcher.stop();
  return {};
});

const shutdown = () => {
  watcher.stop();
  db.close();
};
process.on("exit", shutdown);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

await server.connect(new StdioServerTransport());
