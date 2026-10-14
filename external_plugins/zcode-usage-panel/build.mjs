// 构建：server bundle (ESM/node) + 面板页面（IIFE 内联进自包含 HTML）
// 产物输出到 payload/dist/（安装载荷，随仓库分发）。
import { build } from "esbuild";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
// OUT_DIR 供发布构建覆盖输出位置（如官方市场仓库的 payload/dist），默认本地 dev 市场。
const outDir = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : resolve(root, "payload/dist");
mkdirSync(outDir, { recursive: true });

// ---------- server ----------
await build({
  entryPoints: [resolve(root, "src/server/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: resolve(outDir, "server.mjs"),
  legalComments: "inline",
  logLevel: "info",
});

// ---------- page → 单文件 HTML ----------
const page = await build({
  entryPoints: [resolve(root, "src/page/main.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "inline",
  logLevel: "info",
});
const js = page.outputFiles[0].text;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>用量面板</title>
<style>
:root{--bg:#f7f7f8;--card:#ffffff;--line:#e4e4e7;--text:#18181b;--dim:#71717a;
--accent:#2563eb;--bar:#60a5fa;--err:#dc2626;--ok:#16a34a;--warn:#d97706;
--thead:#f4f4f5;--row-hover:#f0f4ff}
html[data-theme=dark]{--bg:#17181a;--card:#1e2023;--line:#2c2e32;--text:#e6e6e9;--dim:#9d9da6;
--accent:#60a5fa;--bar:#3b82f6;--err:#f87171;--ok:#4ade80;--warn:#fbbf24;
--thead:#242629;--row-hover:#22262e}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
body{padding:10px 10px 14px}
.head{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.head-row{display:flex;align-items:center;gap:6px}
.brand{font-weight:700;font-size:13px}
.status-text{color:var(--dim);font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:auto}
.dot-live{background:var(--ok)}
.dot-poll{background:var(--warn)}
.dot-error{background:var(--err)}
.dot-off{background:var(--dim)}
.session-select{width:100%;padding:4px 6px;border:1px solid var(--line);border-radius:6px;
background:var(--card);color:var(--text);font-size:12px}
.session-meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--dim);font-size:10.5px}
.banner{background:color-mix(in srgb,var(--err) 12%,transparent);border:1px solid var(--err);
color:var(--text);border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:11px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.card-title{color:var(--dim);font-size:10.5px}
.card-value{font-size:16px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.card-sub{color:var(--dim);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tps-block{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:8px;margin-bottom:10px}
.tps-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}
.tps-label{color:var(--dim);font-size:11px}
.tps-now{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.spark{width:100%;height:44px;display:block}
.spark-line{fill:none;stroke:var(--bar);stroke-width:1.5}
.spark-avg{stroke:var(--dim);stroke-width:0.75;stroke-dasharray:3 3;opacity:.7}
.tps-foot{color:var(--dim);font-size:10.5px;margin-top:4px}
.sec{background:var(--card);border:1px solid var(--line);border-radius:8px;
margin-bottom:8px;overflow:hidden}
.sec-summary{display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;
font-weight:600;user-select:none;list-style:none}
.sec-summary::-webkit-details-marker{display:none}
.sec[open]>.sec-summary .arrow{transform:rotate(90deg)}
.arrow{display:inline-block;transition:transform .12s;color:var(--dim);font-size:10px}
.sec-hint{margin-left:auto;color:var(--dim);font-weight:400;font-size:10.5px}
.sec-body{padding:0 10px 10px}
.grp{margin-bottom:8px}
.grp:last-child{margin-bottom:0}
.grp-title{padding:4px 0;font-size:11px}
.kv-list{display:flex;flex-direction:column;gap:2px}
.kv{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.kv-v{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.kv-k{color:var(--dim);font-size:10.5px;white-space:nowrap;flex-shrink:0}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}
.sub-sec{margin-bottom:6px;border:1px solid var(--line);border-radius:6px}
.sub-summary{display:flex;align-items:center;gap:5px;padding:4px 8px;cursor:pointer;font-size:11px;user-select:none;list-style:none}
.sub-summary::-webkit-details-marker{display:none}
.sub-sec[open]>.sub-summary .arrow{transform:rotate(90deg)}
.sub-sec .tbl{margin:0 8px 8px}
.tbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.tbl th{text-align:left;color:var(--dim);font-weight:500;font-size:10.5px;
padding:3px 6px;background:var(--thead);position:sticky;top:0}
.tbl td{padding:3px 6px;border-top:1px solid var(--line);vertical-align:middle}
.tbl tr:hover td{background:var(--row-hover)}
.td-name{max-width:150px}
.td-name .sub{font-size:10px}
.td-num{text-align:right;white-space:nowrap}
.dim{color:var(--dim)}
.sub{margin-top:1px}
.kind{display:inline-block;font-size:9px;line-height:1;padding:2px 4px;border-radius:4px;
margin-right:5px;color:#fff;background:var(--dim);vertical-align:1px}
.kind-mcp{background:#7c3aed}
.kind-skill{background:#0d9488}
.kind-builtin{background:#52525b}
.running-pill{margin-left:5px;font-size:9px;color:var(--ok);border:1px solid var(--ok);
border-radius:4px;padding:0 3px}
.row-err td:first-child{color:var(--err)}
.bar{height:3px;border-radius:2px;background:color-mix(in srgb,var(--dim) 25%,transparent);
margin-top:2px;min-width:44px}
.bar-in{height:100%;border-radius:2px;background:var(--bar)}
.empty{color:var(--dim);padding:8px 2px}
.foot{color:var(--dim);font-size:10px;margin-top:4px;line-height:1.6}
.boot-error{color:var(--err);padding:12px;font-size:12px}
</style>
</head>
<body>
<script>
${js}
</script>
</body>
</html>
`;

const htmlPath = resolve(outDir, "index.html");
writeFileSync(htmlPath, html);
const size = statSync(htmlPath).size;
const limit = 4 * 1024 * 1024 - 512 * 1024; // 宿主 4MiB 限制，留余量
if (size > limit) throw new Error(`index.html ${size}B 超出宿主资源限制`);
console.log(`✓ index.html ${(size / 1024).toFixed(1)}KB / server.mjs 已输出到 ${outDir}`);
