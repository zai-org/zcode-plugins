import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("all nine Craft panels explicitly request retention through real MCP resource metadata", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const catalog = JSON.parse(await readFile(join(root, "marketplace.json"), "utf8"));
  const names = ["cadcraft", "deckcraft", "designcraft", "gridcraft", "pdfcraft", "photocraft", "soundcraft", "vectorcraft", "wordcraft"];
  const temporary = await mkdtemp(join(tmpdir(), "craft-retention-"));
  try {
    await build({ entryPoints: [join(import.meta.dirname, "server.mjs")], outfile: join(temporary, "server.mjs"), bundle: true, platform: "node", format: "esm", banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
    await writeFile(join(temporary, "tools.json"), JSON.stringify([{ name: "test_operation", description: "fixture", inputSchema: { type: "object", properties: {} } }]));
    await writeFile(join(temporary, "panel.html"), "<html>retention fixture</html>");
    for (const name of names) {
      const entry = catalog.plugins.find((entry) => entry.name === name);
      const manifest = JSON.parse(await readFile(join(root, entry.source, ".zcode-plugin/plugin.json"), "utf8"));
      const pkg = JSON.parse(await readFile(join(root, "ui-plugins", name, "package.json"), "utf8"));
      assert.equal(manifest.version, entry.version);
      assert.equal(pkg.version, entry.version);
      await writeFile(join(temporary, "assets.json"), JSON.stringify({ name, version: pkg.version, title: name, assets: [] }));
      const transport = new StdioClientTransport({ command: process.execPath, args: [join(temporary, "server.mjs")], cwd: temporary });
      const client = new Client({ name: "retention-test", version: "1" });
      try {
        await client.connect(transport);
        const uri = `ui://${name}/panel.html`;
        const list = await client.listResources();
        assert.equal(list.resources.find((resource) => resource.uri === uri)?._meta?.ui?.backgroundRetention, true, name);
        const result = await client.readResource({ uri });
        assert.equal(result.contents[0]._meta?.ui?.backgroundRetention, true, name);
        if (name === "cadcraft") {
          const attached = await client.callTool({ name: "_editor_attach", arguments: {} });
          const token = attached.structuredContent.token;
          const pending = client.callTool({ name: "test_operation", arguments: {} });
          const polled = await client.callTool({ name: "_editor_poll", arguments: { token } });
          assert.equal(polled._meta?.["zcode/activity"], true);
          await client.callTool({ name: "_editor_reply", arguments: { token, id: polled.structuredContent.request.id, result: { content: [] } } });
          await pending;
        }
      } finally { await client.close(); }
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
