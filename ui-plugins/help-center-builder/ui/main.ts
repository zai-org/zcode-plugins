import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Issue { level: "error" | "warn" | "info"; src: string; message: string }
interface Rebuilt { out: string; kind: string; reasons: string[]; src?: string }
interface Summary { pages: number; articles: number; categories: { name: string; out: string; count: number }[]; rebuilt: Rebuilt[]; unchanged: number; removed: string[]; copied: string[]; issues: Issue[]; ms: number; full: boolean; first: boolean; searchRebuilt: boolean; lang: string; bytes: number }
interface Build { docs: string; out: string; builtAt?: string; summary: Summary; title?: string }
interface ScanCat { name: string; out: string; articles: { src: string; title: string }[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const WHY: Record<string, [string, string]> = { new: ["新页面", "new"], missing: ["文件缺失", "file missing"], full: ["全量", "full"], content: ["内容改了", "content"], nav: ["同分类列表变了", "category list"], category: ["分类改了", "category"], cats: ["分类列表变了", "categories"], related: ["相关文章变了", "related"], prevnext: ["上一篇/下一篇变了", "prev/next"], site: ["站点设置", "site settings"], tpl: ["模板", "template"], list: ["文章列表变了", "article list"], intro: ["介绍改了", "intro"] };
const root = document.getElementById("root")!;
const st: { folders: { path: string; count: number }[]; docs: string; out: string; title: string; build?: Build; scan?: ScanCat[]; page: string; preview?: string } = { folders: [], docs: "", out: "help-center", title: "", page: "index.html" };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function loadScan() { if (!st.build) return; const r = await call<{ categories: ScanCat[] }>("hc_scan", { docs: st.build.docs }).catch(() => undefined); st.scan = r?.categories; }
async function preview(page = st.page) {
  if (!st.build) return;
  const r = await call<{ html: string; page: string }>("hc_preview", { out: st.build.out, page }).catch(() => undefined);
  if (r) { st.page = r.page; st.preview = r.html; }
  render();
}
function take(b: Build) {
  st.build = b; st.docs = b.docs; st.out = b.out;
  const s = b.summary;
  void updateContext(`Help center ${b.out}/ built from ${b.docs}/: ${s.articles} articles, ${s.categories.length} categories; last build rewrote ${s.rebuilt.length} page(s), ${s.unchanged} unchanged; ${s.issues.filter((i) => i.level === "error").length} error(s).`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "build") { take({ docs: v.docs as string, out: v.out as string, summary: v.summary as Summary }); void loadScan().then(() => preview()); } });
const doBuild = async (full: boolean) => {
  if (!st.docs) { toast(T("请先选择文档目录", "Choose the docs folder first"), "error"); return; }
  const r = await busy(() => call<{ docs: string; out: string; summary: Summary }>("hc_build", { docs: st.docs, out: st.out || "help-center", ...(st.title ? { title: st.title } : {}), ...(full ? { full: true } : {}) }, 200_000));
  if (!r) return;
  take(r); await loadScan(); await preview();
  const s = r.summary;
  toast(s.first || s.full ? T(`已生成 ${s.pages} 个页面`, `Wrote ${s.pages} pages`) : T(`重建 ${s.rebuilt.length} 个页面，${s.unchanged} 个未变`, `Rebuilt ${s.rebuilt.length} page(s), ${s.unchanged} unchanged`));
};

function render() {
  applyTheme();
  const b = st.build, s = b?.summary;
  const form = h("div", { class: "card" }, h("div", { class: "top" },
    h("label", { class: "fld grow" }, h("span", { class: "lb" }, T("文档目录（Markdown / HTML，子文件夹 = 分类）", "Docs folder (Markdown / HTML; sub-folders = categories)")),
      h("select", { class: "docs", onchange: (e: Event) => { st.docs = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, T("— 选择 —", "— choose —")), ...st.folders.map((f) => h("option", { value: f.path, selected: f.path === st.docs }, `${f.path === "." ? T("（工作区根目录）", "(workspace root)") : f.path}/ · ${f.count}`)))),
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("输出目录", "Output folder")), h("input", { class: "out", value: st.out, oninput: (e: Event) => { st.out = (e.target as HTMLInputElement).value; } })),
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("站点标题（可选）", "Site title (optional)")), h("input", { class: "title", value: st.title, placeholder: "help-center.json", oninput: (e: Event) => { st.title = (e.target as HTMLInputElement).value; } })),
    h("button", { class: "primary build", onclick: () => void doBuild(false) }, b ? T("增量构建", "Build changes") : T("生成帮助中心", "Build help center")),
    b ? h("button", { class: "full", onclick: () => void doBuild(true) }, T("全量重建", "Full rebuild")) : null));
  if (!b || !s) {
    put(root, h("h1", {}, T("帮助中心制作", "Help Center Builder")), form, h("div", { class: "empty" }, T("选择一个放 Markdown / HTML 文档的文件夹，生成静态帮助中心：分类导航、全文搜索（离线可用，支持中文）、面包屑、目录、相关文章。之后改了文档再点“增量构建”，只重写受影响的页面，并列出原因。生成的文件夹可以直接上传到任意静态托管。", "Choose a folder of Markdown / HTML docs to generate a static help center: category navigation, full-text search (works offline, Chinese too), breadcrumbs, table of contents and related articles. After editing docs, Build changes rewrites only the affected pages and tells you why. Upload the folder to any static host.")));
    return;
  }
  const errs = s.issues.filter((i) => i.level === "error").length, warns = s.issues.filter((i) => i.level === "warn").length;
  const banner = h("div", { class: `sum ${errs ? "bad" : ""}` }, s.first || s.full
    ? T(`已生成 ${b.out}/：${s.articles} 篇文章、${s.categories.length} 个分类、共 ${s.pages} 个页面（${s.ms} 毫秒）。`, `Built ${b.out}/: ${s.articles} articles, ${s.categories.length} categories, ${s.pages} pages (${s.ms} ms).`)
    : T(`增量构建：重写 ${s.rebuilt.length} 个页面，${s.unchanged} 个未变${s.removed.length ? `，删除 ${s.removed.length} 个` : ""}；搜索索引${s.searchRebuilt ? "已更新" : "未变"}（${s.ms} 毫秒）。`, `Incremental build: rewrote ${s.rebuilt.length} page(s), ${s.unchanged} unchanged${s.removed.length ? `, removed ${s.removed.length}` : ""}; search index ${s.searchRebuilt ? "updated" : "unchanged"} (${s.ms} ms).`),
    errs || warns ? T(` 问题：${errs} 个错误、${warns} 个提醒。`, ` Problems: ${errs} error(s), ${warns} warning(s).`) : T(" 没有坏链。", " No broken links."));
  const rb = h("div", { class: "card" }, h("b", {}, T("本次重写的页面", "Pages rewritten this time")), h("div", { class: "scroll" }, h("ul", { class: "rb" },
    ...s.rebuilt.map((r) => h("li", { "data-out": r.out }, h("code", {}, r.out), ...r.reasons.map((k) => h("span", { class: "why" }, locale() === "zh" ? WHY[k]?.[0] ?? k : WHY[k]?.[1] ?? k)))),
    ...s.removed.map((r) => h("li", { class: "removed" }, "✕ ", h("code", {}, r))))), s.rebuilt.length ? null : h("div", { class: "muted" }, T("没有页面需要重写。", "Nothing needed rewriting.")));
  const iss = h("div", { class: "card iss" }, h("b", {}, T(`检查（${s.issues.length}）`, `Checks (${s.issues.length})`)), ...(s.issues.length ? s.issues.map((i) => h("div", { class: i.level }, `${i.level === "error" ? "✗" : i.level === "warn" ? "!" : "·"} ${i.src}: ${i.message}`)) : [h("div", { class: "muted" }, T("✓ 没有坏链、缺失锚点或重复标题。", "✓ No broken links, missing anchors or duplicate titles."))]));
  const pg = (out: string, label: string) => h("a", { class: out === st.page ? "on" : "", onclick: () => void preview(out) }, label);
  const tree = h("div", { class: "card" }, h("b", {}, T("站点结构（点击预览）", "Site map (click to preview)")), h("ul", { class: "tree" }, h("li", {}, pg("index.html", T("首页", "Home"))),
    ...(st.scan ?? s.categories.map((c) => ({ name: c.name, out: c.out, articles: [] }))).map((c) => h("li", {}, pg(c.out, c.name), ` (${c.articles.length || s.categories.find((x) => x.name === c.name)?.count || 0})`, c.articles.length ? h("ul", { class: "tree" }, ...c.articles.map((a) => h("li", {}, pg(a.src.replace(/\.(md|markdown|htm|html)$/i, ".html"), a.title)))) : null)),
    h("li", {}, pg("search.html", T("搜索页", "Search page"))), h("li", {}, pg("404.html", "404"))));
  const pv = st.preview ? h("div", { class: "card" }, h("div", { class: "row" }, h("b", { class: "grow" }, T("预览：", "Preview: "), h("code", {}, `${b.out}/${st.page}`)), h("span", { class: "muted" }, T("（静态预览，搜索在浏览器里打开站点后可用）", "(static; search works when you open the site in a browser)"))), h("iframe", { class: "pv", srcdoc: st.preview, sandbox: "" })) : null;
  put(root, form, banner, h("div", { class: "split" }, h("div", {}, rb, iss, tree), h("div", {}, pv)));
}

onHostContext(() => render());
render();
void initHost("help-center-builder", "0.1.0").then(async () => {
  const r = await call<{ builds: Build[]; folders: { path: string; count: number }[] }>("hc_state").catch(() => undefined);
  st.folders = r?.folders ?? [];
  if (!st.docs && st.folders.length) st.docs = (st.folders.find((f) => /docs|help|articles|文档|帮助/i.test(f.path)) ?? st.folders[0]).path;
  if (r?.builds?.[0]) { take(r.builds[0]); await loadScan(); await preview(); }
  render();
});
