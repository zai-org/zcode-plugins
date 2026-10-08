// markdown 插件入口：解析环境、装配 registry 与 MCP 服务。
// stdout 只输出协议消息；调试信息写 stderr。
import { dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PLUGIN_VERSION } from "../contract.ts";
import { DocumentRegistry } from "./registry.ts";
import { RecentStore } from "./recent.ts";
import { registerServer } from "./server.ts";

const distRoot = dirname(fileURLToPath(import.meta.url));

const workspaceRoot = await realpath(process.env.ZCODE_WORKSPACE_ROOT || process.cwd()).catch(
  () => process.env.ZCODE_WORKSPACE_ROOT || process.cwd(),
);
const server = new McpServer(
  { name: "markdown", version: PLUGIN_VERSION },
  { capabilities: { resources: { subscribe: true, listChanged: true } } },
);
const dataDir = process.env.ZCODE_PLUGIN_DATA;
const registry = new DocumentRegistry(workspaceRoot);
const recent = new RecentStore(dataDir, workspaceRoot);
registerServer({ server, registry, workspaceRoot, assetRoot: distRoot, recent });

// 空闲收缩：--expose-gc 时，无打开文档的空闲期执行 GC，
// 让大文档操作造成的高水位 RSS 回落（V8 自身不会主动把内存还给 OS）。
const idleGcFn = globalThis.gc;
if (typeof idleGcFn === "function") {
  const periodMs = Number(process.env.MARKDOWN_IDLE_GC_MS) || 60_000;
  const idleGc = setInterval(() => {
    if (registry.list().length === 0) idleGcFn();
  }, periodMs);
  idleGc.unref();
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`markdown uncaught: ${error.stack ?? error.message}\n`);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`markdown unhandled rejection: ${String(reason)}\n`);
});

await server.connect(new StdioServerTransport());
process.stderr.write(`markdown ${PLUGIN_VERSION} ready\n`);
