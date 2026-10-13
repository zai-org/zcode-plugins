// Exercise the installable package outside the checkout, without runtime dependencies.
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugins/markdown");
const temporary = await mkdtemp(join(tmpdir(), "markdown-artifact-"));
const installed = join(temporary, "markdown");
const workspace = join(temporary, "workspace");
let client;
try {
  await cp(source, installed, { recursive: true });
  await mkdir(workspace);
  const manifest = JSON.parse(await readFile(join(installed, ".zcode-plugin/plugin.json"), "utf8"));
  const server = manifest.mcpServers.markdown;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: server.args.map((arg) => arg.replaceAll("${ZCODE_PLUGIN_ROOT}", installed)),
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_PATH: "",
      ZCODE_WORKSPACE_ROOT: workspace,
      ZCODE_PLUGIN_DATA: join(temporary, "data"),
    },
    stderr: "pipe",
  });
  client = new Client({ name: "markdown-artifact-check", version: "1" });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, manifest.version);
  assert.equal((await client.listTools()).tools.length, 10);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const opened = await call("new_document", { path: "docs/sample.md", content: "# 示例\n\nDraft 中文内容。\n" });
  await call("patch_document", {
    path: "docs/sample.md",
    expectedRevision: opened.document.revision,
    ops: [{ find: "Draft", replace: "Ready" }],
  });
  assert.match(await readFile(join(workspace, "docs/sample.md"), "utf8"), /Ready 中文/);
  const html = (await client.readResource({ uri: "ui://markdown/panel.html" })).contents[0].text;
  assert.ok(html.includes('data-boot="connecting"'));
  assert.ok(html.includes("border-radius"));
  assert.ok(!html.includes("/*__BOOTSTRAP__*/") && !html.includes("/*__PANEL_CSS__*/"));
  const assets = JSON.parse((await client.readResource({ uri: "ui://markdown/assets/assets.json" })).contents[0].text);
  for (const file of assets.scripts)
    assert.ok((await client.readResource({ uri: `ui://markdown/assets/${file}` })).contents[0].text);
  for (const name of ["Lute", "KaTeX", "Mermaid", "Highlight", "DOMPurify", "mhchem", "diff-match-patch"])
    assert.ok((await readFile(join(installed, `dist/licenses/assets/${name}-LICENSE.txt`), "utf8")).length > 100);
  assert.ok(JSON.parse(await readFile(join(installed, "dist/licenses/packages.json"), "utf8")).length > 0);
  console.log(`PASS markdown@${manifest.version}: isolated installed artifact, tools, UTF-8 edits, UI resources and licenses`);
} finally {
  await client?.close();
  await rm(temporary, { recursive: true, force: true });
}
