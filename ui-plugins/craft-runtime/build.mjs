import { build, transform } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile, access, rm } from "node:fs/promises";
import { dirname, join, resolve, extname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { CHUNK_BYTES, sha256 } from "./assets.mjs";
import { normalization } from "./normalize-wasm.mjs";
import { overlayDigest } from "./overlay.mjs";
import { spawn } from "node:child_process";
import { cacheRoot, ensureSnapshot, readPatches } from "./snapshot.mjs";
import { ensureToolchain } from "./toolchain.mjs";

const runtime = dirname(fileURLToPath(import.meta.url));
const root = resolve(runtime, "../..");
const source = process.cwd();
const config = JSON.parse(await readFile(join(source, "upstream.json"), "utf8"));
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
const dist = join(source, "dist");
const snapshot = join(source, "web");
const cache = cacheRoot(root);
const exists = async (path) => access(path).then(() => true, () => false);
// web/ is not committed. Take it from the working tree or the snapshot cache;
// compile the pinned upstream only when neither holds the current inputs.
await ensureSnapshot({
  source, root,
  compile: async () => {
    const env = await ensureToolchain({ cache });
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [join(runtime, "compile.mjs")], { cwd: source, env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? accept() : reject(new Error(`${config.name}: Web compilation failed (${code})`)));
    });
  },
});
const provenance = JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf8"));
if (provenance.commit !== config.commit || provenance.repository !== config.repository)
  throw new Error("Web snapshot does not match pinned upstream; run build:web");
if (provenance.diagnosticPathNormalization !== normalization)
  throw new Error("Web snapshot needs build-path cleanup; run build:web");
if (provenance.automationOverlay !== await overlayDigest(config.name)) throw new Error("Automation overlay changed; run build:web");
const toolCatalog = await readFile(join(snapshot, "tools.json"));
if (sha256(toolCatalog) !== provenance.toolCatalogSha256) throw new Error("Tool catalog integrity check failed");
const patches = await readPatches(source);
if (JSON.stringify(provenance.patches || []) !== JSON.stringify(patches))
  throw new Error("Web snapshot patches changed; run build:web");
// Unpacked per checkout, never in the shared cache: two jobs build the same plugin at once.
const site = join(root, ".craft-cache", "web", config.name, config.commit);
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const file of provenance.files) {
  const path = resolve(site, file.path);
  const rel = relative(site, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !/^[a-f0-9]{64}$/.test(file.sha256))
    throw new Error("Invalid snapshot path or hash");
  const bytes = gunzipSync(await readFile(join(snapshot, file.sha256 + ".gz")), { maxOutputLength: file.bytes });
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error("Snapshot integrity check failed");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
let html = await readFile(join(site, "index.html"), "utf8");
const entry = /import\s+[^;]*?from\s*["']\.\/([^"']+\.js)["']/.exec(html)?.[1];
if (!entry) throw new Error(`${config.name}: cannot find Trunk's generated entry module`);
const wasmFiles = (await readdir(site)).filter((name) => name.endsWith(".wasm"));
if (wasmFiles.length !== 1) throw new Error(`${config.name}: expected exactly one WASM module`);
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "assets"), { recursive: true });
await writeFile(join(dist, "tools.json"), toolCatalog);
const assets = [];
const mime = (name) => ({
  ".wasm": "application/wasm", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".ttf": "font/ttf", ".otf": "font/otf",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
}[extname(name)] || "application/octet-stream");
async function add(path, bytes) {
  const id = sha256(bytes);
  await writeFile(join(dist, "assets", `${id}.gz`), gzipSync(bytes, { level: 9 }));
  assets.push({ path, id, bytes: bytes.length, parts: Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)), sha256: id, mime: mime(path) });
}
async function collect(folder, prefix = "") {
  for (const file of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + file.name;
    if (file.isDirectory()) await collect(join(folder, file.name), path + "/");
    else if (file.isFile() && path !== "index.html" && path !== entry && !path.endsWith(".map") && !path.endsWith(".br") && !path.endsWith(".gz"))
      await add(path, await readFile(join(folder, file.name)));
  }
}
await collect(site);
const glue = await build({
  entryPoints: [join(site, entry)], bundle: true, format: "esm", platform: "browser",
  target: "chrome120", write: false, legalComments: "inline", minify: true,
});
await add("app.js", glue.outputFiles[0].contents);
const manifest = {
  name: config.name, title: config.title, version: pkg.version,
  upstream: { repository: config.repository, commit: config.commit, version: config.version },
  entry: "app.js", wasm: wasmFiles[0], chunkBytes: CHUNK_BYTES, assets,
};
await writeFile(join(dist, "assets.json"), JSON.stringify(manifest, null, 2) + "\n");

html = html.replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<link\b[^>]*rel=["'](?:modulepreload|preload)["'][^>]*>/gi, "");
// Favicons are embedded rather than fetched from the host's HTML-only protocol.
for (const match of html.matchAll(/<link\b[^>]*rel=["']icon["'][^>]*>/gi)) {
  const path = /href=["']([^"']+)["']/.exec(match[0])?.[1]?.replace(/^\.\//, "");
  html = html.replace(match[0], path && await exists(join(site, path))
    ? match[0].replace(/href=["'][^"']+["']/, `href="data:${mime(path)};base64,${(await readFile(join(site, path))).toString("base64")}"`)
    : "");
}
const client = await build({
  entryPoints: [join(runtime, "client.mjs")], bundle: true, format: "esm", platform: "browser",
  target: "chrome120", write: false, minify: true, legalComments: "inline", metafile: true,
  define: { __CRAFT_SETTINGS__: JSON.stringify({ name: config.name, version: pkg.version }) },
});
const notice = `<div id="craft-notice"><span id="craft-status" role="status">正在加载…</span><button id="craft-retry-export" hidden>重新保存导出</button></div>`;
const style = `<style>
#craft-notice{position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);display:flex;align-items:center;gap:8px;padding:8px 12px;box-sizing:border-box;border-radius:6px;background:#20242b;color:#e4e8ef;font:12px system-ui;z-index:1000}
#craft-notice[hidden]{display:none}#craft-notice button{flex-shrink:0;background:#343b46;color:inherit;border:1px solid #555;border-radius:4px;padding:4px 8px;cursor:pointer}#craft-status{overflow-wrap:anywhere}#craft-status[data-error=true]{color:#ffa5a5}
#craft-stage{position:fixed;inset:0;overflow:hidden}#craft-stage canvas{max-height:100%;max-width:100%}
</style>`;
html = html.replace("</head>", style + "</head>")
  .replace(/<body([^>]*)>/i, `<body$1>${notice}<div id="craft-stage">`)
  .replace("</body>", () => `</div><script type="module">${client.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body>`);
// Replacement strings interpret $&, $` and $'; bundled SDK code can contain all of them.
// Parse the final embedded module, not just the input bundle.
for (const script of html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi))
  await transform(script[1], { loader: "js" });
await writeFile(join(dist, "panel.html"), html);
const server = await build({
  entryPoints: [join(runtime, "server.mjs")], outfile: join(dist, "server.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node24", legalComments: "linked", metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);' },
});

await cp(join(snapshot, "licenses"), join(dist, "licenses"), { recursive: true });
// Preserve full license texts for the JavaScript actually linked into the two adapters.
const packageDirs = new Map();
const scanned = new Set();
for (const input of new Set([...Object.keys(client.metafile.inputs), ...Object.keys(server.metafile.inputs)])) {
  let folder = dirname(resolve(source, input));
  if (!folder.includes(`${sep}node_modules${sep}`)) continue;
  while (!scanned.has(folder)) {
    scanned.add(folder);
    const manifestPath = join(folder, "package.json");
    if (await exists(manifestPath)) {
      const metadata = JSON.parse(await readFile(manifestPath, "utf8"));
      if (metadata.name) { packageDirs.set(folder, metadata); break; }
    }
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
}
const jsNotices = [];
for (const [folder, metadata] of [...packageDirs].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  jsNotices.push(`${metadata.name} ${metadata.version}\nLicense: ${metadata.license || "See accompanying text"}\n`);
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isFile() && /^(LICENSE|COPYING|NOTICE)([-.]|$)/i.test(entry.name))
      jsNotices.push(`--- ${entry.name} ---\n${await readFile(join(folder, entry.name), "utf8")}\n`);
  }
}
await writeFile(join(dist, "licenses/JAVASCRIPT-NOTICES.txt"), jsNotices.join("\n"));
await writeFile(join(dist, "BUILD.json"), JSON.stringify({
  ...provenance, application: config.name, pluginVersion: pkg.version,
  assets: assets.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })),
}, null, 2) + "\n");
console.log(`Built ${config.name}@${pkg.version}: ${assets.length} assets, ${(assets.reduce((sum, entry) => sum + entry.bytes, 0) / 1048576).toFixed(1)} MiB before compression`);
