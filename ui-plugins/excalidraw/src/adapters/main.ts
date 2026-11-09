import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDocumentStore } from "#excalidraw/adapters/store.ts";
import { createExcalidrawServer } from "#excalidraw/adapters/server.ts";

const workspaceRoot = await realpath(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
const workspaceKey = process.env.ZCODE_WORKSPACE_IDENTITY?.trim() || workspaceRoot;
/** 插件数据目录：宿主注入 ZCODE_PLUGIN_DATA；单独跑 server 时退到 ~/.zcode/plugin-data/excalidraw。 */
const dataRoot =
  process.env.ZCODE_PLUGIN_DATA || join(homedir(), ".zcode", "plugin-data", "excalidraw");
const root = join(dataRoot, createHash("sha256").update(workspaceKey).digest("hex"));
const store = createDocumentStore(root);
const server = createExcalidrawServer({
  store,
  workspaceRoot,
  assetRoot: join(dirname(fileURLToPath(import.meta.url)), "ui"),
});
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await store.close();
}
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
process.stdin.once("end", () => {
  void close();
});
await server.connect(new StdioServerTransport());
