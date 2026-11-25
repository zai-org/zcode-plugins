import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { findPdfFont } from "./kit/fonts.ts";
import { readTable, renderPattern, type TableData } from "./kit/table.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import {
  defaultTemplate,
  fillOne,
  inspectForm,
  mergePdfs,
  normalizeTemplate,
  suggestFields,
  templateProblems,
  type FillContext,
  type Issue,
  type Template,
} from "./form.ts";

export const NAME = "pdf-form-batch-fill";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
export const SURFACE = "editor";
const PDFJS_URI = `ui://${NAME}/pdfjs/{kind}/{file}`;
const MAX_ROWS = 2000;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

/** 表单行：额外提供 {序号} 列（从 1 开始）。 */
function withIndex(rows: Record<string, string>[]) {
  const width = String(rows.length).length;
  return rows.map((row, index) => ({ 序号: String(index + 1).padStart(Math.max(2, width), "0"), ...row }));
}

const issueLine = (issue: Issue) => `row ${issue.row} · ${issue.field}: ${issue.message}`;

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const log = options.log ?? (() => undefined);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: SURFACE,
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log,
    panelMeta: { "zcode/csp": { wasmUnsafeEval: true } },
  });

  const font = () => findPdfFont(options.fontPath);

  async function loadTemplate(value: unknown): Promise<{ template: Template; path?: string }> {
    if (typeof value === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await ws.readText(value));
      } catch (error) {
        if (error instanceof KitError) throw error;
        throw new KitError("bad_template", `${value} is not valid JSON.`);
      }
      return { template: normalizeTemplate(parsed), path: value };
    }
    return { template: normalizeTemplate(value) };
  }

  async function roster(template: Template): Promise<TableData> {
    if (!template.roster) throw new KitError("no_roster", "Set the template's 'roster' to a .csv or .xlsx file in the workspace.");
    const table = await readTable(ws, template.roster, template.sheet);
    if (table.rows.length > MAX_ROWS) throw new KitError("too_many_rows", `The roster has ${table.rows.length} rows; the limit is ${MAX_ROWS}.`);
    return { ...table, columns: ["序号", ...table.columns.filter((c) => c !== "序号")], rows: withIndex(table.rows) };
  }

  async function context(template: Template): Promise<FillContext> {
    const { face, subset } = await font();
    return { formBytes: await ws.read(template.pdf), fontFace: face, fontSubset: subset };
  }

  /** 全部行逐一填写：dryRun 时只检查不写文件。 */
  async function runAll(template: Template, { dryRun, rows: only }: { dryRun: boolean; rows?: number[] }) {
    const table = await roster(template);
    const ctx = await context(template);
    const info = await inspectForm(ctx.formBytes);
    const problems = templateProblems(template, info, table.columns);
    if (problems.length && problems.some((p) => p.kind === "unknown_field"))
      throw new KitError("bad_template", problems.map(issueLine).join("\n"));
    const issues: Issue[] = [...problems];
    const files: string[] = [];
    const outputs: Uint8Array[] = [];
    const used = new Set<string>();
    const perRow: { row: number; file?: string; issues: number }[] = [];
    for (let index = 0; index < table.rows.length; index++) {
      const number = index + 1;
      if (only && !only.includes(number)) continue;
      const row = table.rows[index];
      const result = await fillOne(ctx, template, row, number, template.output.flatten);
      issues.push(...result.issues);
      let file: string | undefined;
      if (!dryRun) {
        let name = safeFileName(renderPattern(template.output.fileName || "{序号}.pdf", row), `${number}`);
        if (!/\.pdf$/i.test(name)) name += ".pdf";
        let candidate = name;
        for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name.replace(/\.pdf$/i, `-${n}.pdf`);
        used.add(candidate.toLowerCase());
        file = await ws.write(`${template.output.dir || "form-fill-output"}/${candidate}`, result.bytes);
        files.push(file);
        if (template.output.merged) outputs.push(result.bytes);
      }
      perRow.push({ row: number, file, issues: result.issues.length });
    }
    let merged: string | undefined;
    let report: string | undefined;
    if (!dryRun) {
      const dir = template.output.dir || "form-fill-output";
      if (template.output.merged && outputs.length) {
        // 合并前统一拼平，避免不同份的同名字段互相覆盖。
        const flattened: Uint8Array[] = [];
        if (template.output.flatten) flattened.push(...outputs);
        else for (const entry of perRow) flattened.push((await fillOne(ctx, template, table.rows[entry.row - 1], entry.row, true)).bytes);
        merged = await ws.write(`${dir}/_merged.pdf`, await mergePdfs(flattened));
      }
      const csv = ["row,file,field,problem,detail"]
        .concat(
          perRow.flatMap((entry) => {
            const rowIssues = issues.filter((issue) => issue.row === entry.row);
            if (!rowIssues.length) return [[entry.row, entry.file ?? "", "", "ok", ""].map(csvCell).join(",")];
            return rowIssues.map((issue) => [entry.row, entry.file ?? "", issue.field, issue.kind, issue.message].map(csvCell).join(","));
          }),
        )
        .join("\n");
      report = await ws.write(`${dir}/_report.csv`, "\uFEFF" + csv + "\n");
    }
    return { issues, files, merged, report, rows: perRow.length, total: table.rows.length };
  }

  const templateInput = z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .describe("Template object, or the workspace path of a saved .formfill.json template.");

  tool(
    "form_open",
    {
      description:
        "Open the PDF Form Batch Fill panel for a blank PDF form and a roster (CSV/XLSX, first row = headers). Lists the PDF's fillable fields (name, label, type, page, position) and the roster columns, and proposes a field→column mapping. Pass `template` to reopen a saved .formfill.json. Call this first; then adjust the mapping with template_save, run form_check, then form_generate.",
      input: {
        pdf: z.string().optional().describe("Workspace path of the blank PDF form."),
        roster: z.string().optional().describe("Workspace path of the roster (.csv, .tsv or .xlsx)."),
        sheet: z.string().optional().describe("Worksheet name for .xlsx rosters (default: first non-empty sheet)."),
        template: z.string().optional().describe("Workspace path of a saved .formfill.json template."),
      },
      openPanel: true,
      readOnly: true,
    },
    async ({ pdf, roster: rosterPath, sheet, template: templatePath }) => {
      let template: Template;
      if (templatePath) template = (await loadTemplate(templatePath)).template;
      else if (pdf) template = defaultTemplate(pdf, rosterPath);
      else throw new KitError("missing_input", "Pass `pdf` (and usually `roster`), or a saved `template`.");
      if (sheet) template.sheet = sheet;
      if (rosterPath) template.roster = rosterPath;
      const info = await inspectForm(await ws.read(template.pdf));
      let table: TableData | undefined;
      if (template.roster) table = await roster(template);
      if (!templatePath) template.fields = suggestFields(info, table?.columns ?? []);
      const fontInfo = await font().then((f) => f.path).catch((error: Error) => `missing — ${error.message}`);
      const lines = [
        `${template.pdf}: ${info.pages.length} page(s), ${info.fields.length} fillable field(s)${info.hasXfa ? " (XFA form: the filled copies use the AcroForm fields)" : ""}.`,
        ...template.fields.slice(0, 60).map((f) => `- ${f.id} [${info.fields.find((x) => x.name === f.name)?.type ?? f.kind}] ${f.label ?? f.name} ← ${f.source || "(not mapped)"}`),
        table ? `Roster ${template.roster}: ${table.rows.length} row(s); columns: ${table.columns.join(", ")}.` : "No roster yet.",
        info.fields.length ? "" : "This PDF has no fillable fields: add text boxes (kind \"box\" with page and rect [x,y,w,h] in points, origin top-left) in the panel or with template_save.",
        `Font for filled text: ${fontInfo}`,
      ].filter(Boolean);
      return {
        text: lines.join("\n"),
        structured: {
          kind: "form",
          template,
          templatePath,
          info,
          roster: table ? { columns: table.columns, rowCount: table.rows.length, sample: table.rows.slice(0, 5) } : null,
        },
      };
    },
  );

  tool(
    "roster_read",
    {
      description: "Read a roster table (.csv/.tsv/.xlsx, first row = headers): columns, row count and the first rows.",
      input: { path: z.string(), sheet: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
      readOnly: true,
      visibility: ["model", "app"],
    },
    async ({ path, sheet, limit }) => {
      const table = await readTable(ws, path, sheet);
      const rows = withIndex(table.rows);
      return {
        text: `${path}: ${rows.length} row(s). Columns: ${table.columns.join(", ")}${table.sheets.length ? `. Sheets: ${table.sheets.join(", ")}` : ""}`,
        structured: { columns: ["序号", ...table.columns], rowCount: rows.length, rows: rows.slice(0, limit ?? 20), sheets: table.sheets, sheet: table.sheet },
      };
    },
  );

  tool(
    "template_save",
    {
      description:
        'Save a fill template as JSON in the workspace (use a .formfill.json name) so the same form can be filled again later. Template shape: {pdf, roster, sheet?, fields:[{id, kind:"acro", name:<PDF field name>, source:"{列名}" | literal | "{列名}=值" for checkboxes, required?, fontSize?, minFontSize?, multiline?} | {id, kind:"box", page, rect:[x,y,w,h] pt from top-left, source, ...}], output:{dir, fileName:"{姓名}-报名表.pdf", flatten, merged}}. The virtual column {序号} is the 1-based row number.',
      input: { path: z.string(), template: z.record(z.string(), z.unknown()) },
    },
    async ({ path, template }) => {
      const normalized = normalizeTemplate(template);
      const target = /\.json$/i.test(path) ? path : `${path}.formfill.json`;
      const written = await ws.write(target, JSON.stringify(normalized, null, 2) + "\n");
      return { text: `Saved template to ${written} (${normalized.fields.length} field(s)).`, structured: { kind: "saved", path: written, template: normalized } };
    },
  );

  tool(
    "form_check",
    {
      description:
        "Check every roster row against the template without writing files: empty required values, text that does not fit its field even at the minimum font size, values longer than a field's max length, options that are not in a radio/dropdown list, unknown fields or columns.",
      input: { template: templateInput },
      readOnly: true,
      timeoutMs: 600_000,
    },
    async ({ template: value }) => {
      const { template } = await loadTemplate(value);
      const result = await runAll(template, { dryRun: true });
      const head = result.issues.length
        ? `${result.issues.length} problem(s) in ${new Set(result.issues.map((i) => i.row)).size} row(s) of ${result.total}:`
        : `All ${result.total} row(s) fit with no missing required values.`;
      return { text: [head, ...result.issues.slice(0, 80).map(issueLine)].join("\n"), structured: { kind: "check", issues: result.issues, total: result.total } };
    },
  );

  tool(
    "form_generate",
    {
      description:
        "Fill the form once per roster row and write the PDFs to the template's output folder (file names from output.fileName, e.g. \"{姓名}-报名表.pdf\"), plus _report.csv listing problems per row and, when output.merged is true, _merged.pdf. Pass `rows` (1-based) to regenerate only some rows.",
      input: { template: templateInput, rows: z.array(z.number().int().min(1)).optional() },
      timeoutMs: 900_000,
    },
    async ({ template: value, rows }) => {
      const { template } = await loadTemplate(value);
      const result = await runAll(template, { dryRun: false, rows });
      const text = [
        `Wrote ${result.files.length} PDF(s) to ${template.output.dir}/.`,
        result.merged ? `Merged file: ${result.merged}` : "",
        `Report: ${result.report}`,
        result.issues.length ? `${result.issues.length} problem(s):` : "No problems found.",
        ...result.issues.slice(0, 40).map(issueLine),
      ].filter(Boolean);
      return { text: text.join("\n"), structured: { kind: "generated", files: result.files, merged: result.merged, report: result.report, issues: result.issues } };
    },
  );

  tool(
    "form_preview",
    {
      description: "Fill the form with one roster row and return the PDF bytes (base64) for the panel preview.",
      input: { template: templateInput, row: z.number().int().min(1) },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ template: value, row }) => {
      const { template } = await loadTemplate(value);
      const table = await roster(template);
      const data = table.rows[row - 1];
      if (!data) throw new KitError("bad_row", `Row ${row} does not exist (the roster has ${table.rows.length}).`);
      const result = await fillOne(await context(template), template, data, row, true);
      return { text: `Row ${row}: ${result.issues.length} problem(s).`, structured: { pdf: Buffer.from(result.bytes).toString("base64"), issues: result.issues, values: result.values, row: data } };
    },
  );

  tool(
    "pdf_data",
    { description: "Return a workspace PDF as base64 for the panel preview.", input: { path: z.string() }, visibility: ["app"], readOnly: true },
    async ({ path }) => {
      const bytes = await ws.read(path, 40 * 1024 * 1024);
      return { text: `${path}: ${bytes.length} bytes`, structured: { pdf: bytes.toString("base64") } };
    },
  );

  tool(
    "workspace_files",
    {
      description: "List workspace files with the given extensions (for the panel's file pickers).",
      input: { exts: z.array(z.string()).max(10) },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ exts }) => {
      const files = await ws.list({ exts, limit: 500 });
      return { text: `${files.length} file(s)`, structured: { files: files.map((f) => f.path) } };
    },
  );

  // pdf.js 的 CMap 与标准字体：面板没有网络，经资源读取。
  server.registerResource(
    "pdfjs-data",
    new ResourceTemplate(PDFJS_URI, { list: undefined }),
    { mimeType: "application/octet-stream" },
    async (uri, { kind, file }) => {
      const folder = ({ cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>)[String(kind)];
      const name = String(file);
      if (!folder || !/^[\w.-]+$/.test(name)) throw new KitError("bad_resource", uri.href);
      const data = await readFile(join(options.assetRoot, "pdfjs", folder, name));
      return { contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: data.toString("base64") }] };
    },
  );

  return server;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
