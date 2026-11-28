import type { PDFPage } from "pdf-lib";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { hexRgb, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { KitError } from "./kit/workspace.ts";
import { DocBuilder } from "./docx.ts";
import { fmtClock, MATERIAL_WORDS, OBSERVABLE, parseLesson, SECTION_ZH, VAGUE } from "./lesson.ts";
import { s, yes } from "./util.ts";

export const NAME = "lesson-plan-builder";
export const VERSION = "0.1.0";
const base = (f: string) => f.split("/").pop()!.replace(/\.(md|txt)$/i, "");
const KINDS = ["目标", "重难点", "准备", "环节", "板书", "作业", "反思"];
const KIND_KEY: Record<string, string> = { 目标: "objectives", 重难点: "keypoints", 准备: "materials", 板书: "board", 作业: "homework", 反思: "reflection" };
const INFO_ZH: [string, string][] = [["subject", "学科"], ["grade", "年级"], ["textbook", "教材"], ["type", "课型"], ["teacher", "授课人"], ["date", "日期"], ["duration", "课时"]];
interface LessonMeta { file: string; title: string; info: Record<string, string>; minutes: number }
interface Meta { lessons: LessonMeta[] }

interface Plan { m: LessonMeta; title: string; info: Record<string, string>; minutes: number; items: Record<string, { row: Row; i: number }[]>; steps: { row: Row; i: number; start: number; end: number }[]; total: number }

function plans(p: Project): Plan[] {
  const meta = p.meta as unknown as Meta, out: Plan[] = [];
  for (const m of meta.lessons) {
    const rows = p.rows.map((row, i) => ({ row, i })).filter((x) => s(x.row.lesson) === m.title && yes(x.row.include));
    const items: Plan["items"] = {};
    for (const x of rows) if (s(x.row.kind) !== "环节") (items[KIND_KEY[s(x.row.kind)] ?? "objectives"] ??= []).push(x);
    let t = 0;
    const steps = rows.filter((x) => s(x.row.kind) === "环节").map((x) => { const mm = Number(x.row.minutes) || 0, st = t; t += mm; return { ...x, start: st, end: t }; });
    const info = { ...m.info };
    if (s(p.settings.teacher)) info.teacher = s(p.settings.teacher);
    if (s(p.settings.date)) info.date = s(p.settings.date);
    const minutes = Number(p.settings.minutes) || m.minutes || 40;
    info.duration = `${minutes} 分钟`;
    out.push({ m, title: m.title, info, minutes, items, steps, total: t });
  }
  return out;
}

const clock = (p: Project, a: number, b: number) => `${fmtClock(s(p.settings.start), a)}–${fmtClock(s(p.settings.start), b)}`;

function toMarkdown(p: Project): string {
  const out: string[] = [];
  plans(p).forEach((L, k) => {
    if (k) out.push("<!-- pagebreak -->", "");
    out.push(`# ${L.title}`, "");
    out.push(`| ${INFO_ZH.slice(0, 4).map(([, z]) => z).join(" | ")} |`, `|${INFO_ZH.slice(0, 4).map(() => "---").join("|")}|`, `| ${INFO_ZH.slice(0, 4).map(([e]) => L.info[e] ?? "").join(" | ")} |`, "");
    out.push(`| ${INFO_ZH.slice(4).map(([, z]) => z).join(" | ")} |`, `|${INFO_ZH.slice(4).map(() => "---").join("|")}|`, `| ${INFO_ZH.slice(4).map(([e]) => L.info[e] ?? "").join(" | ")} |`, "");
    for (const key of ["objectives", "keypoints", "materials"]) {
      if (!L.items[key]?.length) continue;
      out.push(`## ${SECTION_ZH[key]}`, "");
      L.items[key].forEach((x, j) => out.push(key === "objectives" ? `${j + 1}. ${s(x.row.content)}` : `- ${s(x.row.content)}`));
      out.push("");
    }
    out.push(`## 教学过程（共 ${L.total} 分钟）`, "", "| 环节 | 时间 | 教师活动 | 学生活动 | 设计意图 |", "|---|---|---|---|---|");
    for (const x of L.steps) out.push(`| ${s(x.row.content)} | ${s(x.row.minutes)} 分钟（${clock(p, x.start, x.end)}） | ${s(x.row.teacher).replace(/\n/g, "；").replace(/\|/g, "／")} | ${s(x.row.students).replace(/\n/g, "；").replace(/\|/g, "／") || "—"} | ${s(x.row.intent).replace(/\n/g, "；").replace(/\|/g, "／")} |`);
    out.push("");
    for (const key of ["board", "homework", "reflection"]) {
      if (!L.items[key]?.length) continue;
      out.push(`## ${SECTION_ZH[key]}`, "");
      L.items[key].forEach((x) => out.push(key === "board" ? s(x.row.content) : `- ${s(x.row.content)}`));
      out.push("");
    }
    if (yes(p.settings.reflection) && !L.items.reflection?.length) out.push("## 教学反思", "", "&nbsp;", "", "&nbsp;", "");
  });
  return out.join("\n");
}

function drawPlans(k: PdfKit, p: Project) {
  const [W, H] = PAGE.A4, X = 50, CW = W - 100;
  for (const L of plans(p)) {
    let pg: PDFPage = k.doc.addPage([W, H]), y = H - 60;
    const ensure = (h: number) => { if (y - h < 50) { pg = k.doc.addPage([W, H]); y = H - 60; } };
    k.text(pg, L.title, W / 2, y, { size: 18, bold: true, align: "center" }); y -= 26;
    const info = INFO_ZH.filter(([e]) => L.info[e]).map(([e, z]) => `${z}：${L.info[e]}`);
    for (let i = 0; i < info.length; i += 3) { k.text(pg, info.slice(i, i + 3).join("      "), W / 2, y, { size: 9.5, align: "center", color: "#374151" }); y -= 14; }
    y -= 8;
    const section = (key: string, numbered: boolean) => {
      if (!L.items[key]?.length) return;
      ensure(40); k.text(pg, SECTION_ZH[key], X, y, { size: 12, bold: true, color: "#1D4ED8" }); y -= 17;
      L.items[key].forEach((x, j) => { for (const [li, line] of k.wrap(`${numbered ? `${j + 1}. ` : "• "}${s(x.row.content)}`, 10, CW - 10).entries()) { ensure(14); k.text(pg, line, X + (li ? 14 : 4), y, { size: 10 }); y -= 14; } });
      y -= 6;
    };
    section("objectives", true); section("keypoints", false); section("materials", false);
    ensure(60); k.text(pg, `教学过程（共 ${L.total} 分钟）`, X, y, { size: 12, bold: true, color: "#1D4ED8" }); y -= 10;
    const cols = [{ h: "环节 / 时间", w: 90 }, { h: "教师活动", w: (CW - 90) * 0.36 }, { h: "学生活动", w: (CW - 90) * 0.36 }, { h: "设计意图", w: (CW - 90) * 0.28 }];
    const row = (cells: string[], head: boolean) => {
      const wrapped = cells.map((c, j) => k.wrap(c, 9, cols[j].w - 8, head));
      const h = Math.max(...wrapped.map((w) => w.length)) * 12 + 8;
      ensure(h); let x = X;
      cols.forEach((c, j) => { pg.drawRectangle({ x, y: y - h, width: c.w, height: h, borderColor: hexRgb("#D1D5DB"), borderWidth: 0.6, color: head ? hexRgb("#EEF2FF") : undefined }); wrapped[j].forEach((line, li) => k.text(pg, line, x + 4, y - 12 - li * 12, { size: 9, bold: head || (j === 0 && li === 0) })); x += c.w; });
      y -= h;
    };
    row(cols.map((c) => c.h), true);
    for (const x of L.steps) row([`${s(x.row.content)}\n${s(x.row.minutes)} 分钟\n${clock(p, x.start, x.end)}`, s(x.row.teacher), s(x.row.students) || "—", s(x.row.intent)], false);
    y -= 16;
    section("board", false); section("homework", false); section("reflection", false);
    if (yes(p.settings.reflection) && !L.items.reflection?.length) { ensure(90); k.text(pg, "教学反思", X, y, { size: 12, bold: true, color: "#1D4ED8" }); for (let i = 0; i < 4; i++) { y -= 20; pg.drawLine({ start: { x: X, y }, end: { x: W - X, y }, thickness: 0.5, color: hexRgb("#D1D5DB") }); } }
  }
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "lesson",
    title: ["教案制作", "Lesson Plan Builder"],
    openDescription:
      "Turn lesson-plan Markdown files into standard 教案 documents (Word, PDF, Markdown) and check them. Pick one .md per lesson or a folder of them. Each file: “# 课题”, info lines (学科/年级/教材/课时 40 分钟/课型/授课人/日期), then sections 教学目标, 教学重难点, 教学准备, 教学过程, 板书设计, 作业布置, 教学反思. 教学过程 can be “### 一、导入（5 分钟）” headings with “教师：/学生：/设计意图：/材料：” lines, a table (环节|时间|教师活动|学生活动|设计意图), or lines “- 导入（5 分钟）：…”. Rows: include, lesson, kind (目标/重难点/准备/环节/板书/作业/反思), content (the item text, or the step name for 环节), minutes, teacher, students, intent — add rows to add objectives, steps or homework. Settings: teacher, date, minutes (lesson length override), start (clock time like 08:00 to print start–end per step), reflection (add blank reflection lines). Checks: step times not adding up to the lesson length, missing objectives/homework/key points, objectives with vague verbs (了解/理解/掌握…) and no observable behaviour, long teacher-only stretches with no student activity, materials used in steps but missing from 教学准备, steps with no time. Exports lesson-plans.docx, lesson-plans.pdf and lesson-plans.md (all lessons, one per page).",
    inputs: { exts: [".md", ".txt"], min: 1, max: 60, folders: true, label: ["选择教案文件或文件夹", "Pick lesson plan files"] },
    settings: [
      { key: "teacher", label: ["授课人（留空=按文件）", "Teacher (blank = from file)"], type: "text", default: "" },
      { key: "date", label: ["日期", "Date"], type: "text", default: "" },
      { key: "minutes", label: ["每课时分钟（0=按文件，默认 40）", "Lesson length, minutes"], type: "number", default: 0, min: 0, max: 240 },
      { key: "start", label: ["上课时间（如 08:00，留空=只写分钟）", "Start time (e.g. 08:00)"], type: "text", default: "" },
      { key: "reflection", label: ["留出教学反思空行", "Blank reflection lines"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "include", label: ["纳入", "Include"], type: "bool" },
      { key: "lesson", label: ["课题", "Lesson"] },
      { key: "kind", label: ["类型", "Kind"], type: "select", options: KINDS },
      { key: "content", label: ["内容 / 环节名", "Content / step"], wide: true },
      { key: "minutes", label: ["分钟", "Min"], type: "number" },
      { key: "_clock", label: ["时间段", "Time"], readOnly: true },
      { key: "teacher", label: ["教师活动", "Teacher"], wide: true },
      { key: "students", label: ["学生活动", "Students"], wide: true },
      { key: "intent", label: ["设计意图", "Intent"] },
    ] as Column[],
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) {
        if (/\.(md|txt)$/i.test(f)) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [".md", ".txt"], limit: 500 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/")).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
      const lessons: LessonMeta[] = [], rows: Row[] = [];
      for (const f of all) {
        const L = parseLesson(await ws.readText(f), base(f));
        if (!L.steps.length && !L.sections.objectives) continue;
        let title = L.title; for (let n = 2; lessons.some((x) => x.title === title); n++) title = `${L.title}（${n}）`;
        lessons.push({ file: f, title, info: L.info, minutes: L.minutes });
        for (const [key, kind] of Object.entries(KIND_KEY).map(([z, e]) => [e, z])) if (key !== "process") for (const t of L.sections[key] ?? []) if (t) rows.push({ include: true, lesson: title, kind, content: t, minutes: "", teacher: "", students: "", intent: "" });
        for (const st of L.steps) rows.push({ include: true, lesson: title, kind: "环节", content: st.phase, minutes: isNaN(st.minutes) ? "" : st.minutes, teacher: st.teacher + (st.materials ? `${st.teacher ? "\n" : ""}（材料：${st.materials}）` : ""), students: st.students, intent: st.intent });
      }
      if (!lessons.length) throw new KitError("no_lessons", "No lesson plans found. Each .md needs a 教学目标 or 教学过程 section (see the tool description).");
      const order = (r: Row) => ["目标", "重难点", "准备", "环节", "板书", "作业", "反思"].indexOf(s(r.kind));
      rows.sort((a, b) => lessons.findIndex((l) => l.title === a.lesson) - lessons.findIndex((l) => l.title === b.lesson) || order(a) - order(b));
      return { rows, meta: { lessons } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const issues: Issue[] = [], all = plans(p);
      const clockOf = new Map<number, string>();
      for (const L of all) {
        for (const x of L.steps) clockOf.set(x.i, clock(p, x.start, x.end));
        const tag = `《${L.title}》`;
        if (!L.items.objectives?.length) issues.push({ level: "error", message: `${tag} has no 教学目标. Add rows of kind 目标.` });
        if (!L.steps.length) issues.push({ level: "error", message: `${tag} has no 教学过程 steps.` });
        if (L.steps.length && L.total !== L.minutes) issues.push({ level: L.total > L.minutes ? "error" : "warn", row: L.steps[L.steps.length - 1].i, key: "minutes", message: `${tag}: steps add up to ${L.total} min but the lesson is ${L.minutes} min (${L.total > L.minutes ? `${L.total - L.minutes} over` : `${L.minutes - L.total} spare`}). Adjust the minutes.` });
        for (const x of L.steps) {
          if (!(Number(x.row.minutes) > 0)) issues.push({ level: "warn", row: x.i, key: "minutes", message: `${tag} ${s(x.row.content)}: no time set.` });
          if (!s(x.row.students) && Number(x.row.minutes) >= 10) issues.push({ level: "warn", row: x.i, key: "students", message: `${tag} ${s(x.row.content)}: ${s(x.row.minutes)} min with no student activity — add what students do (discuss, try, answer…).` });
        }
        if (!L.items.homework?.length) issues.push({ level: "warn", message: `${tag} has no 作业布置. Add a row of kind 作业 (or “无” if none is planned).` });
        if (!L.items.keypoints?.length) issues.push({ level: "info", message: `${tag} has no 教学重难点.` });
        for (const x of L.items.objectives ?? []) if (VAGUE.test(s(x.row.content)) && !OBSERVABLE.test(s(x.row.content))) issues.push({ level: "info", row: x.i, key: "content", message: `${tag} objective “${s(x.row.content).slice(0, 24)}” uses a vague verb (${VAGUE.exec(s(x.row.content))![1]}) — say what students will be able to do (能说出 / 能比较 / 会写…) so it can be checked.` });
        const prep = (L.items.materials ?? []).map((x) => s(x.row.content)).join(" ").toLowerCase();
        const missing = new Set<string>();
        for (const x of L.steps) for (const w of `${s(x.row.teacher)} ${s(x.row.students)}`.match(MATERIAL_WORDS) ?? []) {
          const lw = w.toLowerCase(), alt = lw === "课件" ? "ppt" : lw === "ppt" ? "课件" : lw;
          if (!prep.includes(lw) && !prep.includes(alt)) missing.add(w);
        }
        if (missing.size) issues.push({ level: "warn", message: `${tag}: ${[...missing].map((w) => `“${w}”`).join("、")} used in the steps but not listed in 教学准备. Add a 准备 row.` });
      }
      const titles = new Set(all.map((L) => L.title));
      p.rows.forEach((r, i) => { if (yes(r.include) && !titles.has(s(r.lesson))) issues.push({ level: "warn", row: i, key: "lesson", message: `Row ${i}: lesson “${s(r.lesson)}” doesn't match any lesson (${[...titles].join(" / ")}), so it isn't in the documents.` }); });
      const rows = p.rows.map((r, i) => ({ ...r, _clock: clockOf.get(i) ?? "" }));
      return {
        rows,
        issues,
        summary: `${all.length} lesson plan(s): ${all.map((L) => `《${L.title}》 ${L.steps.length} steps, ${L.total}/${L.minutes} min, ${L.items.objectives?.length ?? 0} objective(s)${L.items.homework?.length ? "" : ", no homework"}`).join("; ")}.`,
        stats: { lessons: all.length, steps: all.reduce((a, L) => a + L.steps.length, 0) },
      };
    },
    exports: [
      { id: "docx", label: ["Word 教案", "Word"], description: "lesson-plans.docx", async run(ctx: ExportCtx) {
        const b = new DocBuilder({ latin: "Calibri", cjk: "SimSun", size: 10.5, page: "A4", margin: 20, toc: false, title: plans(ctx.project)[0]?.title ?? "教案", author: s(ctx.project.settings.teacher), breakH1: true }, () => undefined);
        b.add(toMarkdown(ctx.project).replace(/<!-- pagebreak -->\n/g, "").replace(/&nbsp;/g, "\u00a0"), false);
        return [await ctx.write("lesson-plans.docx", b.build())];
      } },
      { id: "pdf", label: ["PDF 教案", "PDF"], description: "lesson-plans.pdf", async run(ctx: ExportCtx) {
        const k = await newPdf(); drawPlans(k, ctx.project);
        return [await ctx.write("lesson-plans.pdf", await k.doc.save())];
      } },
      { id: "md", label: ["Markdown", "Markdown"], description: "lesson-plans.md", async run(ctx: ExportCtx) {
        return [await ctx.write("lesson-plans.md", toMarkdown(ctx.project).replace(/<!-- pagebreak -->\n/g, "---\n").replace(/&nbsp;/g, "") + "\n")];
      } },
    ],
    newRow: (p) => ({ include: true, lesson: (p.meta as unknown as Meta).lessons.at(-1)?.title ?? "", kind: "环节", content: "", minutes: "", teacher: "", students: "", intent: "" }),
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}《${s(r.lesson)}》 ${s(r.kind)}: ${s(r.content).slice(0, 40)}${s(r.kind) === "环节" ? ` ${s(r.minutes)} min${s(r._clock) ? ` (${s(r._clock)})` : ""}${s(r.students) ? "" : " [no student activity]"}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
