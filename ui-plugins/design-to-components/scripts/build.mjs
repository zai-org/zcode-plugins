import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeNotices } from "./licenses.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui"), { recursive: true });

// 宿主只提供 HTML 本身，JS 与 CSS 全部内联到一个页面里。
const ui = await build({
  metafile: true,
  entryPoints: [join(root, "ui/main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  outdir: join(dist, "ui"),
  legalComments: "none",
  loader: { ".css": "text" },
});
const js = ui.outputFiles.find((file) => file.path.endsWith(".js")).text;
const escape = (text) => text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pkg.zcode?.title ?? pkg.name}</title></head><body><div id="root"></div><script>${escape(js)}</script></body></html>`;
const htmlBytes = Buffer.byteLength(html);
if (htmlBytes > 4 * 1024 * 1024 - 64 * 1024) throw new Error(`panel.html is ${Math.round(htmlBytes / 1024)} KiB; keep it below 4 MiB`);
await writeFile(join(dist, "ui/panel.html"), html);

// 用不到、且许可证不明的可选依赖（package.json 的 zcode.stub）替换为空模块。
const stubs = pkg.zcode?.stub ?? [];
const stubPlugin = {
  name: "stub",
  setup(b) {
    if (!stubs.length) return;
    const filter = new RegExp(`^(${stubs.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`);
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = {};", loader: "js" }));
  },
};

const server = await build({
  plugins: [stubPlugin],
  metafile: true,
  external: ["esbuild-wasm"],
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url); import { fileURLToPath as __fu } from "node:url"; import { dirname as __dn } from "node:path"; const __filename=__fu(import.meta.url); const __dirname=__dn(__filename);',
  },
});

// 运行时需要的 wasm 等文件（package.json 的 zcode.assets：{ 包内路径: 输出文件名 }）。
const require = createRequire(join(root, "package.json"));
for (const [from, to] of Object.entries(pkg.zcode?.assets ?? {})) await copyFile(require.resolve(from), join(dist, to));

// 整个目录（package.json 的 zcode.dirs：{ "包名:子目录": 输出目录 }），例如 pdf.js 的 CMap。
for (const [spec, to] of Object.entries(pkg.zcode?.dirs ?? {})) {
  const [name, sub] = spec.split(":");
  const base = dirname(require.resolve(`${name}/package.json`));
  await cp(join(base, sub), join(dist, to), { recursive: true, filter: (path) => !/(_nowasm_fallback\.js|quickjs-eval\.(js|wasm))$/.test(path) });
}

// 组件目录页用的 React（浏览器、生产模式）、esbuild-wasm 整包、TypeScript 标准库和 React 类型声明。
const vendor = await build({ entryPoints: [join(root, "src/vendor-entry.ts")], outfile: join(dist, "vendor/react.js"), bundle: true, format: "iife", platform: "browser", minify: true, metafile: true, legalComments: "none", define: { "process.env.NODE_ENV": '"production"' } });
const nm = (p) => join(root, "node_modules", p);
await cp(nm("esbuild-wasm"), join(dist, "node_modules/esbuild-wasm"), { recursive: true, dereference: true, filter: (p) => !/esbuild-wasm[\\/](esm|lib[\\/]browser)/.test(p) });
await mkdir(join(dist, "types/ts-lib"), { recursive: true });
for (const f of (await import("node:fs")).readdirSync(nm("typescript/lib"))) if (/^lib\..*\.d\.ts$/.test(f)) await copyFile(nm(`typescript/lib/${f}`), join(dist, "types/ts-lib", f));
await cp(nm("@types/react"), join(dist, "types/react"), { recursive: true, dereference: true, filter: (p) => !/ts5\.0/.test(p) });
const csstype = join(dirname(dirname((await import("node:fs")).realpathSync(nm("@types/react")))), "csstype");
await cp(csstype, join(dist, "types/csstype"), { recursive: true, dereference: true });

await writeNotices([ui.metafile, server.metafile, vendor.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"), Object.keys(pkg.zcode?.assets ?? {}));
process.stdout.write(`${pkg.name}: panel ${Math.round(htmlBytes / 1024)} KiB, server ${Math.round((await readFile(join(dist, "server.mjs"))).length / 1024)} KiB\n`);
