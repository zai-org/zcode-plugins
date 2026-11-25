import { pdfFontkit as fontkit } from "./kit/pdf-fontkit.ts";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFHexString,
  PDFTextField,
  PDFArray,
  PDFDict,
  PDFRef,
  rgb,
  type PDFFont,
  type PDFField,
} from "pdf-lib";
import { KitError } from "./kit/workspace.ts";
import { patternColumns, renderPattern } from "./kit/table.ts";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  page: number;
  /** [x, y, w, h]，单位 pt，原点在页面左上角。 */
  rect: [number, number, number, number];
  multiline: boolean;
  maxLength?: number;
  options?: string[];
  fontSize?: number;
}

export interface FormInfo {
  pages: { width: number; height: number }[];
  fields: FormField[];
  hasXfa: boolean;
}

export interface FieldSpec {
  id: string;
  kind: "acro" | "box";
  /** AcroForm 字段名（kind=acro）。 */
  name?: string;
  /** 文字框位置（kind=box）：页码从 0 开始，[x, y, w, h] pt，左上角原点。 */
  page?: number;
  rect?: [number, number, number, number];
  /** 内容：固定文字或含 {列名} 占位符；复选框可写 {列名}=值。 */
  source: string;
  label?: string;
  required?: boolean;
  fontSize?: number;
  minFontSize?: number;
  multiline?: boolean;
  align?: "left" | "center" | "right";
}

export interface Template {
  version: 1;
  pdf: string;
  roster?: string;
  sheet?: string;
  fields: FieldSpec[];
  output: { dir: string; fileName: string; flatten: boolean; merged: boolean };
}

export interface Issue {
  row: number;
  field: string;
  kind: "missing" | "overflow" | "bad_option" | "unknown_field" | "unknown_column";
  message: string;
}

const TRUE_VALUES = new Set(["是", "√", "✓", "✔", "对", "有", "yes", "y", "true", "1", "x", "on", "checked", "勾选"]);

function pdfText(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

function fieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "list";
  if (field instanceof PDFSignature) return "signature";
  return "button";
}

/** 字段的可读名称：优先 TU（提示文字），否则取完整名称的最后一段。 */
function fieldLabel(field: PDFField): string {
  const tu = pdfText(field.acroField.dict.lookup(PDFName.of("TU")));
  if (tu?.trim()) return tu.trim().replace(/\s+/g, " ").slice(0, 200);
  const parts = field.getName().split(".");
  return parts[parts.length - 1].replace(/\[\d+\]$/, "");
}

export async function inspectForm(bytes: Uint8Array): Promise<FormInfo> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const pageRefs = pages.map((page) => page.ref);
  const hasXfa = !!doc.catalog.lookup(PDFName.of("AcroForm"))?.toString().includes("/XFA");
  const fields: FormField[] = [];
  for (const field of doc.getForm().getFields()) {
    const widgets = field.acroField.getWidgets();
    const widget = widgets[0];
    if (!widget) continue;
    const box = widget.getRectangle();
    let page = pageRefs.findIndex((ref) => ref === widget.P());
    if (page < 0) {
      const ref = doc.context.getObjectRef(widget.dict);
      page = pages.findIndex((p) => !!ref && (p.node.Annots()?.asArray() ?? []).includes(ref));
    }
    if (page < 0) page = 0;
    const height = pages[page].getHeight();
    const type = fieldType(field);
    const info: FormField = {
      name: field.getName(),
      label: fieldLabel(field),
      type,
      page,
      rect: [round(box.x), round(height - box.y - box.height), round(box.width), round(box.height)],
      multiline: field instanceof PDFTextField ? field.isMultiline() : false,
    };
    if (field instanceof PDFTextField) {
      const max = field.getMaxLength();
      if (max !== undefined) info.maxLength = max;
      const da = field.acroField.getDefaultAppearance() ?? "";
      const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]);
      if (size > 0) info.fontSize = size;
    }
    if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) info.options = field.getOptions();
    if (field instanceof PDFCheckBox) info.options = ["checked"];
    fields.push(info);
  }
  return { pages: pages.map((page) => ({ width: round(page.getWidth()), height: round(page.getHeight()) })), fields, hasXfa };
}

const round = (value: number) => Math.round(value * 100) / 100;

async function loadPdf(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt/i.test(message)) throw new KitError("encrypted_pdf", "The PDF is encrypted. Remove the password protection first.");
    throw new KitError("bad_pdf", `Cannot read the PDF: ${message}`);
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/[\s_\-.:：()（）[\]【】/\\#*]+/g, "").replace(/\d+$/, "");

/** 按名称相似度给每个字段建议一列（找不到则留空）。 */
export function suggestFields(info: FormInfo, columns: string[]): FieldSpec[] {
  const normalized = columns.map((column) => [column, normalize(column)] as const).filter(([, key]) => key);
  return info.fields
    .filter((field) => field.type !== "signature" && field.type !== "button")
    .map((field, index) => {
      const candidates = [normalize(field.label), normalize(field.name.split(".").pop() ?? "")].filter(Boolean);
      let best = "";
      let score = 0;
      for (const [column, key] of normalized) {
        for (const candidate of candidates) {
          const value = candidate === key ? 3 : candidate.startsWith(key) || key.startsWith(candidate) ? 2 : candidate.includes(key) ? 1 : 0;
          if (value > score) {
            score = value;
            best = column;
          }
        }
      }
      return { id: `f${index + 1}`, kind: "acro" as const, name: field.name, label: field.label, source: best ? `{${best}}` : "" };
    });
}

// ---------------------------------------------------------------- 文字排版

/** 按宽度断行：英文按词，中文按字。 */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const tokens = paragraph.match(/[A-Za-z0-9@._%+\-'’]+\s*|\s+|./gu) ?? [""];
    let line = "";
    for (const token of tokens) {
      const next = line + token;
      if (line && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        lines.push(line.trimEnd());
        line = token.trimStart();
        // 单个词比整行还宽：逐字拆开。
        while (line && font.widthOfTextAtSize(line, size) > width) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface Fit {
  size: number;
  lines: string[];
  fits: boolean;
}

/** 找到能放下文字的最大字号（不小于 minSize）。 */
export function fitText(text: string, font: PDFFont, box: { w: number; h: number }, options: { size?: number; minSize?: number; multiline?: boolean }): Fit {
  const padding = 2;
  const width = Math.max(1, box.w - padding * 2);
  const height = Math.max(1, box.h - padding);
  const start = options.size && options.size > 0 ? options.size : Math.max(6, Math.min(12, box.h * 0.7));
  const min = Math.min(start, options.minSize ?? 6);
  for (let size = start; size >= min - 1e-6; size -= 0.5) {
    if (options.multiline) {
      const lines = wrapText(text, font, size, width);
      if (lines.length * size * 1.15 <= height) return { size, lines, fits: true };
    } else if (font.widthOfTextAtSize(text.replace(/\s*\r?\n\s*/g, " "), size) <= width) {
      return { size, lines: [text.replace(/\s*\r?\n\s*/g, " ")], fits: true };
    }
  }
  const lines = options.multiline ? wrapText(text, font, min, width) : [text.replace(/\s*\r?\n\s*/g, " ")];
  return { size: min, lines, fits: false };
}

// ---------------------------------------------------------------- 填写

export interface FillContext {
  formBytes: Uint8Array;
  fontFace: Uint8Array;
  fontSubset: boolean;
}

export interface FillResult {
  bytes: Uint8Array;
  issues: Issue[];
  values: Record<string, string>;
}

function checkboxValue(source: string, row: Record<string, string>): boolean {
  const condition = /^\{([^{}]+)\}\s*=\s*(.+)$/.exec(source.trim());
  if (condition) return (row[condition[1].trim()] ?? "").trim().toLowerCase() === condition[2].trim().toLowerCase();
  return TRUE_VALUES.has(renderPattern(source, row).trim().toLowerCase());
}

/** 校验模板引用的字段与列是否存在。 */
export function templateProblems(template: Template, info: FormInfo, columns: string[]): Issue[] {
  const names = new Set(info.fields.map((field) => field.name));
  const known = new Set(columns);
  const issues: Issue[] = [];
  for (const spec of template.fields) {
    if (spec.kind === "acro" && (!spec.name || !names.has(spec.name)))
      issues.push({ row: 0, field: spec.label ?? spec.id, kind: "unknown_field", message: `Form field "${spec.name}" does not exist in the PDF.` });
    if (spec.kind === "box" && (!spec.rect || spec.page === undefined || spec.page < 0 || spec.page >= info.pages.length))
      issues.push({ row: 0, field: spec.label ?? spec.id, kind: "unknown_field", message: "Text box needs a page and a rect." });
    for (const column of patternColumns(spec.source.replace(/=.*$/, (m) => (m.includes("}") ? m : ""))))
      if (!known.has(column)) issues.push({ row: 0, field: spec.label ?? spec.id, kind: "unknown_column", message: `Column "${column}" is not in the roster.` });
  }
  return issues;
}

/** 用一行数据填写一份表单。rowNumber 从 1 开始（表头不算）。 */
export async function fillOne(ctx: FillContext, template: Template, row: Record<string, string>, rowNumber: number, flatten: boolean): Promise<FillResult> {
  const doc = await loadPdf(ctx.formBytes);
  doc.registerFontkit(fontkit as any);
  const font = await doc.embedFont(ctx.fontFace, { subset: ctx.fontSubset });
  const form = doc.getForm();
  const issues: Issue[] = [];
  const values: Record<string, string> = {};
  const pages = doc.getPages();
  const issue = (spec: FieldSpec, kind: Issue["kind"], message: string) => issues.push({ row: rowNumber, field: spec.label || spec.name || spec.id, kind, message });

  for (const spec of template.fields) {
    const source = spec.source ?? "";
    if (spec.kind === "acro") {
      let field: PDFField;
      try {
        field = form.getField(spec.name ?? "");
      } catch {
        issue(spec, "unknown_field", `Form field "${spec.name}" does not exist.`);
        continue;
      }
      if (field instanceof PDFCheckBox) {
        const checked = source.trim() ? checkboxValue(source, row) : false;
        values[spec.id] = checked ? "☑" : "☐";
        if (checked) field.check();
        else field.uncheck();
        continue;
      }
      const value = renderPattern(source, row).trim();
      values[spec.id] = value;
      if (!value) {
        if (spec.required) issue(spec, "missing", "Required value is empty.");
        continue;
      }
      if (field instanceof PDFTextField) {
        const widget = field.acroField.getWidgets()[0];
        const box = widget.getRectangle();
        const max = field.getMaxLength();
        if (max !== undefined && [...value].length > max) {
          issue(spec, "overflow", `"${value}" has ${[...value].length} characters; the field allows ${max}.`);
          field.setMaxLength(undefined);
        }
        const multiline = spec.multiline ?? field.isMultiline();
        const fit = fitText(value, font, { w: box.width, h: box.height }, { size: spec.fontSize, minSize: spec.minFontSize, multiline });
        if (!fit.fits) issue(spec, "overflow", `"${value}" does not fit even at ${fit.size} pt.`);
        if (multiline && !field.isMultiline()) field.enableMultiline();
        field.setText(multiline ? fit.lines.join("\n") : value);
        field.setFontSize(fit.size);
      } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const options = field.getOptions();
        const match = options.find((option) => option.toLowerCase() === value.toLowerCase());
        if (!match) issue(spec, "bad_option", `"${value}" is not one of: ${options.join(", ")}.`);
        else if (field instanceof PDFRadioGroup) field.select(match);
        else field.select(match);
      }
    } else {
      const value = renderPattern(source, row).trim();
      values[spec.id] = value;
      if (!value) {
        if (spec.required) issue(spec, "missing", "Required value is empty.");
        continue;
      }
      const page = pages[spec.page ?? 0];
      if (!page || !spec.rect) {
        issue(spec, "unknown_field", "Text box needs a page and a rect.");
        continue;
      }
      const [x, y, w, h] = spec.rect;
      const fit = fitText(value, font, { w, h }, { size: spec.fontSize, minSize: spec.minFontSize, multiline: spec.multiline });
      if (!fit.fits) issue(spec, "overflow", `"${value}" does not fit even at ${fit.size} pt.`);
      const top = page.getHeight() - y;
      const lineHeight = fit.size * 1.15;
      const blockHeight = fit.lines.length * lineHeight;
      // 单行在框内垂直居中；多行从顶部开始。
      let baseline = spec.multiline ? top - 1 - fit.size : top - (h - blockHeight) / 2 - fit.size * 0.88;
      for (const line of fit.lines) {
        const width = font.widthOfTextAtSize(line, fit.size);
        const left = spec.align === "center" ? x + (w - width) / 2 : spec.align === "right" ? x + w - 2 - width : x + 2;
        page.drawText(line, { x: left, y: baseline, size: fit.size, font, color: rgb(0, 0, 0) });
        baseline -= lineHeight;
      }
    }
  }
  form.updateFieldAppearances(font);
  if (flatten) {
    form.flatten();
    // 字体在 flush 时才真正写入；先写入再清理，免得把字体引用当成悬空引用。
    await doc.flush();
    pruneDangling(doc);
  }
  // XFA 表单会忽略 AcroForm 的值：去掉 XFA，强制阅读器使用填好的 AcroForm。
  form.acroForm.dict.delete(PDFName.of("XFA"));
  return { bytes: await doc.save({ useObjectStreams: false }), issues, values };
}

/** pdf-lib 拼平后会留下指向已删除对象的引用；删掉这些引用，其他阅读器才不会报错。 */
export function pruneDangling(doc: PDFDocument) {
  const context = doc.context;
  const seen = new Set<unknown>();
  const missing = (value: unknown) => value instanceof PDFRef && context.lookup(value) === undefined;
  const visit = (value: unknown) => {
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof PDFDict) {
      for (const [key, child] of value.entries()) {
        if (missing(child)) value.delete(key);
        else if (!(child instanceof PDFRef)) visit(child);
      }
    } else if (value instanceof PDFArray) {
      for (let index = value.size() - 1; index >= 0; index--) {
        const child = value.get(index);
        if (missing(child)) value.remove(index);
        else if (!(child instanceof PDFRef)) visit(child);
      }
    }
  };
  for (const [, object] of context.enumerateIndirectObjects()) visit(object);
}

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of files) {
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save({ useObjectStreams: false });
}

export function defaultTemplate(pdf: string, roster?: string): Template {
  return { version: 1, pdf, roster, fields: [], output: { dir: "form-fill-output", fileName: "{序号}.pdf", flatten: true, merged: false } };
}

/** 校验并补全模板（来自 Agent 或文件）。 */
export function normalizeTemplate(value: unknown): Template {
  if (!value || typeof value !== "object") throw new KitError("bad_template", "Template must be an object.");
  const t = value as Partial<Template>;
  if (!t.pdf || typeof t.pdf !== "string") throw new KitError("bad_template", "Template needs a 'pdf' path.");
  const fields = Array.isArray(t.fields) ? t.fields : [];
  const ids = new Set<string>();
  const normalized = fields.map((field, index) => {
    const f = field as FieldSpec;
    let id = typeof f.id === "string" && f.id ? f.id : `f${index + 1}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const kind = f.kind === "box" ? "box" : "acro";
    if (kind === "box" && (!Array.isArray(f.rect) || f.rect.length !== 4 || f.rect.some((n) => typeof n !== "number")))
      throw new KitError("bad_template", `Field ${id}: a text box needs rect [x, y, width, height] in points.`);
    return { ...f, id, kind, source: typeof f.source === "string" ? f.source : "" } as FieldSpec;
  });
  const output = { dir: "form-fill-output", fileName: "{序号}.pdf", flatten: true, merged: false, ...t.output };
  return { version: 1, pdf: t.pdf, roster: t.roster, sheet: t.sheet, fields: normalized, output };
}
