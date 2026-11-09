import { build } from "esbuild";
import { writeNotices } from "./licenses.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui"), { recursive: true });

// 宿主只提供 HTML 本身（相对资源会 404），所以 JS、CSS 与 KaTeX 字体全部内联。
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
});
const js = ui.outputFiles.find((file) => file.path.endsWith(".js")).text;

const styles = await build({
  metafile: true,
  entryPoints: [join(root, "ui/panel.css")],
  bundle: true,
  minify: true,
  write: false,
  outdir: join(dist, "ui"),
  // Chromium 只需要 woff2；其他字体格式不打包。
  loader: { ".woff2": "dataurl", ".woff": "empty", ".ttf": "empty" },
  legalComments: "none",
});
const css = styles.outputFiles.find((file) => file.path.endsWith(".css")).text;

// 转义结束标签，避免提前闭合 <script>/<style>。
const escape = (text, tag) => text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
const template = await readFile(join(root, "ui/panel.html"), "utf8");
const html = template
  .replace("/*__PANEL_CSS__*/", () => escape(css, "style"))
  .replace("/*__PANEL_JS__*/", () => escape(js, "script"));
await writeFile(join(dist, "ui/panel.html"), html);

const server = await build({
  metafile: true,
  entryPoints: [join(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
process.stdout.write(`Jupyter Notebook panel: ${Math.round(Buffer.byteLength(html) / 1024)} KiB\n`);

await writeNotices([ui.metafile, styles.metafile, server.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"));
