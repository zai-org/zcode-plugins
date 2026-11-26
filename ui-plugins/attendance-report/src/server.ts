import ExcelJS from "exceljs";
import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { writeXlsx, type SheetSpec } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName, type Workspace } from "./kit/workspace.ts";
import { evaluate, fmt, hm, isWorkday, parseDates, WD, weekdayOf, type DayResult, type Rules } from "./att.ts";

export const NAME = "attendance-report";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** 读表：xlsx 里的日期时间单元格保留时分（通用读表只保留日期）。 */
async function readPunchTable(ws: Workspace, path: string) {
  if (!/\.xlsx$/i.test(path)) return readTable(ws, path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await ws.read(path, 50 * 1024 * 1024)) as unknown as ArrayBuffer);
  const sheet = book.worksheets.find((w) => w.actualRowCount > 0) ?? book.worksheets[0];
  const text = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) {
      const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
      const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
      if (v.getUTCFullYear() < 1901) return t; // 只有时间的单元格
      return v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() ? `${d} ${t}` : d;
    }
    if (typeof v === "object") {
      if ("richText" in v) return v.richText.map((p) => p.text).join("");
      if ("text" in v) return String(v.text);
      if ("result" in v) return text(v.result as ExcelJS.CellValue);
      return "";
    }
    return String(v);
  };
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => { const cells: string[] = []; for (let c = 1; c <= sheet.columnCount; c++) cells.push(text(row.getCell(c).value).trim()); if (cells.some(Boolean)) matrix.push(cells); });
  if (!matrix.length) throw new KitError("empty_table", "The table has no rows.");
  const columns = matrix[0].map((c, i) => c || `列${i + 1}`);
  return { columns, rows: matrix.slice(1).map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""]))) };
}

function rulesOf(st: Record<string, unknown>): Rules {
  const weekend = s(st.weekend) === "sun" ? [0] : s(st.weekend) === "none" ? [] : [6, 0];
  return { start: hm(s(st.start)) ?? 540, end: hm(s(st.end)) ?? 1080, grace: Number(st.grace) || 0, earlyGrace: Number(st.earlyGrace) || 0, lunch: Number(st.lunch ?? 60) || 0, otAfter: Number(st.otAfter ?? 30) || 0, otMin: Number(st.otMin ?? 30) || 0, elastic: Number(st.elastic) || 0, weekend, holidays: parseDates(s(st.holidays)), workdays: parseDates(s(st.workdays)) };
}

function daysOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

interface Person { name: string; dept: string; days: number; attended: number; late: number; lateMin: number; early: number; earlyMin: number; missing: number; absent: number; excused: number; otWeekday: number; otRest: number; worked: number }
function evaluateAll(p: Project) {
  const r = rulesOf(p.settings);
  const results: DayResult[] = p.rows.map((row) => evaluate(s(row.date), hm(s(row.in)), hm(s(row.out)), s(row.note), r));
  const people = new Map<string, Person>();
  p.rows.forEach((row, i) => {
    const x = results[i];
    const k = s(row.name);
    const pp = people.get(k) ?? { name: k, dept: s(row.dept), days: 0, attended: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, missing: 0, absent: 0, excused: 0, otWeekday: 0, otRest: 0, worked: 0 };
    if (!x.rest) { pp.days++; if (!x.absent && !(x.excused && !s(row.in) && !s(row.out))) pp.attended++; }
    if (x.late) { pp.late++; pp.lateMin += x.late; }
    if (x.early) { pp.early++; pp.earlyMin += x.early; }
    pp.missing += x.missing;
    if (x.absent) pp.absent++;
    if (x.excused) pp.excused++;
    if (x.rest) pp.otRest += x.ot; else pp.otWeekday += x.ot;
    pp.worked += x.worked;
    people.set(k, pp);
  });
  return { rules: r, results, people: [...people.values()] };
}
const h1 = (m: number) => Math.round((m / 60) * 10) / 10;

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "attend",
  title: ["考勤统计", "Attendance Report"],
  openDescription:
    "Turn raw clock-in records (CSV/XLSX exported from a time clock or attendance app: one row per punch with 姓名/name and 打卡时间/time, or 日期/date + 时间/time columns; 部门/department optional) into a monthly attendance report: for each person and working day the first and last punch, late arrivals, early leaves, missing punches, absences and overtime (weekday and rest-day). Rules: shift start/end, late grace minutes, flexible start (arrive up to N minutes late and leave as much later), lunch break, overtime threshold, weekend days, public holidays and make-up working days. Fix punches or mark leave/business trips in the table, then export a summary workbook and one workbook per person.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择打卡记录", "Pick the clock-in records"] },
  settings: [
    { key: "month", label: ["月份（YYYY-MM，留空自动）", "Month (YYYY-MM, blank = auto)"], type: "text", default: "", reload: true },
    { key: "start", label: ["上班时间", "Shift start"], type: "text", default: "09:00" },
    { key: "end", label: ["下班时间", "Shift end"], type: "text", default: "18:00" },
    { key: "grace", label: ["迟到宽限（分钟）", "Late grace (min)"], type: "number", default: 5 },
    { key: "earlyGrace", label: ["早退宽限（分钟）", "Early-leave grace (min)"], type: "number", default: 0 },
    { key: "elastic", label: ["弹性上班（分钟，晚到可晚走）", "Flexible start (min, arrive later = leave later)"], type: "number", default: 0 },
    { key: "lunch", label: ["午休（分钟）", "Lunch break (min)"], type: "number", default: 60 },
    { key: "otAfter", label: ["下班后多少分钟起算加班", "Overtime starts after (min past shift end)"], type: "number", default: 30 },
    { key: "otMin", label: ["加班最少计（分钟）", "Minimum overtime counted (min)"], type: "number", default: 30 },
    { key: "weekend", label: ["休息日", "Rest days"], type: "select", default: "sat-sun", options: [{ value: "sat-sun", label: ["周六日", "Sat + Sun"] }, { value: "sun", label: ["仅周日", "Sun only"] }, { value: "none", label: ["无（排班制）", "None"] }] },
    { key: "holidays", label: ["节假日（如 2026-10-01..2026-10-07）", "Holidays (e.g. 2026-10-01..2026-10-07)"], type: "text", default: "" },
    { key: "workdays", label: ["调休上班日", "Make-up working days"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "name", label: ["姓名", "Name"] },
    { key: "dept", label: ["部门", "Dept"] },
    { key: "date", label: ["日期", "Date"], readOnly: true },
    { key: "wd", label: ["星期", "Day"], readOnly: true },
    { key: "in", label: ["上班", "In"] },
    { key: "out", label: ["下班", "Out"] },
    { key: "note", label: ["备注（请假/出差…）", "Note (leave/trip…)"] },
    { key: "status", label: ["结果", "Result"], readOnly: true, wide: true },
  ],
  async load({ ws, files, settings }) {
    const t = await readPunchTable(ws, files[0]);
    const m = mapHeaders(t.columns, { name: ["姓名", "名字", "员工", "name", "employee"], dept: ["部门", "department", "dept"], id: ["工号", "编号", "employee id", "id"], datetime: ["打卡时间", "时间", "datetime", "punch time", "timestamp", "check time", "签到时间"], date: ["日期", "打卡日期", "date"], time: ["打卡时刻", "time", "时刻"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const tcol = m.datetime ?? m.time;
    if (!tcol) throw new KitError("no_time_column", `Couldn't find a punch time column (打卡时间/time). Columns: ${t.columns.join(", ")}`);
    const punches = new Map<string, { name: string; dept: string; date: string; times: number[] }>();
    let bad = 0;
    for (const r of t.rows) {
      const name = s(r[m.name]);
      if (!name) continue;
      const raw = s(r[tcol]);
      const date = parseDate(m.date && m.date !== tcol ? r[m.date] : raw);
      const tm = hm(raw.replace(/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s*/, ""));
      if (!date || tm === null) { bad++; continue; }
      const k = `${name}\t${date}`;
      const e = punches.get(k) ?? { name, dept: m.dept ? s(r[m.dept]) : "", date, times: [] };
      e.times.push(tm);
      punches.set(k, e);
    }
    if (!punches.size) throw new KitError("no_punches", "No punch records with a readable date and time.");
    const months = new Map<string, number>();
    for (const e of punches.values()) months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) ?? 0) + 1);
    let month = s(settings.month);
    if (!/^\d{4}-\d{2}$/.test(month)) { month = [...months].sort((a, b) => b[1] - a[1])[0][0]; settings.month = month; }
    const rules = rulesOf(settings);
    const names = [...new Map([...punches.values()].map((e) => [e.name, e.dept])).entries()];
    const rows: Row[] = [];
    for (const [name, dept] of names) {
      for (const date of daysOfMonth(month)) {
        const e = punches.get(`${name}\t${date}`);
        if (!e && !isWorkday(date, rules)) continue;
        const ts = [...new Set(e?.times ?? [])].sort((a, b) => a - b);
        let inT: number | null = null, outT: number | null = null;
        if (ts.length >= 2) { inT = ts[0]; outT = ts[ts.length - 1]; }
        else if (ts.length === 1) { if (ts[0] < (rules.start + rules.end) / 2) inT = ts[0]; else outT = ts[0]; }
        rows.push({ name, dept, date, wd: `周${WD[weekdayOf(date)]}`, in: fmt(inT), out: fmt(outT), note: "", status: "", punches: ts.length });
      }
    }
    return { rows, meta: { month, badRows: bad, otherMonths: [...months.keys()].filter((x) => x !== month) } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const { results, people } = evaluateAll(p);
    const rows = p.rows.map((r, i) => ({ ...r, status: results[i].status }));
    p.rows.forEach((r, i) => {
      for (const k of ["in", "out"] as const) if (s(r[k]) && hm(s(r[k])) === null) issues.push({ level: "error", row: i, key: k, message: `${r.name} ${r.date}: “${r[k]}” isn't a time (HH:MM).` });
      const x = results[i];
      if (x.missing) issues.push({ level: "warn", row: i, key: s(r.in) ? "out" : "in", message: `${r.name} ${r.date}: ${x.flags.find((f) => f.startsWith("缺")) ?? "missing punch"}.` });
      if (x.absent) issues.push({ level: "warn", row: i, key: "note", message: `${r.name} ${r.date}: no punches (absent) — add 请假/出差 in the note if excused.` });
    });
    const meta = p.meta as { badRows?: number; otherMonths?: string[]; month?: string };
    if (meta.badRows) issues.push({ level: "info", message: `${meta.badRows} record(s) had no readable date/time and were skipped.` });
    if (meta.otherMonths?.length) issues.push({ level: "info", message: `Records from ${meta.otherMonths.join(", ")} were left out (month ${meta.month}).` });
    const tot = people.reduce((a, x) => ({ late: a.late + x.late, missing: a.missing + x.missing, absent: a.absent + x.absent, ot: a.ot + x.otWeekday + x.otRest }), { late: 0, missing: 0, absent: 0, ot: 0 });
    const preview = `<table style="border-collapse:collapse;font:13px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;width:100%"><thead><tr style="background:#f3f4f6">${["姓名", "部门", "应出勤", "实出勤", "迟到", "早退", "缺卡", "缺勤", "请假/出差", "加班(时)"].map((x) => `<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #e5e7eb">${x}</th>`).join("")}</tr></thead><tbody>${people.map((x) => `<tr>${[x.name, x.dept, x.days, x.attended, x.late ? `${x.late} 次 / ${x.lateMin} 分` : "", x.early ? `${x.early} 次 / ${x.earlyMin} 分` : "", x.missing || "", x.absent || "", x.excused || "", h1(x.otWeekday + x.otRest) || ""].map((v, i) => `<td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;${(i === 4 || i === 6 || i === 7) && v ? "color:#b91c1c;font-weight:600" : ""}">${esc(String(v))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return { rows, issues, preview, summary: `${people.length} people · ${meta.month} · ${tot.late} late · ${tot.missing} missing punches · ${tot.absent} absences · ${h1(tot.ot)} h overtime`, stats: { people: people.length, late: tot.late, missing: tot.missing, absent: tot.absent, overtimeHours: h1(tot.ot) } };
  },
  exports: [
    {
      id: "summary", label: ["汇总表 Excel", "Summary workbook"], description: "attendance-<month>.xlsx — one line per person plus every day's detail (problems highlighted)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const { results, people } = evaluateAll(project);
        const month = s(project.meta?.month);
        const detail = detailSheet(project.rows, results);
        const sheets: SheetSpec[] = [
          { name: `汇总 ${month}`, headers: ["姓名", "部门", "应出勤天数", "实出勤天数", "迟到次数", "迟到分钟", "早退次数", "早退分钟", "缺卡次数", "缺勤天数", "请假/出差", "工作日加班(时)", "休息日加班(时)", "工作时长(时)"], rows: people.map((x) => [x.name, x.dept, x.days, x.attended, x.late, x.lateMin, x.early, x.earlyMin, x.missing, x.absent, x.excused, h1(x.otWeekday), h1(x.otRest), h1(x.worked)]), marks: people.flatMap((x, i) => [x.late ? { row: i, col: 4 } : null, x.missing ? { row: i, col: 8 } : null, x.absent ? { row: i, col: 9, color: "#FECACA" } : null].filter(Boolean) as SheetSpec["marks"] & object) },
          detail,
          { name: "规则 Rules", headers: ["项目", "设置"], rows: [["月份", month], ["上班", s(project.settings.start)], ["下班", s(project.settings.end)], ["迟到宽限(分)", Number(project.settings.grace) || 0], ["早退宽限(分)", Number(project.settings.earlyGrace) || 0], ["弹性(分)", Number(project.settings.elastic) || 0], ["午休(分)", Number(project.settings.lunch) || 0], ["加班起算(下班后分钟)", Number(project.settings.otAfter) || 0], ["加班最少(分)", Number(project.settings.otMin) || 0], ["休息日", s(project.settings.weekend)], ["节假日", s(project.settings.holidays)], ["调休上班", s(project.settings.workdays)]] },
        ];
        return [await write(`attendance-${month}.xlsx`, await writeXlsx(sheets))];
      },
    },
    {
      id: "people", label: ["每人一份 Excel", "One workbook per person"], description: "people/<name>-<month>.xlsx — each person's days for them to check",
      async run({ project, write }: ExportCtx) {
        const { results } = evaluateAll(project);
        const month = s(project.meta?.month);
        const out: string[] = [];
        for (const name of [...new Set(project.rows.map((r) => s(r.name)))]) {
          const idx = project.rows.map((r, i) => (s(r.name) === name ? i : -1)).filter((i) => i >= 0);
          out.push(await write(`people/${safeFileName(name, "person")}-${month}.xlsx`, await writeXlsx([detailSheet(idx.map((i) => project.rows[i]), idx.map((i) => results[i]), `${name} ${month}`)])));
        }
        return out;
      },
    },
  ],
};

function detailSheet(rows: Row[], results: DayResult[], name = "明细 Detail"): SheetSpec {
  const marks: NonNullable<SheetSpec["marks"]> = [];
  rows.forEach((_, i) => {
    const x = results[i];
    if (x.late) marks.push({ row: i, col: 4 });
    if (x.early) marks.push({ row: i, col: 5 });
    if (x.missing) marks.push({ row: i, col: s(rows[i].in) ? 5 : 4, color: "#FDBA74" });
    if (x.absent) marks.push({ row: i, col: 7, color: "#FECACA" });
    if (x.ot) marks.push({ row: i, col: 10, color: "#BFDBFE" });
  });
  return { name, headers: ["姓名", "部门", "日期", "星期", "上班", "下班", "备注", "结果", "迟到(分)", "早退(分)", "加班(分)", "工作(分)"], rows: rows.map((r, i) => [s(r.name), s(r.dept), s(r.date), s(r.wd), s(r.in), s(r.out), s(r.note), results[i].status, results[i].late || "", results[i].early || "", results[i].ot || "", results[i].worked || ""]), marks, widths: [10, 10, 12, 6, 7, 7, 14, 30, 8, 8, 8, 8] };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
