/**
 * ai-pair build — assemble dist/ from src/ + ui/:
 *   1. bundle ui/panel.mjs (imports @modelcontextprotocol/ext-apps) with esbuild
 *      and inline it into dist/ui/panel.html (placeholder __AI_PAIR_BUNDLE__);
 *   2. copy src/server.mjs → dist/server.mjs and stamp dist/build-info.json;
 *   3. sync manifest/skills/README/dist into the install dir
 *      (ZCODE_PLUGIN_INSTALL_DIR; the root build passes it, standalone builds may not).
 * Server/runtime stay zero-dependency; esbuild is a build-time tool resolved
 * from the repo root node_modules (same approach as the showcase plugin).
 */
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, ".zcode-plugin/plugin.json"), "utf8"));
const installDir = process.env.ZCODE_PLUGIN_INSTALL_DIR;

const client = await build({
  entryPoints: [resolve(root, "ui/panel.mjs")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  write: false,
  legalComments: "inline",
});

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(join(root, "dist/ui"), { recursive: true });
await cp(join(root, "src/server.mjs"), join(root, "dist/server.mjs"));

const page = await readFile(join(root, "ui/panel.html"), "utf8");
await writeFile(
  join(root, "dist/ui/panel.html"),
  page.replace("__AI_PAIR_BUNDLE__", () =>
    client.outputFiles[0].text.replaceAll("</script", "<\\/script"),
  ),
);

await writeFile(
  join(root, "dist/build-info.json"),
  JSON.stringify({ name: manifest.name, version: manifest.version }) + "\n",
);

if (installDir) {
  await rm(join(installDir, "dist"), { recursive: true, force: true });
  await cp(join(root, "dist"), join(installDir, "dist"), { recursive: true });
  await cp(join(root, ".zcode-plugin"), join(installDir, ".zcode-plugin"), { recursive: true });
  await cp(join(root, "skills"), join(installDir, "skills"), { recursive: true });
  await cp(join(root, "README.md"), join(installDir, "README.md"));
  await cp(join(root, "LICENSE"), join(installDir, "LICENSE"));
}

console.log(`ai-pair ${manifest.version} built (panel bundle ${client.outputFiles[0].text.length} bytes)`);
