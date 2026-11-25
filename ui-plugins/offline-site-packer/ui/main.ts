import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Report { source: string; output: string; zip?: string; pages: { path: string; title: string; words: number }[]; assets: number; files: number; bytes: number; rewritten: number; broken: { from: string; href: string; kind: string }[]; external: { href: string; from: string[] }[]; orphans: string[]; unused: string[]; warnings: string[]; search: boolean }
interface Settings { dir: string; out: string; baseUrl: string; search: boolean; zip: boolean; includeUnlinked: boolean }
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const root = document.getElementById("root")!;
const state: { dirs: string[]; s: Settings; report?: Report; wrote?: boolean } = { dirs: [], s: { dir: "", out: "", baseUrl: "", search: true, zip: true, includeUnlinked: false } };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function show(v: { settings: Settings; report: Report; wrote: boolean }) {
  state.s = { ...v.settings }; state.report = v.report; state.wrote = v.wrote;
  render();
  const r = v.report;
  void updateContext(`Offline site ${r.source}${v.wrote ? ` → ${r.output}` : " (checked)"}: ${r.pages.length} pages, ${r.broken.length} broken links, ${r.external.length} external links.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "report") show(v as never); });

const args = () => ({ dir: state.s.dir, ...(state.s.out ? { out: state.s.out } : {}), ...(state.s.baseUrl ? { baseUrl: state.s.baseUrl } : {}), search: state.s.search, zip: state.s.zip, includeUnlinked: state.s.includeUnlinked });
const go = async (tool: "site_check" | "site_pack") => {
  if (!state.s.dir) { toast(T("请先选择网站目录", "Choose the site folder first"), "error"); return; }
  const r = await busy(() => call<{ settings: Settings; report: Report; wrote: boolean }>(tool, args()));
  if (r) { show(r); if (tool === "site_pack") toast(T(`已生成 ${r.report.output}/`, `Wrote ${r.report.output}/`)); }
};

function render() {
  applyTheme();
  const s = state.s, r = state.report;
  const chk = (key: "search" | "zip" | "includeUnlinked", label: string) => h("label", { class: "chk" }, h("input", { type: "checkbox", "data-opt": key, checked: s[key], onchange: (e: Event) => { s[key] = (e.target as HTMLInputElement).checked; } }), label);
  const form = h("div", { class: "card" },
    h("div", { class: "cols" },
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("网站目录（含 index.html）", "Site folder (has index.html)")),
        h("select", { class: "dir", onchange: (e: Event) => { s.dir = (e.target as HTMLSelectElement).value; s.out = ""; } }, h("option", { value: "" }, T("— 选择 —", "— choose —")), ...state.dirs.map((d) => h("option", { value: d, selected: d === s.dir }, d)))),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("输出目录（可选）", "Output folder (optional)")), h("input", { class: "out", value: s.out, placeholder: s.dir ? `${s.dir.replace(/\/(dist|public|build|out|_site|site|www)$/, "")}-offline` : "", oninput: (e: Event) => { s.out = (e.target as HTMLInputElement).value; } })),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("网站线上地址（可选）", "Public URL (optional)")), h("input", { class: "base", value: s.baseUrl, placeholder: "https://docs.example.com/", oninput: (e: Event) => { s.baseUrl = (e.target as HTMLInputElement).value; } }), h("span", { class: "hint" }, T("指向这个地址的绝对链接按站内链接处理", "Absolute links to it count as internal")))),
    h("div", { class: "row" }, chk("search", T("离线全文搜索", "Offline search")), chk("zip", T("同时生成 zip", "Also write a zip")), chk("includeUnlinked", T("包含没被链接的页面和文件", "Include unlinked pages/files")),
      h("span", { class: "grow" }), h("button", { onclick: () => void go("site_check") }, T("只检查", "Check only")), h("button", { class: "primary", onclick: () => void go("site_pack") }, T("生成离线包", "Pack for offline"))));
  if (!r) { put(root, h("h1", {}, T("网站离线打包", "Offline Site Packer")), form, h("div", { class: "empty" }, T("选择一个构建好的静态网站目录。生成的离线包双击 index.html 就能浏览，不需要服务器。", "Choose a built static site. The offline copy opens by double-clicking index.html — no server needed."))); return; }
  const stat = (n: string | number, label: string, cls = "") => h("div", { class: `stat ${cls}` }, h("b", {}, String(n)), h("span", {}, label));
  const stats = h("div", { class: "stats" }, stat(r.pages.length, T("页面", "pages")), stat(r.assets, T("资源文件", "assets")), stat(r.rewritten, T("改写的链接", "links rewritten")),
    stat(r.broken.length, T("坏链", "broken"), r.broken.length ? "bad" : "ok"), stat(r.external.length, T("外部链接", "external")), state.wrote ? stat(`${(r.bytes / 1048576).toFixed(2)} MB`, T("大小", "size")) : null);
  const done = state.wrote ? h("div", { class: "done" }, T(`已生成 ${r.output}/${r.zip ? ` 和 ${r.zip}` : ""}。直接双击 ${r.output}/index.html 即可离线浏览${r.search ? "，按 ⌘K / Ctrl+K 搜索" : ""}。`, `Wrote ${r.output}/${r.zip ? ` and ${r.zip}` : ""}. Double-click ${r.output}/index.html to browse offline${r.search ? "; search with ⌘K / Ctrl+K" : ""}.`))
    : h("div", { class: "muted" }, T("仅检查，未写入文件。", "Checked only; nothing written."));
  const broken = h("div", { class: "card" }, h("b", {}, T(`坏链（${r.broken.length}）`, `Broken links (${r.broken.length})`)),
    r.broken.length ? h("table", { class: "data" }, h("tr", {}, h("th", {}, T("所在页面", "On page")), h("th", {}, T("链接", "Link")), h("th", {}, T("类型", "Type"))), ...r.broken.map((b) => h("tr", { class: "brk" }, h("td", {}, b.from), h("td", {}, h("code", {}, b.href)), h("td", {}, b.kind === "asset" ? T("缺少文件", "missing file") : T("页面不存在", "no such page"))))) : h("div", { class: "ok" }, T("没有坏链。", "No broken links.")));
  const external = h("div", { class: "card" }, h("b", {}, T(`外部链接（${r.external.length}，离线时打不开）`, `External links (${r.external.length}, need internet)`)),
    ...r.external.map((e) => h("div", { class: "ext" }, h("code", {}, e.href), h("span", { class: "muted" }, T(` ${e.from.length} 个页面`, ` on ${e.from.length} page(s)`)))));
  const other = (r.orphans.length || r.unused.length || r.warnings.length) ? h("div", { class: "card" },
    r.orphans.length ? h("div", {}, h("b", {}, T("没有被链接的页面：", "Pages nothing links to: ")), r.orphans.join("、"), s.includeUnlinked ? null : h("span", { class: "muted" }, T("（未包含）", " (left out)"))) : null,
    r.unused.length ? h("div", {}, h("b", {}, T("没用到的文件：", "Unused files: ")), r.unused.join("、")) : null,
    ...r.warnings.map((w) => h("div", { class: "warn" }, w))) : null;
  const pages = h("div", { class: "card" }, h("b", {}, T(`页面（${r.pages.length}）`, `Pages (${r.pages.length})`)),
    h("table", { class: "data" }, ...r.pages.map((p) => h("tr", {}, h("td", {}, p.title), h("td", {}, h("code", {}, p.path)), h("td", { class: "num" }, T(`${p.words} 词`, `${p.words} words`))))));
  put(root, form, stats, done, h("div", { class: "split" }, h("div", {}, broken, external, other), pages));
}

onHostContext(() => render());
render();
void initHost("offline-site-packer", "0.1.0").then(async () => {
  state.dirs = (await call<{ dirs: string[] }>("site_dirs").catch(() => ({ dirs: [] }))).dirs;
  const st = await call<Record<string, unknown>>("site_state").catch(() => undefined);
  if (st?.kind === "report") show(st as never); else { if (state.dirs.length === 1) state.s.dir = state.dirs[0]; render(); }
});
