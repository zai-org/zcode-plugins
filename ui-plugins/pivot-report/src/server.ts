import { createApp, esc, toCsv, type AppDef, type Column, type Issue, type Project } from "./kit/app.ts";
import { num } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { pivot, type Agg, type DateGroup, type Pivot, type PivotSpec } from "./pivot.ts";

export const NAME = "pivot-report";
export const VERSION = "0.1.0";
const AGG_ZH: Record<Agg, string> = { sum: "合计", count: "计数", avg: "平均", min: "最小", max: "最大", distinct: "不重复计数" };

interface Meta { headers: string[]; numeric: boolean[]; dates: boolean[] }
const metaOf = (p: Project) => p.meta as unknown as Meta;
const data = (p: Project) => p.rows.map((r) => metaOf(p).headers.map((_, i) => String(r[`c${i}`] ?? "")));
const idx = (p: Project, name: unknown) => metaOf(p).headers.indexOf(String(name ?? "").trim());

function spec(p: Project): { s: PivotSpec; errors: string[] } {
  const m = metaOf(p);
  const errors: string[] = [];
  const rows = String(p.settings.rows ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean).map((n) => { const i = m.headers.indexOf(n); if (i < 0) errors.push(`Row field “${n}” is not a column`); return i; }).filter((i) => i >= 0);
  const col = String(p.settings.col ?? "").trim() ? idx(p, p.settings.col) : -1;
  if (String(p.settings.col ?? "").trim() && col < 0) errors.push(`Column field “${p.settings.col}” is not a column`);
  const agg = (p.settings.agg as Agg) ?? "sum";
  const value = String(p.settings.value ?? "").trim() ? idx(p, p.settings.value) : -1;
  if (String(p.settings.value ?? "").trim() && value < 0) errors.push(`Value field “${p.settings.value}” is not a column`);
  if (!rows.length) errors.push("Choose at least one row field");
  if (value < 0 && agg !== "count") errors.push("Choose a value field (or use count)");
  return { s: { rows, col, value, agg, dateGroup: (p.settings.dateGroup as DateGroup) ?? "month", dateCols: new Set(m.dates.map((d, i) => (d ? i : -1)).filter((i) => i >= 0)), topN: Number(p.settings.topN ?? 0), sort: p.settings.sort === "label" ? "label" : "value" }, errors };
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
function pct(p: Project, pv: Pivot, v: number, r: number, c: number) {
  const mode = String(p.settings.percent ?? "none");
  const base = mode === "row" ? pv.rowTotals[r] : mode === "col" ? pv.colTotals[c] : mode === "total" ? pv.total : 0;
  return base ? Math.round((v / base) * 1000) / 10 : undefined;
}
function headerRow(p: Project, pv: Pivot, s: PivotSpec) {
  const m = metaOf(p);
  return [...s.rows.map((i) => m.headers[i]), ...(s.col >= 0 ? pv.colKeys : [`${AGG_ZH[s.agg]} ${s.value >= 0 ? m.headers[s.value] : ""}`.trim()]), ...(s.col >= 0 ? ["总计"] : [])];
}
function matrix(p: Project, pv: Pivot, s: PivotSpec, asText: boolean) {
  const cell = (v: number, r: number, c: number) => { const q = pct(p, pv, v, r, c); return asText ? `${fmt(v)}${q !== undefined ? ` (${q}%)` : ""}` : v; };
  const body = pv.rowKeys.map((k, r) => [...k, ...(s.col >= 0 ? pv.cells[r].map((v, c) => cell(v, r, c)) : [cell(pv.rowTotals[r], r, 0)]), ...(s.col >= 0 ? [asText ? fmt(pv.rowTotals[r]) : pv.rowTotals[r]] : [])]);
  const total = ["总计", ...s.rows.slice(1).map(() => ""), ...(s.col >= 0 ? pv.colTotals.map((v) => (asText ? fmt(v) : v)) : []), asText ? fmt(pv.total) : pv.total];
  return [...body, total];
}
function chart(pv: Pivot) {
  const vals = pv.rowTotals.slice(0, 15);
  const max = Math.max(...vals.map(Math.abs), 1);
  const labels = pv.rowKeys.slice(0, 15).map((k) => k.join(" / "));
  const h = 22 * vals.length + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${h}" font-family="system-ui,sans-serif" font-size="12">${vals.map((v, i) => `<text x="150" y="${i * 22 + 20}" text-anchor="end">${esc(labels[i].slice(0, 22))}</text><rect x="156" y="${i * 22 + 7}" width="${Math.max(1, (Math.abs(v) / max) * 300)}" height="16" rx="2" fill="#4f7cff"/><text x="${162 + (Math.abs(v) / max) * 300}" y="${i * 22 + 20}">${fmt(v)}</text>`).join("")}</svg>`;
}
function table(head: unknown[], rows: unknown[][]) {
  return `<table class="data"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr${i === rows.length - 1 ? ' style="font-weight:600"' : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "pivot",
  title: ["透视汇总报表", "Pivot Report"],
  openDescription:
    "Summarise a CSV/XLSX like an Excel pivot table without Excel: group by one or more row fields (e.g. 门店, 品类), optionally spread a column field across (e.g. 订单日期 by month), and aggregate a value (sum, count, average, min, max, distinct count). Date fields can be grouped by day/week/month/quarter/year; show % of row/column/total; sort by value and keep the top N. Row/value fields are suggested automatically. Export a formatted Excel report (pivot + source data), CSV and an HTML report with a bar chart.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择明细数据表", "Pick the detail table"] },
  settings: [
    { key: "rows", label: ["行（分组字段，逗号分隔）", "Rows (group by, comma-separated)"], type: "text", default: "" },
    { key: "col", label: ["列（可选）", "Columns (optional)"], type: "text", default: "" },
    { key: "value", label: ["值字段", "Value field"], type: "text", default: "" },
    { key: "agg", label: ["汇总方式", "Aggregate"], type: "select", default: "sum", options: (Object.keys(AGG_ZH) as Agg[]).map((a) => ({ value: a, label: [AGG_ZH[a], a] })) },
    { key: "dateGroup", label: ["日期按", "Group dates by"], type: "select", default: "month", options: [{ value: "day", label: ["日", "Day"] }, { value: "week", label: ["周", "Week"] }, { value: "month", label: ["月", "Month"] }, { value: "quarter", label: ["季度", "Quarter"] }, { value: "year", label: ["年", "Year"] }, { value: "none", label: ["不分组", "No grouping"] }] },
    { key: "percent", label: ["显示百分比", "Show percent of"], type: "select", default: "none", options: [{ value: "none", label: ["不显示", "None"] }, { value: "row", label: ["行合计", "Row total"] }, { value: "col", label: ["列合计", "Column total"] }, { value: "total", label: ["总计", "Grand total"] }] },
    { key: "sort", label: ["排序", "Sort rows by"], type: "select", default: "value", options: [{ value: "value", label: ["数值从大到小", "Value, largest first"] }, { value: "label", label: ["名称", "Label"] }] },
    { key: "topN", label: ["只显示前 N 行（0=全部）", "Top N rows (0 = all)"], type: "number", default: 0, min: 0 },
    { key: "title", label: ["报表标题", "Report title"], type: "text", default: "" },
  ],
  columns: (p) => metaOf(p).headers.map((h, i): Column => ({ key: `c${i}`, label: [h, h], type: metaOf(p).numeric[i] ? "number" : "text" })),
  newRow: (p) => Object.fromEntries(metaOf(p).headers.map((_, i) => [`c${i}`, ""])),
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty_table", "The table has no data rows.");
    const headers = t.columns;
    const share = (i: number, f: (v: string) => boolean) => { const v = t.rows.map((r) => r[headers[i]]).filter(Boolean); return v.length ? v.filter(f).length / v.length : 0; };
    const numeric = headers.map((_, i) => share(i, (v) => !isNaN(num(v))) >= 0.9 && share(i, (v) => /^\d{4}-\d{2}-\d{2}/.test(v)) < 0.5);
    const dates = headers.map((_, i) => share(i, (v) => /^\d{4}-\d{2}-\d{2}/.test(v)) >= 0.9);
    const uniq = (i: number) => new Set(t.rows.map((r) => r[headers[i]])).size;
    // 自动建议：行 = 唯一值最少（≥2）的文本列，值 = 名字像金额的数字列或最后一个数字列
    if (!String(settings.rows ?? "").trim()) {
      const cand = headers.map((_, i) => i).filter((i) => !numeric[i] && !dates[i] && uniq(i) >= 2 && uniq(i) <= Math.max(2, t.rows.length / 2)).sort((a, b) => uniq(a) - uniq(b));
      settings.rows = cand.length ? headers[cand[0]] : headers[0];
    }
    if (!String(settings.value ?? "").trim()) {
      const nums = headers.filter((_, i) => numeric[i]);
      settings.value = nums.find((h) => /金额|销售额|amount|revenue|sales|total|合计/i.test(h)) ?? nums[nums.length - 1] ?? "";
      if (!settings.value) settings.agg = "count";
    }
    return { rows: t.rows.map((r) => Object.fromEntries(headers.map((h, i) => [`c${i}`, r[h]]))), meta: { headers, numeric, dates } };
  },
  compute(p) {
    const { s, errors } = spec(p);
    const issues: Issue[] = errors.map((message) => ({ level: "error", key: message.startsWith("Row") || message.startsWith("Choose at") ? "rows" : message.startsWith("Column") ? "col" : "value", message: `${message}. Columns: ${metaOf(p).headers.join(", ")}` }));
    if (errors.length) return { issues, summary: "Fix the pivot fields", preview: "" };
    if (s.value >= 0 && !metaOf(p).numeric[s.value] && !["count", "distinct"].includes(s.agg)) issues.push({ level: "warn", key: "value", message: `“${metaOf(p).headers[s.value]}” is not a numeric column; non-numbers are counted as 0. Use count/distinct instead?` });
    const pv = pivot(data(p), s);
    if (pv.colKeys.length > 60) issues.push({ level: "warn", key: "col", message: `${pv.colKeys.length} columns — consider a coarser date grouping or another column field.` });
    if (pv.others) issues.push({ level: "info", key: "topN", message: `Showing top ${s.topN}; ${pv.others} more row(s) are included in the totals.` });
    const title = String(p.settings.title || `${AGG_ZH[s.agg]}${s.value >= 0 ? " · " + metaOf(p).headers[s.value] : ""} by ${s.rows.map((i) => metaOf(p).headers[i]).join(" / ")}`);
    const preview = `<h3>${esc(title)}</h3>${table(headerRow(p, pv, s), matrix(p, pv, s, true))}<div style="margin-top:12px">${chart(pv)}</div>`;
    return { rows: p.rows, issues, preview, summary: `${pv.rowKeys.length} rows × ${Math.max(1, pv.colKeys.length)} columns, total ${fmt(pv.total)}`, stats: { groups: pv.rowKeys.length, columns: pv.colKeys.length, total: pv.total, source: p.rows.length } };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel 报表", "Excel report"], description: "pivot.xlsx with the pivot sheet (totals row, % if chosen) and the source data",
      async run({ project, write }) {
        const { s, errors } = spec(project);
        if (errors.length) throw new KitError("has_errors", errors.join("; "));
        const pv = pivot(data(project), s);
        const head = headerRow(project, pv, s);
        const rows = matrix(project, pv, s, false);
        const sheets = [
          { name: "pivot", headers: head, rows, marks: head.map((_, c) => ({ row: rows.length - 1, col: c, color: "#E5E7EB" })), numberFormat: Object.fromEntries(head.map((_, c) => [c, "#,##0.##"]).slice(s.rows.length)) },
          { name: "data", headers: metaOf(project).headers, rows: data(project).map((r) => r.map((v, i) => (metaOf(project).numeric[i] && !isNaN(num(v)) ? num(v) : v))) },
        ];
        if (String(project.settings.percent ?? "none") !== "none") sheets.splice(1, 0, { name: "percent", headers: head, rows: matrix(project, pv, s, true), marks: [], numberFormat: {} });
        return [await write("pivot.xlsx", await writeXlsx(sheets))];
      },
    },
    {
      id: "csv", label: ["CSV", "CSV"], description: "pivot.csv",
      async run({ project, write }) {
        const { s, errors } = spec(project);
        if (errors.length) throw new KitError("has_errors", errors.join("; "));
        const pv = pivot(data(project), s);
        return [await write("pivot.csv", toCsv(headerRow(project, pv, s), matrix(project, pv, s, false)))];
      },
    },
    {
      id: "html", label: ["HTML 报告（含图表）", "HTML report (with chart)"], description: "pivot.html — table and bar chart, printable to PDF from a browser",
      async run({ project, computed, write }) {
        return [await write("pivot.html", `<!doctype html><meta charset="utf-8"><title>Pivot</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:5px 10px;text-align:right}td:first-child,th:first-child{text-align:left}th{background:#f3f4f6}</style>${computed.preview}<p style="color:#6b7280">${esc(computed.summary)} · ${project.rows.length} source rows · ${new Date().toISOString().slice(0, 10)}</p>`)];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
