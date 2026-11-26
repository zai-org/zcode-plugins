import { num, parseDate } from "./kit/columns.ts";

export interface Rule { kind: string; arg?: string; min?: number; max?: number; list?: string[]; re?: RegExp }
export interface ColumnRules { column: string; rules: Rule[] }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CN_MOBILE = /^(\+?86)?1[3-9]\d{9}$/;

/** 解析规则文本：每行 “列名: 规则, 规则 …”。 */
export function parseRules(text: string): { cols: ColumnRules[]; errors: string[] } {
  const cols: ColumnRules[] = [];
  const errors: string[] = [];
  for (const [n, line] of text.split("\n").entries()) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(.+?)\s*[:：]\s*(.*)$/);
    if (!m) { errors.push(`Line ${n + 1}: write “column: rule, rule”`); continue; }
    const rules: Rule[] = [];
    for (const part of splitTop(m[2])) {
      const p = part.trim();
      if (!p) continue;
      let r: RegExpMatchArray | null;
      if (/^(required|必填)$/i.test(p)) rules.push({ kind: "required" });
      else if (/^(unique|唯一|不重复)$/i.test(p)) rules.push({ kind: "unique" });
      else if (/^(email|邮箱)$/i.test(p)) rules.push({ kind: "email" });
      else if (/^(phone|mobile|手机)$/i.test(p)) rules.push({ kind: "phone" });
      else if (/^(date|日期)$/i.test(p)) rules.push({ kind: "date" });
      else if (/^(integer|int|整数)$/i.test(p)) rules.push({ kind: "integer" });
      else if ((r = p.match(/^(?:number|数字)(?:\s+(-?[\d.]+)?\s*\.\.\s*(-?[\d.]+)?)?$/i))) rules.push({ kind: "number", min: r[1] !== undefined ? Number(r[1]) : undefined, max: r[2] !== undefined ? Number(r[2]) : undefined });
      else if ((r = p.match(/^(?:in|one of|之一)\s*\((.*)\)$/i))) rules.push({ kind: "in", list: r[1].split(/[|｜/、]/).map((x) => x.trim()).filter(Boolean) });
      else if ((r = p.match(/^(?:length|长度)\s*(<=|>=|=)\s*(\d+)$/i))) rules.push({ kind: "length", arg: r[1], min: Number(r[2]) });
      else if ((r = p.match(/^(?:regex|正则)\s*\((.*)\)$/i))) { try { rules.push({ kind: "regex", re: new RegExp(r[1]), arg: r[1] }); } catch { errors.push(`Line ${n + 1}: bad regex ${r[1]}`); } }
      else if ((r = p.match(/^(?:after|晚于)\s+(\d{4}-\d{2}-\d{2})$/i))) rules.push({ kind: "after", arg: r[1] });
      else if ((r = p.match(/^(?:before|早于)\s+(\d{4}-\d{2}-\d{2})$/i))) rules.push({ kind: "before", arg: r[1] });
      else errors.push(`Line ${n + 1}: unknown rule “${p}”`);
    }
    cols.push({ column: m[1].trim(), rules });
  }
  return { cols, errors };
}

function splitTop(s: string) {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if ((ch === "," || ch === "，") && depth === 0) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur);
  return out;
}

const strictDate = (v: string) => {
  const m = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return !!parseDate(v) && !/^\d+$/.test(v) ? parseDate(v) : "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.toISOString().slice(0, 10) : "";
};

/** 检查一个值，返回问题说明（中英）。 */
export function check(v: string, r: Rule, seen?: Map<string, number>): string | undefined {
  const s = (v ?? "").trim();
  if (r.kind === "required") return s ? undefined : "必填 / required";
  if (!s) return undefined;
  switch (r.kind) {
    case "unique": return seen && (seen.get(s) ?? 0) > 1 ? `重复 / duplicate (${s})` : undefined;
    case "email": return EMAIL.test(s) ? undefined : "邮箱格式不对 / not an email";
    case "phone": return CN_MOBILE.test(s.replace(/[\s-]/g, "")) || /^\+\d{8,15}$/.test(s.replace(/[\s-]/g, "")) ? undefined : "手机号不对 / not a mobile number";
    case "date": return strictDate(s) ? undefined : "不是有效日期 / not a valid date";
    case "integer": return /^-?\d+$/.test(s.replace(/,/g, "")) ? undefined : "不是整数 / not an integer";
    case "number": {
      const n = num(s);
      if (isNaN(n)) return "不是数字 / not a number";
      if (r.min !== undefined && n < r.min) return `小于 ${r.min} / below ${r.min}`;
      if (r.max !== undefined && n > r.max) return `大于 ${r.max} / above ${r.max}`;
      return undefined;
    }
    case "in": return r.list!.includes(s) ? undefined : `不在可选值内 / not one of ${r.list!.join("|")}`;
    case "length": { const L = [...s].length; const n = r.min!; return (r.arg === "<=" && L > n) || (r.arg === ">=" && L < n) || (r.arg === "=" && L !== n) ? `长度应 ${r.arg} ${n} / length ${r.arg} ${n}` : undefined; }
    case "regex": return r.re!.test(s) ? undefined : `格式不符 / does not match ${r.arg}`;
    case "after": { const d = strictDate(s); return d && d < r.arg! ? `早于 ${r.arg} / before ${r.arg}` : undefined; }
    case "before": { const d = strictDate(s); return d && d > r.arg! ? `晚于 ${r.arg} / after ${r.arg}` : undefined; }
  }
  return undefined;
}

/** 根据数据猜一份初始规则。 */
export function suggest(headers: string[], rows: string[][]): string {
  return headers.map((h, i) => {
    const v = rows.map((r) => (r[i] ?? "").trim());
    const filled = v.filter(Boolean);
    const rules: string[] = [];
    if (filled.length >= v.length * 0.8) rules.push("required");
    const share = (f: (x: string) => boolean) => (filled.length ? filled.filter(f).length / filled.length : 0);
    if (/编号|工号|学号|id$|编码|货号|sku|code/i.test(h) && new Set(filled).size >= filled.length * 0.8) rules.push("unique");
    if (/邮箱|e-?mail/i.test(h) || share((x) => x.includes("@")) > 0.6) rules.push("email");
    else if (/手机|电话|mobile|phone/i.test(h)) rules.push("phone");
    else if (/日期|date/i.test(h) || share((x) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(x)) > 0.6) rules.push("date");
    else if (share((x) => !isNaN(num(x))) > 0.6) rules.push(share((x) => num(x) >= 0) > 0.8 ? "number 0.." : "number");
    else {
      const uniq = [...new Set(filled)];
      if (uniq.length >= 2 && uniq.length <= 8 && filled.length >= uniq.length * 1.5) rules.push(`in(${uniq.join("|")})`);
    }
    return `${h}: ${rules.join(", ")}`;
  }).join("\n");
}
