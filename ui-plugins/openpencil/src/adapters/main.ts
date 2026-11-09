import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDesignRegistry } from "#openpencil/adapters/registry.ts";
import { createDesignServer } from "#openpencil/adapters/server.ts";
import { startUpstreamBridge } from "#openpencil/adapters/upstream.ts";
import { createEmptyFig } from "#openpencil/adapters/headless.ts";
import { BRIDGE_COMMANDS } from "#openpencil/contract.ts";

const workspaceRoot = await realpath(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
const workspaceKey = process.env.ZCODE_WORKSPACE_IDENTITY?.trim() || workspaceRoot;
const dataRoot =
  process.env.ZCODE_PLUGIN_DATA || join(homedir(), ".zcode", "plugin-data", "openpencil");
const dataDir = join(
  dataRoot,
  createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16),
);
await mkdir(dataDir, { recursive: true });
const bridge = await startUpstreamBridge({
  dataDir,
  workspaceRoot,
  enableEval: process.env.ZCODE_OPENPENCIL_ENABLE_EVAL === "true",
});
const registry = createDesignRegistry({
  workspaceRoot,
  createEmptyFig,
  onExternalChange: (doc) => {
    // 面板在线时立刻通知；离线时下一次 get_design_status 会带出 externalChange。
    void bridge.isConnected().then((live) => {
      if (!live) return;
      return bridge
        .sendRPC({
          command: BRIDGE_COMMANDS.externalChange,
          args: { documentId: doc.id, revision: doc.revision },
        })
        .catch(() => undefined);
    });
  },
});
const server = createDesignServer({
  registry,
  bridge,
  workspaceRoot,
  assetRoot: join(dirname(fileURLToPath(import.meta.url)), "ui"),
  enableEval: process.env.ZCODE_OPENPENCIL_ENABLE_EVAL === "true",
});
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  registry.close();
  await server.close();
  await bridge.close();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
process.stdin.once("end", () => void close());
await server.connect(new StdioServerTransport());
