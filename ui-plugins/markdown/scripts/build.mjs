// 构建产物（安装目录 dist/）：
// - server.mjs            单文件 Node 入口（src/adapters/main.ts 打包）
// - ui/panel.html         内联样式和 bootstrap 的页面外壳
// - ui/panel.css          页面样式（同时在 HTML head 内联，避免首帧无样式）
// - ui/bundle-N.txt       页面主 bundle（含 Vditor 核心）的 4 MiB 分片
// - ui/assets.json        分片清单
// - ui/vditor/<rel>       Vditor 懒加载资源（lute/KaTeX/mermaid/高亮/图标/主题/i18n），
//                         KaTeX 字体在构建期以 data: 内联进 CSS（font-src 允许 data:）。
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { utf8Chunks } from "./utf8-chunks.mjs";
import { collectLicenses } from "./licenses.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const vditorDist = resolve(root, "node_modules/vditor/dist");
await mkdir(join(dist, "ui"), { recursive: true });

// ---- Vditor 离线资产 ----
const VDITOR_ASSETS = [
  "js/lute/lute.min.js",
  "js/highlight.js/highlight.min.js",
  "js/highlight.js/third-languages.js",
  "js/highlight.js/styles/github.min.css",
  "js/highlight.js/styles/github-dark.min.css",
  "js/icons/ant.js",
  "js/katex/katex.min.js",
  "js/katex/katex.min.css",
  "js/katex/mhchem.min.js",
  "js/mermaid/mermaid.min.js",
  "css/content-theme/light.css",
  "css/content-theme/dark.css",
  "js/i18n/zh_CN.js",
  "js/i18n/en_US.js",
];
await mkdir(join(dist, "ui/vditor"), { recursive: true });
for (const rel of VDITOR_ASSETS) {
  await mkdir(dirname(join(dist, "ui/vditor", rel)), { recursive: true });
  await cp(join(vditorDist, rel), join(dist, "ui/vditor", rel));
}
// KaTeX 字体 data: 内联。注意 (?![\w.])：woff 文件名是同名 woff2 的前缀，
// 朴素替换会把 woff2 的 URL 切坏。
{
  const katexCssPath = join(dist, "ui/vditor/js/katex/katex.min.css");
  let css = await readFile(katexCssPath, "utf8");
  const fontsDir = join(vditorDist, "js/katex/fonts");
  for (const font of await readdir(fontsDir)) {
    const data = (await readFile(join(fontsDir, font))).toString("base64");
    const mime = font.endsWith(".woff2")
      ? "font/woff2"
      : font.endsWith(".woff")
        ? "font/woff"
        : "font/ttf";
    const pattern = new RegExp(
      `fonts/${font.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.])`,
      "g",
    );
    css = css.replace(pattern, `data:${mime};base64,${data}`);
  }
  await writeFile(katexCssPath, css);
}

// ---- 页面 bundle：IIFE（客户端逻辑 + Vditor 核心）----
const page = await build({
  entryPoints: [resolve(root, "ui/main.ts")],
  bundle: true,
  metafile: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  write: false,
  minify: true,
  legalComments: "inline",
});
const js = Buffer.from(page.outputFiles[0].text, "utf8");
// 4 MiB 分片，回退避开 UTF-8 续字节，切分点不落在多字节字符中间。
const parts = utf8Chunks(js);
await Promise.all(
  parts.map((text, index) => writeFile(join(dist, "ui", `bundle-${index}.txt`), text)),
);
await writeFile(
  join(dist, "ui", "assets.json"),
  `${JSON.stringify({ scripts: parts.map((_, index) => `bundle-${index}.txt`) }, null, 2)}\n`,
);
// 页面样式 = Vditor 基础样式（工具栏/图标布局）在前 + 宿主 token 映射在后覆盖。
// 沙箱 style-src 无 blob:/外链，必须内联；vditor index.css 仅含 data: URI，可安全拼接。
{
  const vditorCss = await readFile(join(vditorDist, "index.css"), "utf8");
  const ownCss = (
    await Promise.all(
      ["panel.css", "editor.css", "docs-menu.css", "boot.css"].map((name) =>
        readFile(resolve(root, "ui", name), "utf8"),
      ),
    )
  ).join("\n");
  await writeFile(join(dist, "ui", "panel.css"), `${vditorCss}\n${ownCss}`);
}

// ---- bootstrap：minify 后内联进 panel.html ----
const bootstrap = await build({
  entryPoints: [resolve(root, "ui/bootstrap.ts")],
  bundle: true,
  metafile: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  write: false,
  minify: true,
  legalComments: "inline",
});
const escapeScript = (code) => code.replaceAll("</script", "<\\/script");
const html = await readFile(resolve(root, "ui/panel.html"), "utf8");
if (!html.includes("/*__BOOTSTRAP__*/")) throw new Error("panel.html missing bootstrap marker");
const panelCss = await readFile(join(dist, "ui/panel.css"), "utf8");
if (!html.includes("/*__PANEL_CSS__*/")) throw new Error("panel.html missing CSS marker");
await writeFile(
  join(dist, "ui/panel.html"),
  html
    .replace("/*__PANEL_CSS__*/", () => panelCss.replaceAll("</style", "<\\/style"))
    .replace("/*__BOOTSTRAP__*/", () => escapeScript(bootstrap.outputFiles[0].text)),
);

// ---- 服务端：单文件 Node ESM ----
const server = await build({
  entryPoints: [resolve(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  metafile: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
await collectLicenses(root, join(dist, "licenses"), [page.metafile, bootstrap.metafile, server.metafile]);
await cp(join(root, "licenses"), join(dist, "licenses/assets"), { recursive: true });
process.stdout.write(
  `markdown panel: ${parts.length} chunk(s), ${(js.length / 1048576).toFixed(2)} MiB JS; vditor assets: ${VDITOR_ASSETS.length}\n`,
);
