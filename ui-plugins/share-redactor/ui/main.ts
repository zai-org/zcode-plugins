import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";
import { openPdf, renderPage, toCanvas, toPdf, type PdfDoc } from "./pdf.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Kind = "phone" | "id" | "bank" | "email" | "amount" | "keyword";
interface Rect { page: number; x: number; y: number; w: number; h: number }
interface Area extends Rect { file: string }
interface Hit { id: string; kind: Kind; value: string; key: string; loc: string; context: string; redact: boolean; preview: string; rects?: Rect[] }
interface FileOut { file: string; type: "text" | "docx" | "xlsx" | "pdf"; hits: Hit[]; pages?: { w: number; h: number }[]; textChars?: number; error?: string }
interface Settings { version: 1; files: string[]; kinds: Kind[]; keywords: string[]; mask: "label" | "block" | "partial"; scrubMetadata: boolean; keep: string[]; areas: Area[]; dpi: number; output: string }
interface Result { file: string; output: string; redacted: number; kept: number; check: { ok: boolean; problems: string[] } }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const KIND: Record<Kind, [string, string]> = { phone: ["电话", "Phone"], id: ["身份证", "ID"], bank: ["银行卡", "Card"], email: ["邮箱", "Email"], amount: ["金额", "Amount"], keyword: ["关键词", "Keyword"] };
const state: { s?: Settings; files: FileOut[]; sel: number; ws: string[]; results: Result[]; docs: Map<string, PdfDoc> } = { files: [], sel: 0, ws: [], results: [], docs: new Map() };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  status(label);
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); status(""); }
}
function status(t: string) { const st = document.getElementById("status"); if (st) st.textContent = t; }

function load(v: Record<string, unknown>) {
  state.s = v.settings as Settings;
  state.files = v.files as FileOut[];
  if (state.sel >= state.files.length) state.sel = 0;
  render();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "scan") { state.results = []; load(v); }
  if (v.kind === "exported") { load(v); state.results = (v.results as Result[]) ?? []; render(); void finishPdfs((v.pending as string[]) ?? []); }
});

let saving: Promise<unknown> = Promise.resolve();
function save(rescan = false) {
  const s = state.s!;
  saving = saving.then(async () => {
    const r = await call<Record<string, unknown>>("redact_save", { settings: s }, 300_000);
    if (rescan) load(r);
  }).catch((e) => toast(String(e?.message ?? e), "error"));
  return saving;
}
function toggle(hit: Hit) {
  const s = state.s!;
  const keep = hit.redact;
  for (const f of state.files) for (const h of f.hits) if (h.key === hit.key) h.redact = !keep;
  s.keep = keep ? [...new Set([...s.keep, hit.key])] : s.keep.filter((k) => k !== hit.key);
  void save();
  render();
}

async function pdfDoc(file: string) {
  let d = state.docs.get(file);
  if (!d) {
    const r = await call<{ data: string }>("file_data", { file }, 300_000);
    d = await openPdf(Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
    state.docs.set(file, d);
  }
  return d;
}

/** PDF 预览：每页画布 + 涂黑框（点击切换保留/涂黑），在空白处拖动可加手动框。 */
async function pdfView(f: FileOut, box: HTMLElement) {
  const s = state.s!;
  const doc = await pdfDoc(f.file);
  const width = Math.min(760, Math.max(420, box.clientWidth - 20));
  for (let p = 1; p <= doc.numPages; p++) {
    const page = (f.pages ?? [])[p - 1] ?? { w: 595, h: 842 };
    const canvas = h("canvas", {}) as HTMLCanvasElement;
    const pageBox = h("div", { class: "pagebox" }, canvas, h("div", { class: "pno" }, `p.${p}`));
    box.append(pageBox);
    const vp = await renderPage(doc, p, canvas, width / page.w);
    canvas.style.width = `${vp.width}px`;
    const place = (r: Rect, cls: string, onclick: () => void, title: string) => {
      const c = toCanvas(vp, r);
      pageBox.append(h("div", { class: `box ${cls}`, title, style: `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`, onmousedown: (e: Event) => e.stopPropagation(), onclick: (e: Event) => { e.stopPropagation(); onclick(); } }));
    };
    for (const hit of f.hits) for (const r of hit.rects ?? []) if (r.page === p) place(r, hit.redact ? "" : "kept", () => toggle(hit), `${KIND[hit.kind][locale() === "zh" ? 0 : 1]} · ${hit.redact ? T("点击保留", "click to keep") : T("点击涂黑", "click to redact")}`);
    s.areas.forEach((a, i) => { if (a.file === f.file && a.page === p) place(a, "area", () => { s.areas.splice(i, 1); void save(); render(); }, T("手动框 · 点击删除", "Manual box · click to remove")); });
    let start: { x: number; y: number } | undefined;
    let draft: HTMLElement | undefined;
    const pos = (e: MouseEvent) => { const b = pageBox.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    pageBox.addEventListener("mousedown", (e) => { start = pos(e); draft = h("div", { class: "draft" }); pageBox.append(draft); e.preventDefault(); });
    pageBox.addEventListener("mousemove", (e) => { if (!start || !draft) return; const q = pos(e); Object.assign(draft.style, { left: `${Math.min(q.x, start.x)}px`, top: `${Math.min(q.y, start.y)}px`, width: `${Math.abs(q.x - start.x)}px`, height: `${Math.abs(q.y - start.y)}px` }); });
    pageBox.addEventListener("mouseup", (e) => {
      if (!start) return;
      const q = pos(e);
      draft?.remove();
      const r = { x: Math.min(q.x, start.x), y: Math.min(q.y, start.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) };
      start = undefined;
      if (r.w < 4 || r.h < 4) return;
      const b = toPdf(vp, r);
      s.areas.push({ file: f.file, page: p, ...b });
      void save();
      render();
    });
  }
}

/** 导出 PDF：每页按 dpi 渲染，画黑框，转 JPEG 交给 server 组装成只有图像的 PDF。 */
async function finishPdfs(files: string[]) {
  const s = state.s!;
  for (const file of files) {
    const f = state.files.find((x) => x.file === file);
    if (!f) continue;
    const r = await busy(async () => {
      const doc = await pdfDoc(file);
      const job = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const canvas = document.createElement("canvas");
      for (let p = 1; p <= doc.numPages; p++) {
        status(T(`栅格化 ${file} 第 ${p}/${doc.numPages} 页…`, `Rasterising ${file} page ${p}/${doc.numPages}…`));
        const vp = await renderPage(doc, p, canvas, s.dpi / 72);
        const g = canvas.getContext("2d")!;
        g.fillStyle = "#000";
        const rects = [...f.hits.filter((x) => x.redact).flatMap((x) => x.rects ?? []), ...s.areas.filter((a) => a.file === file)].filter((x) => x.page === p);
        for (const rect of rects) { const c = toCanvas(vp, rect); g.fillRect(Math.floor(c.x) - 1, Math.floor(c.y) - 1, Math.ceil(c.w) + 2, Math.ceil(c.h) + 2); }
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.9));
        const u = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        const page = (f.pages ?? [])[p - 1] ?? { w: vp.width / (s.dpi / 72), h: vp.height / (s.dpi / 72) };
        // 旋转页按渲染后的宽高
        const rotated = Math.abs(vp.width / vp.height - page.w / page.h) > 0.01;
        await call("pdf_page", { job, index: p - 1, data: btoa(bin), w: rotated ? page.h : page.w, h: rotated ? page.w : page.h });
      }
      return call<Result>("pdf_finish", { settings: s, file, job, pages: doc.numPages }, 600_000);
    });
    if (r) { state.results = [...state.results.filter((x) => x.file !== file), r]; render(); }
  }
  if (files.length || state.results.length) {
    const ok = state.results.every((r) => r.check.ok);
    toast(ok ? T("导出完成，自检通过", "Exported; self-check passed") : T("导出完成，但自检发现问题", "Exported, but the self-check found problems"), ok ? "ok" : "error");
    await updateContext(`Share Redactor exported: ${state.results.map((r) => `${r.output} (${r.redacted} redacted, self-check ${r.check.ok ? "passed" : "FAILED: " + r.check.problems.join("; ")})`).join("; ")}`).catch(() => undefined);
  }
}

function hitRow(hit: Hit) {
  const i = hit.context.indexOf("【"), j = hit.context.indexOf("】");
  const ctx = i >= 0 && j > i ? [hit.context.slice(0, i), h("mark", {}, hit.context.slice(i + 1, j)), hit.context.slice(j + 1)] : [hit.context];
  return h("div", { class: `hit${hit.redact ? "" : " kept"}` },
    h("input", { type: "checkbox", checked: hit.redact, title: T("勾选=涂黑/替换；取消=保留（同一值的所有出现）", "Checked = redact; unchecked = keep (all occurrences of this value)"), onchange: () => toggle(hit) }),
    h("span", { class: `k ${hit.kind}` }, KIND[hit.kind][locale() === "zh" ? 0 : 1]),
    h("span", { class: "loc", title: hit.loc }, hit.loc),
    h("span", { class: "ctx", title: hit.context.replace(/[【】]/g, "") }, ...ctx),
    h("span", { class: "to", title: hit.preview }, hit.redact ? `→ ${state.files[state.sel]?.type === "pdf" ? "■■■" : hit.preview}` : T("保留", "keep")));
}

function render() {
  applyTheme();
  const s = state.s;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("分享前资料脱敏", "Share Redactor")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!v) return; void busy(async () => load(await call("redact_scan", { settings: { ...(s ?? {}), files: [...(s?.files ?? []), v] } }, 300_000)), T("扫描中…", "Scanning…")); } },
      h("option", { value: "" }, T("+ 添加文件…", "+ Add a file…")), ...state.ws.filter((f) => !s?.files.includes(f)).map((f) => h("option", { value: f }, f))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    s ? h("button", { class: "primary", onclick: () => void busy(async () => { await saving; const r = await call<Record<string, unknown>>("redact_export", { settings: s }, 600_000); load(r); state.results = (r.results as Result[]) ?? []; render(); await finishPdfs((r.pending as string[]) ?? []); }, T("导出中…", "Exporting…")) }, T("导出脱敏副本", "Export redacted copies")) : null);
  if (!s) {
    put(root, toolbar, h("div", { class: "empty" }, T("添加要分享的文件（PDF、Word、Excel、CSV、文本），自动找出手机号、身份证号、银行卡号、邮箱和你指定的姓名，逐处确认后导出脱敏副本，并自动复查原值确实不在了。也可以对 Agent 说：“把 客户名单.xlsx 和 报价单.pdf 脱敏后发给外包，客户姓名也要隐去”。", "Add the files you want to share (PDF, Word, Excel, CSV, text). Phone numbers, ID numbers, bank cards, emails and names you list are found automatically; review them and export redacted copies, which are re-checked to make sure the originals are gone. Or ask the agent: redact customers.xlsx and quote.pdf before I send them, hide customer names too.")));
    return;
  }
  const kinds: Kind[] = ["phone", "id", "bank", "email", "amount"];
  const opts = h("div", { class: "opts" },
    ...kinds.map((k) => h("label", {}, h("input", { type: "checkbox", checked: s.kinds.includes(k), onchange: (e: Event) => { s.kinds = (e.target as HTMLInputElement).checked ? [...s.kinds, k] : s.kinds.filter((x) => x !== k); void busy(() => save(true)); } }), KIND[k][locale() === "zh" ? 0 : 1])),
    h("label", {}, T("姓名/关键词", "Names/keywords"), h("input", { class: "kw", type: "text", value: s.keywords.join("，"), placeholder: T("用逗号分隔，如 王晓明，李娜，项目代号", "comma-separated, e.g. names, code names"), onchange: (e: Event) => { s.keywords = (e.target as HTMLInputElement).value.split(/[,，;；]/).map((x) => x.trim()).filter(Boolean); void busy(() => save(true)); } })),
    h("label", {}, T("替换为", "Replace with"), h("select", { onchange: (e: Event) => { s.mask = (e.target as HTMLSelectElement).value as Settings["mask"]; void busy(() => save(true)); } }, ...[["label", T("[手机号] 标签", "[PHONE] label")], ["partial", T("138****5678 部分", "138****5678 partial")], ["block", T("████ 涂黑", "████ block")]].map(([v, l]) => h("option", { value: v, selected: s.mask === v }, l)))),
    h("label", { title: T("清除 Word/Excel 的作者、最后修改人、标题等属性", "Clear author, last modified by, title etc. in Word/Excel") }, h("input", { type: "checkbox", checked: s.scrubMetadata, onchange: (e: Event) => { s.scrubMetadata = (e.target as HTMLInputElement).checked; void save(); } }), T("清除作者等属性", "Clear author metadata")));
  const total = (f: FileOut) => f.hits.filter((x) => x.redact).length + s.areas.filter((a) => a.file === f.file).length;
  const fileList = h("div", { class: "files" }, ...state.files.map((f, i) => h("div", { class: `file${i === state.sel ? " sel" : ""}${f.error ? " err" : ""}`, title: f.error ?? f.file, onclick: () => { state.sel = i; render(); } },
    h("div", { class: "fname" }, f.file,
      f.type === "pdf" && f.textChars === 0 ? h("div", { class: "small muted" }, T("无文字层（扫描件）：请手动框选", "No text layer (scanned): draw boxes")) : null),
    h("span", { class: "n" }, f.error ? "!" : String(total(f))),
    h("span", {}, h("button", { class: "small", title: T("移除", "Remove"), onclick: (e: Event) => { e.stopPropagation(); s.files = s.files.filter((x) => x !== f.file); s.areas = s.areas.filter((a) => a.file !== f.file); void busy(() => save(true)); } }, "✕")))));
  const f = state.files[state.sel];
  const main = h("div", {});
  if (f?.error) main.append(h("div", { class: "card" }, `⚠ ${f.error}`));
  else if (f) {
    main.append(h("div", { class: "hits" }, ...(f.hits.length ? f.hits.map(hitRow) : [h("div", { class: "muted small" }, T("没有找到敏感信息。可以添加姓名/关键词，或在 PDF 页面上拖动手动框选。", "Nothing found. Add names/keywords, or drag on a PDF page to add a box."))])));
    if (f.type === "pdf") {
      const pages = h("div", { class: "pages" }, h("div", { class: "small muted" }, T("黑框=导出时涂黑（点击切换保留）；在页面空白处拖动可加手动框（如签名、照片）。导出时整页转为图片，不留文字层。", "Black = redacted on export (click to keep). Drag on the page to add a box (signatures, photos). Pages are exported as images, with no text layer.")));
      main.append(pages);
      requestAnimationFrame(() => void pdfView(f, pages).catch((e) => toast(String(e?.message ?? e), "error")));
    }
  }
  const results = state.results.length ? h("div", { class: "card result" }, h("b", {}, T("导出结果", "Exported")), ...state.results.map((r) => h("div", {}, r.check.ok ? h("span", { class: "ok" }, T("✓ 自检通过 ", "✓ self-check passed ")) : h("span", { class: "bad" }, T("✗ 自检未通过 ", "✗ self-check FAILED ")), `${r.output} · ${T(`涂黑/替换 ${r.redacted}，保留 ${r.kept}`, `${r.redacted} redacted, ${r.kept} kept`)}`, ...r.check.problems.map((p) => h("div", { class: "bad small" }, p)))), h("div", { class: "small muted" }, T(`日志：${s.output}/redaction-log.csv（不含原值）`, `Log: ${s.output}/redaction-log.csv (no original values)`))) : null;
  put(root, toolbar, opts, results, h("div", { class: "layout" }, fileList, main));
}

onHostContext(() => render());
render();
void initHost("share-redactor", "0.1.0").then(async () => {
  state.ws = (await call<{ files: string[] }>("workspace_files").catch(() => ({ files: [] }))).files;
  render();
});
