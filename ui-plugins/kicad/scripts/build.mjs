#!/usr/bin/env node
// Builds dist/: panel.html (one self-contained page), server.mjs (launcher), py/ (Python MCP server + the vendored KiCad worker), THIRD_PARTY_NOTICES.txt.
// The root builder (zcode-plugins `pnpm build`) copies dist/ into the installable directory and writes the completion marker itself.
//
// The KiCad worker is the Python package server/kicad/, copied into dist/py/ with the rest of server/.
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const INSTALL = ["../../external_plugins/kicad", "../../plugins/kicad"].map((p) => join(ROOT, p));
const manifestDir = (await Promise.all(INSTALL.map((d) => stat(join(d, ".zcode-plugin/plugin.json")).then(() => d, () => null)))).find(Boolean);
if (!manifestDir) throw new Error("plugin manifest not found next to ui-plugins/kicad");
const manifest = JSON.parse(await readFile(join(manifestDir, ".zcode-plugin/plugin.json"), "utf8"));
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error(`version mismatch: manifest ${manifest.version} vs package ${pkg.version}`);

// esbuild and the pinned SDKs come from the workspace install; ZT_PLUGINS_SRC points at a zcode-plugins checkout when this tree is built outside one.
const search = [ROOT, ...(process.env.ZT_PLUGINS_SRC ? [resolve(process.env.ZT_PLUGINS_SRC)] : [])];
const esbuild = search.map((d) => { try { return createRequire(join(d, "package.json"))("esbuild"); } catch { return null; } }).find(Boolean);
if (!esbuild) throw new Error("esbuild not found: run pnpm install, or set ZT_PLUGINS_SRC to a zcode-plugins checkout");
const nodePaths = search.map((d) => join(d, "node_modules"));

await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, "py"), { recursive: true });

// 1. panel
const built = await esbuild.build({ entryPoints: [join(ROOT, "ui/src/main.js")], bundle: true, format: "iife", platform: "browser", target: ["es2022"], minify: true,
  legalComments: "none", write: false, logLevel: "warning", nodePaths, metafile: true, loader: { ".svg": "text" }, define: { __PLUGIN_VERSION__: JSON.stringify(pkg.version) } });
const js = built.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile(join(ROOT, "ui/src/style.css"), "utf8");
const html = (await readFile(join(ROOT, "ui/template.html"), "utf8")).replace("__TITLE__", "KiCad board").replace("/*__CSS__*/", () => css.trim()).replace("/*__JS__*/", () => js.trim());
await writeFile(join(DIST, "panel.html"), html);

// 2. launcher + python server (+ vendored worker)
await cp(join(ROOT, "src/server.mjs"), join(DIST, "server.mjs"));
await cp(join(ROOT, "server"), join(DIST, "py"), { recursive: true, filter: (p) => !p.includes("__pycache__") });
await writeFile(join(DIST, "py/plugin_version.py"), `VERSION = ${JSON.stringify(manifest.version)}\n`); // serverInfo.version must equal the manifest version (zcode-plugins artifact test)

// 3. notices for what is bundled into panel.html
const packages = new Map();
for (const input of Object.keys(built.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let dir = dirname(resolve(ROOT, input));
  for (; dir !== dirname(dir); dir = dirname(dir)) {
    try { const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8")); if (meta.name && meta.version) { packages.set(dir, meta); break; } } catch { /* keep walking up */ }
  }
}
let notices = "ZCode KiCad plugin — bundled dependency notices (panel.html)\n\n";
for (const [dir, meta] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  let license = "";
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "license", "license.md"]) { try { license = await readFile(join(dir, name), "utf8"); break; } catch { /* next */ } }
  if (!license) throw new Error(`Missing bundled dependency license: ${meta.name}`);
  notices += `===== ${meta.name} ${meta.version} =====\n${license}\n\n`;
}
await writeFile(join(DIST, "THIRD_PARTY_NOTICES.txt"), notices);

for (const server of Object.values(manifest.mcpServers || {})) for (const arg of server.args || []) {
  if (!arg.includes("${ZCODE_PLUGIN_ROOT}/dist/")) continue; // every local path the manifest points at must exist in the build
  await stat(join(DIST, arg.split("${ZCODE_PLUGIN_ROOT}/dist/")[1])).catch(() => { throw new Error(`manifest path missing from build: ${arg}`); });
}
process.stdout.write(`kicad plugin ${manifest.version}: dist/panel.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, ${packages.size} bundled packages noticed\n`);
