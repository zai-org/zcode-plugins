import { createApp, esc, htmlPage, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num, parseDate, addDays } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { availableShifts, buildRota, clock, DAYS_EN, DAYS_ZH, hours, ics, parseShifts, type Staff } from "./rota.ts";
import { s } from "./util.ts";

export const NAME = "shift-scheduler";
export const VERSION = "0.1.0";
const DK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ALIAS: Record<string, string[]> = { name: ["姓名", "员工", "名字", "name", "staff", "employee"], role: ["岗位", "职位", "角色", "role", "position"], max: ["每周最多工时", "最多工时", "工时上限", "max hours", "max", "hours"], mon: ["周一", "星期一", "monday", "mon"], tue: ["周二", "星期二", "tuesday", "tue"], wed: ["周三", "星期三", "wednesday", "wed"], thu: ["周四", "星期四", "thursday", "thu"], fri: ["周五", "星期五", "friday", "fri"], sat: ["周六", "星期六", "saturday", "sat"], sun: ["周日", "星期日", "星期天", "sunday", "sun"] };

function nextMonday() { const d = new Date(); const k = (8 - d.getDay()) % 7 || 7; d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); }
const shiftsOf = (p: Project) => parseShifts(s(p.settings.shifts));
const staffOf = (p: Project): Staff[] => p.rows.map((r, i) => ({ i, name: s(r.name), max: Number(r.maxHours) > 0 ? Number(r.maxHours) : Number(p.settings.defaultMax) || 40, avail: DK.map((k) => s(r[k])) })).filter((x) => x.name);
function rota(p: Project) {
  const sh = shiftsOf(p), st = staffOf(p);
  return { sh, st, r: buildRota(st, sh, { seed: s(p.settings.seed), restHours: Number(p.settings.rest) || 0, maxShiftsPerDay: Number(p.settings.perDay) || 1 }), start: parseDate(p.settings.weekStart) || nextMonday() };
}
const dayLabel = (start: string, d: number) => `${DAYS_ZH[d]} ${addDays(start, d).slice(5)}`;

function gridHtml(p: Project) {
  const { sh, st, r, start } = rota(p);
  const name = (i: number) => st.find((x) => x.i === i)?.name ?? "";
  return `<table class="data"><thead><tr><th></th>${DAYS_ZH.map((_, d) => `<th>${esc(dayLabel(start, d))}</th>`).join("")}</tr></thead><tbody>${sh.map((x, k) => `<tr><th>${esc(x.name)}<div style="font-weight:400;font-size:11px;color:#6b7280">${clock(x.start)}–${clock(x.end)} ×${x.need}</div></th>${r.grid.map((day) => { const list = day[k]; const miss = x.need - list.length; return `<td${miss > 0 ? ' style="background:#fee2e2"' : ""}>${list.map((i) => esc(name(i))).join("<br>")}${miss > 0 ? `<div style="color:#b91c1c;font-size:11px">缺 ${miss}</div>` : ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "shifts",
  title: ["排班表", "Shift Scheduler"],
  openDescription:
    "Build a weekly shift rota from a staff availability sheet (CSV/XLSX: 姓名/name, 岗位/role, 每周最多工时/max hours, and one column per weekday 周一…周日 / Mon…Sun). Availability cells: empty or 全天 = any shift, 休/x = off, shift names like “早班, 晚班”, or a time window like “10-18”. Shifts are defined in the shifts setting, e.g. “早班 08:00-16:00 ×2; 晚班 16:00-24:00 ×2”. Shifts are shared out fairly by hours, respecting max hours, one shift per day and minimum rest; understaffed shifts are flagged. Exports a rota workbook, an HTML rota and one .ics calendar per person.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择员工可上班时间表", "Pick the staff availability sheet"] },
  settings: [
    { key: "title", label: ["标题", "Title"], type: "text", default: "排班表 Rota" },
    { key: "weekStart", label: ["本周第一天（周一）", "Week starts (Monday)"], type: "date", default: "" },
    { key: "shifts", label: ["班次（名称 开始-结束 ×人数，分号分隔）", "Shifts (name start-end ×people; separated by ;)"], type: "textarea", default: "早班 08:00-16:00 ×2; 晚班 16:00-24:00 ×2" },
    { key: "defaultMax", label: ["默认每周最多工时", "Default max hours/week"], type: "number", default: 40, min: 1, max: 100 },
    { key: "perDay", label: ["每人每天最多几个班", "Max shifts per person per day"], type: "number", default: 1, min: 1, max: 3 },
    { key: "rest", label: ["两班之间至少休息（小时）", "Min rest between shifts (hours)"], type: "number", default: 10, min: 0, max: 24 },
    { key: "seed", label: ["随机种子（改一下换一种排法）", "Seed (change for another rota)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "name", label: ["姓名", "Name"] },
    { key: "role", label: ["岗位", "Role"] },
    { key: "maxHours", label: ["每周最多工时", "Max hours"], type: "number" },
    ...DK.map((k, d) => ({ key: k, label: [DAYS_ZH[d], DAYS_EN[d]] as [string, string] })),
    { key: "hours", label: ["已排工时", "Hours"], type: "number" as const, readOnly: true },
    { key: "shiftsList", label: ["班次", "Shifts"], readOnly: true, wide: true },
  ],
  newRow: () => ({ name: "", role: "", maxHours: "", ...Object.fromEntries(DK.map((k) => [k, ""])) }),
  async load({ ws, files }) {
    if (!files.length) return { rows: [] };
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, ALIAS);
    if (!m.name) throw new KitError("no_name", `Need a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    return { rows: t.rows.filter((r) => s(r[m.name!])).map((r) => ({ name: s(r[m.name!]), role: m.role ? s(r[m.role]) : "", maxHours: m.max ? num(r[m.max]) || "" : "", ...Object.fromEntries(DK.map((k) => [k, m[k] ? s(r[m[k]!]) : ""])) })) };
  },
  compute(p): Computed {
    const { sh, st, r, start } = rota(p);
    const issues: Issue[] = [];
    if (!sh.length) issues.push({ level: "error", key: "shifts", message: "No shifts defined — set shifts like “早班 08:00-16:00 ×2; 晚班 16:00-24:00 ×2”." });
    for (const x of r.short) issues.push({ level: "warn", message: `${dayLabel(start, x.day)} ${sh[x.shift].name}: ${x.missing} more person/people needed — nobody else is available within their hours and rest rules.` });
    p.rows.forEach((row, i) => DK.forEach((k, d) => { const c = s(row[k]); if (c && !availableShifts(c, sh).size && !/^(休|休息|x|×|no|n|off|-|—|不可|请假|不行)$/i.test(c)) issues.push({ level: "warn", row: i, key: k, message: `${s(row.name)} ${DAYS_ZH[d]}: “${c}” matches no shift.` }); }));
    const list = (i: number) => r.grid.flatMap((day, d) => day.flatMap((l, k) => (l.includes(i) ? [`${DAYS_ZH[d]}${sh[k].name}`] : []))).join(" ");
    const rows = p.rows.map((row, i) => ({ ...row, hours: r.hours[st.findIndex((x) => x.i === i)] ?? 0, shiftsList: list(i) }));
    const need = sh.reduce((a, x) => a + x.need * 7, 0), filled = r.grid.flat().reduce((a, l) => a + l.length, 0);
    const hs = st.map((x) => r.hours[st.indexOf(x)]);
    return { rows, issues, summary: `${filled} of ${need} shift slot(s) filled for the week of ${start}; ${st.length} staff, ${hs.length ? Math.min(...hs) : 0}–${hs.length ? Math.max(...hs) : 0} h each.`, stats: { staff: st.length, slots: need, filled, short: need - filled }, preview: gridHtml(p) };
  },
  exports: [
    {
      id: "xlsx", label: ["排班 Excel", "Rota workbook"], description: "rota.xlsx — rota grid, per-person hours and a long list",
      async run({ project, write }: ExportCtx) {
        const { sh, st, r, start } = rota(project);
        const name = (i: number) => st.find((x) => x.i === i)?.name ?? "";
        const marks = r.short.map((x) => ({ row: x.shift, col: x.day + 1, color: "#FECACA", note: `short ${x.missing}` }));
        return [await write("rota.xlsx", await writeXlsx([
          { name: "Rota 排班", headers: ["shift 班次", ...DAYS_ZH.map((_, d) => dayLabel(start, d))], rows: sh.map((x, k) => [`${x.name} ${clock(x.start)}-${clock(x.end)}`, ...r.grid.map((day) => day[k].map(name).join("、"))]), marks, widths: [22, 18, 18, 18, 18, 18, 18, 18] },
          { name: "Hours 工时", headers: ["name", "role", "hours", "max", "shifts"], rows: st.map((x, j) => [x.name, s(project.rows[x.i].role), r.hours[j], x.max, r.grid.flat().filter((l) => l.includes(x.i)).length]) },
          { name: "List 明细", headers: ["date", "day", "shift", "start", "end", "name"], rows: r.grid.flatMap((day, d) => day.flatMap((l, k) => l.map((i) => [addDays(start, d), DAYS_ZH[d], sh[k].name, clock(sh[k].start), clock(sh[k].end), name(i)]))) },
        ]))];
      },
    },
    {
      id: "html", label: ["排班网页", "Rota (HTML)"], description: "rota.html — printable rota",
      async run({ project, write }: ExportCtx) {
        const title = s(project.settings.title) || "Rota";
        return [await write("rota.html", htmlPage(title, `<h1>${esc(title)}</h1>${gridHtml(project)}`, "th{min-width:90px}"))];
      },
    },
    {
      id: "ics", label: ["每人日历 .ics", "Calendars (.ics per person)"], description: "ics/<name>.ics — each person's shifts for calendar apps",
      async run({ project, write }: ExportCtx) {
        const { sh, st, r, start } = rota(project);
        const out: string[] = [];
        for (const x of st) {
          const ev = r.grid.flatMap((day, d) => day.flatMap((l, k) => {
            if (!l.includes(x.i)) return [];
            const [Y, M, D] = addDays(start, d).split("-").map(Number);
            const a = new Date(Date.UTC(Y, M - 1, D, 0, sh[k].start));
            return [{ title: `${sh[k].name} ${s(project.settings.title)}`.trim(), start: a, end: new Date(+a + hours(sh[k]) * 3600000), uid: `${start}-${d}-${k}-${safeFileName(x.name)}@shift-scheduler` }];
          }));
          if (ev.length) out.push(await write(`ics/${safeFileName(x.name)}.ics`, ics(ev, `${x.name} ${s(project.settings.title)}`)));
        }
        return out;
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.name)}${s(r.role) ? ` (${s(r.role)})` : ""} max=${s(r.maxHours) || "default"} ${DK.map((k, d) => `${DAYS_ZH[d]}:${s(r[k]) || "全天"}`).join(" ")} → ${s(r.shiftsList)} (${r.hours ?? 0}h)`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
