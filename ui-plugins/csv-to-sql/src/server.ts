import { createApp, esc, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { buildSql, ident, inferType, literal, sqlName, typeSql, TYPES, type Col, type Dialect, type SqlType } from "./sql.ts";

export const NAME = "csv-to-sql";
export const VERSION = "0.1.0";
const dataOf = (p: Project) => (p.meta.data as string[][]) ?? [];
const colsOf = (p: Project): Col[] => p.rows.map((r) => ({ header: String(r.header), name: String(r.name || r.header), type: (TYPES.includes(r.type as SqlType) ? r.type : "TEXT") as SqlType, length: Number(r.length ?? 1), nullable: Boolean(r.nullable), pk: Boolean(r.pk), include: r.include !== false }));
const tableOf = (p: Project) => String(p.settings.table || "").trim() || "imported";
const dialects = (p: Project): Dialect[] => (p.settings.dialect === "all" ? ["sqlite", "mysql", "postgres"] : [((p.settings.dialect as Dialect) ?? "sqlite")]);
const opts = (p: Project) => ({ drop: p.settings.drop !== false, batch: Number(p.settings.batch ?? 500), transaction: p.settings.transaction !== false });

function problems(p: Project) {
  const data = dataOf(p);
  const out: Issue[] = [];
  const names = new Map<string, number>();
  colsOf(p).forEach((c, i) => {
    if (!c.include) return;
    const n = c.name.toLowerCase();
    if (names.has(n)) out.push({ level: "error", row: i, key: "name", message: `Two columns are both named “${c.name}”.` });
    names.set(n, i);
    const vals = data.map((r) => (r[i] ?? "").trim());
    const empty = vals.filter((v) => !v).length;
    if (empty && (!c.nullable || c.pk)) out.push({ level: "error", row: i, key: "nullable", message: `${c.name}: ${empty} empty value(s) but the column is NOT NULL${c.pk ? " (primary key)" : ""}.` });
    const lost = vals.filter((v) => v && literal(v, c.type, "postgres") === "NULL").length;
    if (lost) out.push({ level: "warn", row: i, key: "type", message: `${c.name}: ${lost} value(s) don't fit ${c.type} and would become NULL — use VARCHAR/TEXT?` });
    if (c.type === "VARCHAR" && Math.max(0, ...vals.map((v) => [...v].length)) > 255) out.push({ level: "info", row: i, message: `${c.name}: long text, consider TEXT.` });
  });
  const pks = colsOf(p).map((c, i) => ({ c, i })).filter((x) => x.c.pk && x.c.include);
  if (pks.length) {
    const keys = data.map((r) => pks.map((x) => r[x.i] ?? "").join("\u0001"));
    const dups = keys.length - new Set(keys).size;
    if (dups) out.push({ level: "error", row: pks[0].i, key: "pk", message: `Primary key has ${dups} duplicate value(s).` });
  }
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(tableOf(p))) out.push({ level: "warn", key: "table", message: `Table name “${tableOf(p)}” has special characters; it will be quoted.` });
  return out;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "csvsql",
  title: ["表格转 SQL", "CSV to SQL"],
  openDescription:
    "Turn a CSV/XLSX into a ready-to-run SQL script for SQLite, MySQL or PostgreSQL: CREATE TABLE with inferred column types (INTEGER, BIGINT, DECIMAL, BOOLEAN incl. 是/否, DATE, TIMESTAMP, VARCHAR(n), TEXT — long digit strings such as phone numbers stay text), NOT NULL and a suggested primary key, then batched INSERTs with correct quoting/escaping (quotes, newlines, backslashes, NULL for empty). Column names become snake_case (Chinese names kept, quoted). The schema is the editable table: rename columns, change types, nullability, primary key or leave columns out. Flags values that wouldn't fit their type, duplicate keys and NOT NULL violations.",
  inputs: { exts: [".csv", ".tsv", ".xlsx"], min: 1, max: 1, label: ["选择要导入数据库的表格", "Pick the table to load into a database"] },
  settings: [
    { key: "dialect", label: ["数据库", "Database"], type: "select", default: "sqlite", options: [{ value: "sqlite", label: ["SQLite", "SQLite"] }, { value: "mysql", label: ["MySQL / MariaDB", "MySQL / MariaDB"] }, { value: "postgres", label: ["PostgreSQL", "PostgreSQL"] }, { value: "all", label: ["三种都生成", "All three"] }] },
    { key: "table", label: ["表名", "Table name"], type: "text", default: "" },
    { key: "drop", label: ["先 DROP TABLE IF EXISTS", "DROP TABLE IF EXISTS first"], type: "bool", default: true },
    { key: "transaction", label: ["包在事务里", "Wrap in a transaction"], type: "bool", default: true },
    { key: "batch", label: ["每条 INSERT 的行数", "Rows per INSERT"], type: "number", default: 500, min: 1, max: 5000 },
  ],
  columns: () => [
    { key: "include", label: ["导入", "Include"], type: "bool" },
    { key: "header", label: ["原列名", "Header"], readOnly: true },
    { key: "name", label: ["SQL 列名", "SQL name"] },
    { key: "type", label: ["类型", "Type"], type: "select", options: TYPES },
    { key: "nullable", label: ["可为空", "Nullable"], type: "bool" },
    { key: "pk", label: ["主键", "Primary key"], type: "bool" },
    { key: "_sample", label: ["示例值", "Sample"], readOnly: true, wide: true },
  ],
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty_table", "The table has no data rows.");
    const data = t.rows.map((r) => t.columns.map((c) => r[c]));
    if (!String(settings.table ?? "").trim()) settings.table = sqlName(files[0].split("/").pop()!.replace(/\.[^.]+$/, ""), 0);
    let pkDone = false;
    const rows = t.columns.map((h, i) => {
      const inf = inferType(data.map((r) => r[i] ?? ""));
      const pk = !pkDone && inf.unique && (i === 0 || /编号|^id$|_id$|code|编码|sku|工号|学号/i.test(h)) && ["INTEGER", "BIGINT", "VARCHAR"].includes(inf.type);
      if (pk) pkDone = true;
      return { include: true, header: h, name: sqlName(h, i), type: inf.type, length: inf.length, nullable: inf.nullable, pk };
    });
    return { rows, meta: { data } };
  },
  compute(p) {
    const data = dataOf(p);
    const issues = problems(p);
    const rows = p.rows.map((r, i) => ({ ...r, _sample: data.slice(0, 3).map((d) => d[i]).filter(Boolean).join(" · ").slice(0, 80) }));
    const d = dialects(p)[0];
    const cols = colsOf(p);
    const sql = buildSql(tableOf(p), cols, data.slice(0, 3), d, { ...opts(p), batch: 3 });
    const preview = `<p><b>${data.length}</b> rows → table <code>${esc(ident(tableOf(p), d))}</code> · ${cols.filter((c) => c.include).length} columns · ${dialects(p).join(", ")}</p><pre style="white-space:pre-wrap;font-size:12px">${esc(sql)}</pre>`;
    void typeSql;
    return { rows, issues, preview, summary: `${data.length} rows, ${cols.filter((c) => c.include).length} columns → ${dialects(p).join("/")}`, stats: { rows: data.length, columns: cols.filter((c) => c.include).length, errors: issues.filter((i) => i.level === "error").length } };
  },
  exports: [
    {
      id: "sql", label: ["SQL 脚本", "SQL script"], description: "<table>.<dialect>.sql — CREATE TABLE + INSERTs (one file per chosen database)",
      async run({ project, write }) {
        const errs = problems(project).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const out: string[] = [];
        for (const d of dialects(project)) out.push(await write(`${safeFileName(tableOf(project), "table")}.${d}.sql`, buildSql(tableOf(project), colsOf(project), dataOf(project), d, opts(project))));
        return out;
      },
    },
    {
      id: "schema", label: ["只要建表语句", "Schema only"], description: "<table>.schema.sql — CREATE TABLE only, for every chosen database",
      async run({ project, write }) {
        const parts = dialects(project).map((d) => `-- ${d}\n` + buildSql(tableOf(project), colsOf(project), [], d, { ...opts(project), transaction: false }).split("\n\n").filter((s) => !s.startsWith("--")).join("\n\n"));
        return [await write(`${safeFileName(tableOf(project), "table")}.schema.sql`, parts.join("\n"))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
