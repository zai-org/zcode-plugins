// MCP 资源注册：panel 页面、编辑器资产分片、文档快照与订阅转发。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ASSET_URI_PREFIX, PANEL_URI, documentUri } from "../contract.ts";
import { readWorkspaceFile } from "./files.ts";
import { DocumentRegistry } from "./registry.ts";

const HTML_MIME = "text/html;profile=mcp-app";
const ASSET_PATTERN = /^(assets\.json|panel\.css|bundle-\d+\.txt)$/;
const VDITOR_PATTERN = /^vditor\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(js|css|json|png|woff2?)$/;

export interface ResourceContext {
  server: McpServer;
  registry: DocumentRegistry;
  workspaceRoot: string;
  /** 安装产物根（dist/），panel 与资产从这里读。 */
  assetRoot: string;
}

export function registerResources({ server, registry, workspaceRoot, assetRoot }: ResourceContext) {
  const subscribed = new Set<string>();
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    subscribed.add(params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    subscribed.delete(params.uri);
    return {};
  });
  registry.onChange(async (id) => {
    const uri = documentUri(id);
    if (subscribed.has(uri)) await server.server.sendResourceUpdated({ uri });
  });

  server.registerResource(
    "panel",
    PANEL_URI,
    { mimeType: HTML_MIME, description: "Markdown editor panel (inline card / editor surface)" },
    async () => ({
      contents: [{ uri: PANEL_URI, mimeType: HTML_MIME, text: await readPage(assetRoot) }],
    }),
  );

  server.registerResource(
    "assets",
    // {+name} 保留扩展可跨 "/"，用于 vditor/js/lute/lute.min.js 这类嵌套路径。
    new ResourceTemplate(`${ASSET_URI_PREFIX}{+name}`, { list: undefined }),
    { mimeType: "text/plain", description: "Editor bundle chunks and offline Vditor assets" },
    async (uri, variables) => {
      const name = String(variables.name);
      const isChunk = ASSET_PATTERN.test(name);
      if (
        (!isChunk && !VDITOR_PATTERN.test(name)) ||
        name.split("/").some((part) => part === "." || part === "..")
      ) throw new Error(`Unknown asset: ${name}`);
      const bytes = await readFile(join(assetRoot, "ui", name));
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("resource_too_large");
      const mimeType = name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".json")
            ? "application/json"
            : "text/plain";
      return { contents: [{ uri: uri.href, mimeType, text: bytes.toString("utf8") }] };
    },
  );

  server.registerResource(
    "document",
    new ResourceTemplate("ui://markdown/document/{id}", { list: undefined }),
    {
      mimeType: "application/json",
      description: "Current document snapshot; subscribe to receive updates",
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const doc = registry.get(id);
      if (!doc) throw new Error(`Unknown document: ${id}`);
      const { content } = await readWorkspaceFile(workspaceRoot, doc.path);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              document: { id: doc.id, path: doc.path, revision: doc.revision },
              content,
              externalChange: doc.externalChange,
            }),
          },
        ],
      };
    },
  );
}

async function readPage(assetRoot: string) {
  const html = await readFile(join(assetRoot, "ui", "panel.html"), "utf8");
  if (html.includes("/*__BOOTSTRAP__*/"))
    throw new Error(
      "Build markdown first and launch dist/server.mjs (pnpm --filter @zcode/plugin-markdown build)",
    );
  return html;
}
