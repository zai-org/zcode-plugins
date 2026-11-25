// 字段映射：从表格推断字段类型、必填、选项；校验每一行；把单元格转换成应用里的值。
export const TYPES = ["text", "longtext", "number", "money", "date", "email", "phone", "url", "select", "boolean"] as const;
export type FieldType = (typeof TYPES)[number];
export interface Field {
  column: string;        // 表格里的列名
  key: string;           // 应用内部的字段名
  label: string;         // 显示名
  type: FieldType;
  required: boolean;
  options?: string[];    // select 的选项
  list: boolean;         // 显示在列表里
  filter: boolean;       // 作为筛选条件
  search: boolean;       // 参与搜索
  hidden?: boolean;      // 完全不在应用里出现
}
export interface Mapping { fields: Field[]; keyField?: string; titleField?: string }
export interface DataIssue { row: number; column: string; value: string; message: string }

const TRUE = new Set(["是", "yes", "y", "true", "1", "✓", "✔", "对", "有"]);
const FALSE = new Set(["否", "no", "n", "false", "0", "✗", "✘", "", "无"]);
const num = (v: string) => { const s = v.replace(/[,\s¥$€£￥]/g, ""); return s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined; };
const dateRe = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/;
export const normDate = (v: string) => { const m = dateRe.exec(v.trim()); if (!m) return undefined; const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : undefined; };
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneRe = /^\+?[\d\s\-().]{6,20}$/;
const urlRe = /^https?:\/\/\S+$/i;

export const fieldKey = (column: string, i: number) => {
  const ascii = column.normalize("NFKD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return /^[a-z]/.test(ascii) ? ascii.slice(0, 32) : `f${i + 1}`;
};

export function inferField(column: string, values: string[], i: number): Field {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  const n = filled.length;
  const share = (ok: (v: string) => boolean) => (n ? filled.filter(ok).length / n : 0);
  const name = column.toLowerCase();
  let type: FieldType = "text";
  if (n && filled.every((v) => TRUE.has(v.toLowerCase()) || FALSE.has(v.toLowerCase())) && !filled.every((v) => /^\d+$/.test(v) && Number(v) > 1)) type = "boolean";
  else if (/phone|tel|mobile|电话|手机/.test(name) && share((v) => phoneRe.test(v)) >= 0.8) type = "phone";
  else if (/e-?mail|邮箱/.test(name) && share((v) => emailRe.test(v)) >= 0.5) type = "email";
  else if (share((v) => num(v) !== undefined) >= 0.85) type = /价|金额|费|price|amount|cost|total|revenue|fee|salary/.test(name) ? "money" : "number";
  else if (share((v) => !!normDate(v)) >= 0.85) type = "date";
  else if (/mail|邮箱/.test(name) || share((v) => emailRe.test(v)) >= 0.8) type = "email";
  else if (/phone|tel|mobile|电话|手机/.test(name) || (share((v) => phoneRe.test(v) && /\d{6}/.test(v.replace(/\D/g, ""))) >= 0.9 && !/id|sku|code|编号/.test(name))) type = "phone";
  else if (share((v) => urlRe.test(v)) >= 0.8) type = "url";
  else {
    const distinct = new Set(filled);
    const avg = n ? filled.reduce((a, v) => a + v.length, 0) / n : 0;
    if (avg > 60) type = "longtext";
    else if (n >= 4 && distinct.size <= Math.min(12, Math.ceil(n / 2)) && avg <= 24 && !/name|名称|姓名|title|标题|备注|note/.test(name)) type = "select";
  }
  const f: Field = { column, key: fieldKey(column, i), label: column, type, required: type !== "boolean" && n >= 3 && (n === values.length || (values.length >= 8 && n / values.length >= 0.9)), list: false, filter: type === "select" || type === "boolean", search: ["text", "longtext", "email", "phone", "select"].includes(type) };
  if (type === "select") f.options = [...new Set(filled)].sort((a, b) => a.localeCompare(b, "zh"));
  return f;
}

export function inferMapping(columns: string[], rows: Record<string, string>[]): Mapping {
  const fields = columns.map((c, i) => inferField(c, rows.map((r) => r[c] ?? ""), i));
  const used = new Set<string>();
  for (const f of fields) { let k = f.key, j = 2; while (used.has(k)) k = `${f.key}_${j++}`; f.key = k; used.add(k); }
  const unique = (f: Field) => { const vals = rows.map((r) => (r[f.column] ?? "").trim()); return vals.filter(Boolean).length >= vals.length - 1 && new Set(vals.filter(Boolean)).size === vals.filter(Boolean).length; };
  const keyF = fields.find((f) => /^(id|sku|编号|编码|code|no\.?|序号)$/i.test(f.column)) ?? fields.find((f) => f.type === "text" && unique(f) && rows.every((r) => (r[f.column] ?? "").length <= 16));
  const titleF = fields.find((f) => f !== keyF && f.type === "text" && /name|名称|姓名|客户|title|标题|商品|customer/i.test(f.column)) ?? fields.find((f) => f !== keyF && f.type === "text");
  let shown = 0;
  for (const f of fields) if (f.type !== "longtext" && shown < 7) { f.list = true; shown++; }
  return { fields, keyField: keyF?.key, titleField: titleF?.key };
}

/** 单元格 → 应用值；返回问题（不改原表）。 */
export function convert(f: Field, raw: string): { value: string | number | boolean | null; problem?: string } {
  const v = (raw ?? "").trim();
  if (!v) return { value: f.type === "boolean" ? false : null, problem: f.required ? "required" : undefined };
  switch (f.type) {
    case "number": case "money": { const x = num(v); return x === undefined ? { value: v, problem: "not a number" } : { value: x }; }
    case "date": { const d = normDate(v); return d ? { value: d } : { value: v, problem: "not a date (YYYY-MM-DD)" }; }
    case "boolean": { const l = v.toLowerCase(); return TRUE.has(l) ? { value: true } : FALSE.has(l) ? { value: false } : { value: false, problem: "not yes/no" }; }
    case "email": return emailRe.test(v) ? { value: v } : { value: v, problem: "not an email address" };
    case "phone": return phoneRe.test(v) ? { value: v } : { value: v, problem: "not a phone number" };
    case "url": return urlRe.test(v) ? { value: v } : { value: v, problem: "not a http(s) URL" };
    case "select": return f.options?.length && !f.options.includes(v) ? { value: v, problem: `not one of the options (${f.options.join(", ")})` } : { value: v };
    default: return { value: v };
  }
}

export function toRecords(m: Mapping, rows: Record<string, string>[]) {
  const issues: DataIssue[] = [];
  const records = rows.map((r, i) => {
    const rec: Record<string, unknown> = {};
    for (const f of m.fields) {
      if (f.hidden) continue;
      const c = convert(f, r[f.column] ?? "");
      rec[f.key] = c.value;
      if (c.problem) issues.push({ row: i + 2, column: f.column, value: r[f.column] ?? "", message: c.problem });
    }
    return rec;
  });
  const key = m.fields.find((f) => f.key === m.keyField);
  if (key) { const seen = new Map<string, number>(); rows.forEach((r, i) => { const v = (r[key.column] ?? "").trim(); if (!v) { if (!key.required) issues.push({ row: i + 2, column: key.column, value: "", message: "missing key" }); return; } if (seen.has(v)) issues.push({ row: i + 2, column: key.column, value: v, message: `duplicate key (also row ${seen.get(v)})` }); else seen.set(v, i + 2); }); }
  return { records, issues };
}
