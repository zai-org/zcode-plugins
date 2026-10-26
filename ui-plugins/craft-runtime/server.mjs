import { readFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHUNK_BYTES, chunk, createAssetReader, readWorkspaceFile, sha256 } from "./assets.mjs";
import { installAutomation } from "./automation.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(directory, "assets.json"), "utf8"));
const { name, version, title } = config;
const panelUri = `ui://${name}/panel.html`;
const workspace = process.env.ZCODE_WORKSPACE_ROOT || process.cwd();
const files = new Map();
const openedFiles = [];
const readAsset = createAssetReader(join(directory, "assets"), config.assets);
const server = new McpServer({ name, version }, { capabilities: { resources: {}, tools: {} } });
const metadata = {
  ui: { prefersBorder: false, backgroundRetention: true },
  "zcode/csp": { wasmUnsafeEval: true },
};
const resource = (uri, bytes) => ({
  contents: [{ uri, mimeType: "application/octet-stream", blob: bytes.toString("base64") }],
});
server.registerResource("panel", panelUri, {
  mimeType: "text/html;profile=mcp-app", _meta: metadata,
}, async () => ({ contents: [{
  uri: panelUri, mimeType: "text/html;profile=mcp-app", _meta: metadata,
  text: await readFile(join(directory, "panel.html"), "utf8"),
}] }));
server.registerResource("assets", `ui://${name}/assets.json`, {
  mimeType: "application/json",
}, async () => ({ contents: [{
  uri: `ui://${name}/assets.json`, mimeType: "application/json", text: JSON.stringify(config),
}] }));
server.registerResource("asset-chunks", new ResourceTemplate(`ui://${name}/asset/{id}/{part}`, {
  list: undefined,
}), {}, async (uri, { id, part }) => resource(uri.href, chunk(await readAsset(id), part)));
server.registerResource("file-chunks", new ResourceTemplate(`ui://${name}/file/{id}/{part}`, {
  list: undefined,
}), {}, async (uri, { id, part }) => {
  const bytes = files.get(id);
  if (!bytes) throw new Error("File expired; open it again");
  return resource(uri.href, chunk(bytes, part));
});
server.registerTool("open_editor", {
  description: `Open ${title}'s interactive editor. Optionally load a file inside the current workspace. This opens the UI; it does not automate editing commands.`,
  inputSchema: { path: z.string().max(4096).optional().describe("Workspace-relative file path") },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    ui: { resourceUri: panelUri, surface: "editor", visibility: ["model", "app"] },
    "openai/ui": { preferredModelDisplayMode: "fullscreen" },
  },
}, async ({ path }) => {
  try {
    let file;
    if (path) {
      const opened = await readWorkspaceFile(workspace, path);
      const id = randomUUID();
      // At most two open requests are retained; asset data is held separately.
      while (openedFiles.length >= 2) files.delete(openedFiles.shift());
      openedFiles.push(id);
      files.set(id, opened.bytes);
      file = {
        id, name: basename(opened.path), path: opened.path,
        uri: `ui://${name}/file/${id}`, bytes: opened.bytes.length,
        parts: Math.max(1, Math.ceil(opened.bytes.length / CHUNK_BYTES)),
        sha256: sha256(opened.bytes),
      };
    }
    return {
      content: [{ type: "text", text: file ? `Requested opening ${file.path} in ${title}; check the editor for import results.` : `Opened ${title}.` }],
      structuredContent: { editor: name, ...(file ? { file } : {}) },
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
await installAutomation(server, { directory, workspace, name, files });
await server.connect(new StdioServerTransport());
