import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Issue { file: string; line?: number; severity: "error" | "warning"; check: string; message: string; source: string }
interface View { project: { dir: string; name: string; design: string[]; lastCheck?: { errors: number; warnings: number; themeCheck: boolean } }; files: string[]; sections: string[]; templates: string[]; issues: Issue[]; themeCheck?: { ran: boolean; ms?: number; error?: string } }
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const TPL: Record<string, [string, string]> = { index: ["首页", "Home"], product: ["商品页", "Product"], collection: ["商品系列", "Collection"], page: ["普通页面", "Page"], cart: ["购物车", "Cart"], search: ["搜索", "Search"], "404": ["404", "404"] };
const root = document.getElementById("root")!;
const state: { v?: View; images: string[]; template: string; device: "desktop" | "mobile"; html?: string; renderErrors: { section: string; message: string }[]; design: Record<string, string>; compare: boolean; source?: { path: string; content: string }; newName: string; newDesign: Set<string>; full: boolean } = {
  images: [], template: "index", device: "desktop", renderErrors: [], design: {}, compare: true, newName: "", newDesign: new Set(), full: false,
};

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function setView(v: View, full = false) {
  state.v = v;
  if (full) state.full = true;
  if (!v.templates.includes(state.template)) state.template = v.templates.includes("index") ? "index" : v.templates[0];
  for (const d of v.project.design) if (!state.design[d]) {
    const r = await call<{ dataUrl: string }>("theme_file", { path: d, design: true }).catch(() => undefined);
    if (r) state.design[d] = r.dataUrl;
  }
  await refresh();
  const e = v.issues.filter((i) => i.severity === "error").length;
  void updateContext(`Theme ${v.project.name} (${v.project.dir}): ${v.sections.length} sections, ${e} errors, ${v.issues.length - e} warnings; previewing ${state.template}.`).catch(() => undefined);
}
async function refresh() {
  const r = await call<{ html: string; errors: { section: string; message: string }[] }>("theme_preview", { template: state.template }).catch(() => undefined);
  state.html = r?.html;
  state.renderErrors = r?.errors ?? [];
  render();
}
onToolResult((v) => {
  if (v?.kind === "theme") void setView(v as unknown as View, Boolean((v as { themeCheck?: unknown }).themeCheck));
  if (v?.kind === "packaged") toast(T(`已打包 ${v.file}`, `Packaged ${v.file}`));
});

const check = async () => { const r = await busy(() => call<View>("theme_check", {}, 300_000)); if (r) await setView(r, true); };
const pack = async () => { const r = await busy(() => call<{ file: string; bytes: number }>("theme_package", {}, 300_000)); if (r) toast(T(`已打包 ${r.file}（${Math.round(r.bytes / 1024)} KB），可在 Shopify 后台上传`, `Packaged ${r.file} (${Math.round(r.bytes / 1024)} KB), ready to upload in Shopify admin`)); };
const create = async () => {
  if (!state.newName.trim()) { toast(T("请填写主题名称", "Enter a theme name"), "error"); return; }
  const r = await busy(() => call<View>("theme_new", { name: state.newName.trim(), design: [...state.newDesign] }, 300_000));
  if (r) await setView(r, true);
};
const openSource = async (path: string) => { const r = await busy(() => call<{ path: string; content: string }>("theme_file", { path })); if (r) { state.source = r; render(); } };

function preview() {
  const box = h("div", { class: `device ${state.device}` });
  if (state.html !== undefined) {
    const w = state.device === "desktop" ? 1280 : 390;
    const frame = h("iframe", { sandbox: "", title: "preview", srcdoc: state.html, style: `width:${w}px` }) as HTMLIFrameElement;
    box.append(frame);
    requestAnimationFrame(() => {
      const avail = box.clientWidth;
      const scale = Math.min(1, avail / w);
      frame.style.transform = `scale(${scale})`;
      frame.style.height = `${Math.round(box.clientHeight / scale)}px`;
    });
  }
  return box;
}

function render() {
  applyTheme();
  const v = state.v;
  if (!v) {
    put(root, h("div", { class: "card" }, h("b", {}, T("新建 Shopify 主题（Online Store 2.0）", "New Shopify theme (Online Store 2.0)")),
      h("div", { class: "row" }, h("label", {}, T("主题名称 ", "Theme name "), h("input", { class: "name", value: state.newName, placeholder: T("如：Hearth & Bean", "e.g. Hearth & Bean"), oninput: (e: Event) => { state.newName = (e.target as HTMLInputElement).value; } }))),
      h("div", {}, T("设计稿（可多选）：", "Design images:")),
      h("div", { class: "flist" }, ...state.images.map((f) => h("label", {}, h("input", { type: "checkbox", checked: state.newDesign.has(f), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? state.newDesign.add(f) : state.newDesign.delete(f); } }), f))),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void create() }, T("创建主题", "Create theme")))),
      h("div", { class: "empty" }, T("更常见的用法：把设计稿发给 Agent，说“按这张设计稿做一个 Shopify 主题”。插件生成主题骨架，Agent 按设计稿写 section，这里实时预览和检查。", "Usually you hand the design to the agent (“build a Shopify theme from this design”). The plugin creates the theme skeleton, the agent writes the sections, and this panel previews and checks them.")));
    return;
  }
  const errors = v.issues.filter((i) => i.severity === "error"), warns = v.issues.filter((i) => i.severity === "warning");
  const top = h("div", { class: "top" }, h("b", {}, v.project.name), h("span", { class: "muted" }, `${v.project.dir}/ · ${v.sections.length} sections · ${v.templates.length} templates`), h("span", { class: "grow" }),
    h("span", { class: `badge ${errors.length ? "bad" : "ok"}` }, errors.length ? T(`${errors.length} 个错误`, `${errors.length} errors`) : T("无错误", "No errors")),
    warns.length ? h("span", { class: "badge warn" }, T(`${warns.length} 个警告`, `${warns.length} warnings`)) : null,
    h("span", { class: "muted small" }, state.full && v.themeCheck?.ran ? T("已含 Shopify theme-check", "incl. Shopify theme-check") : T("内置检查", "built-in checks")),
    h("button", { onclick: () => void check() }, T("完整检查", "Full check")), h("button", { class: "primary", onclick: () => void pack() }, T("打包 zip", "Package zip")));
  const tbar = h("div", { class: "tbar" },
    h("select", { class: "tpl", onchange: (e: Event) => { state.template = (e.target as HTMLSelectElement).value; void refresh(); } }, ...v.templates.map((t) => h("option", { value: t, selected: t === state.template }, TPL[t] ? `${locale() === "zh" ? TPL[t][0] : TPL[t][1]} (${t})` : t))),
    h("button", { class: `tab${state.device === "desktop" ? " on" : ""}`, onclick: () => { state.device = "desktop"; render(); } }, T("桌面", "Desktop")),
    h("button", { class: `tab${state.device === "mobile" ? " on" : ""}`, onclick: () => { state.device = "mobile"; render(); } }, T("手机", "Mobile")),
    v.project.design.length ? h("label", { class: "cmp" }, h("input", { type: "checkbox", checked: state.compare, onchange: (e: Event) => { state.compare = (e.target as HTMLInputElement).checked; render(); } }), T("对照设计稿", "Show design")) : null,
    h("button", { onclick: () => void refresh() }, T("刷新预览", "Refresh")));
  const rerr = state.renderErrors.length ? h("div", { class: "rerr" }, ...state.renderErrors.map((e) => h("div", {}, "✗ ", h("b", {}, e.section), ": ", e.message))) : null;
  const designCol = state.compare && v.project.design.length ? h("div", { class: "design" }, ...v.project.design.map((d) => h("figure", {}, h("figcaption", {}, d), state.design[d] ? h("img", { src: state.design[d], alt: d }) : null))) : null;
  const main = h("div", { class: `main${designCol ? " withdesign" : ""}` }, designCol, preview());
  const issues = h("div", { class: "issues" }, h("b", {}, T("问题", "Problems")),
    v.issues.length ? null : h("div", { class: "muted" }, T("没有问题。", "No problems.")),
    ...v.issues.map((i) => h("div", { class: `issue ${i.severity}` }, h("span", { class: "src" }, i.source === "theme-check" ? "theme-check" : T("内置", "built-in")), h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openSource(i.file); } }, `${i.file}${i.line ? `:${i.line}` : ""}`), h("span", { class: "chk" }, i.check), h("span", {}, i.message))));
  const files = h("details", { class: "files" }, h("summary", {}, T(`文件（${v.files.length}）`, `Files (${v.files.length})`)), ...v.files.map((f) => h("div", {}, /\.(liquid|json|css|js)$/.test(f) ? h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openSource(f); } }, f) : f)));
  const src = state.source ? h("div", { class: "source" }, h("div", { class: "row" }, h("b", {}, state.source.path), h("span", { class: "grow" }), h("button", { onclick: () => { state.source = undefined; render(); } }, T("关闭", "Close"))), h("pre", {}, state.source.content)) : null;
  put(root, top, tbar, rerr, main, h("div", { class: "split" }, issues, files), src);
}

onHostContext(() => render());
render();
void initHost("theme-from-design", "0.1.0").then(async () => {
  state.images = (await call<{ files: string[] }>("workspace_images").catch(() => ({ files: [] }))).files;
  const st = await call<Record<string, unknown>>("theme_state").catch(() => undefined);
  if (st?.kind === "theme") await setView(st as unknown as View); else render();
});
