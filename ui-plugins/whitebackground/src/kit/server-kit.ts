import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { KitError } from "./workspace.ts";

export const HTML_MIME = "text/html;profile=mcp-app";
type Visibility = ("model" | "app")[];
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolOutput {
  text: string;
  structured?: Record<string, unknown>;
  images?: { data: string; mimeType: string }[];
}

export interface KitServerOptions {
  name: string;
  version: string;
  panelUri: string;
  surface: string;
  panelHtml: () => Promise<string>;
  log?: (line: string) => void;
  /** 页面资源的额外 _meta，例如 { "zcode/csp": { wasmUnsafeEval: true } }。 */
  panelMeta?: Record<string, unknown>;
}

/** 统一的工具注册：所有工具都关联同一个侧栏面板，错误带 code 返回给 Agent 与页面。 */
export function createKitServer(options: KitServerOptions) {
  const log = options.log ?? (() => undefined);
  const server = new McpServer({ name: options.name, version: options.version }, { capabilities: { logging: {} } });
  const panelMeta = { ui: { prefersBorder: false }, ...options.panelMeta };
  server.registerResource("panel", options.panelUri, { mimeType: HTML_MIME, _meta: panelMeta }, async () => ({
    contents: [{ uri: options.panelUri, mimeType: HTML_MIME, _meta: panelMeta, text: await options.panelHtml() }],
  }));

  const tool = (
    name: string,
    config: {
      description: string;
      input: Record<string, z.ZodType>;
      visibility?: Visibility;
      openPanel?: boolean;
      readOnly?: boolean;
      openWorld?: boolean;
      timeoutMs?: number;
    },
    run: (input: any) => Promise<ToolOutput>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        annotations: { readOnlyHint: !!config.readOnly, ...(config.readOnly ? {} : { destructiveHint: false }), openWorldHint: !!config.openWorld },
        _meta: {
          ui: { resourceUri: options.panelUri, surface: options.surface, visibility: config.visibility ?? ["model", "app"] },
          ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
          ...(config.openPanel ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } } : {}),
        },
      },
      async (input: unknown) => {
        try {
          const output = await run(input);
          const content: Content[] = [{ type: "text", text: output.text }];
          for (const image of output.images ?? []) content.push({ type: "image", ...image });
          return { content, ...(output.structured ? { structuredContent: output.structured } : {}) };
        } catch (error) {
          const code = error instanceof KitError ? error.code : "internal_error";
          const message = error instanceof Error ? error.message : String(error);
          if (!(error instanceof KitError)) log(`${name} failed: ${error instanceof Error ? error.stack : message}`);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: { error: { code, message } },
          };
        }
      },
    );
  };
  return { server, tool };
}

export async function readPanel(path: string) {
  return readFile(path, "utf8");
}
