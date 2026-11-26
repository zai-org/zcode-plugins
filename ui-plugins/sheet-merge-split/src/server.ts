import { zipSync } from "fflate";
import { createApp, htmlTable, toCsv, type AppDef, type Column, type Computed, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { aligner, numeric } from "./headers.ts";

export const NAME = "sheet-merge-split";
export const VERSION = "0.1.0";

interface Meta { headers: string[]; sources: { name: string; rows: number; missing: string[]; renamed: string[] }[] }
const metaOf = (p: Project) => p.meta as unknown as Meta;
const mode = (p: Project) => (p.settings.mode === "split" || (p.settings.mode !== "merge" && (p.meta as { sources?: unknown[] }).sources?.length === 1) ? "split" : "merge");
const cell = (v: unknown) => (typeof v === "number" ? v : numeric(String(v ?? "")));

function splitCol(p: Project) {
  const m = metaOf(p);
  const want = String(p.settings.splitBy ?? "").trim();
  if (want) return m.headers.indexOf(want);
  // 自动：唯一值 2–50 个、不是日期/数字的第一列
  for (let i = 0; i < m.headers.length; i++) {
    const vals = p.rows.map((r) => String(r[`c${i}`] ?? ""));
    const uniq = new Set(vals.filter(Boolean)).size;
    if (uniq >= 2 && uniq <= Math.min(50, Math.max(2, p.rows.length / 1.5)) && !vals.every((v) => !v || /^[\d.\-/: ]+$/.test(v))) return i;
  }
  return -1;
}
function groups(p: Project) {
  const col = splitCol(p);
  const g = new Map<string, number[]>();
  if (col < 0) return { col, g };
  p.rows.forEach((r, i) => { const k = String(r[`c${col}`] ?? "").trim() || "(空)"; g.set(k, [...(g.get(k) ?? []), i]); });
  return { col, g };
}
const rowsOut = (p: Project, idx: number[], withSource: boolean) => idx.map((i) => [...(withSource ? [p.rows[i]._src] : []), ...metaOf(p).headers.map((_, c) => cell(p.rows[i][`c${c}`]))]);

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "sheets",
  title: ["表格合并拆分", "Sheet Merge & Split"],
  openDescription:
    "Merge several CSV/XLSX files (and all sheets inside a workbook) into one table — columns are matched by name even when they differ (日期/Date, 金额/Amount (元), custom rules like “金额=Revenue”), a 来源 column records where each row came from, and missing columns are reported. Or split one table by a column (e.g. 门店) into one sheet or one file per value. Mode auto: one file → split, several → merge.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 30, label: ["选择要合并的多个表格（或一个要拆分的表格）", "Pick tables to merge (or one table to split)"] },
  settings: [
    { key: "mode", label: ["模式", "Mode"], type: "select", default: "auto", reload: true, options: [{ value: "auto", label: ["自动（多个文件=合并，一个=拆分）", "Auto (many = merge, one = split)"] }, { value: "merge", label: ["合并", "Merge"] }, { value: "split", label: ["拆分", "Split"] }] },
    { key: "allSheets", label: ["读取工作簿里的所有工作表", "Read every sheet of a workbook"], type: "bool", default: true, reload: true },
    { key: "same", label: ["这些列名算同一列（每行：金额=Amount=营业额）", "Treat as the same column (one rule per line: Amount=Revenue)"], type: "textarea", default: "", reload: true },
    { key: "source", label: ["合并时加“来源”列", "Add a source column when merging"], type: "bool", default: true },
    { key: "splitBy", label: ["拆分依据列（留空自动选）", "Split by column (empty = auto)"], type: "text", default: "" },
    { key: "splitTo", label: ["拆分成", "Split into"], type: "select", default: "sheets", options: [{ value: "sheets", label: ["一个工作簿多个工作表", "One workbook, a sheet each"] }, { value: "files", label: ["每个值一个文件", "A file each"] }] },
    { key: "format", label: ["单独文件格式", "File format"], type: "select", default: "xlsx", options: [{ value: "xlsx", label: ["Excel .xlsx", "Excel .xlsx"] }, { value: "csv", label: ["CSV", "CSV"] }] },
  ],
  columns: (p) => [
    ...(mode(p) === "merge" ? [{ key: "_src", label: ["来源", "Source"], readOnly: true } as Column] : []),
    ...metaOf(p).headers.map((h, i): Column => ({ key: `c${i}`, label: [h, h] })),
    ...(mode(p) === "split" ? [{ key: "_group", label: ["拆分到", "Goes to"], readOnly: true } as Column] : []),
  ],
  async load({ ws, files, settings }) {
    const align = aligner(String(settings.same ?? ""));
    const headers: string[] = [];
    const sources: Meta["sources"] = [];
    const parts: { name: string; cols: string[]; rows: Record<string, string>[] }[] = [];
    for (const f of files) {
      const first = await readTable(ws, f);
      const sheets = /\.xlsx$/i.test(f) && settings.allSheets !== false && first.sheets.length > 1 ? first.sheets : [first.sheet];
      for (const s of sheets) {
        const t = s && s !== first.sheet ? await readTable(ws, f, s).catch(() => undefined) : first;
        if (!t || !t.rows.length) continue;
        const name = f.split("/").pop()! + (sheets.length > 1 ? ` · ${t.sheet}` : "");
        const cols = t.columns.map((c) => align(c));
        for (const c of cols) if (!headers.includes(c)) headers.push(c);
        parts.push({ name, cols, rows: t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [cols[i], r[c]]))) });
        sources.push({ name, rows: t.rows.length, missing: [], renamed: t.columns.map((c, i) => (c !== cols[i] ? `${c}→${cols[i]}` : "")).filter(Boolean) });
      }
    }
    if (!parts.length) throw new KitError("empty", "No rows found in the chosen files.");
    parts.forEach((p, i) => { sources[i].missing = headers.filter((h) => !p.cols.includes(h)); });
    const rows = parts.flatMap((p) => p.rows.map((r) => ({ _src: p.name, ...Object.fromEntries(headers.map((h, i) => [`c${i}`, r[h] ?? ""])) })));
    return { rows, meta: { headers, sources } };
  },
  newRow: (p) => ({ _src: "(added)", ...Object.fromEntries(metaOf(p).headers.map((_, i) => [`c${i}`, ""])) }),
  compute(p): Computed {
    const m = metaOf(p);
    const issues: Issue[] = [];
    if (mode(p) === "merge") {
      for (const s of m.sources) {
        if (s.missing.length) issues.push({ level: "info", message: `${s.name} has no ${s.missing.join(", ")} — left empty. If it's the same column under another name, add a rule like “${s.missing[0]}=…”.` });
        if (s.renamed.length) issues.push({ level: "info", message: `${s.name}: matched ${s.renamed.join(", ")}` });
      }
      const preview = `<p>Merged <b>${p.rows.length}</b> rows from ${m.sources.length} table(s) into ${m.headers.length} columns</p>` + htmlTable(["Source / 来源", "Rows / 行数", "Missing columns / 缺少的列"], m.sources.map((s) => [s.name, s.rows, s.missing.join(", ")]));
      return { rows: p.rows, issues, preview, summary: `${p.rows.length} rows from ${m.sources.length} tables, ${m.headers.length} columns`, stats: { rows: p.rows.length, sources: m.sources.length, columns: m.headers.length } };
    }
    const { col, g } = groups(p);
    if (col < 0) issues.push({ level: "error", key: "splitBy", message: String(p.settings.splitBy ?? "") ? `Column “${p.settings.splitBy}” not found. Columns: ${m.headers.join(", ")}` : "No column looks like a good split key; set “Split by column”." });
    else if (g.size > 200) issues.push({ level: "warn", key: "splitBy", message: `${g.size} different values — that's a lot of sheets/files. Is “${m.headers[col]}” the right column?` });
    const by = new Map<number, string>();
    for (const [k, idx] of g) for (const i of idx) by.set(i, k);
    const rows: Row[] = p.rows.map((r, i) => ({ ...r, _group: by.get(i) ?? "" }));
    const preview = col < 0 ? "<p>Choose a column to split by.</p>" : `<p>Split <b>${p.rows.length}</b> rows by <b>${m.headers[col]}</b> into ${g.size} ${p.settings.splitTo === "files" ? "files" : "sheets"}</p>` + htmlTable([m.headers[col], "Rows / 行数"], [...g].map(([k, v]) => [k, v.length]));
    return { rows, issues, preview, summary: col < 0 ? "Pick a split column" : `${p.rows.length} rows → ${g.size} parts by ${m.headers[col]}`, stats: { rows: p.rows.length, parts: g.size } };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel 工作簿", "Excel workbook"], description: "merge: merged.xlsx (+ a sources sheet); split: by-<column>.xlsx with one sheet per value",
      async run({ project, write }) {
        const m = metaOf(project);
        if (mode(project) === "merge") {
          const src = project.settings.source !== false;
          return [await write("merged.xlsx", await writeXlsx([
            { name: "merged", headers: [...(src ? ["来源"] : []), ...m.headers], rows: rowsOut(project, project.rows.map((_, i) => i), src) },
            { name: "sources", headers: ["source", "rows", "missing columns"], rows: m.sources.map((s) => [s.name, s.rows, s.missing.join(", ")]) },
          ]))];
        }
        const { col, g } = groups(project);
        if (col < 0) throw new KitError("has_errors", "Pick a column to split by first.");
        const used = new Set<string>();
        const sheets = [...g].map(([k, idx]) => {
          let n = k.replace(/[\\/?*[\]:]/g, "_").slice(0, 28) || "空";
          for (let j = 2; used.has(n.toLowerCase()); j++) n = `${n.slice(0, 26)}-${j}`;
          used.add(n.toLowerCase());
          return { name: n, headers: m.headers, rows: rowsOut(project, idx, false) };
        });
        return [await write(`by-${safeFileName(m.headers[col], "column")}.xlsx`, await writeXlsx(sheets))];
      },
    },
    {
      id: "files", label: ["CSV / 单独文件", "CSV / separate files"], description: "merge: merged.csv; split: one file per value in split/ plus split.zip",
      async run({ project, write }) {
        const m = metaOf(project);
        if (mode(project) === "merge") {
          const src = project.settings.source !== false;
          return [await write("merged.csv", toCsv([...(src ? ["来源"] : []), ...m.headers], rowsOut(project, project.rows.map((_, i) => i), src)))];
        }
        const { col, g } = groups(project);
        if (col < 0) throw new KitError("has_errors", "Pick a column to split by first.");
        const csv = project.settings.format === "csv";
        const out: string[] = [];
        const zip: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        for (const [k, idx] of g) {
          let n = safeFileName(k, "empty");
          for (let j = 2; used.has(n.toLowerCase()); j++) n = `${safeFileName(k, "empty")}-${j}`;
          used.add(n.toLowerCase());
          const data = csv ? new TextEncoder().encode(toCsv(m.headers, rowsOut(project, idx, false))) : new Uint8Array(await writeXlsx([{ name: k.slice(0, 31), headers: m.headers, rows: rowsOut(project, idx, false) }]));
          const file = `${n}.${csv ? "csv" : "xlsx"}`;
          zip[file] = data;
          out.push(await write(`split/${file}`, data));
        }
        out.push(await write("split.zip", zipSync(zip)));
        return out;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
