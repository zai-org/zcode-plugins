import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "excalidraw-bundle-"));
const workspace = join(temp, "workspace");
await mkdir(workspace);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist/server.mjs")],
  cwd: workspace,
  env: {
    ...process.env,
    ZCODE_WORKSPACE_ROOT: workspace,
    ZCODE_PLUGIN_DATA: join(temp, "data"),
  },
  stderr: "pipe",
});
const client = new Client({ name: "bundle-smoke", version: "1" });
try {
  await client.connect(transport);
  async function asset(name) {
    const r = await client.readResource({ uri: `ui://excalidraw/assets/${name}` });
    const text = r.contents[0].text;
    assert.ok(Buffer.byteLength(text) < 8 * 1024 * 1024);
    return text;
  }
  const panel = await client.readResource({ uri: "ui://excalidraw/panel.html" });
  assert.ok(Buffer.byteLength(panel.contents[0].text) < 4 * 1024 * 1024);
  const manifest = JSON.parse(await asset("assets.json"));
  const js = (await Promise.all(manifest.scripts.map(asset))).join("");
  assert.equal(Buffer.byteLength(js), manifest.scriptBytes);
  assert.equal(Buffer.byteLength(await asset("panel.css")), manifest.cssBytes);
  assert.ok(!js.includes('"./fonts/'), "All packaged font sources must be offline data URLs");
  new Script(js);
  await assert.rejects(
    client.readResource({ uri: "ui://excalidraw/assets/server.mjs" }),
  );
  const created = await client.callTool({
    name: "create_diagram",
    arguments: {
      id: "smoke",
      title: "打包验证",
      elements: [{ id: "box", label: { text: "中文" } }],
    },
  });
  assert.ok(!created.isError);
  const exported = await client.callTool({
    name: "export_diagram",
    arguments: { id: "smoke", expectedRevision: 1, path: "smoke.excalidraw" },
  });
  assert.ok(!exported.isError);
  assert.deepEqual(exported.structuredContent.document, created.structuredContent.document);
  assert.equal(
    JSON.parse(await readFile(join(workspace, "smoke.excalidraw"), "utf8")).elements.length,
    2,
  );
  console.log(
    `Built stdio MCP, offline UI (${manifest.scripts.length} resources), native export: OK`,
  );
} finally {
  await client.close();
  await transport.close();
  await rm(temp, { recursive: true, force: true });
}
