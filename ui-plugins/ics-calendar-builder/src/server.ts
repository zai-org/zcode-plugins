import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { buildIcs, localToUtc, parseReminders, parseRepeat, toMin, validTz, type Ev } from "./ics.ts";

export const NAME = "ics-calendar-builder";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const yes = (v: unknown) => /^(1|y|yes|true|是|√|✓|全天|all ?day)$/i.test(s(v));
const time = (v: unknown) => { const m = /(\d{1,2})[:：.时](\d{2})/.exec(s(v)); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };
const tzOf = (p: Project) => s(p.settings.timezone) || "Asia/Shanghai";

function eventsOf(p: Project): { ev: Ev; row: number; errors: string[]; warns: string[] }[] {
  const tz = tzOf(p);
  const defRem = s(p.settings.reminder);
  const dur = Math.max(5, Number(p.settings.duration) || 60);
  return p.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include !== false).map(({ r, i }) => {
    const errors: string[] = [], warns: string[] = [];
    const title = s(r.title);
    const date = parseDate(r.date);
    if (!title) errors.push("no title");
    if (!date) errors.push(`date “${s(r.date)}” isn't a date`);
    const start = time(r.start);
    const allDay = Boolean(r.allDay) || !start;
    let end = time(r.end);
    if (!allDay && !end) { const m = toMin(start)! + dur; end = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
    const endDate = parseDate(r.endDate);
    if (endDate && date && endDate < date) errors.push("ends before it starts");
    if (!allDay && endDate === date && toMin(end)! <= toMin(start)! && end !== start) warns.push("ends before it starts on the same day — treated as ending after midnight");
    let rrule = parseRepeat(s(r.repeat));
    if (rrule === null) { errors.push(`repeat “${s(r.repeat)}” isn't understood (try 每周 / 每两周 / 每月 / 每年 / 工作日 / 每周一三五)`); rrule = ""; }
    const re = s(r.repeatEnd);
    if (rrule && re) {
      const n = /^(\d+)\s*(次|回|times?)?$/i.exec(re);
      const until = parseDate(re);
      if (n) rrule += `;COUNT=${n[1]}`;
      else if (until) rrule += allDay ? `;UNTIL=${until.replace(/-/g, "")}` : `;UNTIL=${new Date(localToUtc(tz, until, 23 * 60 + 59)).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`;
      else errors.push(`repeat end “${re}” should be a count (10次) or a date`);
    }
    const untilLabel = rrule.includes(";UNTIL=") ? parseDate(re) : "";
    let rem = parseReminders(s(r.reminder) || defRem);
    if (rem === null) { warns.push(`reminder “${s(r.reminder)}” isn't understood (try 15分钟 / 1小时 / 1天)`); rem = []; }
    return { row: i, errors, warns, ev: { title, date, endDate, start, end, allDay, location: s(r.location), desc: s(r.desc), reminders: rem, rrule, category: s(r.category), url: s(r.url), until: untilLabel } };
  });
}

function listHtml(p: Project, items: { ev: Ev }[]): string {
  const sorted = [...items].sort((a, b) => (a.ev.date + (a.ev.allDay ? "" : a.ev.start)).localeCompare(b.ev.date + (b.ev.allDay ? "" : b.ev.start)));
  const months = new Map<string, Ev[]>();
  for (const { ev } of sorted) { const k = ev.date.slice(0, 7); months.set(k, [...(months.get(k) ?? []), ev]); }
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  const rep = (r: string, until?: string) => r ? r.replace(/FREQ=DAILY/, "每天").replace(/FREQ=WEEKLY/, "每周").replace(/FREQ=MONTHLY/, "每月").replace(/FREQ=YEARLY/, "每年").replace(/;INTERVAL=(\d+)/, "（间隔 $1）").replace(/;BYDAY=([A-Z,]+)/, (_, d: string) => ` ${d.split(",").map((x) => ({ MO: "一", TU: "二", WE: "三", TH: "四", FR: "五", SA: "六", SU: "日" })[x]).join("")}`).replace(/;COUNT=(\d+)/, "，共 $1 次").replace(/;UNTIL=\S*/, until ? `，至 ${until}` : "") : "";
  const name = s(p.settings.calName) || "日程";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>
body{font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;max-width:820px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}.tz{color:#6b7280;font-size:12px;margin-bottom:12px}
h2{font-size:15px;color:#4338ca;border-bottom:2px solid #c7d2fe;padding-bottom:4px;margin:22px 0 6px}table{border-collapse:collapse;width:100%}td{padding:6px 8px;border-bottom:1px solid #eef2f7;vertical-align:top}
.d{white-space:nowrap;width:88px;font-weight:600}.t{white-space:nowrap;width:96px;color:#4b5563}.n{font-weight:600}.m{color:#6b7280;font-size:12px}.tag{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:4px;padding:0 6px;font-size:11px;margin-left:6px}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
<h1>${esc(name)}</h1><div class="tz">时区 Time zone: ${esc(tzOf(p))} · ${items.length} 项</div>
${[...months].map(([m, evs]) => `<h2>${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月</h2><table>${evs.map((e) => `<tr><td class="d">${e.date.slice(5).replace("-", "/")} 周${WD[new Date(`${e.date}T00:00:00Z`).getUTCDay()]}${e.endDate && e.endDate !== e.date ? `<div class="m">至 ${e.endDate.slice(5).replace("-", "/")}</div>` : ""}</td><td class="t">${e.allDay ? "全天" : `${e.start}–${e.end}`}</td><td><span class="n">${esc(e.title)}</span>${e.category ? `<span class="tag">${esc(e.category)}</span>` : ""}${e.rrule ? `<span class="tag">↻ ${esc(rep(e.rrule, e.until))}</span>` : ""}${e.location ? `<div class="m">📍 ${esc(e.location)}</div>` : ""}${e.desc ? `<div class="m">${esc(e.desc)}</div>` : ""}</td></tr>`).join("")}</table>`).join("\n")}
</body></html>
`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "ics",
  title: ["表格转日历", "Calendar File Builder"],
  openDescription:
    "Turn an event sheet (CSV/XLSX with columns such as 标题/title, 日期/date, 开始/start, 结束/end, 结束日期/end date, 全天/all day, 地点/location, 说明/description, 重复/repeat, 重复截止/repeat until or count, 提醒/reminder, 分类/category) into a standard .ics calendar file that Apple Calendar, Google Calendar, Outlook and phones can import. Handles time zones (proper VTIMEZONE incl. daylight saving), all-day and multi-day events, events past midnight, reminders (15分钟 / 1小时 / 1天 …), and repeats (每天 / 每周 / 每两周 / 每周一三五 / 工作日 / 每月 / 每年 / weekly …, with a count or end date). Also exports one .ics per event and a printable schedule page.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择活动 / 日程表", "Pick the event sheet"] },
  settings: [
    { key: "calName", label: ["日历名称", "Calendar name"], type: "text", default: "" },
    { key: "timezone", label: ["时区（IANA，如 Asia/Shanghai）", "Time zone (IANA, e.g. Asia/Shanghai)"], type: "text", default: "Asia/Shanghai" },
    { key: "duration", label: ["没写结束时间时的时长（分钟）", "Length when no end time (min)"], type: "number", default: 60 },
    { key: "reminder", label: ["默认提醒（如 15分钟, 1天）", "Default reminder (e.g. 15 min, 1 day)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["导出", "Export"], type: "bool" },
    { key: "title", label: ["标题", "Title"] },
    { key: "date", label: ["日期", "Date"] },
    { key: "start", label: ["开始", "Start"] },
    { key: "end", label: ["结束", "End"] },
    { key: "endDate", label: ["结束日期", "End date"] },
    { key: "allDay", label: ["全天", "All day"], type: "bool" },
    { key: "location", label: ["地点", "Location"] },
    { key: "repeat", label: ["重复", "Repeat"] },
    { key: "repeatEnd", label: ["重复截止/次数", "Repeat until/count"] },
    { key: "reminder", label: ["提醒", "Reminder"] },
    { key: "category", label: ["分类", "Category"] },
    { key: "desc", label: ["说明", "Notes"], wide: true },
  ],
  newRow: () => ({ include: true, title: "", date: "", start: "", end: "", endDate: "", allDay: false, location: "", repeat: "", repeatEnd: "", reminder: "", category: "", desc: "" }),
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { title: ["标题", "名称", "事项", "活动", "主题", "title", "event", "subject", "summary"], date: ["日期", "开始日期", "date", "start date", "day"], start: ["开始", "开始时间", "时间", "start", "start time", "time", "from"], end: ["结束", "结束时间", "end", "end time", "to", "until"], endDate: ["结束日期", "end date", "截止日期"], allDay: ["全天", "all day", "allday"], location: ["地点", "地址", "location", "place", "venue", "where"], desc: ["说明", "备注", "描述", "详情", "description", "notes", "details"], repeat: ["重复", "频率", "repeat", "recurrence", "frequency"], repeatEnd: ["重复截止", "重复次数", "截止", "repeat until", "count", "repeat end"], reminder: ["提醒", "提前提醒", "reminder", "alert", "alarm"], category: ["分类", "类别", "category", "type", "tag"], url: ["链接", "网址", "url", "link"] });
    // “结束”可能误配到“结束日期”列（“开始”同理）
    for (const k of ["start", "end"] as const) if (m[k] && /日期|date/i.test(m[k]!)) { if (k === "end" && !m.endDate) m.endDate = m[k]; if (m[k] === m.date || k === "end" || m[k] === m.endDate) m[k] = undefined; }
    if (!m.title || !m.date) throw new KitError("no_columns", `Need a title (标题/title) and a date (日期/date) column. Columns: ${t.columns.join(", ")}`);
    const g = (r: Record<string, unknown>, k?: string) => (k ? s(r[k]) : "");
    const rows: Row[] = t.rows.filter((r) => g(r, m.title)).map((r) => {
      let start = g(r, m.start), end = g(r, m.end);
      const range = /(\d{1,2}[:：]\d{2})\s*[-–~～至到]\s*(\d{1,2}[:：]\d{2})/.exec(start);
      if (range) { start = range[1]; end = end || range[2]; }
      const d = g(r, m.date);
      if (!start && /\d{1,2}:\d{2}/.test(d)) start = time(d);
      return { include: true, title: g(r, m.title), date: parseDate(d) || d, start: time(start), end: time(end), endDate: parseDate(g(r, m.endDate)), allDay: yes(g(r, m.allDay)) || (!time(start) && !!parseDate(d)), location: g(r, m.location), repeat: g(r, m.repeat), repeatEnd: g(r, m.repeatEnd), reminder: g(r, m.reminder), category: g(r, m.category), desc: g(r, m.desc), url: g(r, m.url) };
    });
    if (!s(settings.calName)) settings.calName = files[0].split("/").pop()!.replace(/\.[^.]+$/, "");
    return { rows };
  },
  compute(p) {
    const issues: Issue[] = [];
    if (!validTz(tzOf(p))) issues.push({ level: "error", key: "timezone", message: `Unknown time zone “${tzOf(p)}” — use an IANA name such as Asia/Shanghai or America/New_York.` });
    const items = eventsOf(p);
    for (const it of items) {
      for (const e of it.errors) issues.push({ level: "error", row: it.row, message: `${it.ev.title || `Row ${it.row + 1}`}: ${e}.` });
      for (const w of it.warns) issues.push({ level: "warn", row: it.row, message: `${it.ev.title}: ${w}.` });
    }
    const ok = items.filter((x) => !x.errors.length);
    const allDay = ok.filter((x) => x.ev.allDay).length, rep = ok.filter((x) => x.ev.rrule).length, rem = ok.filter((x) => x.ev.reminders.length).length;
    const html = validTz(tzOf(p)) ? listHtml(p, ok) : "";
    const preview = html ? `<iframe sandbox="" style="width:100%;height:560px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>` : "";
    return { rows: p.rows, issues, preview, summary: `${ok.length} events · ${allDay} all-day · ${rep} repeating · ${rem} with reminders · ${tzOf(p)}`, stats: { events: ok.length, allDay, repeating: rep, reminders: rem } };
  },
  exports: [
    {
      id: "ics", label: ["日历文件 .ics", "Calendar file (.ics)"], description: "calendar.ics — all events in one file to import",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write(`${safeFileName(s(project.settings.calName), "calendar")}.ics`, buildIcs(eventsOf(project).map((x) => x.ev), { calName: s(project.settings.calName), tz: tzOf(project) }))];
      },
    },
    {
      id: "each", label: ["每个活动一个 .ics", "One .ics per event"], description: "events/<date>-<title>.ics — to attach to an email or message",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first.");
        const out: string[] = [];
        const used = new Set<string>();
        for (const { ev } of eventsOf(project)) {
          let f = `${ev.date}-${safeFileName(ev.title, "event")}`;
          for (let i = 2; used.has(f); i++) f = `${ev.date}-${safeFileName(ev.title, "event")}-${i}`;
          used.add(f);
          out.push(await write(`events/${f}.ics`, buildIcs([ev], { calName: s(project.settings.calName), tz: tzOf(project) })));
        }
        return out;
      },
    },
    {
      id: "list", label: ["可打印日程表", "Printable schedule"], description: "schedule.html — events by month, ready to print",
      async run({ project, write }: ExportCtx) {
        return [await write("schedule.html", listHtml(project, eventsOf(project).filter((x) => !x.errors.length)))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
