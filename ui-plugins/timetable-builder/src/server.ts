import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { DAY_ZH, parseSlots, slotName, slotShort, solve, type Grid, type Req, type Result } from "./solve.ts";
import { s, yes } from "./util.ts";

export const NAME = "timetable-builder";
export const VERSION = "0.1.0";
interface Meta { avoid: string; rooms: string }
const COLORS = ["#DBEAFE", "#FCE7F3", "#DCFCE7", "#FEF3C7", "#EDE9FE", "#FFE4E6", "#CFFAFE", "#FFEDD5", "#E0E7FF", "#F3E8FF", "#ECFCCB", "#F1F5F9"];

const grid = (p: Project): Grid => ({ days: Math.min(7, Math.max(1, Number(p.settings.days) || 5)), periods: Math.min(14, Math.max(1, Number(p.settings.periods) || 7)), lunchAfter: Math.max(0, Number(p.settings.lunchAfter) || 4) });
const avoidText = (p: Project) => s(p.settings.avoid) || (p.meta as unknown as Meta).avoid || "";
const roomText = (p: Project) => s(p.settings.rooms) || (p.meta as unknown as Meta).rooms || "";

function plan(p: Project) {
  const g = grid(p), bad: { row?: number; key?: string; text: string; where: string }[] = [];
  const reqs: Req[] = [];
  p.rows.forEach((r, i) => {
    if (!yes(r.include) || !s(r.cls) || !s(r.subject)) return;
    const f = parseSlots(s(r.fixed), g);
    for (const b of f.bad) bad.push({ row: i, key: "fixed", text: b, where: `${s(r.cls)} ${s(r.subject)} fixed` });
    reqs.push({ id: i, cls: s(r.cls), subject: s(r.subject), teacher: s(r.teacher), hours: Math.max(0, Math.round(Number(r.hours) || 0)), room: s(r.room), fixed: f.slots, double: yes(r.double) });
  });
  const avoid = new Map<string, Set<number>>();
  for (const line of avoidText(p).split(/\n|；|;/)) {
    const m = /^\s*([^:：]+?)\s*[:：]\s*(.+)$/.exec(line);
    if (!m) { if (line.trim()) bad.push({ text: line.trim(), where: "teacher limits" }); continue; }
    const r = parseSlots(m[2], g);
    for (const b of r.bad) bad.push({ text: b, where: `${m[1]} limits` });
    avoid.set(m[1].trim(), new Set([...(avoid.get(m[1].trim()) ?? []), ...r.slots]));
  }
  const rooms = new Map<string, number>();
  for (const part of roomText(p).split(/[\n,，;；]/)) { const m = /^\s*(.+?)\s*[=:：]\s*(\d+)\s*$/.exec(part); if (m) rooms.set(m[1], +m[2]); }
  const morning = new Set(s(p.settings.morning).split(/[\s,，、]+/).filter(Boolean));
  const res: Result = solve(reqs, g, { avoid, rooms, morning });
  return { g, reqs, res, bad, avoid, rooms };
}

const times = (p: Project, k: number) => s(p.settings.times).split(/[,，\n]/).map((x) => x.trim())[k] ?? "";

function tables(p: Project) {
  const { g, reqs, res } = plan(p), N = g.days * g.periods;
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const classes = [...new Set(reqs.map((r) => r.cls))], teachers = [...new Set(reqs.map((r) => r.teacher).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const cls = new Map(classes.map((c) => [c, Array<string>(N).fill("")])), tch = new Map(teachers.map((t) => [t, Array<string>(N).fill("")]));
  const subjColor = new Map<string, string>();
  for (const x of res.placed) {
    const r = byId.get(x.req)!;
    if (!subjColor.has(r.subject)) subjColor.set(r.subject, COLORS[subjColor.size % COLORS.length]);
    cls.get(r.cls)![x.slot] = `${r.subject}${r.teacher ? `\n${r.teacher}` : ""}${r.room ? `\n${r.room}` : ""}`;
    if (r.teacher) tch.get(r.teacher)![x.slot] = tch.get(r.teacher)![x.slot] ? `${tch.get(r.teacher)![x.slot]} / ${r.cls}${r.subject}` : `${r.cls}\n${r.subject}${r.room ? `\n${r.room}` : ""}`;
  }
  return { g, classes, teachers, cls, tch, subjColor };
}

function drawGrid(k: PdfKit, p: Project, title: string, cells: string[], g: Grid, colorOf: (t: string) => string | undefined) {
  const [H, W] = PAGE.A4, pg = k.doc.addPage([W, H]), X = 36, top = H - 40;
  k.text(pg, title, W / 2, top, { size: 16, bold: true, align: "center" });
  if (s(p.settings.title)) k.text(pg, s(p.settings.title), W / 2, top - 16, { size: 9, align: "center", color: "#6B7280" });
  const firstW = 70, cw = (W - 2 * X - firstW) / g.days, gap = 10, ch = (top - 40 - 60 - (g.lunchAfter > 0 && g.lunchAfter < g.periods ? gap : 0)) / (g.periods + 0.6);
  let y = top - 34;
  const hh = ch * 0.6;
  pg.drawRectangle({ x: X, y: y - hh, width: firstW, height: hh, color: hexRgb("#E5E7EB") });
  for (let d = 0; d < g.days; d++) { pg.drawRectangle({ x: X + firstW + d * cw, y: y - hh, width: cw, height: hh, color: hexRgb("#E5E7EB"), borderColor: hexRgb("#FFFFFF"), borderWidth: 1 }); k.text(pg, `星期${DAY_ZH[d]}`, X + firstW + d * cw + cw / 2, y - hh / 2 - 4, { size: 11, bold: true, align: "center" }); }
  y -= hh;
  for (let pd = 0; pd < g.periods; pd++) {
    if (pd === g.lunchAfter && pd > 0) { k.text(pg, "午 休", X + firstW + (g.days * cw) / 2, y - gap / 2 - 3, { size: 7, align: "center", color: "#9CA3AF" }); y -= gap; }
    pg.drawRectangle({ x: X, y: y - ch, width: firstW, height: ch, color: hexRgb("#F9FAFB"), borderColor: hexRgb("#E5E7EB"), borderWidth: 0.6 });
    k.text(pg, `第 ${pd + 1} 节`, X + firstW / 2, y - ch / 2 + (times(p, pd) ? 2 : -4), { size: 10, bold: true, align: "center" });
    if (times(p, pd)) k.text(pg, times(p, pd), X + firstW / 2, y - ch / 2 - 10, { size: 7.5, align: "center", color: "#6B7280" });
    for (let d = 0; d < g.days; d++) {
      const t = cells[d * g.periods + pd], x = X + firstW + d * cw, col = t ? colorOf(t) : undefined;
      pg.drawRectangle({ x, y: y - ch, width: cw, height: ch, color: col ? hexRgb(col) : undefined, borderColor: hexRgb("#E5E7EB"), borderWidth: 0.6 });
      const lines = t.split("\n");
      lines.forEach((l, i) => k.text(pg, l, x + cw / 2, y - ch / 2 + (lines.length - 1) * 6 - i * 12 - 4, { size: i ? 8 : 11, bold: i === 0, align: "center", color: i ? "#4B5563" : "#111827", maxWidth: cw - 6 }));
    }
    y -= ch;
  }
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "timetable",
    title: ["排课表", "Timetable Builder"],
    openDescription:
      "Build class and teacher timetables with no clashes. Pick a spreadsheet (.xlsx/.csv) with one row per class × subject: 班级/class, 科目/subject, 教师/teacher, 周课时/hours per week, 教室/room (shared rooms like 操场 or 机房), 固定/fixed slots (e.g. “周五7”, “周一1, 周三2”), 连堂/double (two periods in a row). Optional sheets: 教师限制 (教师, 不排: “周三下午”, “周一1-2, 周五下午”) and 教室 (教室, 容量 — how many classes at once). Rows are the requirements: include, cls, subject, teacher, hours, room, fixed, double, with _placed and _slots showing where each landed. Settings: days, periods, lunchAfter (morning periods), morning (subjects preferred in the morning, default 语文 数学 英语), avoid (teacher limits, one “教师: 时段” per line; overrides the sheet), rooms (“操场=2”; overrides the sheet), times (period times for printing), title. The scheduler never double-books a class, teacher or room, respects fixed slots and limits, spreads a subject across the week, keeps core subjects in the morning and avoids piling one teacher's day. Checks: lessons it could not place and why, clashing fixed slots, unreadable slot text, missing teachers, classes with more hours than periods, overloaded teachers, a subject twice on one day. Exports timetables.xlsx (every class and teacher grid, plus a master sheet) and timetables.pdf (one landscape page per class, then per teacher).",
    inputs: { exts: [".xlsx", ".csv"], min: 1, max: 1, label: ["选择课程需求表", "Pick the requirements sheet"] },
    settings: [
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "days", label: ["每周天数", "Days per week"], type: "number", default: 5, min: 1, max: 7 },
      { key: "periods", label: ["每天节数", "Periods per day"], type: "number", default: 7, min: 1, max: 14 },
      { key: "lunchAfter", label: ["上午节数", "Morning periods"], type: "number", default: 4, min: 0, max: 10 },
      { key: "morning", label: ["尽量排上午的科目", "Prefer morning for"], type: "text", default: "语文 数学 英语" },
      { key: "avoid", label: ["教师不排时段（每行 教师: 时段；留空=按表）", "Teacher limits (blank = sheet)"], type: "textarea", default: "" },
      { key: "rooms", label: ["教室容量（操场=2；留空=按表）", "Room capacity (blank = sheet)"], type: "text", default: "" },
      { key: "times", label: ["每节时间（逗号分隔，打印用）", "Period times (for printing)"], type: "text", default: "" },
    ],
    columns: () => [
      { key: "include", label: ["排", "On"], type: "bool" },
      { key: "cls", label: ["班级", "Class"] },
      { key: "subject", label: ["科目", "Subject"] },
      { key: "teacher", label: ["教师", "Teacher"] },
      { key: "hours", label: ["周课时", "Hours"], type: "number" },
      { key: "room", label: ["教室", "Room"] },
      { key: "fixed", label: ["固定", "Fixed"] },
      { key: "double", label: ["连堂", "Double"], type: "bool" },
      { key: "_placed", label: ["已排", "Placed"], readOnly: true },
      { key: "_slots", label: ["时段", "Slots"], readOnly: true, wide: true },
    ] as Column[],
    async load({ ws, files }) {
      const f = files[0];
      const t = await readTable(ws, f);
      const sheetOf = async (re: RegExp) => { const name = t.sheets.find((x) => re.test(x)); return name && name !== t.sheet ? readTable(ws, f, name) : undefined; };
      const h = mapHeaders(t.columns, { cls: ["班级", "班", "class", "group"], subject: ["科目", "学科", "课程", "subject", "course"], teacher: ["教师", "老师", "任课教师", "teacher"], hours: ["周课时", "课时", "每周课时", "节数", "hours", "periods", "lessons"], room: ["教室", "场地", "room", "venue"], fixed: ["固定", "固定时段", "fixed"], double: ["连堂", "连排", "double"] });
      if (!h.cls || !h.subject) throw new KitError("bad_sheet", `Couldn't find 班级 and 科目 columns in ${f.split("/").pop()} (found: ${t.columns.join(", ")}).`);
      const rows: Row[] = t.rows.filter((r) => s(r[h.cls!]) && s(r[h.subject!])).map((r) => ({ include: true, cls: s(r[h.cls!]), subject: s(r[h.subject!]), teacher: s(h.teacher && r[h.teacher]), hours: Number(s(h.hours && r[h.hours])) || 0, room: s(h.room && r[h.room]), fixed: s(h.fixed && r[h.fixed]), double: yes(h.double && r[h.double]) || /^(是|连)$/.test(s(h.double && r[h.double])) }));
      const lim = await sheetOf(/限制|不排|limit|avail/i), rm = await sheetOf(/教室|场地|room/i);
      const avoid = lim ? lim.rows.map((r) => `${s(Object.values(r)[0])}: ${s(Object.values(r)[1])}`).filter((x) => !/^:|: $/.test(x)).join("\n") : "";
      const rooms = rm ? rm.rows.map((r) => `${s(Object.values(r)[0])}=${s(Object.values(r)[1]) || 1}`).join(", ") : "";
      return { rows, meta: { avoid, rooms } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const { g, reqs, res, bad, avoid } = plan(p), issues: Issue[] = [], N = g.days * g.periods;
      for (const b of bad) issues.push({ level: "error", row: b.row, key: b.key, message: `Can't read “${b.text}” (${b.where}). Use e.g. 周一1, 周三2-3, 周五下午, 周二上午 (days 周一–周${DAY_ZH[g.days - 1]}, periods 1–${g.periods}).` });
      const classes = [...new Set(reqs.map((r) => r.cls))];
      for (const c of classes) { const h = reqs.filter((r) => r.cls === c).reduce((a, r) => a + r.hours, 0); if (h > N) issues.push({ level: "error", message: `${c} needs ${h} periods a week but there are only ${N} (${g.days} days × ${g.periods}).` }); }
      const tLoad = new Map<string, number>(); for (const r of reqs) if (r.teacher) tLoad.set(r.teacher, (tLoad.get(r.teacher) ?? 0) + r.hours);
      for (const [t, h] of tLoad) { const av = N - (avoid.get(t)?.size ?? 0); if (h > av) issues.push({ level: "error", message: `${t} teaches ${h} periods but is available for only ${av}.` }); }
      for (const r of reqs) if (!r.teacher) issues.push({ level: "warn", row: r.id, key: "teacher", message: `${r.cls} ${r.subject} has no teacher — it's scheduled, but teacher clashes can't be checked.` });
      const byIdR = new Map(reqs.map((r) => [r.id, r]));
      for (const f of res.fixedFail) {
        const r = byIdR.get(f.req)!, who = res.placed.filter((x) => x.slot === f.slot && x.req !== f.req).map((x) => byIdR.get(x.req)!).filter((x) => x.cls === r.cls || (r.teacher && x.teacher === r.teacher) || (r.room && x.room === r.room)).map((x) => `${x.cls} ${x.subject}${x.teacher ? `（${x.teacher}）` : ""}`);
        issues.push({ level: "error", row: f.req, key: "fixed", message: `${r.cls} ${r.subject}${r.teacher ? `（${r.teacher}）` : ""}: ${f.why.replace(/\)$/, "")}${who.length ? ` by ${who.join("、")}` : ""}). That period was put somewhere else instead — change the fixed slot.` });
      }
      for (const u of res.unplaced) { const r = reqs.find((x) => x.id === u.req)!; issues.push({ level: "error", row: u.req, key: /fixed/.test(u.why) ? "fixed" : "hours", message: `${r.cls} ${r.subject}${r.teacher ? `（${r.teacher}）` : ""}: ${u.n} period(s) not placed — ${u.why}.` }); }
      const slotsOf = new Map<number, number[]>(); for (const x of res.placed) slotsOf.set(x.req, [...(slotsOf.get(x.req) ?? []), x.slot].sort((a, b) => a - b));
      for (const r of reqs) {
        if (r.hours > g.days) continue;
        const days = (slotsOf.get(r.id) ?? []).map((x) => Math.floor(x / g.periods)), dup = days.find((d, i) => days.indexOf(d) !== i && !(r.double));
        if (dup !== undefined) issues.push({ level: "info", row: r.id, key: "_slots", message: `${r.cls} ${r.subject} has two periods on 周${DAY_ZH[dup]} — no better spread was possible.` });
      }
      const tDay = new Map<string, number[]>(); for (const x of res.placed) { const r = reqs.find((y) => y.id === x.req)!; if (!r.teacher) continue; const a = tDay.get(r.teacher) ?? Array(g.days).fill(0); a[Math.floor(x.slot / g.periods)]++; tDay.set(r.teacher, a); }
      for (const [t, a] of tDay) a.forEach((n, d) => { if (n >= 5) issues.push({ level: "info", message: `${t} teaches ${n} periods on 周${DAY_ZH[d]}.` }); });
      const rows = p.rows.map((r, i) => { const sl = slotsOf.get(i) ?? [], req = reqs.find((x) => x.id === i); return { ...r, _placed: req ? `${sl.length}/${req.hours}` : "", _slots: sl.map((x) => slotShort(x, g)).join(" ") }; });
      const need = reqs.reduce((a, r) => a + r.hours, 0);
      return {
        rows,
        issues,
        summary: `${classes.length} class(es), ${tLoad.size} teacher(s), ${reqs.length} subject row(s); ${g.days} days × ${g.periods} periods. Placed ${res.placed.length} of ${need} periods${res.unplaced.length ? `; ${need - res.placed.length} not placed` : " — no clashes"}.`,
        stats: { classes: classes.length, teachers: tLoad.size, placed: res.placed.length, needed: need },
      };
    },
    exports: [
      { id: "xlsx", label: ["课表 Excel", "Timetables (Excel)"], description: "timetables.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, { g, classes, teachers, cls, tch } = tables(p);
        const block = (cells: string[]) => Array.from({ length: g.periods }, (_, pd) => [`第${pd + 1}节${times(p, pd) ? ` ${times(p, pd)}` : ""}`, ...Array.from({ length: g.days }, (_, d) => cells[d * g.periods + pd].replace(/\n/g, " "))]);
        const head = ["节次", ...Array.from({ length: g.days }, (_, d) => `星期${DAY_ZH[d]}`)];
        const master = Array.from({ length: g.days * g.periods }, (_, sl) => [slotName(sl, g), ...classes.map((c) => cls.get(c)![sl].replace(/\n/g, " "))]);
        return [await ctx.write("timetables.xlsx", await writeXlsx([
          { name: "总表", headers: ["时段", ...classes], rows: master, widths: [14, ...classes.map(() => 18)] },
          ...classes.map((c) => ({ name: c, headers: head, rows: block(cls.get(c)!), widths: [12, ...Array(g.days).fill(18)] })),
          ...teachers.map((t) => ({ name: `${t}（教师）`, headers: head, rows: block(tch.get(t)!), widths: [12, ...Array(g.days).fill(16)] })),
        ]))];
      } },
      { id: "pdf", label: ["课表 PDF", "Timetables (PDF)"], description: "timetables.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { g, classes, teachers, cls, tch, subjColor } = tables(p), k = await newPdf();
        for (const c of classes) drawGrid(k, p, `${c} 课程表`, cls.get(c)!, g, (t) => subjColor.get(t.split("\n")[0]));
        for (const t of teachers) drawGrid(k, p, `${t} 老师课表`, tch.get(t)!, g, (x) => subjColor.get(x.split("\n")[1] ?? ""));
        return [await ctx.write("timetables.pdf", await k.doc.save())];
      } },
    ],
    newRow: () => ({ include: true, cls: "", subject: "", teacher: "", hours: 1, room: "", fixed: "", double: false }),
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.cls)} ${s(r.subject)} ${s(r.teacher) || "(no teacher)"} ${s(r.hours)}h${s(r.room) ? ` @${s(r.room)}` : ""}${s(r.fixed) ? ` fixed ${s(r.fixed)}` : ""}${yes(r.double) ? " double" : ""} → ${s(r._placed)} ${s(r._slots)}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
