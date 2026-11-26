import { createApp, htmlTable, toCsv, type AppDef, type Column, type Issue, type Project } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { decodeText, parseCsv, readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { cleanCell, detect, keyOf, type ColType, type Opts } from "./clean.ts";

export const NAME = "csv-cleaner";
export const VERSION = "0.1.0";
const TYPES: ColType[] = ["text", "number", "date", "email", "phone"];
const TYPE_ZH: Record<ColType, string> = { text: "文本", number: "数字", date: "日期", email: "邮箱", phone: "电话" };

interface Meta { headers: string[]; types: ColType[]; sheet?: string }
const metaOf = (p: Project) => p.meta as unknown as Meta;
const optsOf = (p: Project): Opts => ({ trim: p.settings.trim !== false, spaces: p.settings.spaces !== false, fullwidth: p.settings.fullwidth !== false, numbers: p.settings.numbers !== false, dates: p.settings.dates !== false, emails: p.settings.emails !== false, phones: p.settings.phones !== false });
const typesOf = (p: Project) => {
  const m = metaOf(p);
  const over = String(p.settings.types ?? "").split(/[;\n；]/).map((x) => x.split(/[=:：]/).map((y) => y.trim())).filter((x) => x.length === 2);
  return m.headers.map((h, i) => (over.find(([k, v]) => k === h && TYPES.includes(v as ColType))?.[1] as ColType) ?? m.types[i]);
};

function run(p: Project) {
  const m = metaOf(p);
  const types = typesOf(p);
  const o = optsOf(p);
  const keep = m.headers.map((_, i) => !(p.settings.dropEmptyCols !== false && p.rows.every((r) => !String(r[`c${i}`] ?? "").trim())));
  const dedupe = String(p.settings.dedupe ?? "exact");
  const keyCols = String(p.settings.keyCols ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean).map((k) => m.headers.indexOf(k)).filter((i) => i >= 0);
  const seen = new Map<string, number>();
  const changes: { row: number; col: number; before: string; after: string | number }[] = [];
  const problems: { row: number; col: number; problem: string }[] = [];
  const out = p.rows.map((r, ri) => {
    const cells = m.headers.map((_, ci) => {
      const raw = String(r[`c${ci}`] ?? "");
      const c = cleanCell(raw, types[ci], o);
      if (String(c.value) !== raw && keep[ci]) changes.push({ row: ri, col: ci, before: raw, after: c.value });
      if (c.problem && keep[ci]) problems.push({ row: ri, col: ci, problem: c.problem });
      return c.value;
    });
    let status = "";
    if (p.settings.emptyRows !== false && cells.every((c) => c === "")) status = "empty";
    else if (dedupe !== "none") {
      const k = keyOf(dedupe === "key" && keyCols.length ? keyCols.map((i) => cells[i]) : cells);
      if (seen.has(k)) status = `dup:${seen.get(k)}`;
      else seen.set(k, ri);
    }
    return { cells, status };
  });
  return { types, keep, out, changes, problems };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "clean",
  title: ["表格数据清洗", "CSV Cleaner"],
  openDescription:
    "Clean a messy CSV/XLSX (GBK/GB18030 CSVs from Chinese Excel are decoded automatically): trim and collapse spaces, convert full-width digits/letters, turn money/number text into numbers (¥1,280.00 → 1280), normalise dates to YYYY-MM-DD (2026/11/3, 2026年11月5日, 11/20/2026), lower-case and validate emails, normalise phone numbers, drop empty rows/columns and remove duplicate rows (exact, or by key columns). Column types are detected and can be overridden. Every change is listed; cells that can't be cleaned are flagged. Export cleaned.xlsx (changed cells highlighted with the old value as a note), cleaned.csv (UTF-8) and changes.csv.",
  inputs: { exts: [".csv", ".tsv", ".txt", ".xlsx"], min: 1, max: 1, label: ["选择要清洗的表格", "Pick the table to clean"] },
  settings: [
    { key: "trim", label: ["去掉首尾空格", "Trim spaces"], type: "bool", default: true },
    { key: "spaces", label: ["合并连续空格", "Collapse spaces"], type: "bool", default: true },
    { key: "fullwidth", label: ["全角数字/字母转半角", "Full-width → half-width"], type: "bool", default: true },
    { key: "numbers", label: ["数字列转成数字", "Numbers as numbers"], type: "bool", default: true },
    { key: "dates", label: ["日期统一成 YYYY-MM-DD", "Dates as YYYY-MM-DD"], type: "bool", default: true },
    { key: "emails", label: ["邮箱小写并检查", "Lower-case and check emails"], type: "bool", default: true },
    { key: "phones", label: ["电话只保留数字", "Phones digits only"], type: "bool", default: true },
    { key: "emptyRows", label: ["删除空行", "Drop empty rows"], type: "bool", default: true },
    { key: "dropEmptyCols", label: ["删除空列", "Drop empty columns"], type: "bool", default: true },
    { key: "dedupe", label: ["删除重复行", "Remove duplicates"], type: "select", default: "exact", options: [{ value: "exact", label: ["整行相同（清洗后）", "Whole row (after cleaning)"] }, { value: "key", label: ["按关键列", "By key columns"] }, { value: "none", label: ["不删除", "Keep all"] }] },
    { key: "keyCols", label: ["关键列（逗号分隔）", "Key columns (comma-separated)"], type: "text", default: "" },
    { key: "types", label: ["改列类型（列名=类型；类型：text number date email phone）", "Column types (name=type; text number date email phone)"], type: "textarea", default: "" },
  ],
  columns: (p) => [
    ...metaOf(p).headers.map((h, i): Column => ({ key: `c${i}`, label: [h, h] })).filter((_, i) => p.settings.dropEmptyCols === false || p.rows.some((r) => String(r[`c${i}`] ?? "").trim())),
    { key: "_status", label: ["状态", "Status"], readOnly: true },
  ],
  newRow: (p) => Object.fromEntries(metaOf(p).headers.map((_, i) => [`c${i}`, ""])),
  async load({ ws, files }) {
    const path = files[0];
    let headers: string[], matrix: string[][];
    if (/\.xlsx$/i.test(path)) {
      const t = await readTable(ws, path);
      headers = t.columns; matrix = t.rows.map((r) => t.columns.map((c) => r[c]));
    } else {
      const all = parseCsv(decodeText(await ws.read(path, 50 * 1024 * 1024)));
      if (!all.length) throw new KitError("empty_table", "The table has no rows.");
      const seen = new Map<string, number>();
      headers = all[0].map((h, i) => { let n = h.trim() || `列${i + 1}`; const c = seen.get(n) ?? 0; seen.set(n, c + 1); return c ? `${n}_${c + 1}` : n; });
      matrix = all.slice(1);
    }
    if (matrix.length > 50000) throw new KitError("too_big", `${matrix.length} rows; v0.1 handles up to 50,000.`);
    const rows = matrix.map((cells) => Object.fromEntries(headers.map((_, i) => [`c${i}`, cells[i] ?? ""])));
    const types = headers.map((h, i) => detect(h, matrix.map((c) => c[i] ?? "")));
    return { rows, meta: { headers, types } };
  },
  compute(p) {
    const { types, keep, out, changes, problems } = run(p);
    const m = metaOf(p);
    const issues: Issue[] = problems.slice(0, 200).map((x) => ({ level: "warn", row: x.row, key: `c${x.col}`, message: `Row ${x.row + 1}, ${m.headers[x.col]}: ${x.problem} (“${p.rows[x.row][`c${x.col}`]}”)` }));
    const dups = out.filter((x) => x.status.startsWith("dup")).length;
    const empty = out.filter((x) => x.status === "empty").length;
    const rows = p.rows.map((r, i) => ({ ...Object.fromEntries(out[i].cells.map((c, ci) => [`c${ci}`, c])), _status: out[i].status === "empty" ? "空行·删除 / empty" : out[i].status ? `重复 #${Number(out[i].status.slice(4))} / duplicate` : "" }));
    const perCol = m.headers.map((h, i) => [h, `${TYPE_ZH[types[i]]} / ${types[i]}`, keep[i] ? changes.filter((c) => c.col === i).length : "dropped (empty)", problems.filter((x) => x.col === i).length]);
    const preview = `<p>${p.rows.length} rows → <b>${p.rows.length - dups - empty}</b> after removing ${dups} duplicate(s) and ${empty} empty row(s) · ${changes.length} cell(s) changed</p>` +
      htmlTable(["Column / 列", "Type / 类型", "Changed", "Problems"], perCol) +
      htmlTable(["Row", "Column", "Before", "After"], changes.slice(0, 40).map((c) => [c.row + 1, m.headers[c.col], c.before, c.after]));
    return { rows, issues, preview, summary: `${p.rows.length - dups - empty} clean rows, ${changes.length} cells changed, ${dups} duplicates, ${problems.length} problems`, stats: { rows: p.rows.length, kept: p.rows.length - dups - empty, changed: changes.length, duplicates: dups, empty, problems: problems.length } };
  },
  exports: [
    {
      id: "xlsx", label: ["清洗后的 Excel", "Cleaned Excel"], description: "cleaned.xlsx — changed cells highlighted with the old value as a note, problems in red",
      async run({ project, write }) {
        const { keep, out, changes, problems } = run(project);
        const m = metaOf(project);
        const cols = m.headers.map((_, i) => i).filter((i) => keep[i]);
        const kept = out.map((x, i) => ({ ...x, i })).filter((x) => !x.status);
        const pos = new Map(kept.map((x, k) => [x.i, k]));
        const marks = [
          ...changes.filter((c) => pos.has(c.row)).map((c) => ({ row: pos.get(c.row)!, col: cols.indexOf(c.col), note: `was: ${c.before}` })),
          ...problems.filter((c) => pos.has(c.row)).map((c) => ({ row: pos.get(c.row)!, col: cols.indexOf(c.col), color: "#FCA5A5", note: c.problem })),
        ];
        const removed = out.map((x, i) => ({ ...x, i })).filter((x) => x.status);
        const sheets = [{ name: "cleaned", headers: cols.map((i) => m.headers[i]), rows: kept.map((x) => cols.map((i) => x.cells[i])), marks }];
        if (removed.length) sheets.push({ name: "removed", headers: ["row", "reason", ...m.headers], rows: removed.map((x) => [x.i + 2, x.status === "empty" ? "empty" : `duplicate of row ${Number(x.status.slice(4)) + 2}`, ...m.headers.map((_, ci) => String(project.rows[x.i][`c${ci}`] ?? ""))]), marks: [] });
        return [await write("cleaned.xlsx", await writeXlsx(sheets))];
      },
    },
    {
      id: "csv", label: ["清洗后的 CSV + 修改记录", "Cleaned CSV + change log"], description: "cleaned.csv (UTF-8 with BOM, opens in Excel) and changes.csv",
      async run({ project, write }) {
        const { keep, out, changes } = run(project);
        const m = metaOf(project);
        const cols = m.headers.map((_, i) => i).filter((i) => keep[i]);
        return [
          await write("cleaned.csv", toCsv(cols.map((i) => m.headers[i]), out.filter((x) => !x.status).map((x) => cols.map((i) => x.cells[i])))),
          await write("changes.csv", toCsv(["row", "column", "before", "after"], [...changes.map((c) => [c.row + 2, m.headers[c.col], c.before, c.after]), ...out.map((x, i) => [x.status, i]).filter(([s]) => s).map(([s, i]) => [Number(i) + 2, "(row removed)", s === "empty" ? "empty row" : `duplicate of row ${Number(String(s).slice(4)) + 2}`, ""])])),
        ];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
