import { build } from "esbuild";
import { writeNotices } from "#build/licenses.mjs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const vendor = dirname(require.resolve("@excalidraw/excalidraw"));
await mkdir(join(dist, "ui"), { recursive: true });
const fonts = new Map();
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await collect(path);
    else if (item.name.endsWith(".woff2"))
      fonts.set(
        `./${path.slice(vendor.length + 1).replaceAll("\\", "/")}`,
        `data:font/woff2;base64,${(await readFile(path)).toString("base64")}`,
      );
  }
}
await collect(join(vendor, "fonts"));
const ui = await build({
  entryPoints: [join(root, "ui/main.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "external",
  metafile: true,
  write: false,
  outdir: join(dist, "ui"),
  conditions: ["production"],
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "dataurl" },
  plugins: [
    {
      name: "offline-excalidraw-fonts",
      setup(builder) {
        builder.onLoad({ filter: /excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/ }, async ({ path }) => {
          let contents = await readFile(path, "utf8");
          contents = contents.replace(/"(\.\/fonts\/[^"\n]+\.woff2)"/g, (match, name) =>
            JSON.stringify(fonts.get(name) ?? name),
          );
          return { contents, loader: "js" };
        });
      },
    },
  ],
});
const js = ui.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = ui.outputFiles.find((f) => f.path.endsWith(".css")).text;
// 以原始 UTF-8 字节拆分同插件资源，不把压缩体积当作 HTML/资源的解码后上限。
const bytes = Buffer.from(js);
const scripts = [];
let offset = 0;
while (offset < bytes.length) {
  let end = Math.min(offset + 4 * 1024 * 1024, bytes.length);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  const name = `bundle-${scripts.length}.txt`;
  scripts.push(name);
  await writeFile(join(dist, "ui", name), bytes.subarray(offset, end));
  offset = end;
}
await writeFile(
  join(dist, "ui/assets.json"),
  JSON.stringify({ scripts, scriptBytes: bytes.length, cssBytes: Buffer.byteLength(css) }),
);
await writeFile(join(dist, "ui/panel.css"), css);
const bootstrap = await build({
  entryPoints: [join(root, "ui/bootstrap.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  write: false,
});
await writeFile(
  join(dist, "ui/panel.html"),
  (await readFile(join(root, "ui/panel.html"), "utf8")).replace("/*__BOOTSTRAP__*/", () =>
    bootstrap.outputFiles[0].text.replaceAll("</script", "<\\/script"),
  ),
);
for (const f of ui.outputFiles.filter((f) => f.path.endsWith(".LEGAL.txt")))
  await writeFile(join(dist, "ui", f.path.split("/").pop()), f.contents);
const server = await build({
  metafile: true,
  entryPoints: [join(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  define: { __WORKER_FILE__: '"./store-worker.mjs"' },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
await build({
  entryPoints: [join(root, "src/adapters/store-worker.ts")],
  outfile: join(dist, "store-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
process.stdout.write(
  `Excalidraw offline UI: ${(bytes.length / 1024 / 1024).toFixed(2)} MiB in ${scripts.length} resources; CSS ${Math.round(Buffer.byteLength(css) / 1024)} KiB\n`,
);

await writeNotices([ui.metafile, server.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"));
