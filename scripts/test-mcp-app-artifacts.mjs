import assert from "node:assert/strict";
import { assertKicadRuntimeTools, prepareKicadRuntime } from "./prepare-kicad-runtime.mjs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMcpServers } from "./plugin-catalog.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "zcode-plugin-artifacts-"));
try {
  const marketplace = JSON.parse(
    await readFile(join(root, "dist/local-marketplace/marketplace.json"), "utf8"),
  );
  for (const entry of marketplace.plugins) {
    const { name } = entry;
    const source = join(root, "dist/local-marketplace", entry.source);
    const sourceManifest = JSON.parse(
      await readFile(join(source, ".zcode-plugin/plugin.json"), "utf8"),
    );
    if (!sourceManifest.ui?.surfaces?.length) continue;
    const short = name;
    const installed = join(temporary, name);
    assert.ok([`./plugins/${name}`, `./external_plugins/${name}`].includes(entry.source));
    await cp(join(root, "dist/local-marketplace", entry.source), installed, { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(installed, ".zcode-plugin/plugin.json"), "utf8"),
    );
    assert.equal(manifest.version, entry.version);
    const servers = await readMcpServers(installed, manifest);
    const expand = (value) =>
      value.replace(/\$\{([^}]+)\}/g, (_, key) => {
        const values = {
          ZCODE_PLUGIN_ROOT: installed,
          ZCODE_PROJECT_DIR: temporary,
          ZCODE_PLUGIN_DATA: join(temporary, `${name}-data`),
        };
        if (key in values) return values[key];
        if (key.startsWith("user_config."))
          return String(manifest.userConfig?.[key.slice(12)]?.default ?? "");
        throw new Error(`${name}: unresolved server variable ${key}`);
      });
    for (const serverName of new Set(manifest.ui.surfaces.map((surface) => surface.server))) {
      const server = servers[serverName];
      assert.ok(
        server?.command,
        `${name}/${serverName}: artifact test requires a local stdio server`,
      );
      const preparedEnv = name === "kicad"
        ? await prepareKicadRuntime(join(installed, "dist/server.mjs"), temporary)
        : {};
      const transport = new StdioClientTransport({
        command: server.command === "node" ? process.execPath : expand(server.command),
        args: (server.args ?? []).map(expand),
        cwd: temporary,
        env: {
          ...Object.fromEntries(
            Object.entries(server.env ?? {}).map(([key, value]) => [key, expand(value)]),
          ),
          ...preparedEnv,
          PATH: process.env.PATH ?? "",
          HOME: temporary,
          NODE_PATH: "",
          ZCODE_WORKSPACE_ROOT: temporary,
          ZCODE_PLUGIN_ROOT: installed,
          ZCODE_PLUGIN_DATA: join(temporary, `${short}-data`),
          ZCODE_DISK_CLEANER_TEST_TRASH: join(temporary, "trash"),
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "artifact-check", version: "1" });
      let stderr = "";
      transport.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      try {
        await client.connect(transport);
        assert.equal(client.getServerVersion()?.version, manifest.version);
        if (client.getServerCapabilities()?.tools || name === "kicad") {
          const { tools } = await client.listTools();
          if (name === "kicad") assertKicadRuntimeTools(tools);
        }
        for (const surface of manifest.ui.surfaces.filter((item) => item.server === serverName)) {
          const page = await client.readResource({ uri: surface.resourceUri });
          const html = page.contents[0]?.text;
          assert.equal(typeof html, "string");
          assert.ok(html.includes("<html"));
          assert.ok(!html.includes("/*__BOOTSTRAP__*/"));
          assert.ok(!html.includes("/*__JS__*/"));
        }
        const create = {
          excalidraw: {
            name: "create_diagram",
            arguments: { title: "Artifact test", elements: [] },
          },
          openpencil: { name: "new_design", arguments: { path: "artifact.fig" } },
        }[short];
        if (create) {
          const created = await client.callTool(create);
          assert.ok(!created.isError, JSON.stringify(created));
          assert.ok(created.structuredContent);
        }
        if (short === "excalidraw" || short === "openpencil") {
          const assets = await client.readResource({ uri: `ui://${name}/assets/assets.json` });
          const index = JSON.parse(assets.contents[0].text);
          for (const file of ["panel.css", ...index.scripts])
            assert.ok(
              (await client.readResource({ uri: `ui://${name}/assets/${file}` })).contents[0]?.text,
            );
        }
        console.log(`PASS isolated artifact ${name}@${manifest.version}`);
      } catch (error) {
        throw new Error(`${name}: ${error.message}\n${stderr}`, { cause: error });
      } finally {
        await client.close();
      }
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
