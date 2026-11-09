import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ASSET_URI_PREFIX,
  DESIGN_CHUNK_BYTES,
  DESIGN_URI_PREFIX,
  DesignError,
  PANEL_URI,
  designRef,
} from "#openpencil/contract.ts";
import type { DesignRegistry } from "#openpencil/adapters/registry.ts";
import type { UpstreamBridge } from "#openpencil/adapters/upstream.ts";

const TEXT_ASSET = /^(assets\.json|panel\.css|bundle-\d+\.txt|worker-[a-z-]+\.js)$/;
const BINARY_ASSET = /^(canvaskit\.wasm|[A-Za-z0-9-]+\.ttf)$/;
const toBuffer = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** `ui://` 资源：面板 HTML（带资源级 CSP 回环 origin）、静态资产（文本 / 二进制白名单）、设计稿字节分片。 */
export function registerDesignResources(
  server: McpServer,
  {
    registry,
    bridge,
    assetRoot,
  }: { registry: DesignRegistry; bridge: UpstreamBridge; assetRoot: string },
) {
  server.registerResource(
    "panel",
    PANEL_URI,
    { mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: PANEL_URI,
          mimeType: "text/html;profile=mcp-app",
          text: await readFile(join(assetRoot, "panel.html"), "utf8"),
          // 面板要连本机 WebSocket 桥，端口运行时才知道，因此在资源级 _meta 中声明。
          _meta: {
            ui: { csp: { connectDomains: [bridge.endpoint.url] }, prefersBorder: false },
            // 默认 CSP 会拦截 Yoga / CanvasKit 的 WASM 和 .fig 的 kiwi schema 动态编译。
            // 仅为此面板声明所需能力，与 Agent 的 enableEval 工具开关无关。
            "zcode/csp": { wasmUnsafeEval: true, unsafeEval: true },
          },
        },
      ],
    }),
  );
  server.registerResource(
    "assets",
    new ResourceTemplate(`${ASSET_URI_PREFIX}{name}`, { list: undefined }),
    {},
    async (uri, { name }) => {
      if (typeof name !== "string") throw new DesignError("invalid_resource", "Unknown UI asset");
      const file = join(assetRoot, name);
      if (TEXT_ASSET.test(name)) {
        const text = await readFile(file, "utf8");
        if (Buffer.byteLength(text) > 8 * 1024 * 1024)
          throw new DesignError("resource_too_large", "Asset exceeds limit");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: name.endsWith(".json") ? "application/json" : "text/plain",
              text,
            },
          ],
        };
      }
      if (BINARY_ASSET.test(name)) {
        const size = (await stat(file)).size;
        if (size > 8 * 1024 * 1024)
          throw new DesignError("resource_too_large", "Asset exceeds limit");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/octet-stream",
              blob: (await readFile(file)).toString("base64"),
            },
          ],
        };
      }
      throw new DesignError("invalid_resource", "Unknown UI asset");
    },
  );
  server.registerResource(
    "design",
    new ResourceTemplate(`${DESIGN_URI_PREFIX}{id}/{part}`, { list: undefined }),
    {},
    async (uri, params) => {
      const id = String(params.id);
      const part = String(params.part);
      const doc = registry.get(id);
      const bytes = toBuffer(await registry.readBytes(id));
      const chunkCount = Math.max(1, Math.ceil(bytes.length / DESIGN_CHUNK_BYTES));
      if (part === "meta") {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                document: designRef(doc),
                byteLength: bytes.length,
                chunkBytes: DESIGN_CHUNK_BYTES,
                chunkCount,
                format: doc.format,
              }),
            },
          ],
        };
      }
      const match = /^chunk-(\d+)$/.exec(part);
      if (!match) throw new DesignError("invalid_resource", "Unknown design resource part");
      const index = Number(match[1]);
      if (index >= chunkCount)
        throw new DesignError("invalid_resource", "Chunk index out of range");
      const slice = bytes.subarray(index * DESIGN_CHUNK_BYTES, (index + 1) * DESIGN_CHUNK_BYTES);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/octet-stream", blob: slice.toString("base64") },
        ],
      };
    },
  );
}
