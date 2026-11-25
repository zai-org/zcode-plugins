import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Change { from: string; added: number; removed: number; changed: number; unchanged: boolean }
interface Capture { at: string; dir: string; title: string; status: number; finalUrl: string; paragraphs: number; chars: number; images: number; imagesFailed: number; screenshot: boolean; change?: Change }
interface Entry { url: string; title: string; site: string; captures: Capture[] }
interface Row { type: "same" | "add" | "del" | "mod"; text: string; old?: string; html?: string }
interface Result { url: string; ok: boolean; error?: string; capture?: Capture }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { entries: Entry[]; browser: boolean; sel?: string; tab: "article" | "changes" | "shot"; view?: { dir: string; html: string; screenshot?: string }; diff?: { dir: string; rows: Row[] }; results: Result[]; urls: string; images: boolean; shot: boolean } = { entries: [], browser: false, tab: "article", results: [], urls: "", images: true, shot: false };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  status(label);
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); status(""); }
}
function status(t: string) { const st = document.getElementById("status"); if (st) st.textContent = t; }

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const changeLabel = (c: Capture) => (c.change ? (c.change.unchanged ? T("无变化", "unchanged") : `+${c.change.added} −${c.change.removed} ~${c.change.changed}`) : T("首次", "first"));
const current = () => { for (const e of state.entries) for (const c of e.captures) if (c.dir === state.sel) return { e, c }; return undefined; };

function select(dir: string, tab: typeof state.tab = "article") {
  state.sel = dir;
  state.tab = tab;
  render();
  void loadView();
}
async function loadView() {
  const cur = current();
  if (!cur) return;
  if (state.tab === "changes" && cur.c.change && state.diff?.dir !== cur.c.dir) {
    const r = await call<{ rows: Row[] }>("archive_diff", { url: cur.e.url, from: cur.c.change.from, to: cur.c.dir }).catch((e) => { toast(String(e?.message ?? e), "error"); return { rows: [] }; });
    state.diff = { dir: cur.c.dir, rows: r.rows };
  } else if (state.view?.dir !== cur.c.dir) {
    const r = await call<{ html: string; screenshot?: string }>("capture_view", { dir: cur.c.dir });
    state.view = { dir: cur.c.dir, ...r };
  }
  renderMain();
}
function setEntries(entries: Entry[]) {
  state.entries = entries ?? [];
  if (!current()) state.sel = state.entries[0]?.captures.at(-1)?.dir;
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "captured") {
    state.results = v.results as Result[];
    setEntries(v.entries as Entry[]);
    const last = [...state.results].reverse().find((r) => r.ok)?.capture;
    if (last) state.sel = last.dir;
    state.view = undefined;
    render();
    void loadView();
    void sync();
  } else if (v.kind === "list") { setEntries(v.entries as Entry[]); render(); void loadView(); }
  else if (v.kind === "diff") { state.sel = v.to as string; state.tab = "changes"; state.diff = { dir: v.to as string, rows: v.rows as Row[] }; render(); }
});
async function sync() {
  const cur = current();
  await updateContext(`Web archive panel: ${state.entries.length} page(s) archived${cur ? `; viewing ${cur.c.dir} (“${cur.c.title}”, ${changeLabel(cur.c)})` : ""}.`).catch(() => undefined);
}

async function captureNow() {
  const urls = state.urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
  if (!urls.length) { toast(T("先粘贴网址，每行一个", "Paste URLs first, one per line"), "error"); return; }
  await busy(async () => {
    const r = await call<Record<string, unknown>>("archive_capture", { urls, images: state.images, screenshot: state.shot }, 900_000);
    state.results = r.results as Result[];
    setEntries(r.entries as Entry[]);
    const last = [...state.results].reverse().find((x) => x.ok)?.capture;
    if (last) state.sel = last.dir;
    state.view = undefined;
    state.tab = "article";
    render();
    await loadView();
    void sync();
  }, T("采集中…", "Capturing…"));
}

function sanitizeArticle(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || (/^(href|src)$/.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); }));
  doc.querySelectorAll("a[href]").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); });
  const wrap = document.createElement("div");
  wrap.append(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  return wrap;
}

function renderMain() {
  const main = document.getElementById("main");
  if (!main) return;
  const cur = current();
  if (!cur) { put(main, h("p", { class: "muted" }, T("还没有采集的网页。粘贴网址后点“采集”。", "Nothing archived yet. Paste URLs and press Capture."))); return; }
  const { c } = cur;
  const tab = (id: typeof state.tab, label: string, enabled = true) => (enabled ? h("button", { class: state.tab === id ? "on" : "", onclick: () => { state.tab = id; renderMain(); void loadView(); } }, label) : null);
  let body: Node = h("p", { class: "muted" }, T("加载中…", "Loading…"));
  if (state.tab === "changes" && state.diff?.dir === c.dir) {
    body = h("div", { class: "diff" }, ...(state.diff.rows.length ? state.diff.rows.map((r) => { const p = h("p", { class: r.type }); if (r.type === "mod" && r.html) p.innerHTML = r.html; else p.textContent = r.text; return p; }) : [h("p", { class: "muted" }, T("正文没有变化", "No text changes"))]));
  } else if (state.tab === "shot" && state.view?.dir === c.dir && state.view.screenshot) {
    body = h("div", { class: "shot" }, h("img", { src: `data:image/png;base64,${state.view.screenshot}`, alt: "screenshot" }));
  } else if (state.tab === "article" && state.view?.dir === c.dir) {
    const r = h("div", { class: "reader" });
    r.append(sanitizeArticle(state.view.html));
    body = r;
  }
  put(main,
    h("div", { class: "tabs" }, tab("article", T("正文", "Article")), tab("changes", `${T("变化", "Changes")} ${c.change ? changeLabel(c) : ""}`, !!c.change), tab("shot", T("截图", "Screenshot"), c.screenshot), h("span", { class: "spacer" }),
      h("span", { class: "muted", style: "font-size:11px" }, `${c.dir}/ · ${c.paragraphs} ${T("段", "paras")} · ${c.images} ${T("图", "images")}${c.imagesFailed ? ` (${c.imagesFailed} ${T("失败", "failed")})` : ""}`)),
    body);
}

function render() {
  applyTheme();
  const ta = h("textarea", { placeholder: T("粘贴网址，每行一个", "Paste URLs, one per line"), value: state.urls, oninput: (e: Event) => { state.urls = (e.target as HTMLTextAreaElement).value; } });
  const toolbar = h("div", { class: "toolbar" }, ta,
    h("div", { class: "opts" },
      h("label", {}, h("input", { type: "checkbox", checked: state.images, onchange: (e: Event) => { state.images = (e.target as HTMLInputElement).checked; } }), T("保存图片", "Save images")),
      h("label", { title: state.browser ? "" : T("没有找到本机 Chrome / Edge", "No local Chrome/Edge found") }, h("input", { type: "checkbox", checked: state.shot, disabled: !state.browser, onchange: (e: Event) => { state.shot = (e.target as HTMLInputElement).checked; } }), T("截图（本机浏览器）", "Screenshot (local browser)"))),
    h("div", { class: "opts" }, h("button", { class: "primary", onclick: () => void captureNow() }, T("采集", "Capture")), h("span", { id: "status", class: "muted" })));
  const results = state.results.length ? h("div", { class: "card result" }, ...state.results.map((r) => h("div", { class: r.ok ? "ok" : "bad" }, r.ok ? `✓ ${r.capture!.title} — ${changeLabel(r.capture!)}` : `✗ ${r.url}: ${r.error}`))) : null;
  const list = h("div", {}, h("h2", {}, T(`已归档（${state.entries.length}）`, `Archived (${state.entries.length})`)),
    ...state.entries.map((e) => h("div", { class: "entry" }, h("div", { class: "t" }, e.title), h("div", { class: "u" }, e.url),
      ...e.captures.slice().reverse().map((c) => h("div", { class: `cap${c.dir === state.sel ? " sel" : ""}`, title: c.dir, onclick: () => select(c.dir, c.change && !c.change.unchanged ? "changes" : "article") }, h("span", {}, fmt(c.at)), h("span", { class: `badge${c.change && !c.change.unchanged ? "" : " ok"}` }, changeLabel(c)), c.screenshot ? h("span", { title: T("有截图", "Screenshot") }, "📷") : null)))));
  put(root, toolbar, results, h("div", { class: "layout" }, list, h("div", { id: "main" })));
  renderMain();
}

onHostContext(() => render());
void initHost("web-archiver", "0.1.0").then(async () => {
  const r = await call<{ entries: Entry[]; browser: boolean }>("archive_index").catch(() => ({ entries: [], browser: false }));
  state.browser = r.browser;
  setEntries(r.entries);
  render();
  void loadView();
});
render();
