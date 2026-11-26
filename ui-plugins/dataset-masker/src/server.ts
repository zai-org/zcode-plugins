import { randomBytes } from "node:crypto";
import { createApp, esc, htmlTable, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { apply, detect, leaks, METHODS, Pseudonyms, type Kind, type Method } from "./mask.ts";

export const NAME = "dataset-masker";
export const VERSION = "0.1.0";
const M_ZH: Record<Method, string> = { keep: "保留", partial: "部分遮盖", hash: "哈希", pseudonym: "化名", generalize: "泛化", scrub: "清除文本中的个人信息", drop: "删除列" };
const headersOf = (p: Project) => (p.meta.headers as string[]) ?? [];
const dataOf = (p: Project) => (p.meta.data as string[][]) ?? [];

function masked(p: Project) {
  const ps = new Pseudonyms();
  const salt = String(p.settings.salt || "");
  const cfg = p.rows.map((r, i) => ({ i, method: (METHODS.includes(r.method as Method) ? r.method : "keep") as Method, kind: String(r.kind) as Kind, prefix: String(r.prefix ?? ""), col: headersOf(p)[i] }));
  const keep = cfg.filter((c) => c.method !== "drop");
  const rows = dataOf(p).map((row) => keep.map((c) => apply(row[c.i] ?? "", c.method, c.kind, { salt, col: c.col, prefix: c.prefix, ps })));
  return { headers: keep.map((c) => c.col), rows, keep };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "mask",
  title: ["数据脱敏", "Dataset Masker"],
  openDescription:
    "Make a safe copy of a CSV/XLSX that contains personal data before sharing it with an outsourcer, a vendor or an AI tool. Each column gets a method: keep, partial mask (138****1234, l***@qinghe.cn, 330106********1234, **** **** **** 0123, 林**), salted hash (same input → same hash, so joins still work), pseudonym (用户0001, consistent per value), generalize (birthday → year, address → province/city/district, amounts → ranges), scrub (finds phone numbers, emails, ID and bank card numbers inside free text) or drop. Columns are detected automatically (身份证, 手机, 邮箱, 姓名, 地址, 生日, 备注…). Warns when kept columns still contain personal data. Original file untouched.",
  inputs: { exts: [".csv", ".tsv", ".xlsx"], min: 1, max: 1, label: ["选择含个人信息的表格", "Pick the table with personal data"] },
  settings: [
    { key: "salt", label: ["哈希密钥（保密；相同密钥=相同哈希）", "Hash key (keep secret; same key = same hashes)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "column", label: ["列", "Column"], readOnly: true },
    { key: "kind", label: ["识别为", "Detected"], type: "select", options: ["name", "phone", "email", "idcard", "bankcard", "address", "date", "id", "text", "number", "other"] },
    { key: "method", label: ["处理方式", "Method"], type: "select", options: METHODS },
    { key: "prefix", label: ["化名前缀", "Pseudonym prefix"] },
    { key: "_before", label: ["处理前", "Before"], readOnly: true, wide: true },
    { key: "_after", label: ["处理后", "After"], readOnly: true, wide: true },
  ],
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    if (!t.rows.length) throw new KitError("empty_table", "The table has no data rows.");
    const data = t.rows.map((r) => t.columns.map((c) => r[c]));
    if (!String(settings.salt ?? "").trim()) settings.salt = randomBytes(9).toString("base64url");
    const rows = t.columns.map((h, i) => { const d = detect(h, data.map((r) => r[i] ?? "")); return { column: h, kind: d.kind, method: d.method, prefix: d.kind === "name" ? "用户" : `${h}-` }; });
    return { rows, meta: { headers: t.columns, data } };
  },
  compute(p) {
    const { headers, rows, keep } = masked(p);
    const data = dataOf(p);
    const issues: Issue[] = [];
    keep.forEach((c, k) => {
      const found = new Set(rows.flatMap((r) => leaks(r[k] ?? "")));
      if (found.size) issues.push({ level: "warn", row: c.i, key: "method", message: `${c.col}: the output still contains ${[...found].join(", ")} (method “${c.method}”). Use partial, hash, scrub or drop.` });
    });
    if (!String(p.settings.salt ?? "").trim() && p.rows.some((r) => r.method === "hash")) issues.push({ level: "error", key: "salt", message: "Set a hash key; without one, hashes of phone numbers can be reversed by guessing." });
    else if (String(p.settings.salt ?? "").length < 8 && p.rows.some((r) => r.method === "hash")) issues.push({ level: "warn", key: "salt", message: "Use a hash key of at least 8 characters." });
    const firstNonEmpty = (i: number) => data.find((r) => (r[i] ?? "").trim())?.[i] ?? "";
    const outRow = (i: number) => { const k = keep.findIndex((c) => c.i === i); if (k < 0) return "(dropped / 已删除)"; const j = data.findIndex((r) => (r[i] ?? "").trim()); return j >= 0 ? rows[j][k] : ""; };
    const view = p.rows.map((r, i) => ({ ...r, _before: firstNonEmpty(i).slice(0, 60), _after: outRow(i).slice(0, 60) }));
    const changed = keep.filter((c) => c.method !== "keep").length + p.rows.filter((r) => r.method === "drop").length;
    const preview = `<p>${data.length} rows · <b>${changed}</b> of ${p.rows.length} columns protected · ${p.rows.filter((r) => r.method === "drop").length} dropped</p>` + htmlTable(headers, rows.slice(0, 8));
    void esc;
    return { rows: view, issues, preview, summary: `${changed} of ${p.rows.length} columns protected, ${issues.filter((i) => i.level !== "info").length} warning(s)`, stats: { rows: data.length, columns: p.rows.length, protected: changed, warnings: issues.length } };
  },
  exports: [
    { id: "csv", label: ["脱敏 CSV", "Masked CSV"], description: "masked.csv", run: async ({ project, write }) => { const m = masked(project); return [await write("masked.csv", toCsv(m.headers, m.rows))]; } },
    { id: "xlsx", label: ["脱敏 Excel", "Masked Excel"], description: "masked.xlsx", run: async ({ project, write }) => { const m = masked(project); return [await write("masked.xlsx", await writeXlsx([{ name: "masked", headers: m.headers, rows: m.rows }]))]; } },
    {
      id: "report", label: ["脱敏说明", "Masking report"], description: "masking-report.md — which column was treated how (no original values, no key)",
      async run({ project, computed, write }) {
        const lines = [`# 数据脱敏说明 / Masking report`, "", `- 原文件 / Source: ${project.inputs[0]}`, `- 行数 / Rows: ${dataOf(project).length}`, `- 日期 / Date: ${new Date().toISOString().slice(0, 10)}`, "", "| 列 Column | 识别为 Detected | 处理 Method |", "|---|---|---|", ...project.rows.map((r) => `| ${r.column} | ${r.kind} | ${M_ZH[r.method as Method] ?? r.method} (${r.method}) |`), "", ...(computed.issues ?? []).filter((i) => i.level !== "info").map((i) => `- ⚠️ ${i.message}`), "", "哈希使用带密钥的 HMAC-SHA256（密钥不在本文件中）。化名在同一次导出内对同一个值保持一致。", "Hashes are HMAC-SHA256 with a secret key (not included). Pseudonyms are consistent for the same value within one export."];
        return [await write("masking-report.md", lines.join("\n") + "\n")];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
