import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNotebookOwner } from "#nb/app/notebooks.ts";
import { createJupyterMcpServer } from "#nb/adapters/server.ts";
import { createServerRegistry } from "#nb/servers/registry.ts";

// stdout 只走 MCP 协议；诊断写 stderr。
const log = (line: string) => process.stderr.write(`[jupyter-notebook] ${line}\n`);

const workspaceRoot = resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
const pythonPath = process.env.JUPYTER_NOTEBOOK_PYTHON?.trim() || null;

const registry = createServerRegistry({
  workspaceRoot,
  pythonPath,
  onLog: (line) => log(`jupyter_server: ${line}`),
});
const owner = createNotebookOwner({ resolveServer: (server) => registry.resolve(server), onLog: log });
const server = createJupyterMcpServer({
  owner,
  registry,
  assetRoot: join(dirname(fileURLToPath(import.meta.url)), "ui"),
  log,
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // 先保存 notebook、关闭本插件创建的 session，再停止自己启动的 server；整体限时。
  const deadline = new Promise((done) => setTimeout(done, 8_000).unref());
  await Promise.race([
    (async () => {
      await owner.closeAll().catch(() => undefined);
      await registry.closeAll().catch(() => undefined);
    })(),
    deadline,
  ]);
  await server.close().catch(() => undefined);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdin.once("end", () => void shutdown());
await server.connect(new StdioServerTransport());
