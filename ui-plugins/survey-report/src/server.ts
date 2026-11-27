import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Row } from "./kit/app.ts";
import { newPdf } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { chartSvg, drawReport, esc, headline, reportHtml, type Section } from "./report.ts";
import { analyze, cleanLabel, crossTab, detectType, QTYPES, type QType } from "./survey.ts";

export const NAME = "survey-report";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
type Meta = { headers: string[]; data: string[][]; responses: number; file: string };

function resolveQuestion(rows: Row[], want: string): number {
  const w = want.trim().toLowerCase();
  if (!w) return -1;
  const m = w.match(/^q?(\d+)$/);
  if (m) return rows.findIndex((r) => s(r.no).toLowerCase() === `q${m[1]}`);
  const exact = rows.findIndex((r) => s(r.label).toLowerCase() === w || s(r.header).toLowerCase() === w);
  return exact >= 0 ? exact : rows.findIndex((r) => s(r.label).toLowerCase().includes(w) || s(r.header).toLowerCase().includes(w));
}

function build(rows: Row[], meta: Meta, settings: Record<string, unknown>) {
  const sort = s(settings.sort) === "original" ? "original" : "count";
  const issues: Issue[] = [];
  const crossIdx = resolveQuestion(rows, s(settings.crossBy));
  let crossLabel = "", groupVals: string[] = [], groups: string[] = [];
  if (s(settings.crossBy)) {
    const cr = rows[crossIdx];
    if (!cr) issues.push({ level: "warn", message: `Cross-tab question “${s(settings.crossBy)}” not found — use the Q number (e.g. Q3) or the question text / 找不到交叉分析的题目` });
    else if (s(cr.type) !== "single") issues.push({ level: "warn", row: crossIdx, key: "type", message: `Cross-tab needs a single-choice question; ${s(cr.no)} is ${s(cr.type)} / 交叉分析需要单选题` });
    else {
      groupVals = meta.data[Number(cr._col)];
      groups = analyze("single", groupVals, { sort }).options.map((o) => o.label);
      crossLabel = s(cr.label) || s(cr.header);
    }
  }
  const sections: Section[] = [];
  const out = rows.map((r, i): Row => {
    const type = (QTYPES.includes(s(r.type) as QType) ? s(r.type) : "text") as QType;
    const values = meta.data[Number(r._col)] ?? [];
    const res = analyze(type, values, { sort });
    if (res.ignored) issues.push({ level: "warn", row: i, key: "type", message: `${res.ignored} answer(s) to ${s(r.no)} are not numbers and were left out / ${res.ignored} 个回答不是数字` });
    if (type !== "skip" && !res.answered) issues.push({ level: "info", row: i, message: `${s(r.no)} has no answers / 无人回答` });
    if (type === "single" && res.options.length > 15) issues.push({ level: "warn", row: i, key: "type", message: `${s(r.no)} has ${res.options.length} different answers — maybe open text? / 选项太多，可能是开放题` });
    if (r.include !== false && type !== "skip") {
      const chart = (["bar", "pie", "none"].includes(s(r.chart)) ? s(r.chart) : "bar") as Section["chart"];
      sections.push({ no: s(r.no), label: s(r.label) || s(r.header), chart, res, cross: groups.length && i !== crossIdx ? crossTab(groupVals, groups, type, values, { sort }) : undefined });
    }
    return { ...r, answered: type === "skip" ? "" : res.answered, result: type === "skip" ? "" : headline(res) };
  });
  return { rows: out, sections, issues, crossLabel };
}

const reportOpts = (project: { settings: Record<string, unknown> }, meta: Meta, b: ReturnType<typeof build>) => ({
  title: s(project.settings.title) || "Survey report", responses: meta.responses, sections: b.sections, crossBy: b.crossLabel,
  maxText: Number(project.settings.maxText ?? 30), generated: new Date().toLocaleDateString("zh-CN"),
});

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "survey",
  title: ["问卷结果报告", "Survey Report"],
  openDescription:
    "Turn a survey export (.xlsx/.csv, one row per response, one column per question — e.g. from 问卷星, 腾讯问卷, Google Forms, Microsoft Forms) into a report. Each question's type is detected: single choice, multiple choice (answers joined by ┋ , ; 、 |), rating (1–5/1–7/1–10), NPS (0–10, recommend), number, open text, or skip (IDs, times, contact details). Grid rows are questions: change label, type, chart (bar/pie/none) or include. settings.crossBy (Q number or text of a single-choice question) adds a cross-tab to every other question. Exports report.html, report.pdf and results.xlsx.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择问卷导出表", "Pick a survey export"] },
  settings: [
    { key: "title", label: ["报告标题", "Report title"], type: "text", default: "问卷结果报告" },
    { key: "crossBy", label: ["交叉分析按", "Cross-tab by"], type: "text", default: "", help: ["填单选题的题号（如 Q3）或题目文字；留空不做交叉", "Q number (e.g. Q3) or text of a single-choice question; blank = none"] },
    { key: "sort", label: ["选项顺序", "Option order"], type: "select", default: "count", options: [{ value: "count", label: ["按人数", "By count"] }, { value: "original", label: ["按出现顺序", "As they appear"] }] },
    { key: "maxText", label: ["每题最多列出文字回答", "Text answers listed per question"], type: "number", default: 30, min: 0 },
  ],
  columns: () => [
    { key: "include", label: ["纳入", "Include"], type: "bool" },
    { key: "no", label: ["题号", "Q"], readOnly: true },
    { key: "label", label: ["题目", "Question"], wide: true },
    { key: "type", label: ["题型", "Type"], type: "select", options: QTYPES },
    { key: "chart", label: ["图表", "Chart"], type: "select", options: ["bar", "pie", "none"] },
    { key: "answered", label: ["回答数", "Answered"], type: "number", readOnly: true },
    { key: "result", label: ["结果", "Result"], readOnly: true, wide: true },
  ] as Column[],
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty", "The file has no responses (one row per response, questions as columns).");
    const headers = t.columns;
    const data = headers.map((h) => t.rows.map((r) => s(r[h])));
    let q = 0;
    const rows: Row[] = headers.map((h, i) => {
      const type = detectType(h, data[i]);
      return { _col: i, include: type !== "skip", no: type === "skip" ? "—" : `Q${++q}`, header: h, label: cleanLabel(h), type, chart: type === "single" && new Set(data[i].filter(Boolean)).size <= 6 ? "pie" : type === "text" ? "none" : "bar" };
    });
    const meta: Meta = { headers, data, responses: t.rows.length, file: files[0] };
    return { rows, meta };
  },
  compute(p): Computed {
    const meta = p.meta as Meta;
    const b = build(p.rows, meta, p.settings);
    const n = b.sections.length;
    b.issues.unshift({ level: "info", message: `${meta.responses} response(s), ${n} question(s) in the report / ${meta.responses} 份回答，${n} 道题` });
    const preview = b.sections.slice(0, 6).map((sec) => `<div style="margin:0 0 12px"><b>${esc(sec.no)} ${esc(sec.label)}</b><div class="muted" style="font-size:11px">${sec.res.answered} answered · ${esc(headline(sec.res))}</div>${chartSvg(sec)}${(sec.res.texts ?? []).slice(0, 3).map((x) => `<div style="font-size:11px;color:#374151">• ${esc(x)}</div>`).join("")}</div>`).join("");
    return {
      rows: b.rows,
      issues: b.issues,
      summary: `${meta.responses} responses · ${n} questions${b.crossLabel ? ` · cross-tab by “${b.crossLabel}”` : ""}. ${meta.responses} 份回答，${n} 道题。`,
      stats: { responses: meta.responses, questions: n, skipped: p.rows.filter((r) => s(r.type) === "skip").length },
      preview: `<div style="font-size:12px">${preview}${n > 6 ? `<p class="muted">… ${n - 6} more in the report</p>` : ""}</div>`,
    };
  },
  exports: [
    {
      id: "html", label: ["HTML 报告", "HTML report"], description: "report.html — one page with a chart per question, open answers and cross-tabs",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta, b = build(project.rows, meta, project.settings);
        return [await write("report.html", reportHtml(reportOpts(project, meta, b)))];
      },
    },
    {
      id: "pdf", label: ["PDF 报告", "PDF report"], description: "report.pdf — the same report on A4 pages",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta, b = build(project.rows, meta, project.settings);
        const k = await newPdf();
        drawReport(k, reportOpts(project, meta, b));
        return { files: [await write("report.pdf", await k.doc.save())], note: k.cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "xlsx", label: ["结果表 Excel", "Results (Excel)"], description: "results.xlsx — counts and % per option, scores, cross-tabs, every open answer and the raw data",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta, b = build(project.rows, meta, project.settings);
        const sum: unknown[][] = [];
        for (const sec of b.sections) {
          if (sec.res.type === "text") { sum.push([sec.no, sec.label, "text", sec.res.answered, "（见“开放题”表 / see Open answers）", "", ""]); continue; }
          sum.push([sec.no, sec.label, sec.res.type, sec.res.answered, headline(sec.res), "", ""]);
          for (const o of sec.res.options) sum.push(["", "", "", "", o.label, o.count, o.pct / 100]);
        }
        const cross: unknown[][] = [];
        for (const sec of b.sections) if (sec.cross) {
          cross.push([`${sec.no} ${sec.label}`, ...sec.cross.groups.map((g) => `${g.label} (n=${g.n})`)]);
          for (const r of sec.cross.rows) cross.push([r.label, ...r.cells.map((c) => (c.value !== undefined ? c.value : c.count !== undefined ? `${c.count} (${c.pct}%)` : `${c.pct}%`))]);
          cross.push([]);
        }
        const texts = b.sections.flatMap((sec) => (sec.res.texts ?? []).map((t) => [sec.no, sec.label, t]));
        const sheets = [
          { name: "汇总 Summary", headers: ["题号 Q", "题目 Question", "题型 Type", "回答数 Answered", "选项 / 结果 Option / Result", "人数 Count", "占比 %"], rows: sum, numberFormat: { 6: "0.0%" } },
          ...(cross.length ? [{ name: "交叉 Cross-tab", headers: [`按 By: ${b.crossLabel}`], rows: cross }] : []),
          { name: "开放题 Open answers", headers: ["题号 Q", "题目 Question", "回答 Answer"], rows: texts, widths: [8, 30, 80] },
          { name: "原始数据 Data", headers: meta.headers, rows: (meta.data[0] ?? []).map((_, i) => meta.data.map((col) => col[i])) },
        ];
        return [await write("results.xlsx", await writeXlsx(sheets))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.no)} [${s(r.type)}${r.include === false ? ", excluded" : ""}] ${s(r.label)} — ${s(r.result)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
