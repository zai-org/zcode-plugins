import { expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.ts";
import { DocumentRegistry } from "./registry.ts";

it.each(["vditor/../../secret.js", "vditor/./secret.js", "vditor/%2e%2e/secret.js"])(
  "rejects asset traversal before touching the filesystem: %s",
  async (name) => {
    let readAsset!: (uri: URL, variables: { name: string }) => Promise<unknown>;
    const server = {
      server: { setRequestHandler() {} },
      registerResource(label: string, _uri: unknown, _meta: unknown, handler: typeof readAsset) {
        if (label === "assets") readAsset = handler;
      },
    } as unknown as McpServer;
    registerResources({ server, registry: new DocumentRegistry("."), workspaceRoot: ".", assetRoot: "." });
    await expect(readAsset(new URL("ui://markdown/assets/test"), { name }))
      .rejects.toThrow("Unknown asset");
  },
);
