import { build } from "esbuild";
import { buildWebEditor } from "./build-web.mjs";
import { writeNotices } from "#build/licenses.mjs";
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await mkdir(join(dist, "ui"), { recursive: true });

// 浏览器包里会碰到只在 Node 分支执行的 import（core 的字体缓存、CanvasKit 胶水、unifont 的 undici）。
// 这些分支在浏览器里由 IS_BROWSER 守卫永不执行，用抛错的空模块顶替即可，不能让它们把 Node 内置模块拖进包。
const browserStubs = {
  name: "browser-stubs",
  setup(builder) {
    const filter =
      /^(node:.*|fs|fs\/promises|path|url|os|crypto|module|stream|events|undici|worker_threads|child_process)$/;
    builder.onResolve({ filter }, (args) => ({ path: args.path, namespace: "browser-stub" }));
    builder.onLoad({ filter: /.*/, namespace: "browser-stub" }, (args) => ({
      contents: `module.exports = new Proxy({}, { get: (_, key) => key === "__esModule" ? false : () => { throw new Error("${args.path} is unavailable in the plugin sandbox"); } });`,
      loader: "js",
    }));
  },
};
// yoga-layout 用了顶层 await，只能输出 ESM；引导页以 <script type="module"> 内联执行。
const ui = await buildWebEditor();
// .fig 解析 / 压缩 worker：上游按 import.meta.url 相对路径起 worker，面板里由 assets.ts 换成 blob: 脚本。
const coreDist = dirname(require.resolve("@open-pencil/core/package.json"));
for (const [name, entry] of [
  ["worker-fig-export.js", "dist/io/formats/fig/export-worker.js"],
  ["worker-fig-parse.js", "dist/kiwi/fig/parse/worker.js"],
]) {
  const worker = await build({
    entryPoints: [join(coreDist, entry)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    outdir: join(dist, "ui"),
    conditions: ["browser", "production"],
    plugins: [browserStubs],
  });
  await writeFile(
    join(dist, "ui", name),
    worker.outputFiles.find((f) => f.path.endsWith(".js")).text,
  );
}
const js = ui.js;
const css = ui.css;
// 以原始 UTF-8 字节拆分同插件资源（宿主 readResource 单次 8 MiB，HTML 4 MiB）。
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
  JSON.stringify({
    upstream: ui.provenance,
    scripts,
    scriptBytes: bytes.length,
    cssBytes: Buffer.byteLength(css),
  }),
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
await copyFile(
  join(dirname(require.resolve("canvaskit-wasm")), "canvaskit.wasm"),
  join(dist, "ui/canvaskit.wasm"),
);
for (const font of await readdir(join(root, "ui/fonts")))
  if (font.endsWith(".ttf")) await copyFile(join(root, "ui/fonts", font), join(dist, "ui", font));

const server = await build({
  metafile: true,
  entryPoints: [join(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // 原来 external 全部依赖，离开仓库就无法启动。仅保留按原包路径读取数据/WASM 的依赖，
  // Plugin staging 复制它们的运行时闭包；其余依赖内联，不依赖用户安装 npm 包。
  external: ["css-tree", "canvaskit-wasm"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
process.stdout.write(
  `OpenPencil panel: ${(bytes.length / 1024 / 1024).toFixed(2)} MiB JS in ${scripts.length} resources; CSS ${Math.round(Buffer.byteLength(css) / 1024)} KiB\n`,
);
await writeNotices([ui.metafile, server.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"));
