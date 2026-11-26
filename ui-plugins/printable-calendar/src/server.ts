import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { byDay, calendarPdf, grid, iso, monthsOf, type CalEvent, type CalOpts } from "./cal.ts";

export const NAME = "printable-calendar";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const kindOf = (v: unknown): CalEvent["kind"] => (/假|休|holiday|off|节/i.test(s(v)) ? "holiday" : /补班|调休上班|上班|workday|make-?up/i.test(s(v)) ? "workday" : "event");
const KIND_LABEL: Record<CalEvent["kind"], string> = { event: "活动", holiday: "假期", workday: "补班" };

/** “2027-01-01 元旦, 2027-02-06..2027-02-12 春节” → 假期列表。 */
export function parseHolidayText(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const part of String(text ?? "").split(/[\n,，;；]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d{4}-\d{1,2}-\d{1,2})(?:\s*(?:\.\.|~|～|至|-{2})\s*(\d{4}-\d{1,2}-\d{1,2}))?\s*(.*)$/.exec(part);
    if (!m) continue;
    const kind: CalEvent["kind"] = /补班|上班/.test(m[3]) ? "workday" : "holiday";
    out.push({ date: parseDate(m[1]), endDate: m[2] ? parseDate(m[2]) : "", title: m[3].trim() || (kind === "workday" ? "补班" : "假期"), kind, color: "" });
  }
  return out;
}
function eventsOf(p: Project): CalEvent[] {
  const rows = p.rows.filter((r) => r.include !== false && parseDate(r.date)).map((r) => ({ date: parseDate(r.date), endDate: parseDate(r.endDate), title: s(r.title), kind: kindOf(r.kind), color: /^#[0-9a-f]{6}$/i.test(s(r.color)) ? s(r.color) : "" }));
  return [...rows, ...parseHolidayText(s(p.settings.holidays))];
}
function optsOf(p: Project, layout: CalOpts["layout"]): CalOpts {
  const st = p.settings;
  return { year: Number(st.year) || new Date().getFullYear() + 1, startMonth: Math.min(12, Math.max(1, Number(st.startMonth) || 1)), months: Math.min(24, Math.max(1, Number(st.months) || 12)), layout, weekStart: s(st.weekStart) === "sun" ? 0 : 1, page: s(st.page) === "Letter" ? "Letter" : "A4", landscape: layout === "month" ? s(st.orientation) !== "portrait" : s(st.orientation) === "landscape", title: s(st.title), accent: s(st.accent) || "#0f766e", weekNumbers: st.weekNumbers === true, lang: (["zh", "en", "both"].includes(s(st.lang)) ? s(st.lang) : "both") as CalOpts["lang"] };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "cal",
  title: ["可打印日历", "Printable Calendar"],
  openDescription:
    "Make printable calendar PDFs: a monthly calendar (one month per page, big boxes with your events written in) and a year-at-a-glance page. Optionally pick an event list (CSV/XLSX with 日期/date, 结束日期/end date, 事项/title, 类型/type such as 活动, 假期 or 补班, 颜色/colour) and/or type holidays in settings (e.g. “2027-01-01 元旦, 2027-02-06..2027-02-12 春节”). Choose the year, starting month and number of months, Monday or Sunday week start, A4 or Letter, portrait or landscape, Chinese/English labels, ISO week numbers and a colour. Holidays are shaded and marked 休, make-up working days 班.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择事件表（可选）", "Pick an event list (optional)"] },
  settings: [
    { key: "year", label: ["年份", "Year"], type: "number", default: new Date().getFullYear() + 1 },
    { key: "startMonth", label: ["从几月开始", "Start month"], type: "number", default: 1 },
    { key: "months", label: ["月数", "Number of months"], type: "number", default: 12 },
    { key: "weekStart", label: ["每周从", "Week starts on"], type: "select", default: "mon", options: [{ value: "mon", label: ["周一", "Monday"] }, { value: "sun", label: ["周日", "Sunday"] }] },
    { key: "page", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
    { key: "orientation", label: ["方向", "Orientation"], type: "select", default: "auto", options: [{ value: "auto", label: ["自动（月历横向、年历纵向）", "Auto (monthly landscape, year portrait)"] }, { value: "landscape", label: ["横向", "Landscape"] }, { value: "portrait", label: ["纵向", "Portrait"] }] },
    { key: "lang", label: ["文字", "Labels"], type: "select", default: "both", options: [{ value: "both", label: ["中英", "Chinese + English"] }, { value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }] },
    { key: "title", label: ["标题（可选）", "Title (optional)"], type: "text", default: "" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#0f766e" },
    { key: "weekNumbers", label: ["显示周数", "Show week numbers"], type: "bool", default: false },
    { key: "holidays", label: ["节假日（如 2027-01-01 元旦, 2027-02-06..2027-02-12 春节）", "Holidays (e.g. 2027-01-01 New Year)"], type: "textarea", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["显示", "Show"], type: "bool" },
    { key: "date", label: ["日期", "Date"] },
    { key: "endDate", label: ["结束日期", "End date"] },
    { key: "title", label: ["事项", "Title"], wide: true },
    { key: "kind", label: ["类型", "Type"], type: "select", options: ["活动", "假期", "补班"] },
    { key: "color", label: ["颜色", "Colour"] },
  ],
  newRow: () => ({ include: true, date: "", endDate: "", title: "", kind: "活动", color: "" }),
  async load({ ws, files, settings }) {
    if (!files.length) return { rows: [] };
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { date: ["日期", "开始日期", "date", "start date", "day"], endDate: ["结束日期", "end date", "截止日期", "to"], title: ["事项", "标题", "名称", "活动", "title", "event", "name", "summary"], kind: ["类型", "分类", "type", "kind", "category"], color: ["颜色", "color", "colour"] });
    if (!m.date || !m.title) throw new KitError("no_columns", `Need a date (日期/date) and a title (事项/title) column. Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.filter((r) => s(r[m.date!])).map((r) => ({ include: true, date: parseDate(r[m.date!]) || s(r[m.date!]), endDate: m.endDate ? parseDate(r[m.endDate]) : "", title: s(r[m.title!]), kind: KIND_LABEL[kindOf(m.kind ? r[m.kind] : "")], color: m.color ? s(r[m.color]) : "" }));
    const years = new Map<number, number>();
    for (const r of rows) { const y = Number(String(r.date).slice(0, 4)); if (y) years.set(y, (years.get(y) ?? 0) + 1); }
    if (years.size && Number(settings.year) === new Date().getFullYear() + 1) settings.year = [...years].sort((a, b) => b[1] - a[1])[0][0];
    return { rows };
  },
  compute(p) {
    const issues: Issue[] = [];
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!parseDate(r.date)) issues.push({ level: "error", row: i, key: "date", message: `Row ${i + 1}: “${r.date}” isn't a date.` });
      if (s(r.endDate) && parseDate(r.endDate) < parseDate(r.date)) issues.push({ level: "warn", row: i, key: "endDate", message: `${r.title}: ends before it starts.` });
      if (s(r.color) && !/^#[0-9a-f]{6}$/i.test(s(r.color))) issues.push({ level: "info", row: i, key: "color", message: `${r.title}: colour should look like #2563eb.` });
    });
    const o = optsOf(p, "year");
    const events = eventsOf(p);
    const list = monthsOf(o);
    const firstKey = iso(list[0].y, list[0].m, 1), lastKey = iso(list[list.length - 1].y, list[list.length - 1].m, 31);
    const inRange = events.filter((e) => (e.endDate || e.date) >= firstKey && e.date <= lastKey);
    if (events.length && !inRange.length) issues.push({ level: "warn", key: "year", message: `None of the events fall in ${firstKey.slice(0, 7)} – ${lastKey.slice(0, 7)} — check the year.` });
    const days = byDay(events);
    const WD = ["日", "一", "二", "三", "四", "五", "六"];
    const mini = list.map(({ y, m }) => `<div style="width:170px"><div style="font-weight:700;color:${esc(o.accent)};margin-bottom:2px">${y === list[0].y ? "" : `${y} `}${m} 月</div><table style="border-collapse:collapse;font-size:11px;text-align:center;width:100%"><tr>${[0, 1, 2, 3, 4, 5, 6].map((c) => { const wd = (c + o.weekStart) % 7; return `<td style="color:${wd % 6 === 0 ? "#dc2626" : "#6b7280"}">${WD[wd]}</td>`; }).join("")}</tr>${grid(y, m, o.weekStart).map((row) => `<tr>${row.map((d, c) => { if (!d) return "<td></td>"; const ev = days.get(iso(y, m, d)) ?? []; const hol = ev.some((e) => e.kind === "holiday"); const work = ev.some((e) => e.kind === "workday"); const wd = (c + o.weekStart) % 7; const has = ev.find((e) => e.kind === "event"); return `<td title="${esc(ev.map((e) => e.title).join(" / "))}" style="padding:1px;${hol ? "background:#fee2e2;" : ""}color:${hol || (wd % 6 === 0 && !work) ? "#dc2626" : "#111827"};${has ? `font-weight:700;text-decoration:underline ${esc(has.color || o.accent)} 2px` : ""}">${d}</td>`; }).join("")}</tr>`).join("")}</table></div>`).join("");
    const preview = `<div style="display:flex;flex-wrap:wrap;gap:14px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${mini}</div>`;
    const hol = inRange.filter((e) => e.kind === "holiday").length, ev = inRange.filter((e) => e.kind === "event").length;
    return { rows: p.rows, issues, preview, summary: `${list.length} months from ${firstKey.slice(0, 7)} · ${ev} events · ${hol} holidays`, stats: { months: list.length, events: ev, holidays: hol } };
  },
  exports: [
    {
      id: "monthly", label: ["月历 PDF（每月一页）", "Monthly PDF (a page per month)"], description: "calendar-<year>-monthly.pdf",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first.");
        const o = optsOf(project, "month");
        return [await write(`calendar-${o.year}-monthly.pdf`, await calendarPdf(eventsOf(project), o))];
      },
    },
    {
      id: "year", label: ["年历 PDF（一页全年）", "Year-at-a-glance PDF"], description: "calendar-<year>-year.pdf",
      async run({ project, write }: ExportCtx) {
        const o = optsOf(project, "year");
        return [await write(`calendar-${o.year}-year.pdf`, await calendarPdf(eventsOf(project), o))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
