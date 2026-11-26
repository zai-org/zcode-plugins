import { createApp, esc, htmlTable, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { choices, generate, TYPES, type ColDef, type ColType } from "./gen.ts";

export const NAME = "test-data-generator";
export const VERSION = "0.1.0";
const DEFAULT: [string, ColType, string, boolean][] = [
  ["id", "sequence", "C{0000}", true], ["姓名", "name", "", false], ["手机", "phone", "", true], ["邮箱", "email", "", true], ["城市", "city", "", false],
  ["注册日期", "date", "2024-01-01..2026-11-30", false], ["会员等级", "choice", "普通*6|银卡*3|金卡*1", false], ["积分", "integer", "0..5000", false], ["余额", "decimal", "0..999.99", false],
];
const cols = (p: Project): ColDef[] => p.rows.map((r) => ({ name: String(r.name ?? "").trim() || "col", type: (TYPES as readonly string[]).includes(String(r.type)) ? (r.type as ColType) : "text", arg: String(r.arg ?? ""), blank: Math.min(1, Math.max(0, Number(r.blank ?? 0) || 0)) }));
const uniq = (p: Project) => new Set(p.rows.filter((r) => r.unique).map((r) => String(r.name)));
const make = (p: Project, count = Number(p.settings.count ?? 100)) => generate(cols(p), Math.min(100000, Math.max(1, count)), Number(p.settings.seed ?? 42), p.settings.locale !== "en", uniq(p));
const NUM: ColType[] = ["integer", "decimal"];
const typed = (c: ColDef, v: string) => (v === "" ? "" : NUM.includes(c.type) ? Number(v) : c.type === "boolean" ? v === "true" : v);

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "fakedata",
  title: ["测试数据生成", "Test Data Generator"],
  openDescription:
    "Generate realistic fake test data from a column list — Chinese or English names, mobile numbers, emails, cities, addresses, companies, dates/datetimes in a range, integers/decimals in a range, booleans with a probability, weighted choices (“普通*6|银卡*3|金卡*1”), UUIDs, IDs (“C{0000}”), patterns (“ORD-####-??”), lorem/Chinese text, URLs, IPs; optional share of blanks and unique columns. Same seed = same data. Start from the built-in customer template or a schema sheet (columns 列名/name, 类型/type, 参数/arg). All values are made up (example.com emails, 555 numbers in English), so no real personal data. Export CSV, Excel, JSON and SQL INSERTs.",
  inputs: { exts: [".csv", ".xlsx"], min: 0, max: 1, label: ["（可选）选择字段定义表", "(Optional) pick a column-definition sheet"] },
  settings: [
    { key: "count", label: ["生成行数", "Rows"], type: "number", default: 100, min: 1, max: 100000 },
    { key: "locale", label: ["语言", "Locale"], type: "select", default: "zh", options: [{ value: "zh", label: ["中文（姓名、手机号、城市）", "Chinese"] }, { value: "en", label: ["英文", "English"] }] },
    { key: "seed", label: ["随机种子（相同=相同数据）", "Seed (same seed = same data)"], type: "number", default: 42 },
    { key: "table", label: ["SQL 表名", "SQL table name"], type: "text", default: "test_data" },
  ],
  columns: () => [
    { key: "name", label: ["列名", "Column"] },
    { key: "type", label: ["类型", "Type"], type: "select", options: [...TYPES] },
    { key: "arg", label: ["参数", "Argument"], wide: true },
    { key: "blank", label: ["空值比例 0–1", "Blank share 0–1"], type: "number" },
    { key: "unique", label: ["唯一", "Unique"], type: "bool" },
    { key: "_sample", label: ["示例", "Sample"], readOnly: true, wide: true },
  ],
  newRow: () => ({ name: "new_column", type: "text", arg: "", blank: 0, unique: false }),
  async load({ ws, files }) {
    if (!files.length) return { rows: DEFAULT.map(([name, type, arg, unique]) => ({ name, type, arg, blank: 0, unique })) };
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { name: ["列名", "字段", "名称", "name", "column", "field"], type: ["类型", "type"], arg: ["参数", "选项", "范围", "arg", "args", "options", "range"], blank: ["空值比例", "blank", "null"], unique: ["唯一", "unique"] });
    if (!m.name || !m.type) throw new KitError("bad_schema", "The definition sheet needs columns 列名/name and 类型/type (optional: 参数/arg, 空值比例/blank, 唯一/unique).");
    return { rows: t.rows.map((r) => ({ name: r[m.name!], type: r[m.type!].toLowerCase(), arg: m.arg ? r[m.arg] : "", blank: m.blank ? Number(r[m.blank]) || 0 : 0, unique: m.unique ? /^(1|true|yes|是|y)$/i.test(r[m.unique]) : r[m.type!].toLowerCase() === "sequence" || r[m.type!].toLowerCase() === "uuid" })) };
  },
  compute(p) {
    const issues: Issue[] = [];
    const cs = cols(p);
    const names = new Set<string>();
    p.rows.forEach((r, i) => {
      if (!(TYPES as readonly string[]).includes(String(r.type))) issues.push({ level: "error", row: i, key: "type", message: `Unknown type “${r.type}”. Use one of: ${TYPES.join(", ")}` });
      if (names.has(cs[i].name)) issues.push({ level: "error", row: i, key: "name", message: `Duplicate column name ${cs[i].name}` });
      names.add(cs[i].name);
      if (cs[i].type === "choice" && !choices(cs[i].arg).length) issues.push({ level: "error", row: i, key: "arg", message: `${cs[i].name}: list the choices, e.g. 普通*6|银卡*3|金卡*1` });
      if ((cs[i].type === "integer" || cs[i].type === "decimal") && cs[i].arg && !/^\s*-?[\d.]*\s*\.\.\s*-?[\d.]*\s*$/.test(cs[i].arg)) issues.push({ level: "warn", row: i, key: "arg", message: `${cs[i].name}: range should look like 0..5000` });
      if ((cs[i].type === "date" || cs[i].type === "datetime") && cs[i].arg && !/\d{4}-\d{2}-\d{2}\s*\.\.\s*\d{4}-\d{2}-\d{2}/.test(cs[i].arg)) issues.push({ level: "warn", row: i, key: "arg", message: `${cs[i].name}: range should look like 2024-01-01..2026-12-31` });
    });
    const count = Number(p.settings.count ?? 100);
    const { rows: sample } = make(p, Math.min(count, 8));
    const { dupes } = make(p);
    for (const d of dupes) issues.push({ level: "warn", message: `${d}: not enough different values for ${count} unique rows; some repeat. Widen the range or untick Unique.` });
    const rows = p.rows.map((r, i) => ({ ...r, _sample: sample.slice(0, 3).map((x) => x[i]).join(" · ") }));
    const preview = `<p><b>${count}</b> rows × ${cs.length} columns · seed ${p.settings.seed ?? 42} · ${p.settings.locale === "en" ? "English" : "中文"}</p>` + htmlTable(cs.map((c) => c.name), sample);
    void esc;
    return { rows, issues, preview, summary: `${count} rows × ${cs.length} columns`, stats: { rows: count, columns: cs.length } };
  },
  exports: [
    { id: "csv", label: ["CSV", "CSV"], description: "test-data.csv", run: async ({ project, write }) => [await write("test-data.csv", toCsv(cols(project).map((c) => c.name), make(project).rows))] },
    {
      id: "xlsx", label: ["Excel", "Excel"], description: "test-data.xlsx (numbers and booleans typed)",
      async run({ project, write }) { const cs = cols(project); return [await write("test-data.xlsx", await writeXlsx([{ name: "data", headers: cs.map((c) => c.name), rows: make(project).rows.map((r) => r.map((v, i) => typed(cs[i], v))) }]))]; },
    },
    {
      id: "json", label: ["JSON", "JSON"], description: "test-data.json (array of objects; blanks as null)",
      async run({ project, write }) { const cs = cols(project); return [await write("test-data.json", JSON.stringify(make(project).rows.map((r) => Object.fromEntries(r.map((v, i) => [cs[i].name, v === "" ? null : typed(cs[i], v)]))), null, 2) + "\n")]; },
    },
    {
      id: "sql", label: ["SQL INSERT", "SQL INSERT"], description: "test-data.sql — INSERT statements (standard SQL quoting)",
      async run({ project, write }) {
        const cs = cols(project);
        const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const t = q(String(project.settings.table || "test_data"));
        const lit = (c: ColDef, v: string) => (v === "" ? "NULL" : NUM.includes(c.type) ? v : c.type === "boolean" ? (v === "true" ? "TRUE" : "FALSE") : `'${v.replace(/'/g, "''")}'`);
        const rows = make(project).rows;
        const parts: string[] = [];
        for (let k = 0; k < rows.length; k += 500) parts.push(`INSERT INTO ${t} (${cs.map((c) => q(c.name)).join(", ")}) VALUES\n${rows.slice(k, k + 500).map((r) => `  (${r.map((v, i) => lit(cs[i], v)).join(", ")})`).join(",\n")};`);
        return [await write("test-data.sql", parts.join("\n\n") + "\n")];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
