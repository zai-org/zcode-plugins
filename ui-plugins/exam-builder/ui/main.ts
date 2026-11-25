import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type QType = "single" | "multi" | "tf" | "fill" | "short";
const TYPES: QType[] = ["single", "multi", "tf", "fill", "short"];
const TL: Record<QType, [string, string]> = { single: ["单选", "Single"], multi: ["多选", "Multi"], tf: ["判断", "T/F"], fill: ["填空", "Fill"], short: ["解答", "Problem"] };
const KIND: Record<string, [string, string]> = { "missing-answer": ["缺答案", "No answer"], "bad-answer": ["答案不对", "Bad answer"], "missing-options": ["缺选项", "No options"], "missing-image": ["缺图片", "Missing image"], duplicate: ["重复题", "Duplicate"], latex: ["公式错误", "LaTeX error"], "unknown-type": ["题型不明", "Unknown type"], dollar: ["$ 不成对", "Unpaired $"] };
interface Issue { id: string; file: string; line: number; kind: string; message: string }
interface Section { type: QType; ids: string[]; scores: number[] }
interface Paper { set: string; sections: Section[]; total: number; levels: Record<string, number> }
interface Rules { title: string; sections: { type: QType; count: number; score?: number }[]; chapters?: string[]; difficulty?: { easy: number; medium: number; hard: number }; sets?: number; seed?: string }
interface View {
  project: { files: string[]; rules?: Rules; meta?: { title: string; duration?: string }; papers?: Paper[]; warnings?: string[] };
  stats: { total: number; usable: number; chapters: string[]; grid: Record<string, number | string>[]; levels: { easy: number; medium: number; hard: number }; byType: Record<QType, number> };
  issues: Issue[];
}
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const L = (x: [string, string]) => (locale() === "zh" ? x[0] : x[1]);
const root = document.getElementById("root")!;
const state: { v?: View; files: string[]; picked: Set<string>; set: string; mode: "paper" | "key"; preview?: string; form: Rules & { duration: string } } = {
  files: [], picked: new Set(), set: "A", mode: "paper",
  form: { title: "", duration: "", sections: [{ type: "single", count: 8 }, { type: "multi", count: 2 }, { type: "tf", count: 3 }, { type: "fill", count: 3 }, { type: "short", count: 2 }], difficulty: { easy: 5, medium: 3, hard: 2 }, sets: 1, chapters: [] },
};

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function setView(v: View) {
  state.v = v;
  state.picked = new Set(v.project.files);
  const r = v.project.rules;
  if (r) state.form = { ...state.form, ...r, duration: v.project.meta?.duration ?? state.form.duration, chapters: r.chapters ?? [] };
  if (!v.project.papers?.some((p) => p.set === state.set)) state.set = "A";
  state.preview = undefined;
  render();
  if (v.project.papers?.length) await refreshPreview();
  void updateContext(`Exam builder: ${v.stats.usable}/${v.stats.total} usable questions, ${v.issues.length} flagged.${v.project.papers?.length ? ` ${v.project.papers.length} set(s) of “${v.project.meta?.title}”, totals ${v.project.papers.map((p) => p.total).join("/")}.` : ""}`).catch(() => undefined);
}
async function refreshPreview() {
  const r = await call<{ html: string }>("exam_preview", { set: state.set, mode: state.mode }).catch(() => undefined);
  state.preview = r?.html;
  render();
}
onToolResult((v) => { if (v?.kind === "exam") void setView(v as unknown as View); if (v?.kind === "exported") toast(T(`已导出 ${(v.files as string[]).length} 个文件`, `Exported ${(v.files as string[]).length} files`)); });

const load = async () => { const r = await busy(() => call<View>("exam_bank", { files: [...state.picked] })); if (r) await setView(r); };
const build = async () => {
  const f = state.form;
  if (!f.title.trim()) { toast(T("请填写试卷标题", "Enter a title"), "error"); return; }
  const r = await busy(() => call<View>("exam_build", { title: f.title.trim(), ...(f.duration ? { duration: f.duration } : {}), sections: f.sections.filter((s) => s.count > 0), ...(f.chapters?.length ? { chapters: f.chapters } : {}), difficulty: f.difficulty, sets: f.sets, ...(f.seed ? { seed: f.seed } : {}) }));
  if (r) await setView(r);
};
const swap = async (id: string) => { const r = await busy(() => call<View>("exam_swap", { set: state.set, id })); if (r) await setView(r); };
const exportAll = async () => { const r = await busy(() => call<{ files: string[]; warnings: string[] }>("exam_export", {}, 600_000)); if (r) toast(T(`已导出 ${r.files.length} 个文件到 ${r.files[0].replace(/\/[^/]+$/, "")}/`, `Exported ${r.files.length} files to ${r.files[0].replace(/\/[^/]+$/, "")}/`)); };

const num = (v: string) => Math.max(0, Number(v) || 0);
function rulesCard(v: View) {
  const f = state.form;
  const avail = v.stats.byType;
  return h("div", { class: "card rules" }, h("b", {}, T("组卷规则", "Paper rules")),
    h("div", { class: "row" },
      h("label", {}, T("标题 ", "Title "), h("input", { class: "title", value: f.title, placeholder: T("如：高一数学期中测试", "e.g. Physics mid-term"), oninput: (e: Event) => { f.title = (e.target as HTMLInputElement).value; } })),
      h("label", {}, T("时长 ", "Time "), h("input", { class: "short", value: f.duration, placeholder: T("90 分钟", "90 min"), oninput: (e: Event) => { f.duration = (e.target as HTMLInputElement).value; } })),
      h("label", {}, T("套数 ", "Sets "), h("input", { class: "n", type: "number", min: "1", max: "10", value: String(f.sets ?? 1), oninput: (e: Event) => { f.sets = Math.max(1, num((e.target as HTMLInputElement).value)); } }))),
    h("table", { class: "data secs" }, h("tr", {}, h("th", {}, T("题型", "Type")), h("th", {}, T("题数", "Count")), h("th", {}, T("每题分值", "Points each")), h("th", {}, T("题库可用", "In bank"))),
      ...TYPES.map((t) => { const s = f.sections.find((x) => x.type === t);
        return h("tr", {}, h("td", {}, L(TL[t])),
          h("td", {}, h("input", { class: "n", type: "number", min: "0", "data-type": t, value: String(s?.count ?? 0), oninput: (e: Event) => { const n = num((e.target as HTMLInputElement).value); const cur = f.sections.find((x) => x.type === t); if (cur) cur.count = n; else f.sections.push({ type: t, count: n }); f.sections.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type)); } })),
          h("td", {}, h("input", { class: "n", type: "number", min: "0", placeholder: T("默认", "default"), value: s?.score ? String(s.score) : "", oninput: (e: Event) => { const n = num((e.target as HTMLInputElement).value); const cur = f.sections.find((x) => x.type === t); if (cur) cur.score = n || undefined; } })),
          h("td", { class: "muted" }, String(avail[t] ?? 0))); })),
    h("div", { class: "row" }, T("难度比例 易:中:难 ", "Difficulty easy:medium:hard "),
      ...(["easy", "medium", "hard"] as const).map((k) => h("input", { class: "n", type: "number", min: "0", value: String(f.difficulty?.[k] ?? 0), oninput: (e: Event) => { f.difficulty = { ...(f.difficulty ?? { easy: 0, medium: 0, hard: 0 }), [k]: num((e.target as HTMLInputElement).value) }; } })),
      h("span", { class: "muted" }, T(`题库：易 ${v.stats.levels.easy} · 中 ${v.stats.levels.medium} · 难 ${v.stats.levels.hard}`, `Bank: easy ${v.stats.levels.easy} · medium ${v.stats.levels.medium} · hard ${v.stats.levels.hard}`))),
    h("div", { class: "row chapters" }, T("章节：", "Chapters: "), ...v.stats.chapters.map((c) => h("label", {}, h("input", { type: "checkbox", checked: !f.chapters?.length || f.chapters.includes(c), onchange: (e: Event) => {
      const all = f.chapters?.length ? new Set(f.chapters) : new Set(v.stats.chapters);
      (e.target as HTMLInputElement).checked ? all.add(c) : all.delete(c);
      f.chapters = all.size === v.stats.chapters.length ? [] : [...all];
    } }), c))),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void build() }, v.project.papers?.length ? T("重新组卷", "Rebuild") : T("组卷", "Build paper"))));
}

function render() {
  applyTheme();
  const v = state.v;
  const picker = h("div", { class: "card files" }, h("b", {}, T("题库文件", "Question banks")),
    h("div", { class: "flist" }, ...state.files.map((f) => h("label", {}, h("input", { type: "checkbox", checked: state.picked.has(f), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? state.picked.add(f) : state.picked.delete(f); } }), f))),
    h("div", { class: "row" }, h("button", { class: v ? "" : "primary", onclick: () => void load() }, v ? T("重新载入题库", "Reload banks") : T("载入题库", "Load banks"))));
  if (!v) { put(root, picker, h("div", { class: "empty" }, T("勾选题库（Markdown 或 Excel），点“载入题库”。题目格式见 README。", "Tick your question banks (Markdown or Excel) and press Load. See the README for the format."))); return; }
  const s = v.stats;
  const stats = h("div", { class: "stats" }, h("div", {}, h("b", {}, String(s.total)), T("道题", "questions")), h("div", {}, h("b", {}, String(s.usable)), T("可用", "usable")),
    h("div", { class: v.issues.length ? "bad" : "" }, h("b", {}, String(v.issues.length)), T("个问题", "problems")), h("div", {}, h("b", {}, String(s.chapters.length)), T("个章节", "chapters")));
  const grid = h("table", { class: "data bankgrid" }, h("tr", {}, h("th", {}, T("章节", "Chapter")), ...TYPES.map((t) => h("th", {}, L(TL[t])))), ...s.grid.map((r) => h("tr", {}, h("td", {}, String(r.chapter)), ...TYPES.map((t) => h("td", { class: r[t] ? "" : "muted" }, String(r[t]))))));
  const issues = v.issues.length ? h("div", { class: "card issues" }, h("b", {}, T("需要修正的题（组卷时跳过）", "Questions to fix (skipped when building)")),
    ...v.issues.map((i) => h("div", { class: "issue" }, h("span", { class: "badge bad" }, L(KIND[i.kind] ?? [i.kind, i.kind])), h("b", {}, i.id), h("span", { class: "muted" }, `${i.file}:${i.line}`), h("span", {}, i.message)))) : null;
  const papers = v.project.papers ?? [];
  let paperCard: HTMLElement | null = null;
  if (papers.length) {
    const cur = papers.find((p) => p.set === state.set) ?? papers[0];
    const tabs = h("div", { class: "tabs" }, ...papers.map((p) => h("button", { class: `tab${p.set === cur.set ? " on" : ""}`, onclick: () => { state.set = p.set; void refreshPreview(); } }, T(`${p.set} 卷（${p.total} 分）`, `Paper ${p.set} (${p.total} pts)`))),
      h("span", { class: "grow" }), h("button", { class: `tab${state.mode === "paper" ? " on" : ""}`, onclick: () => { state.mode = "paper"; void refreshPreview(); } }, T("试卷", "Paper")), h("button", { class: `tab${state.mode === "key" ? " on" : ""}`, onclick: () => { state.mode = "key"; void refreshPreview(); } }, T("答案", "Answer key")),
      h("button", { class: "primary", onclick: () => void exportAll() }, T("导出 PDF + HTML", "Export PDF + HTML")));
    const lv = cur.levels;
    const info = h("div", { class: "muted" }, T(`易 ${lv[1]} · 中 ${lv[2]} · 难 ${lv[3]}　鼠标移到题目上可“换一题”`, `easy ${lv[1]} · medium ${lv[2]} · hard ${lv[3]} — hover a question to swap it`));
    const warn = v.project.warnings?.length ? h("div", { class: "warnbox" }, ...v.project.warnings.map((w) => h("div", {}, "⚠ ", warnText(w)))) : null;
    const pv = h("div", { class: "paper" });
    if (state.preview) {
      pv.innerHTML = state.preview;
      if (state.mode === "paper") for (const el of pv.querySelectorAll<HTMLElement>(".q[data-id]")) {
        const id = el.dataset.id!;
        el.prepend(h("button", { class: "swap", title: id, onclick: () => void swap(id) }, T("换一题", "Swap")));
      }
    }
    paperCard = h("div", { class: "card" }, tabs, info, warn, pv);
  }
  put(root, picker, stats, h("div", { class: "two" }, h("div", {}, grid, issues), rulesCard(v)), paperCard);
}

function warnText(w: string) {
  if (locale() !== "zh") return w;
  return w.replace(/^set (\w) (\w+): /, (_m, set: string, t: string) => `${set} 卷${TL[t as QType]?.[0] ?? t}题：`)
    .replace(/not enough questions at the requested difficulty; (\d+) filled from other levels/, "指定难度的题不够，$1 道用其他难度补上")
    .replace(/only (\d+) of (\d+) questions available/, "题库只有 $1 道可用（需要 $2 道）")
    .replace(" (questions are not repeated across sets)", "（各套之间不重复出题）");
}

onHostContext(() => render());
render();
void initHost("exam-builder", "0.1.0").then(async () => {
  state.files = (await call<{ files: string[] }>("workspace_files").catch(() => ({ files: [] }))).files;
  const st = await call<Record<string, unknown>>("exam_state").catch(() => undefined);
  if (st?.kind === "exam") await setView(st as unknown as View); else render();
});
