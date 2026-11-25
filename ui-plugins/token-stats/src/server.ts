import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import { PLUGIN_VERSION, TOOL_NAME, VIEW_URI, toCardMetrics } from "./metrics.js";
import { readMetrics } from "./storage.js";

const server = new McpServer({ name: "token-stats", version: PLUGIN_VERSION });
const html = await readFile(new URL("./view.html", import.meta.url), "utf8");

server.registerResource(
  "Token statistics",
  VIEW_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
  }),
);

server.registerTool(
  TOOL_NAME,
  {
    title: "Token statistics",
    description:
      "Insert an inline card of observed model speed and token usage in the current ZCode session. Call only when the user asks to see token statistics.",
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: VIEW_URI, visibility: ["model"], showInline: true, prefersBorder: false },
    },
  },
  async (_input, extra) => {
    const sessionId = extra._meta?.session_id;
    const dataPath = process.env.ZCODE_PLUGIN_DATA;
    if (typeof sessionId !== "string" || !sessionId || !dataPath) {
      return {
        isError: true,
        content: [{ type: "text", text: "Token statistics require a local ZCode session." }],
      };
    }
    try {
      const metrics = toCardMetrics(await readMetrics(dataPath, sessionId));
      const summary = metrics.latest
        ? `Latest measured request: ${metrics.latest.outputTokensPerSecond.toFixed(1)} tok/s, ${metrics.latest.outputTokens} output tokens.`
        : "No completed generation metrics have been observed in this session.";
      return { content: [{ type: "text", text: summary }], structuredContent: { ...metrics } };
    } catch {
      return {
        isError: true,
        content: [{ type: "text", text: "The saved token statistics could not be read." }],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
