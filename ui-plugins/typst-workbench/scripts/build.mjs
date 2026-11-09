import { build } from "esbuild";
import { writeNotices } from "./licenses.mjs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui"), { recursive: true });

// 宿主只提供 HTML 本身（相对资源会 404），所以 JS 与 CSS 全部内联。
const ui = await build({
  metafile: true,
  entryPoints: [join(root, "ui/main.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  write: false,
  outdir: join(dist, "ui"),
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  // pdf.js 在浏览器里不会走到 Node 分支；这些内置模块不打包。
  external: ["module", "fs", "url", "path", "http", "https", "zlib", "canvas", "@napi-rs/canvas"],
});
const js = ui.outputFiles.find((file) => file.path.endsWith(".js")).text;

const styles = await build({
  metafile: true,
  entryPoints: [join(root, "ui/panel.css")],
  bundle: true,
  minify: true,
  write: false,
  outdir: join(dist, "ui"),
  legalComments: "none",
});
const css = styles.outputFiles.find((file) => file.path.endsWith(".css")).text;

// 转义结束标签，避免提前闭合 <script>/<style>。
const escape = (text, tag) => text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
const template = await readFile(join(root, "ui/panel.html"), "utf8");
const html = template
  .replace("/*__PANEL_CSS__*/", () => escape(css, "style"))
  .replace("/*__PANEL_JS__*/", () => escape(js, "script"));
const htmlBytes = Buffer.byteLength(html);
// 宿主对单个 HTML 资源的上限是 4 MiB。
if (htmlBytes > 4 * 1024 * 1024 - 64 * 1024) throw new Error(`panel.html is ${Math.round(htmlBytes / 1024)} KiB; the host limit is 4 MiB`);
await writeFile(join(dist, "ui/panel.html"), html);

const server = await build({
  metafile: true,
  entryPoints: [join(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // pdf.js 的 Node 渲染依赖（canvas）是可选的；server 只读取页数与文本。
  external: ["@napi-rs/canvas", "canvas"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});

// pdf.js 运行时数据：CMap（CJK 文本）、标准字体与 wasm 解码器，连同各自的许可证。
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(join(pdfjsRoot, folder), join(dist, "pdfjs", folder), {
    recursive: true,
    // 不需要的 JS 后备实现（沙箱页面不能执行）。
    filter: (path) => !/(_nowasm_fallback\.js|quickjs-eval\.(js|wasm))$/.test(path),
  });
}
const licenses = (await readdir(join(dist, "pdfjs", "wasm"))).filter((name) => name.startsWith("LICENSE"));
process.stdout.write(
  `Typst panel: ${Math.round(htmlBytes / 1024)} KiB; server: ${Math.round((await readFile(join(dist, "server.mjs"))).length / 1024)} KiB; pdf.js data licenses: ${licenses.length}\n`,
);

await writeNotices([ui.metafile, styles.metafile, server.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"));
