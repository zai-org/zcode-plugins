import { num, parseDate } from "./kit/columns.ts";

export type ColType = "text" | "number" | "date" | "email" | "phone";
export interface Opts { trim: boolean; spaces: boolean; fullwidth: boolean; numbers: boolean; dates: boolean; emails: boolean; phones: boolean }

export const halfwidth = (s: string) => s.replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a\uff20\uff0e\uff0b\uff0d]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function detect(header: string, values: string[]): ColType {
  const v = values.map((x) => halfwidth(x).trim()).filter(Boolean);
  if (!v.length) return "text";
  const share = (f: (x: string) => boolean) => v.filter(f).length / v.length;
  if (/电话|手机|联系方式|phone|mobile|tel/i.test(header) || share((x) => /^\+?[\d\s()\-]{7,}$/.test(x) && x.replace(/\D/g, "").length >= 7) >= 0.8) return "phone";
  if (/邮箱|e-?mail/i.test(header) || share((x) => x.includes("@")) >= 0.8) return "email";
  if (/日期|时间|date/i.test(header) || share((x) => /\d/.test(x) && /[-/.年]/.test(x) && !!parseDate(x)) >= 0.8) return "date";
  if (share((x) => !isNaN(num(x))) >= 0.8) return "number";
  return "text";
}

export interface Cell { value: string | number; problem?: string }

export function cleanCell(raw: string, type: ColType, o: Opts): Cell {
  let s = raw ?? "";
  if (o.fullwidth) s = halfwidth(s);
  if (o.trim) s = s.trim();
  if (o.spaces) s = s.replace(/[ \t\u00a0]{2,}/g, " ");
  if (!s) return { value: "" };
  if (type === "number" && o.numbers) {
    const n = num(s);
    return isNaN(n) ? { value: s, problem: "not a number" } : { value: n };
  }
  if (type === "date" && o.dates) {
    const d = parseDate(s);
    return d ? { value: d } : { value: s, problem: "not a date" };
  }
  if (type === "email" && o.emails) {
    const e = s.replace(/\s+/g, "").toLowerCase();
    return EMAIL.test(e) ? { value: e } : { value: e, problem: "invalid email" };
  }
  if (type === "phone" && o.phones) {
    const plus = s.trim().startsWith("+");
    const d = s.replace(/\D/g, "");
    return d.length < 7 ? { value: s, problem: "too short for a phone number" } : { value: (plus ? "+" : "") + d };
  }
  return { value: s };
}

/** 去重用的键：清理后的值拼起来，忽略大小写。 */
export const keyOf = (cells: (string | number)[]) => cells.map((c) => String(c).toLowerCase()).join("\u0001");
