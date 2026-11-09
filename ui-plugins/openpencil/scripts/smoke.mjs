// 冒烟：真实启动 dist/server.mjs（stdio），验证上游桥端口绑定、工具表与 panel 资源的回环 CSP。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "openpencil-smoke-"));
const data = await mkdtemp(join(tmpdir(), "openpencil-smoke-data-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist/server.mjs")],
  cwd: workspace,
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace, ZCODE_PLUGIN_DATA: data },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);
const { tools } = await client.listTools();
const status = await client.callTool({ name: "get_design_status", arguments: {} });
const panel = await client.readResource({ uri: "ui://openpencil/panel.html" });
const created = await client.callTool({
  name: "new_design",
  arguments: { path: "designs/smoke.fig" },
});
const health = await fetch(
  `${status.structuredContent.bridge.url.replace("ws://", "http://")}/health`,
).then((r) => r.json());
console.log(
  JSON.stringify(
    {
      tools: tools.length,
      bridge: status.structuredContent.bridge.url,
      panelMeta: panel.contents[0]._meta,
      created: created.structuredContent,
      health,
    },
    null,
    1,
  ),
);
await client.close();
await rm(workspace, { recursive: true, force: true });
await rm(data, { recursive: true, force: true });
