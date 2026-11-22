#!/usr/bin/env node
/**
 * Build TurnLens runtime artifacts for the official plugin repository.
 *
 * Outputs:
 *   dist/ui/panel.html  inlined MCP Apps panel
 *   dist/server.mjs     MCP stdio server
 *
 * The MCP Apps browser runtime is vendored as an ES module. Inline module
 * scripts cannot be imported, so the trailing `export {...}` block is replaced
 * with a `window.McpApps` assignment before the runtime and the panel UI are
 * concatenated.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const [template, css, ui, sdk] = await Promise.all([
  readFile(path.join(root, "src", "panel.html.template"), "utf8"),
  readFile(path.join(root, "src", "panel.css"), "utf8"),
  readFile(path.join(root, "src", "panel-ui.js"), "utf8"),
  readFile(path.join(root, "vendor", "app-with-deps.js"), "utf8"),
]);

const exportMatch = sdk.match(/export\{([\s\S]*?)\};?\s*$/);
if (!exportMatch) throw new Error("Vendored MCP Apps SDK has no trailing export block");

const entries = exportMatch[1]
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function localName(exportedName) {
  for (const entry of entries) {
    const aliased = entry.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
    if (aliased) {
      if (aliased[2] === exportedName) return aliased[1];
      continue;
    }
    if (entry === exportedName) return entry;
  }
  return null;
}

const names = {
  App: localName("App"),
  applyDocumentTheme: localName("applyDocumentTheme"),
  applyHostStyleVariables: localName("applyHostStyleVariables"),
  applyHostFonts: localName("applyHostFonts"),
};
for (const [name, local] of Object.entries(names)) {
  if (!local) throw new Error(`Vendored MCP Apps SDK does not export ${name}`);
}

const sdkWithGlobal = `${sdk.slice(0, exportMatch.index)}window.McpApps={App:${names.App},applyDocumentTheme:${names.applyDocumentTheme},applyHostStyleVariables:${names.applyHostStyleVariables},applyHostFonts:${names.applyHostFonts}};\n`;

const html = template
  .replace("__CSS__", () => css.trimEnd())
  .replace("__SDK__", () => sdkWithGlobal.trimEnd())
  .replace("__UI__", () => ui.trimEnd());

const htmlBytes = Buffer.byteLength(html);
if (htmlBytes > 4 * 1024 * 1024) {
  throw new Error(`panel.html is ${Math.round(htmlBytes / 1024)} KiB; the host limit is 4 MiB`);
}

await mkdir(path.join(dist, "ui"), { recursive: true });
await writeFile(path.join(dist, "ui", "panel.html"), html, "utf8");
await copyFile(path.join(root, "server", "server.mjs"), path.join(dist, "server.mjs"));
console.log(`Wrote dist/ui/panel.html (${htmlBytes} bytes) and dist/server.mjs`);
