import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFString, PDFHexString, PDFTextField, type PDFField } from "pdf-lib";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature";
export interface FieldInfo { name: string; label: string; type: FieldType; required: boolean; options: string[] }
export interface FormRead { fields: FieldInfo[]; values: Record<string, string | boolean>; encrypted: boolean; error?: string }

function tooltip(f: PDFField): string {
  const v = f.acroField.dict.lookup(PDFName.of("TU"));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText().trim();
  return "";
}

export async function readForm(bytes: Uint8Array): Promise<FormRead> {
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { return { fields: [], values: {}, encrypted: false, error: (e as Error).message }; }
  const fields: FieldInfo[] = [], values: FormRead["values"] = {};
  let form;
  try { form = doc.getForm(); } catch { return { fields, values, encrypted: doc.isEncrypted }; }
  for (const f of form.getFields()) {
    const name = f.getName();
    const base = { name, label: tooltip(f) || name, required: f.isRequired(), options: [] as string[] };
    try {
      if (f instanceof PDFTextField) { fields.push({ ...base, type: "text" }); values[name] = (f.getText() ?? "").replace(/\r\n?/g, "\n"); }
      else if (f instanceof PDFCheckBox) { fields.push({ ...base, type: "checkbox" }); values[name] = f.isChecked(); }
      else if (f instanceof PDFRadioGroup) { fields.push({ ...base, type: "radio", options: f.getOptions() }); values[name] = f.getSelected() ?? ""; }
      else if (f instanceof PDFDropdown) { fields.push({ ...base, type: "dropdown", options: f.getOptions() }); values[name] = f.getSelected().join("; "); }
      else if (f instanceof PDFOptionList) { fields.push({ ...base, type: "list", options: f.getOptions() }); values[name] = f.getSelected().join("; "); }
      else if (f instanceof PDFSignature) { fields.push({ ...base, type: "signature" }); values[name] = f.acroField.dict.has(PDFName.of("V")); }
    } catch { /* 损坏的字段跳过 */ }
  }
  return { fields, values, encrypted: doc.isEncrypted };
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE = /^\+?[\d\s()-]{7,20}$/;
export const looksEmail = (f: FieldInfo) => /e-?mail|邮箱|邮件/i.test(`${f.name} ${f.label}`);
export const looksPhone = (f: FieldInfo) => /phone|mobile|tel|手机|电话|联系方式/i.test(`${f.name} ${f.label}`);
export const looksDate = (f: FieldInfo) => /date|日期|生日|birth/i.test(`${f.name} ${f.label}`);

/** 统一日期写法：YYYY-MM-DD；认不出时原样返回 null */
export function normDate(v: string): string | null {
  const t = v.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}
