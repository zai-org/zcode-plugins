import { createApp, esc, toCsv, type AppDef, type Column, type Issue, type Project } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { findRecords, flatten, getPath, toObject, typed, type JsonOpts } from "./convert.ts";

export const NAME = "json-table-converter";
export const VERSION = "0.1.0";
const headersOf = (p: Project) => (p.meta.headers as string[]) ?? [];
const sepOf = (p: Project) => String(p.settings.sep ?? "; ") || "; ";
const jsonOpts = (p: Project): JsonOpts => ({
  nest: p.settings.nest !== false, types: p.settings.types !== false, empty: (p.settings.empty as JsonOpts["empty"]) ?? "omit", sep: sepOf(p),
  arrayCols: new Set([...((p.meta.arrayCols as string[]) ?? []), ...String(p.settings.arrayCols ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean)]),
});
const cells = (p: Project, r: Record<string, unknown>) => headersOf(p).map((_, i) => String(r[`c${i}`] ?? ""));
const objects = (p: Project) => p.rows.map((r) => toObject(headersOf(p), cells(p, r), jsonOpts(p)));

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "jsontable",
  title: ["JSON 表格互转", "JSON ⇄ Table Converter"],
  openDescription:
    "Convert JSON or JSON Lines (API responses, exports, logs) into a table and back. JSON → table: finds the array of records automatically (or a path like data.orders), flattens nested objects into dotted columns (customer.city), joins arrays of values (tags) or keeps them as JSON, and can explode one array of objects into one row per item (items → items.sku, items.qty). Table (CSV/XLSX) → JSON: dotted headers become nested objects, numbers/true/false become real types, list columns split back into arrays. Edit cells in between. Export .xlsx, .csv, .json (pretty) and .jsonl.",
  inputs: { exts: [".json", ".jsonl", ".ndjson", ".csv", ".tsv", ".xlsx"], min: 1, max: 1, label: ["选择 JSON 或表格文件", "Pick a JSON or table file"] },
  settings: [
    { key: "path", label: ["记录所在路径（留空自动找）", "Path to records (empty = auto)"], type: "text", default: "", reload: true },
    { key: "explode", label: ["展开成多行的数组（如 items）", "Explode this array into rows (e.g. items)"], type: "text", default: "", reload: true },
    { key: "arrays", label: ["值数组", "Arrays of values"], type: "select", default: "join", reload: true, options: [{ value: "join", label: ["用分隔符连接", "Join with separator"] }, { value: "json", label: ["保留 JSON", "Keep as JSON"] }] },
    { key: "sep", label: ["分隔符", "Separator"], type: "text", default: "; ", reload: true },
    { key: "nest", label: ["导出 JSON 时还原嵌套（a.b → {a:{b}}）", "Nest dotted columns in JSON"], type: "bool", default: true },
    { key: "types", label: ["导出 JSON 时识别数字和 true/false", "Detect numbers and booleans in JSON"], type: "bool", default: true },
    { key: "empty", label: ["空单元格", "Empty cells"], type: "select", default: "omit", options: [{ value: "omit", label: ["省略字段", "Omit the field"] }, { value: "null", label: ["null", "null"] }, { value: "string", label: ["空字符串", "Empty string"] }] },
    { key: "arrayCols", label: ["拆成数组的列（逗号分隔）", "Columns to split into arrays"], type: "text", default: "" },
  ],
  columns: (p) => headersOf(p).map((h, i): Column => ({ key: `c${i}`, label: [h, h] })),
  newRow: (p) => Object.fromEntries(headersOf(p).map((_, i) => [`c${i}`, ""])),
  async load({ ws, files, settings }) {
    const f = files[0];
    if (/\.(json|jsonl|ndjson)$/i.test(f)) {
      const text = (await ws.readText(f)).replace(/^\uFEFF/, "");
      let records: unknown[];
      let path = String(settings.path ?? "").trim();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (/\.(jsonl|ndjson)$/i.test(f) || (lines.length > 1 && lines.every((l) => l.trim().startsWith("{")) && !text.trim().startsWith("["))) {
        records = lines.map((l, i) => { try { return JSON.parse(l); } catch { throw new KitError("bad_json", `Line ${i + 1} is not valid JSON.`); } });
        path = "(lines)";
      } else {
        let root: unknown;
        try { root = JSON.parse(text); } catch (e) { throw new KitError("bad_json", `Not valid JSON: ${(e as Error).message}`); }
        if (!path) path = findRecords(root);
        const v = getPath(root, path);
        if (v === undefined) throw new KitError("bad_path", `Path “${path}” not found in the JSON.`);
        records = Array.isArray(v) ? v : [v];
      }
      const arrayCols = new Set<string>();
      const flat = records.flatMap((r) => flatten(r, { arrays: settings.arrays === "json" ? "json" : "join", explode: String(settings.explode ?? "").trim(), sep: String(settings.sep ?? "; ") || "; " }, arrayCols));
      const headers: string[] = [];
      for (const r of flat) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
      return { rows: flat.map((r) => Object.fromEntries(headers.map((h, i) => [`c${i}`, r[h] ?? ""]))), meta: { headers, source: "json", path, records: records.length, arrayCols: [...arrayCols] } };
    }
    const t = await readTable(ws, f);
    return { rows: t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [`c${i}`, r[c]]))), meta: { headers: t.columns, source: "table", records: t.rows.length, arrayCols: [] } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const headers = headersOf(p);
    if (p.meta.source === "json" && headers.length > 80) issues.push({ level: "warn", message: `${headers.length} columns — very nested data. Point “Path to records” at the part you need, or keep arrays as JSON.` });
    const exploded = String(p.settings.explode ?? "").trim();
    if (exploded && !headers.some((h) => h.startsWith(exploded + "."))) issues.push({ level: "warn", key: "explode", message: `“${exploded}” is not an array of objects in these records.` });
    if (p.meta.source === "json" && !exploded) {
      const jsonArrays = headers.filter((h, i) => p.rows.some((r) => String(r[`c${i}`] ?? "").startsWith("[{")));
      if (jsonArrays.length) issues.push({ level: "info", key: "explode", message: `${jsonArrays.join(", ")} hold lists of objects (kept as JSON). Set “Explode” to ${jsonArrays[0]} to get one row per item.` });
    }
    const dotted = headers.filter((h) => h.includes(".")).length;
    const sample = JSON.stringify(objects({ ...p, rows: p.rows.slice(0, 2) } as Project), null, 2);
    const preview = `<p>${p.meta.source === "json" ? `JSON → table: ${p.meta.records} record(s) at <code>${esc(p.meta.path)}</code> → <b>${p.rows.length}</b> rows × ${headers.length} columns` : `Table → JSON: <b>${p.rows.length}</b> rows, ${dotted} dotted column(s) will nest`}</p><p class="muted">JSON preview (first 2 rows):</p><pre style="white-space:pre-wrap;font-size:12px">${esc(sample.slice(0, 3000))}</pre>`;
    void typed;
    return { rows: p.rows, issues, preview, summary: `${p.rows.length} rows × ${headers.length} columns`, stats: { rows: p.rows.length, columns: headers.length, records: Number(p.meta.records ?? 0) } };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel", "Excel"], description: "table.xlsx (numbers as numbers)",
      async run({ project, write }) {
        const o = jsonOpts(project);
        return [await write("table.xlsx", await writeXlsx([{ name: "data", headers: headersOf(project), rows: project.rows.map((r) => cells(project, r).map((v) => { const t = typed(v, { ...o, arrayCols: new Set() }); return typeof t === "number" ? t : v; })) }]))];
      },
    },
    { id: "csv", label: ["CSV", "CSV"], description: "table.csv (UTF-8, opens in Excel)", run: async ({ project, write }) => [await write("table.csv", toCsv(headersOf(project), project.rows.map((r) => cells(project, r))))] },
    { id: "json", label: ["JSON", "JSON"], description: "data.json — an array of objects, pretty-printed", run: async ({ project, write }) => [await write("data.json", JSON.stringify(objects(project), null, 2) + "\n")] },
    { id: "jsonl", label: ["JSON Lines", "JSON Lines"], description: "data.jsonl — one object per line", run: async ({ project, write }) => [await write("data.jsonl", objects(project).map((o) => JSON.stringify(o)).join("\n") + "\n")] },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
