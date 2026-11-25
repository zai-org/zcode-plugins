import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Status = "open" | "ok" | "question";
interface Seg { op: "=" | "+" | "-"; text: string }
interface Para { text: string; loc: string; heading?: number }
interface Change { id: string; kind: "added" | "deleted" | "modified" | "moved"; old?: number; new?: number; oldLoc?: string; newLoc?: string; oldText: string; newText: string; segs?: Seg[]; numbers: boolean; summary: string; status: Status; note: string }
interface Row { kind: "same" | Change["kind"]; old?: number; new?: number; change?: string; ghost?: boolean }
interface Data { old: string; new: string; A: Para[]; B: Para[]; rows: Row[]; changes: Change[]; stats: Record<string, number>; options: { ignoreCase?: boolean; ignorePunctuation?: boolean } }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const KIND = (k: string) => ({ added: T("新增", "Added"), deleted: T("删除", "Deleted"), modified: T("修改", "Modified"), moved: T("移动", "Moved") })[k] ?? k;
const state: { d?: Data; files: string[]; filter: string; sel?: string; expanded: Set<number>; pickOld?: string; pickNew?: string; exported?: string[] } = { files: [], filter: "all", expanded: new Set() };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); const s2 = document.getElementById("status"); if (s2) s2.textContent = ""; }
}
function load(v: Record<string, unknown>) {
  const keepSel = state.d && state.d.old === v.old && state.d.new === v.new;
  state.d = v as unknown as Data;
  state.pickOld = state.d.old;
  state.pickNew = state.d.new;
  if (!keepSel) { state.sel = undefined; state.expanded.clear(); state.exported = undefined; }
  render();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "compare") load(v);
  if (v.kind === "exported") { state.exported = v.files as string[]; render(); }
});

const visible = (c: Change) => state.filter === "all" || (state.filter === "numbers" ? c.numbers : state.filter === c.status || state.filter === c.kind);

let queue: Promise<unknown> = Promise.resolve();
async function review(c: Change, patch: Partial<Pick<Change, "status" | "note">>) {
  Object.assign(c, patch);
  const d = state.d!;
  queue = queue.then(() => call("compare_review", { old: d.old, new: d.new, reviews: [{ id: c.id, ...patch }], ...d.options })).catch((e) => toast(String(e?.message ?? e), "error"));
  renderChips();
  const card = document.getElementById(`c-${c.id}`);
  card?.replaceWith(cardEl(c));
}

function segsHtml(segs: Seg[], side: "old" | "new") {
  return segs.map((s) => (s.op === "=" ? document.createTextNode(s.text) : s.op === "-" ? (side === "old" ? h("del", {}, s.text) : null) : side === "new" ? h("ins", {}, s.text) : null)).filter(Boolean) as Node[];
}

function select(id: string, scroll: "doc" | "list") {
  state.sel = id;
  document.querySelectorAll(".sel").forEach((e) => e.classList.remove("sel"));
  const card = document.getElementById(`c-${id}`);
  card?.classList.add("sel");
  let row = document.querySelector<HTMLElement>(`.drow[data-change="${id}"]`);
  if (!row) {
    // 在折叠的未改动区域里：展开后再找
    render();
    row = document.querySelector<HTMLElement>(`.drow[data-change="${id}"]`);
  }
  document.querySelectorAll(`.drow[data-change="${id}"]`).forEach((r) => r.classList.add("sel"));
  if (scroll === "doc" && row) { row.scrollIntoView({ block: "center", behavior: "smooth" }); row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
  if (scroll === "list") card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function cardEl(c: Change): HTMLElement {
  const btn = (s: Status, label: string, title: string) => h("button", { class: `${c.status === s ? "on " : ""}${s}`, title, onclick: (e: Event) => { e.stopPropagation(); void review(c, { status: c.status === s ? "open" : s }); } }, label);
  return h("div", { id: `c-${c.id}`, class: `card chg ${c.status}${state.sel === c.id ? " sel" : ""}`, onclick: () => select(c.id, "doc") },
    h("div", { class: "top" }, h("span", { class: `k ${c.kind}` }, KIND(c.kind)), c.numbers ? h("span", { class: "num", title: T("涉及数字（金额、日期、比例…）", "Involves numbers (amounts, dates, ratios…)") }, "#") : null, h("span", { class: "loc" }, `${c.oldLoc ?? "—"} → ${c.newLoc ?? "—"}`)),
    h("div", { class: "sum" }, c.summary),
    h("div", { class: "acts" },
      btn("ok", T("✓ 确认", "✓ OK"), T("已确认这处改动", "Change confirmed")),
      btn("question", T("? 疑问", "? Ask"), T("这处改动有疑问", "Question this change")),
      h("input", { class: "note", type: "text", value: c.note, placeholder: T("备注…", "Note…"), onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => void review(c, { note: (e.target as HTMLInputElement).value }) })));
}

function renderChips() {
  const box = document.getElementById("chips");
  const d = state.d;
  if (!box || !d) return;
  const n = (f: (c: Change) => boolean) => d.changes.filter(f).length;
  const chip = (key: string, label: string, count: number) => h("span", { class: `chip${state.filter === key ? " on" : ""}`, onclick: () => { state.filter = key; render(); } }, `${label} ${count}`);
  put(box,
    chip("all", T("全部", "All"), d.changes.length),
    chip("modified", KIND("modified"), d.stats.modified), chip("added", KIND("added"), d.stats.added), chip("deleted", KIND("deleted"), d.stats.deleted), d.stats.moved ? chip("moved", KIND("moved"), d.stats.moved) : null,
    chip("numbers", T("# 涉及数字", "# Numbers"), d.stats.numbers),
    chip("open", T("未确认", "Open"), n((c) => c.status === "open")), chip("ok", T("已确认", "Confirmed"), n((c) => c.status === "ok")), chip("question", T("有疑问", "Questioned"), n((c) => c.status === "question")));
}

function docView(d: Data) {
  const byId = new Map(d.changes.map((c) => [c.id, c]));
  const out: HTMLElement[] = [h("div", { class: "dhead" }, h("div", { title: d.old }, `${T("旧版", "Old")} · ${d.old}`), h("div", { title: d.new }, `${T("新版", "New")} · ${d.new}`))];
  const para = (p: Para | undefined, content?: Node[]) => p ? h("div", {}, h("span", { class: "pl" }, p.loc), h("span", { class: p.heading ? "h" : "" }, ...(content ?? [document.createTextNode(p.text)]))) : h("div", {});
  // 未改动的连续段落只保留每处改动前后各 1 段，其余折叠。
  const near = new Set<number>();
  d.rows.forEach((r, i) => { if (r.kind !== "same") for (let k = i - 1; k <= i + 1; k++) near.add(k); });
  let i = 0;
  while (i < d.rows.length) {
    const r = d.rows[i];
    if (r.kind === "same" && !near.has(i) && !state.expanded.has(i)) {
      const start = i;
      while (i < d.rows.length && d.rows[i].kind === "same" && !near.has(i) && !state.expanded.has(i)) i++;
      const end = i;
      out.push(h("div", { class: "gap", onclick: () => { for (let k = start; k < end; k++) state.expanded.add(k); render(); } }, T(`… ${end - start} 段未改动（点击展开）…`, `… ${end - start} unchanged paragraph(s) (click to show) …`)));
      continue;
    }
    const c = r.change ? byId.get(r.change) : undefined;
    const A = r.old !== undefined ? d.A[r.old] : undefined, B = r.new !== undefined ? d.B[r.new] : undefined;
    let left = para(A), right = para(B);
    if (r.kind === "modified" && c?.segs) { left = para(A, segsHtml(c.segs, "old")); right = para(B, segsHtml(c.segs, "new")); }
    else if (r.kind === "added") right = para(B, [h("ins", {}, B!.text)]);
    else if (r.kind === "deleted") left = para(A, [h("del", {}, A!.text)]);
    else if (r.kind === "moved" && c) {
      // 移动：旧位置只显示在左边，新位置只显示在右边
      if (r.ghost && A) { left = para(A, [h("del", {}, A.text)]); right = h("div", { class: "loc" }, T(`↕ 移到 ${c.newLoc}`, `↕ moved to ${c.newLoc}`)); }
      else if (B) { left = h("div", { class: "loc" }, T(`↕ 从 ${c.oldLoc} 移来`, `↕ moved from ${c.oldLoc}`)); right = para(B, [h("ins", {}, B.text)]); }
    }
    out.push(h("div", { class: `drow ${r.kind}${c ? " chg" : ""}${c && state.sel === c.id ? " sel" : ""}`, "data-change": c?.id ?? "", onclick: () => c && select(c.id, "list") }, left, right));
    i++;
  }
  return h("div", { class: "doc", id: "doc" }, ...out);
}

function render() {
  applyTheme();
  const d = state.d;
  const pick = (which: "old" | "new") => h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (which === "old") state.pickOld = v; else state.pickNew = v; } },
    h("option", { value: "" }, which === "old" ? T("旧版文件…", "Old version…") : T("新版文件…", "New version…")),
    ...state.files.map((f) => h("option", { value: f, selected: (which === "old" ? state.pickOld : state.pickNew) === f }, f)));
  const opts = d?.options ?? {};
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("文档版本对照", "Doc Compare")),
    pick("old"), h("span", {}, "→"), pick("new"),
    h("label", { class: "opt" }, h("input", { id: "ic", type: "checkbox", checked: !!opts.ignoreCase }), T("忽略大小写", "Ignore case")),
    h("label", { class: "opt" }, h("input", { id: "ip", type: "checkbox", checked: !!opts.ignorePunctuation }), T("忽略标点", "Ignore punctuation")),
    h("button", { class: d ? "" : "primary", onclick: () => { if (!state.pickOld || !state.pickNew) return toast(T("请选择新旧两个文件", "Choose both files"), "error"); void busy(async () => load(await call("compare_open", { old: state.pickOld, new: state.pickNew, ignoreCase: (document.getElementById("ic") as HTMLInputElement).checked, ignorePunctuation: (document.getElementById("ip") as HTMLInputElement).checked }, 300_000)), T("对照中…", "Comparing…")); } }, T("对照", "Compare")),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    d ? h("button", { class: "primary", onclick: () => void busy(async () => { const r = await call<{ files: string[] }>("compare_export", { old: d.old, new: d.new, format: "both" }); state.exported = r.files; render(); toast(T("已导出", "Exported")); await updateContext(`Doc Compare report exported: ${r.files.join(", ")}`).catch(() => undefined); }) }, T("导出报告", "Export report")) : null);
  if (!d) {
    put(root, toolbar, h("div", { class: "empty" }, T("选择旧版和新版文件（DOCX、PDF、Markdown、TXT，可以不同格式），点“对照”。也可以对 Agent 说：“对比 合同-v1.docx 和 合同-v2.pdf，把涉及金额和日期的改动标出来”。", "Choose the old and new versions (DOCX, PDF, Markdown or TXT; formats may differ) and press Compare. Or ask the agent: compare contract-v1.docx with contract-v2.pdf and flag changes to amounts and dates.")));
    return;
  }
  const list = d.changes.filter(visible);
  put(root, toolbar,
    state.exported ? h("div", { class: "card small" }, T("已导出：", "Exported: "), state.exported.join(", ")) : null,
    h("div", { id: "chips", class: "chips" }),
    d.changes.length
      ? h("div", { class: "layout" }, h("div", { class: "list" }, ...(list.length ? list.map(cardEl) : [h("div", { class: "muted small" }, T("没有符合筛选的改动", "No changes match this filter"))])), docView(d))
      : h("div", { class: "empty" }, T("两份文件的文字内容相同。", "The two documents have the same text.")));
  renderChips();
}

onHostContext(() => render());
render();
void initHost("doc-compare", "0.1.0").then(async () => {
  state.files = (await call<{ files: string[] }>("workspace_files").catch(() => ({ files: [] }))).files;
  render();
});
