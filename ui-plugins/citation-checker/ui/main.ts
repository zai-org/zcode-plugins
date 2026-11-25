import css from "./kit.css";
import panelCss from "./panel.css";
import { diffChars, diffWords } from "diff";
import { applyTheme, base64ToBytes, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";
import { openPdf, renderPage, toCanvas, type PdfDoc } from "./pdf.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Status = "ok" | "weak" | "number" | "quote" | "missing";
type Verdict = "supported" | "partly" | "wrong" | "unsupported" | "open";
interface Passage { file: string; block: number; start: number; end: number; text: string; loc: string; page?: number; section?: string }
interface Evidence extends Passage { score: number }
interface Claim {
  id: string; text: string; loc: string; section?: string; cites: string[]; citedFiles: string[]; status: Status; reason: string; coverage: number;
  numbers: { raw: string; found: boolean; evidence?: number; suggest?: string }[];
  quotes: { text: string; found: boolean; closest?: Passage & { similarity: number } }[];
  evidence: Evidence[]; citeMismatch?: string;
  review?: { verdict: Verdict; note?: string; at: string };
}
interface State { report: string; title: string; sources: { file: string; title: string; kind: string; error?: string }[]; checkedAt: string; claims: Claim[] }
type View = { kind: "pdf"; file: string; page: number; pages: number; rects: { x: number; y: number; w: number; h: number }[]; w: number; h: number; text: string } | { kind: "text"; file: string; loc: string; section?: string; prev: string[]; before: string; match: string; after: string; next: string[] };

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const LABEL: Record<Status, [string, string]> = { number: ["数字不符", "Number mismatch"], quote: ["引文不符", "Quote mismatch"], missing: ["找不到依据", "No source found"], weak: ["需确认", "Needs a look"], ok: ["有依据", "Supported"] };
const VLABEL: Record<Verdict, [string, string]> = { supported: ["属实", "Supported"], partly: ["部分属实", "Partly"], wrong: ["有误", "Wrong"], unsupported: ["无依据", "Unsupported"], open: ["待定", "Open"] };
const ORDER: Status[] = ["number", "quote", "missing", "weak", "ok"];
const L = (x: [string, string]) => (locale() === "zh" ? x[0] : x[1]);

const state: { files: string[]; checked: string[]; report: string; sources: string; s?: State; sel?: string; filter: Status | "all" | "todo"; ev?: Passage; view?: View; note: string; pdfs: Map<string, PdfDoc> } = { files: [], checked: [], report: "", sources: "", filter: "all", note: "", pdfs: new Map() };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  status(label);
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); status(""); }
}
function status(t: string) { const st = document.getElementById("status"); if (st) st.textContent = t; }

const claim = () => state.s?.claims.find((c) => c.id === state.sel);
function setState(s: State) {
  const same = state.s?.report === s.report;
  state.s = s;
  state.report = s.report;
  if (!same || !claim()) {
    const first = ORDER.flatMap((st) => s.claims.filter((c) => c.status === st))[0];
    state.sel = first?.id;
    state.ev = undefined;
    state.view = undefined;
  }
  if (!state.checked.includes(s.report)) state.checked.push(s.report);
  render();
  const c = claim();
  if (c && !state.view) void pick(c, firstPassage(c));
  void sync();
}
const firstPassage = (c: Claim): Passage | undefined => c.quotes.find((q) => !q.found)?.closest ?? c.quotes.find((q) => q.found)?.closest ?? c.evidence[0];

onToolResult((v) => {
  if (!v) return;
  if ((v.kind === "checked" || v.kind === "reviewed") && v.state) setState(v.state as State);
  if (v.kind === "exported") toast(T(`已导出 ${v.path}`, `Exported ${v.path}`));
});
async function sync() {
  const s = state.s;
  if (!s) return;
  const c = claim();
  const n = (st: Status) => s.claims.filter((x) => x.status === st).length;
  await updateContext(`Citation check panel: ${s.report} — ${s.claims.length} claims (${ORDER.map((st) => `${st} ${n(st)}`).join(", ")}), ${s.claims.filter((x) => x.review && x.review.verdict !== "open").length} reviewed.${c ? ` Selected ${c.id} [${c.status}${c.review ? ` → ${c.review.verdict}` : ""}]: ${c.text}` : ""}`).catch(() => undefined);
}

async function runCheck() {
  if (!state.report) { toast(T("先选择报告", "Pick a report first"), "error"); return; }
  const sources = state.sources.split(/[\n,，;；]+/).map((x) => x.trim()).filter(Boolean);
  const r = await busy(() => call<{ state: State }>("cite_check", { report: state.report, ...(sources.length ? { sources } : {}) }, 600_000), T("正在核对…", "Checking…"));
  if (r) { state.s = undefined; setState(r.state); }
}
async function openChecked(report: string) {
  state.report = report;
  const r = await busy(() => call<{ state: State }>("cite_state", { report }));
  if (r) { state.s = undefined; setState(r.state); }
}
async function review(verdict: Verdict) {
  const c = claim();
  if (!c || !state.s) return;
  const r = await busy(() => call<{ state: State }>("cite_review", { report: state.s!.report, reviews: [{ id: c.id, verdict, ...(state.note.trim() ? { note: state.note.trim() } : {}) }] }));
  if (!r) return;
  state.s = r.state;
  // 跳到下一条未复核的问题
  const list = visible();
  const i = list.findIndex((x) => x.id === c.id);
  const next = list.slice(i + 1).find((x) => !x.review && x.status !== "ok");
  if (next) select(next.id); else { render(); void sync(); }
}
async function exportAs(format: "html" | "csv") {
  if (!state.s) return;
  const r = await busy(() => call<{ path: string }>("cite_export", { report: state.s!.report, format }));
  if (r) toast(T(`已导出 ${r.path}`, `Exported ${r.path}`));
}

function select(id: string) {
  state.sel = id;
  state.note = claim()?.review?.note ?? "";
  state.view = undefined;
  render();
  const c = claim();
  if (c) void pick(c, firstPassage(c));
  void sync();
  document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
}
async function pick(c: Claim, p?: Passage) {
  state.ev = p;
  state.view = undefined;
  renderDetail();
  if (!p || !state.s) return;
  const v = await call<View>("source_view", { report: state.s.report, file: p.file, block: p.block, start: p.start, end: p.end }).catch((e) => { toast(String(e?.message ?? e), "error"); return undefined; });
  if (!v || state.ev !== p || claim() !== c) return;
  state.view = v;
  renderDetail();
}

const visible = () => {
  const s = state.s;
  if (!s) return [];
  const all = ORDER.flatMap((st) => s.claims.filter((c) => c.status === st));
  return state.filter === "all" ? all : state.filter === "todo" ? all.filter((c) => !c.review && c.status !== "ok") : all.filter((c) => c.status === state.filter);
};

/** 报告原句：数字按核对结果上色（绿=资料里有，红=不符）。 */
function claimText(c: Claim) {
  const parts: (Node | string)[] = [];
  let rest = c.text;
  for (const n of c.numbers) {
    const at = rest.indexOf(n.raw);
    if (at < 0) continue;
    parts.push(rest.slice(0, at), h("span", { class: n.found ? "num ok" : "num bad", title: n.found ? T("资料中有此数字", "found in source") : n.suggest ? T(`资料为 ${n.suggest}`, `source says ${n.suggest}`) : T("资料中没有", "not in source") }, n.raw));
    rest = rest.slice(at + n.raw.length);
  }
  parts.push(rest);
  return parts;
}

function quoteDiff(q: string, src: string) {
  const cjk = /[\u4e00-\u9fff]/.test(q);
  const parts = (cjk ? diffChars : diffWords)(src, q);
  return h("div", { class: "qdiff" }, ...parts.map((p) => (p.added ? h("ins", { title: T("报告多出/改写", "in report only") }, p.value) : p.removed ? h("del", { title: T("资料原文", "source wording") }, p.value) : p.value)));
}

function renderDetail() {
  const box = document.getElementById("detail");
  if (!box) return;
  const c = claim();
  if (!c) { put(box, h("div", { class: "empty" }, T("选择左侧的一条", "Pick a claim on the left"))); return; }
  const verdicts = (Object.keys(VLABEL) as Verdict[]).map((v) => h("button", { class: `vbtn ${v}${c.review?.verdict === v ? " on" : ""}`, onclick: () => void review(v) }, L(VLABEL[v])));
  const evButtons: HTMLElement[] = [];
  const seen = new Set<string>();
  const addEv = (p: Passage | undefined, label: string) => {
    if (!p) return;
    const k = `${p.file}#${p.block}#${p.start}`;
    if (seen.has(k)) return;
    seen.add(k);
    evButtons.push(h("button", { class: `evbtn${state.ev && state.ev.file === p.file && state.ev.block === p.block && state.ev.start === p.start ? " on" : ""}`, onclick: () => void pick(c, p), title: p.text }, `${label} ${p.file.split("/").pop()} · ${p.page ? T(`第 ${p.page} 页`, `p.${p.page}`) : p.loc}`));
  };
  c.quotes.forEach((q) => addEv(q.closest, q.found ? T("引文", "Quote") : T("最接近", "Closest")));
  c.evidence.forEach((e, i) => addEv(e, i ? T("另见", "Also") : T("依据", "Source")));
  const nums = c.numbers.length ? h("table", { class: "data nums" }, h("tr", {}, h("th", {}, T("报告数字", "In report")), h("th", {}, T("资料", "Source"))), ...c.numbers.map((n) => h("tr", {}, h("td", {}, n.raw), h("td", { class: n.found ? "ok" : "bad" }, n.found ? T("✓ 一致", "✓ matches") : n.suggest ? T(`✗ 资料为 ${n.suggest}`, `✗ source says ${n.suggest}`) : T("✗ 没找到", "✗ not found"))))) : null;
  const quotes = c.quotes.map((q) => h("div", { class: "quote" }, q.found ? h("span", { class: "ok" }, T("✓ 引文与资料逐字一致", "✓ Quote is verbatim in the source")) : q.closest ? h("div", {}, h("span", { class: "bad" }, T(`✗ 引文与资料不一致（相似 ${Math.round(q.closest.similarity * 100)}%）：绿色为资料原文，红色为报告改写`, `✗ Not verbatim (${Math.round(q.closest.similarity * 100)}% similar): green = source wording, red = report`)), quoteDiff(q.text, q.closest.text)) : h("span", { class: "bad" }, T("✗ 资料里找不到这段引文", "✗ Quote not found in any source"))));
  put(box,
    h("div", { class: "claimhead" }, h("span", { class: `chip ${c.status}` }, L(LABEL[c.status])), h("b", {}, c.id), h("span", { class: "muted" }, `${c.loc}${c.section ? ` · ${c.section}` : ""}`), c.cites.length ? h("span", { class: "muted" }, c.cites.map((x) => `[${x}]`).join("")) : null),
    h("div", { class: "claimtext" }, ...claimText(c)),
    h("div", { class: "reason" }, reasonText(c)),
    c.citeMismatch ? h("div", { class: "warnline" }, T("⚠ 出处不符：", "⚠ Cited source differs: ") + c.citeMismatch) : null,
    nums, ...quotes,
    h("div", { class: "verdicts" }, h("span", { class: "muted" }, T("结论：", "Verdict:")), ...verdicts),
    h("div", { class: "row" }, h("input", { class: "note", placeholder: T("备注（如正确数字、需补的出处）", "Note (correct figure, missing source…)"), value: state.note, oninput: (e: Event) => { state.note = (e.target as HTMLInputElement).value; }, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && c.review) void review(c.review.verdict); } })),
    evButtons.length ? h("div", { class: "evs" }, ...evButtons) : h("div", { class: "muted" }, T("资料里没有相关段落。可以让助手用 cite_search 再找找。", "No related passage in the sources. Ask the assistant to search with cite_search.")),
    h("div", { id: "viewer", class: "viewer" }, viewerBody()),
  );
  if (state.view?.kind === "pdf") requestAnimationFrame(() => void drawPdf(state.view as Extract<View, { kind: "pdf" }>).catch((e) => toast(String(e?.message ?? e), "error")));
  else requestAnimationFrame(() => document.querySelector("#viewer mark")?.scrollIntoView({ block: "center" }));
}
function reasonText(c: Claim) {
  const ev = c.evidence[0];
  switch (c.status) {
    case "ok": return T(`资料 ${ev?.file ?? c.quotes[0]?.closest?.file ?? ""} 中找到对应原文${c.numbers.length ? "，数字一致" : ""}。`, c.reason);
    case "weak": return c.numbers.length ? T("数字在资料里都找到了，但措辞差别较大（转述或翻译？），请确认意思一致。", c.reason) : T(`只有部分措辞吻合（${Math.round(c.coverage * 100)}%），请确认。`, c.reason);
    case "number": return T(`数字与资料不符：${c.numbers.filter((n) => !n.found).map((n) => `${n.raw}${n.suggest ? `（资料为 ${n.suggest}）` : ""}`).join("、")}`, c.reason);
    case "quote": return T("引号里的话与资料原文不一致。", c.reason);
    default: return T(`资料里找不到支持这句话的内容（最接近 ${Math.round(c.coverage * 100)}%）。`, c.reason);
  }
}
function viewerBody() {
  const v = state.view;
  if (!state.ev) return null;
  if (!v) return h("div", { class: "muted" }, T("正在打开原文…", "Opening source…"));
  if (v.kind === "text") return h("div", { class: "textview" }, h("div", { class: "vhead" }, `${v.file} · ${v.loc}${v.section ? ` · ${v.section}` : ""}`), ...v.prev.map((t) => h("p", { class: "ctx" }, t)), h("p", {}, v.before, h("mark", {}, v.match), v.after), ...v.next.map((t) => h("p", { class: "ctx" }, t)));
  return h("div", {}, h("div", { class: "vhead" }, `${v.file} · ${T(`第 ${v.page} / ${v.pages} 页`, `page ${v.page} of ${v.pages}`)}`), h("div", { class: "pagebox", id: "pagebox" }, h("canvas", {})));
}
async function drawPdf(v: Extract<View, { kind: "pdf" }>) {
  const box = document.getElementById("pagebox");
  if (!box || !state.s) return;
  let doc = state.pdfs.get(v.file);
  if (!doc) {
    const r = await call<{ data: string }>("file_data", { report: state.s.report, file: v.file }, 120_000);
    doc = await openPdf(base64ToBytes(r.data));
    state.pdfs.set(v.file, doc);
  }
  const canvas = box.querySelector("canvas") as HTMLCanvasElement;
  const width = Math.min(820, Math.max(360, (document.getElementById("viewer")?.clientWidth ?? 600) - 4));
  const ratio = window.devicePixelRatio || 1;
  const vp = await renderPage(doc, v.page, canvas, width / v.w, ratio);
  canvas.style.width = `${vp.width / ratio}px`;
  box.querySelectorAll(".hl").forEach((e) => e.remove());
  let top = Infinity;
  for (const r of v.rects) {
    const c = toCanvas(vp, r);
    top = Math.min(top, c.y / ratio);
    box.append(h("div", { class: "hl", style: `left:${c.x / ratio}px;top:${c.y / ratio}px;width:${c.w / ratio}px;height:${c.h / ratio}px` }));
  }
  const viewer = document.getElementById("viewer");
  if (viewer && Number.isFinite(top)) viewer.scrollTop = Math.max(0, top - 80);
}

function render() {
  applyTheme();
  const s = state.s;
  const reports = state.files.filter((f) => /\.(md|markdown|docx|txt)$/i.test(f) || state.checked.includes(f));
  const top = h("div", { class: "toolbar" },
    h("label", {}, T("报告", "Report"), h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; state.report = v; if (state.checked.includes(v)) void openChecked(v); else render(); } },
      h("option", { value: "" }, T("— 选择 —", "— choose —")), ...reports.map((f) => h("option", { value: f, selected: f === state.report }, `${f}${state.checked.includes(f) ? " ✓" : ""}`)))),
    h("input", { class: "sources", placeholder: T("资料（文件或文件夹，逗号分隔；默认：报告所在文件夹）", "Sources (files or folders; default: the report's folder)"), value: state.sources, oninput: (e: Event) => { state.sources = (e.target as HTMLInputElement).value; } }),
    h("button", { class: "primary", onclick: () => void runCheck() }, s && s.report === state.report ? T("重新核对", "Re-check") : T("核对", "Check")),
    s ? h("button", { onclick: () => void exportAs("html") }, T("导出 HTML", "Export HTML")) : null,
    s ? h("button", { onclick: () => void exportAs("csv") }, "CSV") : null,
    h("span", { id: "status", class: "muted" }),
  );
  if (!s) {
    put(root, top, h("div", { class: "empty" }, T("选择报告（Markdown / Word / TXT）并点“核对”。资料默认取报告所在文件夹里的 PDF、网页（.html）、Word、Markdown 和 TXT。", "Pick a report (Markdown / Word / TXT) and press Check. Sources default to the PDFs, saved web pages (.html), Word, Markdown and text files in the report's folder.")));
    return;
  }
  const count = (st: Status) => s.claims.filter((c) => c.status === st).length;
  const todo = s.claims.filter((c) => !c.review && c.status !== "ok").length;
  const chips = h("div", { class: "chips" },
    h("button", { class: `fchip${state.filter === "all" ? " on" : ""}`, onclick: () => { state.filter = "all"; render(); } }, `${T("全部", "All")} ${s.claims.length}`),
    h("button", { class: `fchip todo${state.filter === "todo" ? " on" : ""}`, onclick: () => { state.filter = "todo"; render(); } }, `${T("待复核", "To review")} ${todo}`),
    ...ORDER.map((st) => h("button", { class: `fchip ${st}${state.filter === st ? " on" : ""}`, disabled: !count(st), onclick: () => { state.filter = st; render(); } }, `${L(LABEL[st])} ${count(st)}`)),
    h("span", { class: "muted small" }, T(`资料 ${s.sources.length} 份`, `${s.sources.length} sources`)),
    ...s.sources.filter((x) => x.error).map((x) => h("span", { class: "badge bad", title: x.error }, `${x.file.split("/").pop()}: ${x.error}`)),
  );
  const list = h("div", { class: "list" }, ...visible().map((c) => h("div", { class: `item${c.id === state.sel ? " sel" : ""}`, "data-id": c.id, onclick: () => select(c.id) },
    h("div", { class: "ihead" }, h("span", { class: `chip ${c.status}` }, L(LABEL[c.status])), c.review ? h("span", { class: `vchip ${c.review.verdict}` }, L(VLABEL[c.review.verdict])) : null, c.citeMismatch ? h("span", { class: "badge", title: c.citeMismatch }, T("出处?", "cite?")) : null, h("span", { class: "muted small" }, `${c.id} · ${c.loc}`)),
    h("div", { class: "itext" }, ...claimText(c)))));
  put(root, top, chips, h("div", { class: "layout" }, list, h("div", { id: "detail", class: "detail" })));
  renderDetail();
}

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
  const list = visible();
  const i = list.findIndex((c) => c.id === state.sel);
  if (e.key === "j" || e.key === "ArrowDown") { const n = list[Math.min(list.length - 1, i + 1)]; if (n) { select(n.id); e.preventDefault(); } }
  if (e.key === "k" || e.key === "ArrowUp") { const n = list[Math.max(0, i - 1)]; if (n) { select(n.id); e.preventDefault(); } }
});

onHostContext(() => render());
render();
void initHost("citation-checker", "0.1.0").then(async () => {
  const r = await call<{ files: string[]; checked: string[] }>("workspace_files").catch(() => ({ files: [], checked: [] }));
  state.files = r.files;
  state.checked = r.checked;
  if (!state.s && !state.report && r.checked.length) await openChecked(r.checked[0]);
  else render();
});
