import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, base64ToBytes, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";
import { openPdf, renderPage } from "./pdf.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Issue { level: "error" | "warning"; kind: string; file?: string; line?: number; message: string; target?: string }
interface Config { title: string; subtitle: string; author: string; language: string; identifier: string; publisher: string; date: string; description: string; rights: string; cover: string; chapters: string[]; tocDepth: 1 | 2; pdf: { pageSize: string; fontSize: number } }
interface ChapterInfo { file: string; id: string; title: string; chars: number; images: number; footnotes: number; headings: number }
interface BookView { dir: string; saved: boolean; config: Config; chapters: ChapterInfo[]; issues: Issue[]; external: { url: string; file: string; line: number; text: string }[] }
interface Output { format: string; path: string; bytes: number; pages?: number }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { book?: BookView; dirs: string[]; images: string[]; sel?: string; tab: "preview" | "checks" | "pdf"; html: string; outputs: Output[]; warnings: string[]; pdfPath?: string } = { dirs: [], images: [], tab: "preview", html: "", outputs: [], warnings: [] };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  status(label);
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); status(""); }
}
function status(t: string) { const st = document.getElementById("status"); if (st) st.textContent = t; }

function load(v: Record<string, unknown>) {
  const prevDir = state.book?.dir;
  state.book = v as unknown as BookView;
  if (prevDir !== state.book.dir) { state.outputs = []; state.pdfPath = undefined; void loadImages(); }
  if (!state.sel || !state.book.chapters.some((c) => c.file === state.sel)) state.sel = state.book.chapters[0]?.file;
  render();
  void preview();
  void sync();
}
function exported(v: Record<string, unknown>) {
  load(v);
  state.outputs = (v.outputs as Output[]) ?? [];
  state.warnings = (v.warnings as string[]) ?? [];
  const pdf = state.outputs.find((o) => o.format === "pdf");
  if (pdf) { state.pdfPath = pdf.path; state.tab = "pdf"; }
  render();
}
onToolResult((v) => {
  if (!v || !("dir" in v)) return;
  if (v.kind === "exported") exported(v);
  else load(v);
});
async function loadImages() {
  if (!state.book) return;
  state.images = (await call<{ images: string[] }>("book_dirs", { dir: state.book.dir }).catch(() => ({ images: [] }))).images;
  render();
}
async function sync() {
  const b = state.book;
  if (!b) return;
  const errors = b.issues.filter((i) => i.level === "error").length;
  await updateContext(`Ebook panel: ${b.dir} — "${b.config.title}", ${b.chapters.length} chapters, ${errors} error(s), ${b.issues.length - errors} warning(s)${state.outputs.length ? `; exported ${state.outputs.map((o) => o.path).join(", ")}` : ""}.`).catch(() => undefined);
}

async function open(dir: string) {
  await busy(async () => load(await call<Record<string, unknown>>("ebook_open", { dir })), T("读取中…", "Loading…"));
}
let saving: Promise<unknown> = Promise.resolve();
function save(meta: Record<string, unknown>, chapters?: string[]) {
  const dir = state.book!.dir;
  saving = saving.then(async () => load(await call<Record<string, unknown>>("ebook_save", { dir, meta, ...(chapters ? { chapters } : {}) }))).catch((e) => toast(String(e?.message ?? e), "error"));
  return saving;
}

/** 预览：去掉脚本和事件属性后插入。 */
function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,style,link").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || (a.name === "href" && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); }));
  return doc.body.firstElementChild!;
}
async function preview() {
  if (!state.book || !state.sel) { state.html = ""; return; }
  const r = await call<{ html: string }>("chapter_preview", { dir: state.book.dir, file: state.sel }).catch((e) => ({ html: `<p class="missing">${String(e?.message ?? e)}</p>` }));
  state.html = r.html;
  renderMain();
}

function metaForm() {
  const c = state.book!.config;
  const field = (key: keyof Config, label: string, multiline = false) => {
    const el = multiline ? h("textarea", { value: String(c[key] ?? "") }) : h("input", { value: String(c[key] ?? ""), "data-key": key });
    el.addEventListener("change", () => void save({ [key]: (el as HTMLInputElement).value }));
    return [h("label", {}, label), el];
  };
  const cover = h("select", { onchange: (e: Event) => void save({ cover: (e.target as HTMLSelectElement).value }) }, h("option", { value: "" }, T("（无）", "(none)")), ...[...new Set([...state.images, c.cover].filter(Boolean))].map((p) => h("option", { value: p, selected: p === c.cover }, p)));
  const toc = h("select", { onchange: (e: Event) => void save({ tocDepth: Number((e.target as HTMLSelectElement).value) }) }, h("option", { value: "1", selected: c.tocDepth === 1 }, T("仅章节", "Chapters")), h("option", { value: "2", selected: c.tocDepth === 2 }, T("章节 + 二级标题", "Chapters + ##")));
  const size = h("select", { onchange: (e: Event) => void save({ pdf: { pageSize: (e.target as HTMLSelectElement).value } }) }, ...["A5", "B6", "A4"].map((s) => h("option", { value: s, selected: c.pdf.pageSize === s }, s)));
  const font = h("input", { type: "number", min: "8", max: "14", step: "0.5", value: String(c.pdf.fontSize), style: "width:60px", onchange: (e: Event) => void save({ pdf: { fontSize: Number((e.target as HTMLInputElement).value) } }) });
  return h("div", { class: "meta" },
    ...field("title", T("书名", "Title")), ...field("subtitle", T("副标题", "Subtitle")), ...field("author", T("作者", "Author")),
    ...field("language", T("语言", "Language")), ...field("publisher", T("出版方", "Publisher")), ...field("date", T("日期", "Date")),
    ...field("description", T("简介", "Blurb"), true),
    h("label", {}, T("封面", "Cover")), cover, h("label", {}, T("目录", "TOC")), toc,
    h("label", {}, "PDF"), h("div", { class: "row", style: "margin:0" }, size, font, h("span", { class: "muted" }, "pt")));
}

function chapterList() {
  const b = state.book!;
  const files = b.chapters.map((c) => c.file);
  const move = (i: number, d: number) => {
    const next = [...files];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void save({}, next);
  };
  const count = (f: string) => b.issues.filter((x) => x.file === f).length;
  return h("div", { class: "chapters" }, ...b.chapters.map((c, i) =>
    h("div", { class: `chap${c.file === state.sel ? " sel" : ""}`, title: c.file, onclick: () => { state.sel = c.file; state.tab = "preview"; render(); void preview(); } },
      h("span", { class: "muted" }, String(i + 1)),
      h("span", { class: "t" }, c.title, " ", h("span", { class: "f" }, c.file)),
      count(c.file) ? h("span", { class: `badge${b.issues.some((x) => x.file === c.file && x.level === "error") ? " bad" : ""}` }, String(count(c.file))) : null,
      h("button", { disabled: i === 0, title: T("上移", "Up"), onclick: (e: Event) => { e.stopPropagation(); move(i, -1); } }, "↑"),
      h("button", { disabled: i === b.chapters.length - 1, title: T("下移", "Down"), onclick: (e: Event) => { e.stopPropagation(); move(i, 1); } }, "↓"))));
}

function checks() {
  const b = state.book!;
  return h("div", {},
    b.issues.length ? null : h("p", { class: "badge ok" }, T("没有发现问题", "No problems found")),
    ...b.issues.map((i) => h("div", { class: "issue", onclick: () => { if (i.file && b.chapters.some((c) => c.file === i.file)) { state.sel = i.file; state.tab = "preview"; render(); void preview(); } } },
      h("span", { class: `badge${i.level === "error" ? " bad" : ""}` }, i.level === "error" ? T("错误", "Error") : T("提醒", "Warning")),
      h("span", { class: "loc" }, i.file ? `${i.file}${i.line ? `:${i.line}` : ""}` : ""),
      h("span", {}, i.message))),
    h("h2", {}, T(`外部链接（${b.external.length}）`, `External links (${b.external.length})`)),
    b.external.length ? h("table", { class: "data" }, h("tr", {}, h("th", {}, T("位置", "Where")), h("th", {}, T("文字", "Text")), h("th", {}, "URL")), ...b.external.map((e) => h("tr", {}, h("td", {}, `${e.file}:${e.line}`), h("td", {}, e.text), h("td", {}, e.url)))) : h("p", { class: "muted" }, T("没有外部链接", "None")));
}

let pdfToken = 0;
async function showPdf(box: HTMLElement) {
  const path = state.pdfPath;
  if (!path) { put(box, h("p", { class: "muted" }, T("导出 PDF 后在这里逐页查看", "Export a PDF to see its pages here"))); return; }
  const token = ++pdfToken;
  put(box, h("p", { class: "muted" }, T("加载 PDF…", "Loading PDF…")));
  const r = await call<{ data: string }>("file_data", { path });
  const doc = await openPdf(base64ToBytes(r.data));
  if (token !== pdfToken) return;
  const grid = h("div", { class: "pages" });
  put(box, h("p", { class: "muted" }, `${path} · ${doc.numPages} ${T("页", "pages")}`), grid);
  for (let p = 1; p <= doc.numPages; p++) {
    if (token !== pdfToken) return;
    const canvas = h("canvas", {});
    grid.append(h("div", {}, canvas, h("div", { class: "pg" }, String(p))));
    await renderPage(doc, p, canvas, 220 / 420, Math.min(2, devicePixelRatio || 1));
  }
}

function renderMain() {
  const main = document.getElementById("main");
  if (!main || !state.book) return;
  const b = state.book;
  const errors = b.issues.filter((i) => i.level === "error").length;
  const tab = (id: typeof state.tab, label: string) => h("button", { class: state.tab === id ? "on" : "", onclick: () => { state.tab = id; renderMain(); } }, label);
  let body: Node;
  if (state.tab === "checks") body = checks();
  else if (state.tab === "pdf") { body = h("div", {}); void showPdf(body as HTMLElement).catch((e) => toast(String(e?.message ?? e), "error")); }
  else { const pv = h("div", { class: `preview${/^(zh|ja|ko)/i.test(b.config.language) ? " cjk" : ""}` }); if (state.html) pv.append(sanitize(state.html)); body = pv; }
  put(main,
    state.outputs.length ? h("div", { class: "card result" }, h("b", {}, T("已导出", "Exported")), ...state.outputs.map((o) => h("div", {}, `${o.format.toUpperCase()}: ${o.path} · ${Math.round(o.bytes / 1024)} KB${o.pages ? ` · ${o.pages} ${T("页", "pages")}` : ""}`)), ...state.warnings.map((w) => h("div", { class: "muted" }, w))) : null,
    h("div", { class: "tabs" }, tab("preview", T("预览", "Preview")), tab("checks", `${T("检查", "Checks")} ${errors ? `✗${errors}` : ""} ${b.issues.length - errors ? `!${b.issues.length - errors}` : ""}`.trim()), tab("pdf", "PDF")),
    body);
}

function render() {
  applyTheme();
  const b = state.book;
  const select = h("select", { onchange: (e: Event) => void open((e.target as HTMLSelectElement).value) }, h("option", { value: "" }, T("打开书稿文件夹…", "Open a book folder…")), ...state.dirs.map((d) => h("option", { value: d, selected: d === b?.dir }, d)));
  const toolbar = h("div", { class: "toolbar" }, h("b", {}, T("电子书制作", "Ebook Maker")), select,
    b ? h("button", { onclick: () => void open(b.dir) }, T("重新检查", "Re-check")) : null,
    h("span", { id: "status", class: "muted" }), h("span", { class: "spacer" }),
    b ? h("button", { class: "primary", onclick: () => void busy(async () => exported(await call<Record<string, unknown>>("ebook_export", { dir: b.dir }, 600_000)), T("导出中…", "Exporting…")) }, T("导出 EPUB + PDF", "Export EPUB + PDF")) : null);
  if (!b) { put(root, toolbar, h("p", { class: "muted" }, T("选择一个放着 Markdown 章节的文件夹，或让 Agent 用 ebook_open 打开。", "Pick a folder of Markdown chapters, or ask the agent to open one with ebook_open."))); return; }
  put(root, toolbar, h("div", { class: "layout" }, h("div", {}, h("h2", {}, T("书籍信息", "Book")), metaForm(), h("h2", {}, T(`章节（${b.chapters.length}）`, `Chapters (${b.chapters.length})`)), chapterList()), h("div", { id: "main" })));
  renderMain();
}

onHostContext(() => render());
void initHost("ebook-maker", "0.1.0").then(async () => {
  state.dirs = (await call<{ dirs: string[] }>("book_dirs").catch(() => ({ dirs: [] }))).dirs;
  render();
});
render();
