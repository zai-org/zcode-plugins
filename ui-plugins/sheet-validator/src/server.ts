import { createApp, esc, toCsv, type AppDef, type Column, type Issue, type Project } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { check, parseRules, suggest } from "./rules.ts";

export const NAME = "sheet-validator";
export const VERSION = "0.1.0";
const headersOf = (p: Project) => (p.meta.headers as string[]) ?? [];
const numOr = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) && !/^0\d/.test(v.trim()) ? Number(v) : v);

function validate(p: Project) {
  const headers = headersOf(p);
  const { cols, errors } = parseRules(String(p.settings.rules ?? ""));
  const problems: { row: number; col: number; message: string }[] = [];
  const ruleErrors = [...errors];
  for (const c of cols) {
    const ci = headers.indexOf(c.column);
    if (ci < 0) { ruleErrors.push(`Column “${c.column}” is not in the table (columns: ${headers.join(", ")})`); continue; }
    const counts = new Map<string, number>();
    for (const r of p.rows) { const v = String(r[`c${ci}`] ?? "").trim(); if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
    p.rows.forEach((r, ri) => {
      for (const rule of c.rules) {
        const msg = check(String(r[`c${ci}`] ?? ""), rule, counts);
        if (msg) { problems.push({ row: ri, col: ci, message: msg }); break; }
      }
    });
  }
  return { problems, ruleErrors };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "validate",
  title: ["表格数据校验", "Sheet Validator"],
  openDescription:
    "Check a CSV/XLSX against simple rules before importing or submitting it: one line per column, e.g. “工号: required, unique”, “手机: phone”, “邮箱: email”, “入职日期: date, after 2000-01-01”, “月薪: number 0..100000”, “部门: in(市场部|设计部|研发部)”, “备注: length<=50”, “编码: regex(^[A-Z]{3}-\\d{3}$)”. Rules are suggested from the data on open. Lists every failing cell; fix cells in the table and re-check. Export checked.xlsx (bad cells red with the reason as a note), errors.csv and valid-rows.csv / invalid-rows.csv.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择要校验的表格", "Pick the table to check"] },
  settings: [
    { key: "rules", label: ["校验规则（每行：列名: 规则, 规则）", "Rules (one line per column: name: rule, rule)"], type: "textarea", default: "", help: ["可用：required unique email phone date integer number 最小..最大 in(A|B) length<=N regex(…) after/before 日期", "Available: required unique email phone date integer number min..max in(A|B) length<=N regex(…) after/before date"] },
  ],
  columns: (p) => [...headersOf(p).map((h, i): Column => ({ key: `c${i}`, label: [h, h] })), { key: "_errors", label: ["问题", "Problems"], readOnly: true, wide: true }],
  newRow: (p) => Object.fromEntries(headersOf(p).map((_, i) => [`c${i}`, ""])),
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty_table", "The table has no data rows.");
    const matrix = t.rows.map((r) => t.columns.map((c) => r[c]));
    if (!String(settings.rules ?? "").trim()) settings.rules = suggest(t.columns, matrix);
    return { rows: matrix.map((cells) => Object.fromEntries(cells.map((v, i) => [`c${i}`, v]))), meta: { headers: t.columns } };
  },
  compute(p) {
    const { problems, ruleErrors } = validate(p);
    const headers = headersOf(p);
    const issues: Issue[] = [
      ...ruleErrors.map((m): Issue => ({ level: "error", key: "rules", message: m })),
      ...problems.slice(0, 300).map((x): Issue => ({ level: "warn", row: x.row, key: `c${x.col}`, message: `${headers[x.col]}: ${x.message} — “${p.rows[x.row][`c${x.col}`] ?? ""}”` })),
    ];
    const byRow = new Map<number, string[]>();
    for (const x of problems) byRow.set(x.row, [...(byRow.get(x.row) ?? []), `${headers[x.col]}: ${x.message.split(" / ")[0]}`]);
    const rows = p.rows.map((r, i) => ({ ...r, _errors: (byRow.get(i) ?? []).join("；") }));
    const perCol = headers.map((h, i) => [h, problems.filter((x) => x.col === i).length]).filter(([, n]) => Number(n) > 0);
    const bad = byRow.size;
    const preview = `<p>${bad ? `❌ <b>${bad}</b> of ${p.rows.length} rows have problems (${problems.length} cells)` : `✅ All ${p.rows.length} rows pass`}</p>` +
      (perCol.length ? `<table class="data"><thead><tr><th>Column / 列</th><th>Problems / 问题数</th></tr></thead><tbody>${perCol.map(([h, n]) => `<tr><td>${esc(h)}</td><td>${n}</td></tr>`).join("")}</tbody></table>` : "");
    return { rows, issues, preview, summary: bad ? `${bad} of ${p.rows.length} rows fail (${problems.length} problems)` : `All ${p.rows.length} rows pass`, stats: { rows: p.rows.length, badRows: bad, problems: problems.length, ruleErrors: ruleErrors.length } };
  },
  exports: [
    {
      id: "xlsx", label: ["标注问题的 Excel", "Checked Excel"], description: "checked.xlsx — failing cells red with the reason as a note, plus a problems sheet",
      async run({ project, write }) {
        const { problems } = validate(project);
        const headers = headersOf(project);
        return [await write("checked.xlsx", await writeXlsx([
          { name: "checked", headers, rows: project.rows.map((r) => headers.map((_, i) => numOr(String(r[`c${i}`] ?? "")))), marks: problems.map((x) => ({ row: x.row, col: x.col, color: "#FCA5A5", note: x.message })) },
          { name: "problems", headers: ["row", "column", "value", "problem"], rows: problems.map((x) => [x.row + 2, headers[x.col], String(project.rows[x.row][`c${x.col}`] ?? ""), x.message]) },
        ]))];
      },
    },
    {
      id: "csv", label: ["问题清单 + 合格/不合格行 CSV", "Problems + valid/invalid rows CSV"], description: "errors.csv, valid-rows.csv and invalid-rows.csv",
      async run({ project, write }) {
        const { problems } = validate(project);
        const headers = headersOf(project);
        const bad = new Set(problems.map((x) => x.row));
        const line = (r: Record<string, unknown>) => headers.map((_, i) => r[`c${i}`]);
        return [
          await write("errors.csv", toCsv(["row", "column", "value", "problem"], problems.map((x) => [x.row + 2, headers[x.col], project.rows[x.row][`c${x.col}`], x.message]))),
          await write("valid-rows.csv", toCsv(headers, project.rows.filter((_, i) => !bad.has(i)).map(line))),
          await write("invalid-rows.csv", toCsv(headers, project.rows.filter((_, i) => bad.has(i)).map(line))),
        ];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
