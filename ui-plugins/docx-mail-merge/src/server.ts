import { zipSync } from "fflate";
import { createApp, esc, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName, type Workspace } from "./kit/workspace.ts";
import { fileNameFor, fillDocx, openDocx, paragraphs, placeholders } from "./merge.ts";

export const NAME = "docx-mail-merge";
export const VERSION = "0.1.0";

const templateOf = (p: Project) => p.inputs.find((f) => /\.docx$/i.test(f))!;
const strRow = (r: Record<string, unknown>, cols: string[]) => Object.fromEntries(cols.map((c) => [c, String(r[c] ?? "")]));
async function template(ws: Workspace, p: Project) {
  return openDocx(await ws.read(templateOf(p)));
}

function plan(p: Project) {
  const cols = (p.meta.columns as string[]) ?? [];
  const used = (p.meta.placeholders as string[]) ?? [];
  const pattern = String(p.settings.fileName || `{${cols[0] ?? "n"}}`);
  const seen = new Map<string, number>();
  const names = p.rows.map((r, i) => {
    let n = safeFileName(fileNameFor(pattern, strRow(r, cols), i), `document-${i + 1}`);
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c > 1) n = `${n}-${c}`;
    return n;
  });
  return { cols, used, names };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "merge",
  title: ["Word 批量套打", "DOCX Mail Merge"],
  openDescription:
    "Mail-merge a Word template with a sheet: pass a .docx whose text contains {{field}} placeholders (in body, tables, headers, footers; placeholders split across formatting runs are handled) and a .xlsx/.csv whose column names match the fields. One output .docx per row, formatting kept. Reports fields missing from the sheet, unused columns and empty values.",
  inputs: { exts: [".docx", ".xlsx", ".csv"], min: 2, max: 2, label: ["选择 Word 模板（.docx）和名单表格", "Pick the Word template (.docx) and the data sheet"] },
  settings: [
    { key: "fileName", label: ["文件名规则", "File name pattern"], type: "text", default: "", help: ["例如 {姓名}-录用通知；{n} 是序号", "e.g. {Name}-offer; {n} = row number"] },
    { key: "zip", label: ["同时打包 zip", "Also make a zip"], type: "bool", default: true },
  ],
  columns: (p) => [
    ...((p.meta.columns as string[]) ?? []).map((c) => ({ key: c, label: [c, c] as [string, string], wide: true })),
    { key: "_file", label: ["输出文件", "Output file"], readOnly: true },
    { key: "_empty", label: ["空字段", "Empty fields"], readOnly: true },
  ],
  newRow: (p) => Object.fromEntries(((p.meta.columns as string[]) ?? []).map((c) => [c, ""])),
  async load({ ws, files }) {
    const docx = files.find((f) => /\.docx$/i.test(f));
    const sheet = files.find((f) => /\.(xlsx|csv|tsv)$/i.test(f));
    if (!docx || !sheet) throw new KitError("missing_input", "Pass one .docx template and one .xlsx/.csv data sheet.");
    const fields = placeholders(openDocx(await ws.read(docx)));
    if (!fields.length) throw new KitError("no_placeholders", `${docx} has no {{field}} placeholders. Type them in Word like {{姓名}} or {{Name}}.`);
    const t = await readTable(ws, sheet);
    return { rows: t.rows.filter((r) => Object.values(r).some((v) => String(v).trim())), meta: { columns: t.columns, placeholders: fields, sheet: t.sheet } };
  },
  async compute(p, { ws }) {
    const { cols, used, names } = plan(p);
    const issues: Issue[] = [];
    const missingCols = used.filter((u) => !cols.includes(u));
    for (const m of missingCols) issues.push({ level: "error", key: m, message: `Template field {{${m}}} has no matching column in the sheet / 表格里没有这一列。Columns: ${cols.join(", ")}` });
    for (const c of cols.filter((c) => !used.includes(c))) issues.push({ level: "info", key: c, message: `Column “${c}” is not used in the template / 模板里没用到这一列` });
    const rows = p.rows.map((r, i) => {
      const empty = used.filter((u) => cols.includes(u) && !String(r[u] ?? "").trim());
      if (empty.length) issues.push({ level: "warn", row: i, message: `Empty: ${empty.join(", ")} / 这些字段为空` });
      return { ...r, _file: `${names[i]}.docx`, _empty: empty.join(", ") };
    });
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) issues.push({ level: "warn", key: "fileName", message: "Some file names repeat; -2, -3 … were added. Use a more specific pattern." });
    let preview = "";
    try {
      const files = await template(ws, p);
      const first = p.rows[0] ? fillDocx(files, strRow(p.rows[0], cols)) : undefined;
      const paras = first ? paragraphs(openDocx(first.bytes)) : paragraphs(files);
      preview = `<div class="muted" style="margin-bottom:6px">${esc(names[0] ?? "")}.docx</div>` + paras.map((t) => `<p style="margin:4px 0">${esc(t)}</p>`).join("");
    } catch (e) {
      issues.push({ level: "error", message: (e as Error).message });
    }
    return {
      rows,
      issues,
      summary: `${p.rows.length} document(s) from ${templateOf(p)}; fields: ${used.map((u) => `{{${u}}}`).join(" ")}. 将生成 ${p.rows.length} 份文档。`,
      stats: { documents: p.rows.length, fields: used.length, missing: missingCols.length },
      preview,
    };
  },
  exports: [
    {
      id: "docx",
      label: ["生成 Word 文件", "Make DOCX files"],
      description: "one .docx per row (plus all-documents.zip when enabled) and merge-log.csv",
      async run(ctx) {
        const p = ctx.project;
        const { cols, used, names } = plan(p);
        const missingCols = used.filter((u) => !cols.includes(u));
        if (missingCols.length) throw new KitError("has_errors", `The sheet has no column for ${missingCols.map((m) => `{{${m}}}`).join(", ")}. Rename a column or the placeholder first.`);
        const files = await template(ctx.ws, p);
        const out: string[] = [];
        const zip: Record<string, Uint8Array> = {};
        const log: unknown[][] = [];
        for (const [i, r] of p.rows.entries()) {
          const { bytes } = fillDocx(files, strRow(r, cols));
          const name = `${names[i]}.docx`;
          out.push(await ctx.write(`documents/${name}`, bytes));
          zip[name] = bytes;
          log.push([i + 1, name, used.filter((u) => !String(r[u] ?? "").trim()).join(" ")]);
        }
        if (p.settings.zip !== false) out.push(await ctx.write("all-documents.zip", zipSync(zip)));
        out.push(await ctx.write("merge-log.csv", toCsv(["#", "File", "Empty fields"], log)));
        return out;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
