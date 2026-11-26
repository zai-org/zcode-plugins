import { createApp, esc, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { autoKey, diff, type Table } from "./diff.ts";

export const NAME = "sheet-diff";
export const VERSION = "0.1.0";
const KIND: Record<string, string> = { added: "新增 / added", removed: "删除 / removed", changed: "修改 / changed" };

interface Meta { a: Table; b: Table; names: [string, string]; auto: string[] }
const metaOf = (p: Project) => p.meta as unknown as Meta;
function sides(p: Project) { const m = metaOf(p); return p.settings.swap ? { a: m.b, b: m.a, na: m.names[1], nb: m.names[0] } : { a: m.a, b: m.b, na: m.names[0], nb: m.names[1] }; }
function keysOf(p: Project) {
  const k = String(p.settings.key ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  return p.settings.byPosition ? [] : k.length ? k : metaOf(p).auto;
}
function run(p: Project) {
  const { a, b } = sides(p);
  return diff(a, b, { keys: keysOf(p), ignoreCase: Boolean(p.settings.ignoreCase), ignoreSpace: p.settings.ignoreSpace !== false, tolerance: Number(p.settings.tolerance ?? 0) });
}
const numOr = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v);

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "sheetdiff",
  title: ["表格对比", "Sheet Diff"],
  openDescription:
    "Compare two versions of a CSV/XLSX table (e.g. last month's and this month's price list) and list every added row, removed row and changed cell. Rows are matched by a key column (detected automatically — the first column that is unique in both, like 货号 — or set by you, several allowed) so re-ordered rows don't count as changes; or compare by position. Options: ignore case, ignore extra spaces, numeric tolerance. Reports added/removed columns and duplicate keys. Export diff.xlsx (new version with changed cells highlighted and the old value as a note, plus removed rows and a change list), changes.csv and an HTML report.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 2, max: 2, label: ["选择两个版本（先选旧的，再选新的）", "Pick two versions (old first, then new)"] },
  settings: [
    { key: "key", label: ["关键列（留空自动识别）", "Key column(s) (empty = auto)"], type: "text", default: "", reload: true },
    { key: "byPosition", label: ["按行号对比（没有关键列时）", "Compare by row position"], type: "bool", default: false, reload: true },
    { key: "swap", label: ["交换新旧", "Swap old/new"], type: "bool", default: false, reload: true },
    { key: "ignoreSpace", label: ["忽略多余空格", "Ignore extra spaces"], type: "bool", default: true, reload: true },
    { key: "ignoreCase", label: ["忽略大小写", "Ignore case"], type: "bool", default: false, reload: true },
    { key: "tolerance", label: ["数字容差", "Numeric tolerance"], type: "number", default: 0, min: 0, reload: true },
  ],
  columns: () => [
    { key: "_kind", label: ["变化", "Change"], readOnly: true },
    { key: "key", label: ["关键值", "Key"], readOnly: true },
    { key: "column", label: ["列", "Column"], readOnly: true },
    { key: "old", label: ["旧值", "Old"], readOnly: true, wide: true },
    { key: "new", label: ["新值", "New"], readOnly: true, wide: true },
    { key: "note", label: ["备注", "Note"] },
  ],
  async load({ ws, files, settings, previous }) {
    const read = async (f: string): Promise<Table> => { const t = await readTable(ws, f); return { headers: t.columns, rows: t.rows.map((r) => t.columns.map((c) => r[c])) }; };
    const a = await read(files[0]), b = await read(files[1]);
    const meta = { a, b, names: [files[0].split("/").pop(), files[1].split("/").pop()], auto: autoKey(a, b) };
    const r = run({ settings, meta } as unknown as Project);
    const notes = new Map((previous ?? []).map((x) => [`${x.kind}|${x.key}|${x.column}`, x.note]));
    return { rows: r.changes.map((c) => ({ kind: c.kind, key: c.key, column: c.column, old: c.old, new: c.new, note: notes.get(`${c.kind}|${c.key}|${c.column}`) ?? "" })), meta };
  },
  compute(p) {
    const r = run(p);
    const { a, b, na, nb } = sides(p);
    const issues: Issue[] = [];
    if (!keysOf(p).length && !p.settings.byPosition) issues.push({ level: "warn", key: "key", message: "No column is unique in both tables, so rows are compared by position. Set a key column (or several, e.g. “门店,货号”) for a better match." });
    for (const k of String(p.settings.key ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean)) if (!a.headers.includes(k) || !b.headers.includes(k)) issues.push({ level: "error", key: "key", message: `Key column “${k}” is not in both tables. Shared columns: ${a.headers.filter((h) => b.headers.includes(h)).join(", ")}` });
    if (r.dupKeys.length) issues.push({ level: "warn", key: "key", message: `Duplicate keys (only the first row is compared): ${r.dupKeys.slice(0, 5).join(", ")}` });
    if (r.addedCols.length) issues.push({ level: "info", message: `New columns in ${nb}: ${r.addedCols.join(", ")}` });
    if (r.removedCols.length) issues.push({ level: "info", message: `Columns missing from ${nb}: ${r.removedCols.join(", ")}` });
    const count = (k: string) => r.changes.filter((c) => c.kind === k).length;
    const changedRows = new Set(r.changes.filter((c) => c.kind === "changed").map((c) => c.key)).size;
    const rows = p.rows.map((x) => ({ ...x, _kind: KIND[String(x.kind)] }));
    const color: Record<string, string> = { added: "#dcfce7", removed: "#fee2e2", changed: "#fef9c3" };
    const preview = `<p><b>${esc(na)}</b> (${a.rows.length} rows) → <b>${esc(nb)}</b> (${b.rows.length} rows) · key: ${esc(keysOf(p).join(" + ") || "row position")}</p><p>➕ ${count("added")} added · ➖ ${count("removed")} removed · ✏️ ${changedRows} rows changed (${count("changed")} cells) · ${r.same} unchanged</p>` +
      `<table class="data"><thead><tr><th>Change</th><th>Key</th><th>Column</th><th>Old</th><th>New</th></tr></thead><tbody>${r.changes.slice(0, 300).map((c) => `<tr style="background:${color[c.kind]}"><td>${KIND[c.kind]}</td><td>${esc(c.key)}</td><td>${esc(c.column)}</td><td>${esc(c.old)}</td><td>${esc(c.new)}</td></tr>`).join("")}</tbody></table>`;
    return { rows, issues, preview, summary: r.changes.length ? `${count("added")} added, ${count("removed")} removed, ${changedRows} changed rows` : "The two tables are the same", stats: { added: count("added"), removed: count("removed"), changedRows, changedCells: count("changed"), unchanged: r.same } };
  },
  exports: [
    {
      id: "xlsx", label: ["对比结果 Excel", "Diff workbook"], description: "diff.xlsx — the new version with changes highlighted (old value in a note), removed rows and the change list",
      async run({ project, write }) {
        const r = run(project);
        const { a, b } = sides(project);
        const added = new Set(r.changes.filter((c) => c.kind === "added").map((c) => c.newRow));
        const marks = [
          ...r.changes.filter((c) => c.kind === "changed").map((c) => ({ row: c.newRow!, col: b.headers.indexOf(c.column), note: `old: ${c.old}` })),
          ...[...added].flatMap((row) => b.headers.map((_, col) => ({ row: row!, col, color: "#BBF7D0" }))),
          ...r.addedCols.flatMap((h) => b.rows.map((_, row) => ({ row, col: b.headers.indexOf(h), color: "#BFDBFE" }))),
        ];
        const removed = r.changes.filter((c) => c.kind === "removed").map((c) => a.rows[c.oldRow!].map(numOr));
        return [await write("diff.xlsx", await writeXlsx([
          { name: "new version", headers: b.headers, rows: b.rows.map((x) => x.map(numOr)), marks },
          { name: "removed rows", headers: a.headers, rows: removed, marks: removed.flatMap((_, row) => a.headers.map((_, col) => ({ row, col, color: "#FECACA" }))) },
          { name: "changes", headers: ["change", "key", "column", "old", "new", "note"], rows: project.rows.map((x) => [x.kind, x.key, x.column, x.old, x.new, x.note]) },
        ]))];
      },
    },
    {
      id: "csv", label: ["变化清单 CSV", "Changes CSV"], description: "changes.csv",
      async run({ project, write }) {
        return [await write("changes.csv", toCsv(["change", "key", "column", "old", "new", "note"], project.rows.map((x) => [x.kind, x.key, x.column, x.old, x.new, x.note])))];
      },
    },
    {
      id: "html", label: ["HTML 报告", "HTML report"], description: "diff.html — printable summary with colour-coded changes",
      async run({ computed, write }) {
        return [await write("diff.html", `<!doctype html><meta charset="utf-8"><title>Diff</title><style>body{font:14px system-ui,sans-serif;margin:32px}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:4px 8px;text-align:left;vertical-align:top}</style><h1>Table comparison</h1>${computed.preview}`)];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
