import type { PDFPage } from "pdf-lib";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { autoFull, bandOf, histogram, parseBands, parseKeyNums, parseScore, rank, stats, type Stat } from "./grades.ts";

export const NAME = "grade-book";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const r1 = (x: number) => Math.round(x * 10) / 10;
type Meta = { subjects: string[]; autoFull: number[]; file: string; ignored: string[] };
const NOT_SUBJECT = /^(学号|编号|序号|考号|准考证号|id|no|number|student id|姓名|名字|学生|name|student|班级|班|class|性别|gender|sex|总分|总成绩|total|平均|平均分|average|avg|排名|名次|rank|班级排名|年级排名|等级|grade|备注|评语|comment|note|remark)$/i;

interface Analysis {
  subjects: string[]; full: number[]; weight: number[]; bands: ReturnType<typeof parseBands>; passPct: number; excPct: number;
  students: { row: Row; scores: (number | undefined)[]; total: number; avg?: number; band: string; rank?: number; classRank?: number }[];
  bySubject: { all: Stat; classes: Map<string, Stat> }[]; classes: string[]; issues: Issue[];
}

function analyse(p: Pick<Project, "rows" | "settings" | "meta">): Analysis {
  const meta = p.meta as Meta, subjects = meta.subjects, issues: Issue[] = [];
  const fm = parseKeyNums(s(p.settings.fullMarks)), wm = parseKeyNums(s(p.settings.weights));
  for (const e of [...fm.errors, ...wm.errors]) issues.push({ level: "error", message: `Can't read “${e}” — write 科目=数字, e.g. 数学=150 / 格式：科目=数字` });
  for (const k of [...fm.map.keys(), ...wm.map.keys()]) if (!subjects.includes(k)) issues.push({ level: "warn", message: `Subject “${k}” in the settings is not a column (subjects: ${subjects.join(", ")}) / 设置里的科目不存在` });
  const full = subjects.map((sub, j) => fm.map.get(sub) ?? fm.all ?? meta.autoFull[j]);
  const weight = subjects.map((sub) => wm.map.get(sub) ?? wm.all ?? 1);
  const bands = parseBands(s(p.settings.bands) || "优秀 85; 良好 75; 及格 60; 不及格 0");
  const passPct = Number(p.settings.passPct ?? 60), excPct = bands[0]?.min ?? 85;
  const seen = new Map<string, number>();
  const students = p.rows.map((row, i) => {
    const id = s(row.id) || s(row.name);
    if (id && seen.has(id)) issues.push({ level: "warn", row: i, key: s(row.id) ? "id" : "name", message: `${id} appears twice (rows ${seen.get(id)} and ${i}) / 学生重复` });
    else if (id) seen.set(id, i);
    const scores = subjects.map((sub, j) => {
      const sc = parseScore(row[`s${j}`]);
      if (sc.kind === "bad") { issues.push({ level: "error", row: i, key: `s${j}`, message: `${s(row.name)} ${sub}: “${sc.raw}” is not a score (use a number, or 缺考 / absent) / 成绩无效` }); return undefined; }
      if (sc.kind === "absent") { issues.push({ level: "info", row: i, key: `s${j}`, message: `${s(row.name)} ${sub}: absent — left out of averages / 缺考，不计入平均` }); return undefined; }
      if (sc.value < 0 || sc.value > full[j]) issues.push({ level: "error", row: i, key: `s${j}`, message: `${s(row.name)} ${sub}: ${sc.value} is outside 0–${full[j]} (change 满分 / full marks if needed) / 超出满分` });
      return sc.value;
    });
    const total = scores.reduce<number>((a, v) => a + (v ?? 0), 0);
    let wsum = 0, psum = 0;
    scores.forEach((v, j) => { if (v !== undefined && weight[j] > 0) { wsum += weight[j]; psum += weight[j] * (v / full[j]) * 100; } });
    const avg = wsum ? r1(psum / wsum) : undefined;
    return { row, scores, total: Math.round(total * 100) / 100, avg, band: avg === undefined ? "" : bandOf(avg, bands), rank: undefined as number | undefined, classRank: undefined as number | undefined };
  });
  const by = s(p.settings.rankBy) === "avg" ? (x: (typeof students)[number]) => x.avg : (x: (typeof students)[number]) => (x.scores.some((v) => v !== undefined) ? x.total : undefined);
  rank(students.map(by)).forEach((r, i) => (students[i].rank = r));
  const classes = [...new Set(students.map((x) => s(x.row.class)))].filter(Boolean);
  for (const c of classes) {
    const idx = students.map((x, i) => (s(x.row.class) === c ? i : -1)).filter((i) => i >= 0);
    rank(idx.map((i) => by(students[i]))).forEach((r, k) => (students[idx[k]].classRank = r));
  }
  if (s(p.settings.rankBy) !== "avg" && students.some((x) => x.scores.some((v) => v === undefined) && x.scores.some((v) => v !== undefined))) issues.push({ level: "info", message: "Some students missed a subject; their total is lower. Rank by weighted average to compare fairly / 有学生缺考，按总分排名会偏低，可改为按平均排名" });
  const bySubject = subjects.map((_, j) => {
    const vals = (list: typeof students) => list.map((x) => x.scores[j]).filter((v): v is number => v !== undefined);
    const absent = (list: typeof students) => list.filter((x) => x.scores[j] === undefined).length;
    return { all: stats(vals(students), full[j], passPct, excPct, absent(students)), classes: new Map(classes.map((c) => { const l = students.filter((x) => s(x.row.class) === c); return [c, stats(vals(l), full[j], passPct, excPct, absent(l))] as const; })) };
  });
  return { subjects, full, weight, bands, passPct, excPct, students, bySubject, classes, issues };
}

function histSvg(values: number[], full: number, title: string): string {
  const h = histogram(values, full), max = Math.max(1, ...h.map((x) => x.count)), W = 240, H = 110, bw = W / h.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 34}" font-family="sans-serif"><text x="0" y="12" font-size="11" font-weight="bold">${esc(title)}</text>${h.map((b, i) => { const bh = (b.count / max) * (H - 30); return `<rect x="${i * bw + 4}" y="${H - bh}" width="${bw - 8}" height="${bh}" fill="${i === 0 ? "#ef4444" : i === h.length - 1 ? "#10b981" : "#3b82f6"}" rx="2"/><text x="${i * bw + bw / 2}" y="${H - bh - 3}" font-size="10" text-anchor="middle">${b.count}</text><text x="${i * bw + bw / 2}" y="${H + 13}" font-size="9" text-anchor="middle" fill="#6b7280">${esc(b.label)}</text>`; }).join("")}</svg>`;
}

function drawCard(k: PdfKit, a: Analysis, i: number, title: string, school: string) {
  const [W, H] = PAGE.A5, m = 36, st = a.students[i], r = st.row;
  const page: PDFPage = k.doc.addPage(PAGE.A5);
  let y = H - m;
  if (school) k.text(page, school, m, y - 10, { size: 9.5, color: "#6b7280", maxWidth: W - 2 * m });
  k.text(page, title || "成绩单 Report card", m, y - 30, { size: 16, bold: true, maxWidth: W - 2 * m });
  y -= 52;
  k.text(page, `${s(r.name)}`, m, y, { size: 13, bold: true });
  k.text(page, [s(r.class), s(r.id) ? `学号 ${s(r.id)}` : ""].filter(Boolean).join(" · "), W - m, y, { size: 9.5, align: "right", color: "#374151" });
  y -= 20;
  const cols = [m, m + 110, m + 170, m + 230, m + 300];
  page.drawRectangle({ x: m - 4, y: y - 5, width: W - 2 * m + 8, height: 18, color: hexRgb("#f3f4f6") });
  ["科目 Subject", "成绩 Score", "满分 Full", "班均 Class avg", "等级 Band"].forEach((h, j) => k.text(page, h, cols[j], y, { size: 8.5, bold: true, color: "#374151" }));
  y -= 20;
  a.subjects.forEach((sub, j) => {
    const v = st.scores[j], cls = a.bySubject[j].classes.get(s(r.class)) ?? a.bySubject[j].all;
    const pct = v === undefined ? undefined : (v / a.full[j]) * 100;
    const fail = pct !== undefined && pct < a.passPct;
    k.text(page, sub, cols[0], y, { size: 10 });
    k.text(page, v === undefined ? "缺考" : String(v), cols[1], y, { size: 10, bold: true, color: fail ? "#b91c1c" : "#111827" });
    k.text(page, String(a.full[j]), cols[2], y, { size: 9.5, color: "#6b7280" });
    k.text(page, String(cls.mean), cols[3], y, { size: 9.5, color: "#6b7280" });
    k.text(page, pct === undefined ? "—" : bandOf(pct, a.bands), cols[4], y, { size: 9.5 });
    page.drawLine({ start: { x: m - 4, y: y - 6 }, end: { x: W - m + 4, y: y - 6 }, thickness: 0.4, color: hexRgb("#e5e7eb") });
    y -= 19;
  });
  y -= 8;
  const boxes: [string, string][] = [["总分 Total", String(st.total)], ["平均 Avg %", st.avg === undefined ? "—" : `${st.avg}%`], ["等级 Band", st.band || "—"], ["班级排名 Class", st.classRank ? `${st.classRank} / ${a.students.filter((x) => s(x.row.class) === s(r.class) && x.classRank).length}` : "—"], ["总排名 Overall", st.rank ? `${st.rank} / ${a.students.filter((x) => x.rank).length}` : "—"]];
  const bw = (W - 2 * m) / boxes.length;
  boxes.forEach(([l, v], j) => {
    page.drawRectangle({ x: m + j * bw + 2, y: y - 34, width: bw - 4, height: 38, color: hexRgb(j === 0 ? "#1d4ed8" : "#eff6ff") });
    k.text(page, l, m + j * bw + 8, y - 8, { size: 7.5, color: j === 0 ? "#ffffff" : "#6b7280" });
    k.text(page, v, m + j * bw + 8, y - 26, { size: 11.5, bold: true, color: j === 0 ? "#ffffff" : "#111827", maxWidth: bw - 12 });
  });
  y -= 56;
  // 成绩与班均对比条形图
  const lw = 60, bwid = W - 2 * m - lw - 30;
  k.text(page, "成绩 vs 班均（满分百分比） Score vs class average", m, y, { size: 8.5, color: "#6b7280" });
  y -= 14;
  a.subjects.forEach((sub, j) => {
    const v = st.scores[j], cls = a.bySubject[j].classes.get(s(r.class)) ?? a.bySubject[j].all;
    k.text(page, sub, m + lw - 6, y - 7, { size: 8, align: "right", maxWidth: lw - 8 });
    const pv = v === undefined ? 0 : v / a.full[j], pc = cls.mean / a.full[j];
    page.drawRectangle({ x: m + lw, y: y - 9, width: Math.max(0.5, pv * bwid), height: 7, color: hexRgb(v !== undefined && pv * 100 < a.passPct ? "#ef4444" : "#2563eb") });
    page.drawRectangle({ x: m + lw, y: y - 13, width: Math.max(0.5, pc * bwid), height: 3, color: hexRgb("#9ca3af") });
    k.text(page, v === undefined ? "缺考" : `${Math.round(pv * 100)}%`, m + lw + Math.max(pv, pc) * bwid + 4, y - 9, { size: 7.5, color: "#374151" });
    y -= 16;
  });
  if (s(r.comment)) {
    y -= 8;
    k.text(page, "评语 Comment", m, y, { size: 9, bold: true });
    y -= 14;
    for (const line of k.wrap(s(r.comment), 9.5, W - 2 * m).slice(0, 6)) { k.text(page, line, m, y, { size: 9.5, color: "#374151" }); y -= 13; }
  }
  k.text(page, "家长签字 Parent signature: ____________________", m, m - 6, { size: 8.5, color: "#6b7280" });
}

function drawSummary(k: PdfKit, a: Analysis, title: string) {
  const [W, H] = PAGE.A4, m = 40;
  let page = k.doc.addPage(PAGE.A4), y = H - m;
  const need = (h: number) => { if (y - h < m) { page = k.doc.addPage(PAGE.A4); y = H - m; } };
  k.text(page, `${title || "成绩分析"} — 统计 Summary`, m, y - 16, { size: 16, bold: true, maxWidth: W - 2 * m });
  y -= 30;
  k.text(page, `${a.students.length} 名学生 students · ${a.classes.length || 1} 个班 classes · 及格线 pass ${a.passPct}% · 优秀 excellent ${a.excPct}%`, m, y, { size: 9, color: "#6b7280" });
  y -= 24;
  const groups = ["全部 All", ...a.classes];
  a.subjects.forEach((sub, j) => {
    need(150 + groups.length * 13);
    k.text(page, `${sub}（满分 ${a.full[j]}${a.weight[j] !== 1 ? `，权重 ${a.weight[j]}` : ""}）`, m, y, { size: 11.5, bold: true });
    y -= 10;
    const h = histogram(a.students.map((x) => x.scores[j]).filter((v): v is number => v !== undefined), a.full[j]);
    const max = Math.max(1, ...h.map((b) => b.count)), cw = 70, ch = 70;
    h.forEach((b, i) => {
      const bh = (b.count / max) * ch;
      page.drawRectangle({ x: m + i * cw + 6, y: y - 16 - ch, width: cw - 12, height: Math.max(0.5, bh), color: hexRgb(i === 0 ? "#ef4444" : i === h.length - 1 ? "#10b981" : "#3b82f6") });
      k.text(page, String(b.count), m + i * cw + cw / 2, y - 12 - ch + bh, { size: 8.5, align: "center" });
      k.text(page, b.label, m + i * cw + cw / 2, y - 28 - ch, { size: 8, align: "center", color: "#6b7280" });
    });
    y -= ch + 46;
    const cols = ["", "人数 n", "平均 Mean", "最高 Max", "最低 Min", "中位 Median", "及格率 Pass", "优秀率 Exc.", "缺考 Absent"];
    const cx = [m, m + 110, m + 160, m + 215, m + 265, m + 315, m + 375, m + 435, m + 490];
    cols.forEach((c, i) => k.text(page, c, cx[i], y, { size: 7.5, bold: true, color: "#374151" }));
    y -= 13;
    for (const g of groups) {
      const st = g === "全部 All" ? a.bySubject[j].all : a.bySubject[j].classes.get(g)!;
      [g, st.n, st.mean, st.max, st.min, st.median, `${st.pass}%`, `${st.excellent}%`, st.absent].forEach((v, i) => k.text(page, String(v), cx[i], y, { size: 8.5, bold: i === 0, maxWidth: i === 0 ? 104 : 54 }));
      y -= 13;
    }
    y -= 14;
  });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "grades",
  title: ["成绩统计分析", "Grade Book"],
  openDescription:
    "Analyse a score sheet (.xlsx/.csv: one row per student, with 学号/ID, 姓名/name, 班级/class and one numeric column per subject or assessment). Computes totals, weighted average % (settings.weights “数学=1.5; 英语=1”), score bands by % of full marks (settings.bands “优秀 85; 良好 75; 及格 60; 不及格 0”), overall and class rankings (rankBy total|avg), and per-subject stats per class (mean, max, min, pass and excellent rates). Full marks are guessed per subject (100, 120, 150…) or set with settings.fullMarks (“语文=150; 数学=150” or “100”). Write 缺考/absent for missing scores. Edit scores or add a comment per student, then export grades.xlsx, report-cards.pdf (one A5 page per student) and summary.pdf.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择成绩表", "Pick a score sheet"] },
  settings: [
    { key: "title", label: ["考试名称", "Exam / term"], type: "text", default: "期中考试成绩单" },
    { key: "school", label: ["学校 / 机构", "School"], type: "text", default: "" },
    { key: "fullMarks", label: ["满分", "Full marks"], type: "text", default: "", help: ["留空自动判断；或“语文=150; 数学=150; 物理=100”；或一个数字", "Blank = guessed; or “Maths=150; Physics=100”, or one number"] },
    { key: "weights", label: ["权重", "Weights"], type: "text", default: "", help: ["留空等权；如“数学=1.5; 英语=1”", "Blank = equal; e.g. “Maths=1.5; English=1”"] },
    { key: "bands", label: ["等级（满分百分比）", "Bands (% of full)"], type: "text", default: "优秀 85; 良好 75; 及格 60; 不及格 0" },
    { key: "passPct", label: ["及格线 %", "Pass mark %"], type: "number", default: 60, min: 0, max: 100 },
    { key: "rankBy", label: ["排名依据", "Rank by"], type: "select", default: "total", options: [{ value: "total", label: ["总分", "Total"] }, { value: "avg", label: ["加权平均", "Weighted average"] }] },
  ],
  columns: (p) => {
    const subs = (p.meta as Meta | undefined)?.subjects ?? [];
    return [
      { key: "id", label: ["学号", "ID"] },
      { key: "name", label: ["姓名", "Name"] },
      { key: "class", label: ["班级", "Class"] },
      ...subs.map((sub, j) => ({ key: `s${j}`, label: [sub, sub] as [string, string] })),
      { key: "total", label: ["总分", "Total"], type: "number", readOnly: true },
      { key: "avg", label: ["平均%", "Avg %"], type: "number", readOnly: true },
      { key: "band", label: ["等级", "Band"], readOnly: true },
      { key: "rank", label: ["排名", "Rank"], type: "number", readOnly: true },
      { key: "classRank", label: ["班排", "Class rank"], type: "number", readOnly: true },
      { key: "comment", label: ["评语", "Comment"], wide: true },
    ] as Column[];
  },
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty", "The sheet has no students.");
    const m = mapHeaders(t.columns, { id: ["学号", "考号", "编号", "准考证号", "student id", "id", "no"], name: ["姓名", "名字", "学生", "学生姓名", "name", "student", "student name"], class: ["班级", "班", "class", "group", "section"], comment: ["评语", "备注", "comment", "remark", "note"] });
    if (!m.name && !m.id) throw new KitError("columns_not_found", `No name or ID column found (姓名 / 学号 / name). Columns: ${t.columns.join(", ")}`);
    const used = new Set(Object.values(m).filter(Boolean) as string[]);
    const subjects: string[] = [], ignored: string[] = [];
    for (const c of t.columns) {
      if (used.has(c)) continue;
      if (NOT_SUBJECT.test(c.trim().replace(/\s+/g, " "))) { ignored.push(c); continue; }
      const vals = t.rows.map((r) => parseScore(r[c]));
      const ok = vals.filter((v) => v.kind === "ok").length, bad = vals.filter((v) => v.kind === "bad").length;
      if (ok && ok >= bad * 4) subjects.push(c); else ignored.push(c);
    }
    if (!subjects.length) throw new KitError("no_subjects", `No score columns found. Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.map((r) => {
      const row: Row = { id: m.id ? s(r[m.id]) : "", name: m.name ? s(r[m.name]) : "", class: m.class ? s(r[m.class]) : "", comment: m.comment ? s(r[m.comment]) : "" };
      subjects.forEach((c, j) => { const sc = parseScore(r[c]); row[`s${j}`] = sc.kind === "ok" ? sc.value : s(r[c]); });
      return row;
    });
    const auto = subjects.map((c) => autoFull(t.rows.map((r) => parseScore(r[c])).filter((x) => x.kind === "ok").map((x) => (x as { value: number }).value)));
    const meta: Meta = { subjects, autoFull: auto, file: files[0], ignored };
    return { rows, meta };
  },
  compute(p): Computed {
    const a = analyse(p), meta = p.meta as Meta;
    if (meta.ignored.length) a.issues.push({ level: "info", message: `Not used as subjects: ${meta.ignored.join(", ")} (totals, ranks and averages are recalculated) / 未作为科目的列` });
    const rows = a.students.map((x) => ({ ...x.row, total: x.total, avg: x.avg ?? "", band: x.band, rank: x.rank ?? "", classRank: x.classRank ?? "" }));
    const avgs = a.students.map((x) => x.avg).filter((v): v is number => v !== undefined);
    const mean = avgs.length ? r1(avgs.reduce((q, b) => q + b, 0) / avgs.length) : 0;
    const top = [...a.students].filter((x) => x.rank === 1).map((x) => s(x.row.name)).join("、");
    return {
      rows,
      issues: a.issues,
      summary: `${a.students.length} students, ${a.subjects.length} subjects (${a.subjects.map((x, j) => `${x}/${a.full[j]}`).join(", ")}); average ${mean}%; top: ${top || "—"}. ${a.students.length} 名学生，平均 ${mean}%。`,
      stats: { students: a.students.length, subjects: a.subjects.length, classes: a.classes.length, average: mean, pass: avgs.length ? r1((avgs.filter((v) => v >= a.passPct).length / avgs.length) * 100) : 0 },
      preview: `<div style="display:flex;flex-wrap:wrap;gap:10px">${a.subjects.map((sub, j) => `<div>${histSvg(a.students.map((x) => x.scores[j]).filter((v): v is number => v !== undefined), a.full[j], `${sub} · 平均 ${a.bySubject[j].all.mean} · 及格 ${a.bySubject[j].all.pass}%`)}</div>`).join("")}</div>`,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["成绩分析 Excel", "Grade book (Excel)"], description: "grades.xlsx — scores with totals, average, band and ranks (fails red, excellent green), statistics per subject and class, and score distribution",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const a = analyse(project);
        const marks: { row: number; col: number; color: string }[] = [];
        const scoreRows = a.students.map((x, i) => {
          x.scores.forEach((v, j) => { if (v === undefined) return; const pct = (v / a.full[j]) * 100; if (pct < a.passPct) marks.push({ row: i, col: 3 + j, color: "#FECACA" }); else if (pct >= a.excPct) marks.push({ row: i, col: 3 + j, color: "#BBF7D0" }); });
          return [s(x.row.id), s(x.row.name), s(x.row.class), ...x.scores.map((v, j) => (v === undefined ? s(x.row[`s${j}`]) || "缺考" : v)), x.total, x.avg ?? "", x.band, x.rank ?? "", x.classRank ?? "", s(x.row.comment)];
        });
        const groups = ["全部 All", ...a.classes];
        const statRows = a.subjects.flatMap((sub, j) => groups.map((g) => { const st = g === "全部 All" ? a.bySubject[j].all : a.bySubject[j].classes.get(g)!; return [sub, g, a.full[j], st.n, st.mean, st.max, st.min, st.median, st.sd, st.pass / 100, st.excellent / 100, st.absent]; }));
        const distRows = a.subjects.flatMap((sub, j) => histogram([], a.full[j]).map((b, bi) => [sub, b.label, ...groups.map((g) => histogram(a.students.filter((x) => g === "全部 All" || s(x.row.class) === g).map((x) => x.scores[j]).filter((v): v is number => v !== undefined), a.full[j])[bi].count)]));
        const xlsx = await writeXlsx([
          { name: "成绩 Scores", headers: ["学号 ID", "姓名 Name", "班级 Class", ...a.subjects, "总分 Total", "平均% Avg", "等级 Band", "排名 Rank", "班排 Class rank", "评语 Comment"], rows: scoreRows, marks },
          { name: "统计 Statistics", headers: ["科目 Subject", "范围 Group", "满分 Full", "人数 n", "平均 Mean", "最高 Max", "最低 Min", "中位数 Median", "标准差 SD", "及格率 Pass", "优秀率 Excellent", "缺考 Absent"], rows: statRows, numberFormat: { 9: "0.0%", 10: "0.0%" } },
          { name: "分数段 Distribution", headers: ["科目 Subject", "分数段 Range", ...groups], rows: distRows },
        ]);
        return [await write("grades.xlsx", xlsx)];
      },
    },
    {
      id: "cards", label: ["成绩单 PDF", "Report cards (PDF)"], description: "report-cards.pdf — one A5 page per student with scores, class averages, band, ranks and comment",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const a = analyse(project), k = await newPdf();
        a.students.forEach((_, i) => drawCard(k, a, i, s(project.settings.title), s(project.settings.school)));
        return { files: [await write("report-cards.pdf", await k.doc.save())], note: k.cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "summary", label: ["统计报告 PDF", "Summary (PDF)"], description: "summary.pdf — score distribution and statistics per subject and class",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project), k = await newPdf();
        drawSummary(k, a, s(project.settings.title));
        return [await write("summary.pdf", await k.doc.save())];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.id)} ${s(r.name)} ${s(r.class)} · total ${s(r.total)} · avg ${s(r.avg)}% · rank ${s(r.rank)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
