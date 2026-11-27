import ExcelJS from "exceljs";
import type { PDFPage } from "pdf-lib";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { hm, parseClock, parseDate, parseHours, parseRates, rateFor, roundHours, ROUNDINGS, type Rounding } from "./time.ts";

export const NAME = "timesheet-report";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".csv", ".tsv", ".xlsx"];
const r2 = (n: number) => Math.round(n * 100) / 100;

const ALIASES: Record<string, RegExp> = {
  date: /^(日期|工作日期|开始日期|date|day|start date|work date)$/i,
  client: /^(客户|客户名称|甲方|client|customer|account)$/i,
  project: /^(项目|项目名称|project)$/i,
  task: /^(任务|描述|内容|工作内容|事项|description|task|activity|notes?|备注)$/i,
  person: /^(成员|姓名|人员|员工|负责人|user|member|person|name|employee|staff)$/i,
  start: /^(开始|开始时间|起|start|start time|from|in)$/i,
  end: /^(结束|结束时间|止|end|end time|to|out)$/i,
  hours: /^(工时|小时|小时数|时长|用时|hours|duration|time|h|duration \(h\)|hours worked)$/i,
  billable: /^(计费|可计费|收费|是否计费|billable|bill)$/i,
  rate: /^(费率|单价|时薪|rate|hourly rate|billable rate)$/i,
};
const NO = /^(否|不计费|不收费|免费|n|no|false|0|non-?billable|×|✗)$/i;

async function readLog(ws: Workspace, path: string): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  if (!path.toLowerCase().endsWith(".xlsx")) return readTable(ws, path);
  // 自己读 xlsx：Excel 的时刻单元格是 1899-12-30 的日期，需要保留时分
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await ws.read(path, 50 * 1024 * 1024)) as unknown as ArrayBuffer);
  const sh = book.worksheets.find((w) => w.actualRowCount > 0) ?? book.worksheets[0];
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) {
      const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`, d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
      return v.getUTCFullYear() < 1901 ? t : t === "00:00" ? d : `${d} ${t}`;
    }
    if (typeof v === "object") { if ("richText" in v) return v.richText.map((x) => x.text).join(""); if ("text" in v) return String(v.text); if ("result" in v) return text(v.result as ExcelJS.CellValue); return ""; }
    return String(v);
  };
  const matrix: string[][] = [];
  sh?.eachRow({ includeEmpty: false }, (row) => { const c: string[] = []; for (let i = 1; i <= sh.columnCount; i++) c.push(text(row.getCell(i).value).trim()); if (c.some(Boolean)) matrix.push(c); });
  if (!matrix.length) throw new KitError("empty_table", `${path} has no rows.`);
  const columns = matrix[0].map((c, i) => c || `列${i + 1}`);
  return { columns, rows: matrix.slice(1).map((c) => Object.fromEntries(columns.map((k, i) => [k, c[i] ?? ""]))) };
}

type Line = { i: number; row: Row; date: string; client: string; project: string; task: string; person: string; hours: number; billed: number; billable: boolean; rate: number; rateFrom: string; amount: number; inPeriod: boolean };

function lang(p: Pick<Project, "settings" | "meta">) { const l = s(p.settings.lang); return l === "en" ? "en" : l === "zh" ? "zh" : (p.meta as { cjk?: boolean }).cjk ? "zh" : "en"; }

function lines(p: Pick<Project, "rows" | "settings">): Line[] {
  const rules = parseRates(s(p.settings.rates)).rules;
  const fallback = Number(p.settings.defaultRate ?? 0) || 0;
  const mode = (s(p.settings.rounding) || "up15") as Rounding;
  const from = s(p.settings.from), to = s(p.settings.to);
  return p.rows.map((row, i) => {
    const e = { client: s(row.client), project: s(row.project), person: s(row.person) };
    const hours = Number(row.hours) || 0;
    const billable = row.billable !== false;
    const own = s(row.rate) !== "" && Number.isFinite(Number(row.rate));
    const rr = own ? { rate: Number(row.rate), from: "row" } : rateFor(rules, e, fallback);
    const billed = roundHours(hours, mode);
    const date = s(row.date);
    const inPeriod = (!from || date >= from) && (!to || date <= to);
    return { i, row, date, ...e, task: s(row.task), hours, billed, billable, rate: rr.rate, rateFrom: rr.from, amount: billable ? r2(billed * rr.rate) : 0, inPeriod };
  });
}

type Group = { client: string; project: string; billH: number; nonH: number; billedH: number; amount: number; rates: Set<number> };
function groups(ls: Line[]) {
  const map = new Map<string, Group>();
  for (const l of ls) {
    if (!l.inPeriod) continue;
    const k = `${l.client}\u0000${l.project}`;
    let g = map.get(k);
    if (!g) map.set(k, (g = { client: l.client, project: l.project, billH: 0, nonH: 0, billedH: 0, amount: 0, rates: new Set() }));
    if (l.billable) { g.billH += l.hours; g.billedH += l.billed; g.amount += l.amount; g.rates.add(l.rate); } else g.nonH += l.hours;
  }
  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client, "zh") || a.project.localeCompare(b.project, "zh"));
}

export function money(n: number, cur: string) { return `${cur}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
const L = {
  zh: { title: "工时结算单", no: "编号", from: "开具方", to: "客户", period: "期间", date: "日期", task: "工作内容", person: "成员", hours: "工时", rate: "费率", amount: "金额", subtotal: "小计", tax: "税", total: "合计", billable: "计费工时", nonbill: "不计费", page: "页", notCharged: "不收费" },
  en: { title: "Timesheet statement", no: "No.", from: "From", to: "Client", period: "Period", date: "Date", task: "Work", person: "Person", hours: "Hours", rate: "Rate", amount: "Amount", subtotal: "Subtotal", tax: "Tax", total: "Total", billable: "Billable hours", nonbill: "Non-billable", page: "Page", notCharged: "not charged" },
};

async function statementPdf(p: Project, client: string, ls: Line[], idx: number) {
  const lg = lang(p), T = L[lg];
  const cur = s(p.settings.currency) || "¥";
  const tax = Number(p.settings.taxRate ?? 0) || 0;
  const detail = s(p.settings.pdfDetail) !== "projects";
  const mine = ls.filter((l) => l.inPeriod && l.client === client).sort((a, b) => a.project.localeCompare(b.project, "zh") || a.date.localeCompare(b.date) || a.i - b.i);
  const dates = mine.map((l) => l.date).filter(Boolean).sort();
  const period = `${s(p.settings.from) || dates[0] || ""} – ${s(p.settings.to) || dates.at(-1) || ""}`;
  const no = `${s(p.settings.statementPrefix) || "ST-"}${(s(p.settings.to) || dates.at(-1) || "").slice(0, 7).replace("-", "")}-${String(idx + 1).padStart(2, "0")}`;
  const kit = await newPdf();
  const [W, H] = PAGE.A4, M = 48;
  const cols = [{ k: "date", w: 62 }, { k: "task", w: 196 }, { k: "person", w: 58 }, { k: "hours", w: 50, r: true }, { k: "rate", w: 60, r: true }, { k: "amount", w: W - 2 * M - 62 - 196 - 58 - 50 - 60, r: true }] as const;
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const head = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: hexRgb("#f3f4f6") });
    for (const c of cols) { kit.text(page, T[c.k as keyof typeof T], "r" in c && c.r ? x + c.w - 4 : x + 4, y, { size: 9, bold: true, align: "r" in c && c.r ? "right" : "left" }); x += c.w; }
    y -= 20;
  };
  const newPage = (withHead: boolean) => { page = kit.doc.addPage([W, H]); pages.push(page); y = H - M; if (pages.length > 1) { kit.text(page, `${T.title} ${no} · ${client}`, M, y, { size: 8, color: "#6b7280" }); y -= 22; } if (withHead) head(); };
  const ensure = (h: number) => { if (y - h < M + 30) newPage(true); };
  newPage(false);
  kit.text(page, T.title, M, y - 6, { size: 20, bold: true });
  kit.text(page, `${T.no} ${no}`, W - M, y - 2, { size: 10, align: "right", color: "#374151" });
  y -= 40;
  const info: [string, string][] = [[T.from, s(p.settings.yourName) || "—"], [T.to, client || "—"], [T.period, period]];
  for (const [k, v] of info) { kit.text(page, k, M, y, { size: 9, color: "#6b7280" }); kit.text(page, v, M + 60, y, { size: 10, bold: k === T.to }); y -= 15; }
  y -= 12;
  head();
  const projects = [...new Set(mine.map((l) => l.project))];
  let total = 0, billH = 0, nonH = 0;
  for (const pr of projects) {
    const items = mine.filter((l) => l.project === pr);
    ensure(40);
    kit.text(page, pr || "—", M + 4, y, { size: 10, bold: true, color: "#1d4ed8" });
    y -= 16;
    if (detail) for (const l of items) {
      const taskLines = kit.wrap(l.task, 9, cols[1].w - 8).slice(0, 3);
      ensure(taskLines.length * 11 + 6);
      const grey = l.billable ? "#111827" : "#9ca3af";
      let x = M;
      const vals = [l.date, "", l.person, hm(l.billed), l.billable ? money(l.rate, cur) : T.nonbill, l.billable ? money(l.amount, cur) : T.notCharged];
      cols.forEach((c, ci) => {
        if (ci === 1) taskLines.forEach((t, k) => kit.text(page, t, x + 4, y - k * 11, { size: 9, color: grey }));
        else kit.text(page, vals[ci], "r" in c && c.r ? x + c.w - 4 : x + 4, y, { size: 9, color: grey, align: "r" in c && c.r ? "right" : "left", maxWidth: c.w - 8 });
        x += c.w;
      });
      const ly = y - (taskLines.length - 1) * 11 - 4;
      page.drawLine({ start: { x: M, y: ly }, end: { x: W - M, y: ly }, thickness: 0.3, color: hexRgb("#e5e7eb") });
      y -= taskLines.length * 11 + 6;
    }
    const bh = items.filter((l) => l.billable).reduce((a, l) => a + l.billed, 0), nh = items.filter((l) => !l.billable).reduce((a, l) => a + l.hours, 0), amt = items.reduce((a, l) => a + l.amount, 0);
    total += amt; billH += bh; nonH += nh;
    ensure(18);
    kit.text(page, `${T.subtotal}${nh ? `（${T.nonbill} ${hm(nh)}）` : ""}`, M + 4 + cols[0].w, y, { size: 9, bold: true });
    const xh = M + cols[0].w + cols[1].w + cols[2].w;
    kit.text(page, hm(bh), xh + cols[3].w - 4, y, { size: 9, bold: true, align: "right" });
    kit.text(page, money(amt, cur), W - M - 4, y, { size: 9, bold: true, align: "right" });
    y -= 22;
  }
  ensure(80);
  const box: [string, string, boolean][] = [[T.billable, hm(billH), false], [T.subtotal, money(r2(total), cur), false]];
  if (tax) box.push([`${T.tax} ${tax}%`, money(r2((total * tax) / 100), cur), false]);
  box.push([T.total, money(r2(total * (1 + tax / 100)), cur), true]);
  if (nonH) box.splice(1, 0, [T.nonbill, hm(nonH), false]);
  for (const [k, v, b] of box) { kit.text(page, k, W - M - 200, y, { size: b ? 12 : 10, bold: b }); kit.text(page, v, W - M - 4, y, { size: b ? 12 : 10, bold: b, align: "right" }); y -= b ? 20 : 15; }
  const terms = s(p.settings.terms);
  if (terms) { y -= 10; for (const t of kit.wrap(terms, 9, W - 2 * M)) { ensure(12); kit.text(page, t, M, y, { size: 9, color: "#374151" }); y -= 12; } }
  pages.forEach((pg, i) => kit.text(pg, `${i + 1} / ${pages.length}`, W / 2, 24, { size: 8, align: "center", color: "#9ca3af" }));
  return { bytes: await kit.doc.save(), total: r2(total * (1 + tax / 100)), no };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "timesheet",
  title: ["工时统计", "Timesheet Report"],
  openDescription:
    "Summarise time logs (CSV/TSV/XLSX exports from any time tracker or a hand-kept sheet) by client and project into billable statements. Columns are found by name in Chinese or English: date, client, project, task/description, person, hours (1.5, 1:30, 1h30m, 90m, 1小时30分) or start/end times (overnight works), billable (是/否/yes/no) and rate. One row per entry: date, client, project, task, person, hours, billable, rate (empty = from the rate table), plus billed hours after rounding, amount and notes. Settings: currency, defaultRate, rates (lines 'Client = 300', 'Client/Project = 360', '@Person = 200', '* = 100'; most specific wins), rounding (none, up to 6/15/30/60 min, nearest 15 — per entry), from/to (period), nonBillable (keywords in client/project/task that make an entry non-billable), taxRate %, yourName, terms, statementPrefix, pdfDetail (entries/projects), lang. Flags duplicates, overlapping start/end times, entries over 12 h, missing dates/hours and billable work with no rate. Exports timesheet.xlsx (entries, by client & project, by person), one statement PDF per client, and summary.csv.",
  inputs: { exts: EXTS, min: 1, max: 20, folders: true, label: ["选择工时记录（CSV / Excel）", "Pick time logs (CSV / Excel)"] },
  settings: [
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
    { key: "defaultRate", label: ["默认费率（每小时）", "Default hourly rate"], type: "number", default: 0, min: 0 },
    { key: "rates", label: ["费率表（每行 客户 = 300、客户/项目 = 360、@成员 = 200）", "Rates (one per line: Client = 300, Client/Project = 360, @Person = 200)"], type: "textarea", default: "" },
    { key: "rounding", label: ["每条记录取整", "Rounding per entry"], type: "select", default: "up15", options: ROUNDINGS.map((r) => ({ value: r.value, label: [r.zh, r.en] as [string, string] })) },
    { key: "from", label: ["开始日期", "From"], type: "date", default: "" },
    { key: "to", label: ["结束日期", "To"], type: "date", default: "" },
    { key: "nonBillable", label: ["不计费关键词（逗号分隔）", "Non-billable keywords (comma-separated)"], type: "text", default: "内部, 不收费, internal, non-billable", reload: true },
    { key: "taxRate", label: ["税率 %", "Tax %"], type: "number", default: 0, min: 0, max: 100 },
    { key: "yourName", label: ["开具方（你的名字或公司）", "Your name or company"], type: "text", default: "" },
    { key: "terms", label: ["结算单备注（付款方式等）", "Statement note (payment terms…)"], type: "textarea", default: "" },
    { key: "statementPrefix", label: ["结算单编号前缀", "Statement number prefix"], type: "text", default: "ST-" },
    { key: "pdfDetail", label: ["结算单明细", "Statement detail"], type: "select", default: "entries", options: [{ value: "entries", label: ["逐条列出", "Every entry"] }, { value: "projects", label: ["只列项目小计", "Project totals only"] }] },
    { key: "lang", label: ["语言", "Language"], type: "select", default: "auto", options: [{ value: "auto", label: ["自动", "Auto"] }, { value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }] },
  ],
  columns: () => [
    { key: "date", label: ["日期", "Date"], type: "date" },
    { key: "client", label: ["客户", "Client"] },
    { key: "project", label: ["项目", "Project"] },
    { key: "task", label: ["任务", "Task"], wide: true },
    { key: "person", label: ["成员", "Person"] },
    { key: "hours", label: ["工时", "Hours"], type: "number" },
    { key: "billable", label: ["计费", "Billable"], type: "bool" },
    { key: "rate", label: ["费率", "Rate"] },
    { key: "billed", label: ["取整后", "Billed"], readOnly: true },
    { key: "amount", label: ["金额", "Amount"], readOnly: true },
    { key: "notes", label: ["说明", "Notes"], readOnly: true },
  ] as Column[],
  newRow: () => ({ date: "", client: "", project: "", task: "", person: "", hours: 0, billable: true, rate: "", _key: "" }),
  async load({ ws, files, settings, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 200 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", "No .csv/.tsv/.xlsx time logs found.");
    const kw = s(settings.nonBillable).split(/[,，、;；]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const prev = new Map((previous ?? []).map((r) => [s(r._key), r]));
    const rows: Row[] = [];
    let cjk = false;
    for (const f of uniq) {
      const t = await readLog(ws, f);
      const col: Record<string, string | undefined> = {};
      for (const [k, re] of Object.entries(ALIASES)) col[k] = t.columns.find((c) => re.test(c.trim()));
      if (!col.hours && !(col.start && col.end)) throw new KitError("no_hours", `${f}: no hours column (工时/Hours/Duration) or start+end columns. Columns: ${t.columns.join(", ")}`);
      t.rows.forEach((r, n) => {
        const g = (k: string) => (col[k] ? s(r[col[k]!]) : "");
        if (!Object.values(r).some((v) => s(v))) return;
        cjk ||= /[\u4e00-\u9fff]/.test(Object.values(r).join(""));
        const rawDate = g("date") || g("start");
        let hours = parseHours(g("hours"));
        let note = "";
        if (hours === null && col.start && col.end) {
          const a = parseClock(g("start")), b = parseClock(g("end"));
          if (a !== null && b !== null) { hours = ((b - a + 1440) % 1440) / 60; if (b < a) note = "overnight 跨天"; }
        }
        const text = `${g("client")} ${g("project")} ${g("task")}`.toLowerCase();
        const b = g("billable");
        let billable = NO.test(b) ? false : true;
        if (kw.some((k) => text.includes(k))) { billable = false; note = note ? `${note}; ` : ""; note += "non-billable keyword 关键词不计费"; }
        const key = `${f}:${n + 2}`;
        const row: Row = { date: parseDate(rawDate), client: g("client"), project: g("project"), task: g("task"), person: g("person"), hours: hours === null ? 0 : Math.round(hours * 10000) / 10000, billable, rate: g("rate").replace(/[^\d.]/g, ""), _key: key, _raw: g("hours") || `${g("start")}–${g("end")}`, _note: note, _start: col.start ? parseClock(g("start")) : null, _end: col.end ? parseClock(g("end")) : null, _bad: hours === null };
        const o = prev.get(key);
        if (o) for (const k of ["date", "client", "project", "task", "person", "hours", "billable", "rate"]) row[k] = o[k];
        rows.push(row);
      });
    }
    for (const o of previous ?? []) if (!s(o._key)) rows.push(o);
    if (!rows.length) throw new KitError("empty", "No time entries found.");
    return { rows, meta: { files: uniq, cjk } };
  },
  compute(p): Computed {
    const ls = lines(p);
    const cur = s(p.settings.currency) || "¥";
    const issues: Issue[] = [];
    const { bad } = parseRates(s(p.settings.rates));
    if (bad.length) issues.push({ level: "error", key: "rates", message: `Rates line ${bad.join(", ")} isn't “name = number” / 费率表格式应为 名称 = 数字` });
    const seen = new Map<string, number>();
    const noRate = new Map<string, number[]>();
    let outside = 0;
    for (const l of ls) {
      if (!l.inPeriod) { outside++; continue; }
      if (!l.date) issues.push({ level: "error", row: l.i, key: "date", message: `Row ${l.i}: no date / 缺少日期` });
      if (l.row._bad === true && !l.hours) issues.push({ level: "error", row: l.i, key: "hours", message: `Row ${l.i}: can't read hours “${s(l.row._raw)}” / 工时无法识别` });
      else if (l.hours <= 0) issues.push({ level: "error", row: l.i, key: "hours", message: `Row ${l.i}: hours must be more than 0 / 工时必须大于 0` });
      else if (l.hours > 12) issues.push({ level: "warn", row: l.i, key: "hours", message: `Row ${l.i}: ${hm(l.hours)} in one entry — check the start/end / 单条超过 12 小时` });
      const k = [l.date, l.person, l.client, l.project, l.task, l.hours].join("|");
      if (seen.has(k)) issues.push({ level: "warn", row: l.i, message: `Row ${l.i} looks like a duplicate of row ${seen.get(k)} / 疑似重复记录` });
      else seen.set(k, l.i);
      if (l.billable && !l.rate) { const g = `${l.client}/${l.project}`; noRate.set(g, [...(noRate.get(g) ?? []), l.i]); }
    }
    for (const [g, rs] of noRate) issues.push({ level: "warn", row: rs[0], key: "rate", message: `${g}: ${rs.length} billable entr${rs.length > 1 ? "ies have" : "y has"} no rate — add “${g.split("/")[0]} = …” to rates / 没有费率` });
    // 同一人同一天时间段重叠
    const byDay = new Map<string, Line[]>();
    for (const l of ls) if (l.inPeriod && typeof l.row._start === "number" && typeof l.row._end === "number") { const k = `${l.person}|${l.date}`; byDay.set(k, [...(byDay.get(k) ?? []), l]); }
    for (const xs of byDay.values()) {
      const iv = xs.map((l) => { const a = l.row._start as number; let b = l.row._end as number; if (b < a) b += 1440; return { l, a, b }; }).sort((x, y) => x.a - y.a);
      for (let k = 1; k < iv.length; k++) if (iv[k].a < iv[k - 1].b) issues.push({ level: "warn", row: iv[k].l.i, message: `Row ${iv[k].l.i} overlaps row ${iv[k - 1].l.i} (${iv[k].l.person}, ${iv[k].l.date}) / 时间段重叠` });
    }
    if (outside) issues.push({ level: "info", message: `${outside} entr${outside > 1 ? "ies" : "y"} outside ${s(p.settings.from) || "…"} – ${s(p.settings.to) || "…"} left out / 不在期间内，未计入` });
    const gs = groups(ls);
    const inP = ls.filter((l) => l.inPeriod);
    const tot = { hours: inP.reduce((a, l) => a + l.hours, 0), bill: inP.filter((l) => l.billable).reduce((a, l) => a + l.billed, 0), amount: r2(inP.reduce((a, l) => a + l.amount, 0)) };
    const rows = ls.map((l) => ({ ...l.row, billed: l.inPeriod ? hm(l.billed) : "—", amount: l.inPeriod ? (l.billable ? money(l.amount, cur) : "—") : "—", notes: [!l.inPeriod ? "outside period 不在期间" : "", s(l.row._note), l.billable && l.rateFrom && l.rateFrom !== "row" ? `rate ${l.rateFrom}` : ""].filter(Boolean).join("; ") }));
    const clients = [...new Set(gs.filter((g) => g.amount > 0 || g.billH > 0).map((g) => g.client))];
    const people = [...new Set(inP.map((l) => l.person))].map((pn) => { const xs = inP.filter((l) => l.person === pn); const h = xs.reduce((a, l) => a + l.hours, 0), b = xs.filter((l) => l.billable).reduce((a, l) => a + l.hours, 0); return { pn, h, pct: h ? Math.round((b / h) * 100) : 0 }; });
    const preview = `<table class="data"><tr><th>客户 Client</th><th>项目 Project</th><th>计费 Billable</th><th>不计费 Non-bill</th><th>取整 Billed</th><th>金额 Amount</th></tr>${gs.map((g) => `<tr><td>${esc(g.client)}</td><td>${esc(g.project)}</td><td>${hm(g.billH)}</td><td>${g.nonH ? hm(g.nonH) : ""}</td><td>${hm(g.billedH)}</td><td style="text-align:right">${g.amount ? money(r2(g.amount), cur) : `<span class="muted">—</span>`}</td></tr>`).join("")}<tr style="font-weight:600"><td colspan="4">Total 合计</td><td>${hm(tot.bill)}</td><td style="text-align:right">${money(tot.amount, cur)}</td></tr></table><p class="muted" style="margin-top:8px">${people.map((x) => `${esc(x.pn || "—")}: ${hm(x.h)} (${x.pct}% billable)`).join(" · ")}</p>`;
    return {
      rows,
      issues,
      summary: `${inP.length} entr${inP.length === 1 ? "y" : "ies"}, ${hm(tot.hours)} logged, ${hm(tot.bill)} billable after rounding = ${money(tot.amount, cur)} across ${clients.length} client(s). 共 ${inP.length} 条，计费 ${hm(tot.bill)}，金额 ${money(tot.amount, cur)}。`,
      stats: { entries: inP.length, hours: r2(tot.hours), billedHours: r2(tot.bill), amount: tot.amount, clients: clients.length, outside },
      preview,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel 汇总", "Excel workbook"], description: "timesheet.xlsx — Entries, By client & project, By person",
      async run({ project, write }: ExportCtx) {
        const ls = lines(project).filter((l) => l.inPeriod), gs = groups(ls);
        const people = [...new Set(ls.map((l) => l.person))].map((pn) => { const xs = ls.filter((l) => l.person === pn); return [pn, r2(xs.reduce((a, l) => a + l.hours, 0)), r2(xs.filter((l) => l.billable).reduce((a, l) => a + l.hours, 0)), r2(xs.filter((l) => !l.billable).reduce((a, l) => a + l.hours, 0)), r2(xs.reduce((a, l) => a + l.amount, 0))]; });
        const buf = await writeXlsx([
          { name: "Entries", headers: ["Date", "Client", "Project", "Task", "Person", "Hours", "Billed hours", "Billable", "Rate", "Amount"], rows: ls.map((l) => [l.date, l.client, l.project, l.task, l.person, r2(l.hours), l.billed, l.billable ? "yes" : "no", l.rate, l.amount]), numberFormat: { 5: "0.00", 6: "0.00", 8: "#,##0.00", 9: "#,##0.00" } },
          { name: "By client & project", headers: ["Client", "Project", "Billable hours", "Non-billable hours", "Billed hours", "Rate(s)", "Amount"], rows: [...gs.map((g) => [g.client, g.project, r2(g.billH), r2(g.nonH), r2(g.billedH), [...g.rates].join(" / "), r2(g.amount)]), ["Total", "", r2(gs.reduce((a, g) => a + g.billH, 0)), r2(gs.reduce((a, g) => a + g.nonH, 0)), r2(gs.reduce((a, g) => a + g.billedH, 0)), "", r2(gs.reduce((a, g) => a + g.amount, 0))]], numberFormat: { 2: "0.00", 3: "0.00", 4: "0.00", 6: "#,##0.00" } },
          { name: "By person", headers: ["Person", "Hours", "Billable hours", "Non-billable hours", "Amount"], rows: people, numberFormat: { 1: "0.00", 2: "0.00", 3: "0.00", 4: "#,##0.00" } },
        ]);
        return [await write("timesheet.xlsx", buf)];
      },
    },
    {
      id: "pdf", label: ["结算单 PDF", "Statement PDFs"], description: "statements/<client>.pdf — one statement per client with billable work: entries grouped by project, subtotals, tax and total",
      async run({ project, write }: ExportCtx) {
        const ls = lines(project);
        const clients = [...new Set(groups(ls).filter((g) => g.billH > 0).map((g) => g.client))];
        if (!clients.length) throw new KitError("nothing", "No billable entries in the period.");
        const out: string[] = [], notes: string[] = [];
        for (const [i, c] of clients.entries()) {
          const st = await statementPdf(project, c, ls, i);
          out.push(await write(`statements/${(c || "client").replace(/[\\/:*?"<>|]/g, "_")}.pdf`, st.bytes));
          notes.push(`${st.no} ${c}: ${money(st.total, s(project.settings.currency) || "¥")}`);
        }
        return { files: out, note: notes.join("; ") };
      },
    },
    {
      id: "csv", label: ["汇总 CSV", "Summary (CSV)"], description: "summary.csv — client, project, billable/non-billable/billed hours, rate(s), amount",
      async run({ project, write }: ExportCtx) {
        const gs = groups(lines(project));
        return [await write("summary.csv", toCsv(["client", "project", "billable_hours", "non_billable_hours", "billed_hours", "rates", "amount"], gs.map((g) => [g.client, g.project, r2(g.billH), r2(g.nonH), r2(g.billedH), [...g.rates].join(" / "), r2(g.amount)])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.date)} ${s(r.client)}/${s(r.project)} ${s(r.task)} (${s(r.person)}) ${s(r.hours)}h${r.billable === false ? " non-billable" : ""}${s(r.rate) ? ` @${s(r.rate)}` : ""} → ${s(r.billed)} ${s(r.amount)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
