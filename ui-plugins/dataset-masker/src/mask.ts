import { createHmac } from "node:crypto";

export type Method = "keep" | "partial" | "hash" | "pseudonym" | "generalize" | "scrub" | "drop";
export const METHODS: Method[] = ["keep", "partial", "hash", "pseudonym", "generalize", "scrub", "drop"];
export type Kind = "name" | "phone" | "email" | "idcard" | "bankcard" | "address" | "date" | "id" | "text" | "number" | "other";

const PHONE = /(?<!\d)(\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IDCARD = /(?<!\d)[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
const BANK = /(?<!\d)(62|4\d|5[1-5])\d{14,17}(?!\d)/g;

export function detect(header: string, values: string[]): { kind: Kind; method: Method } {
  const v = values.map((x) => x.trim()).filter(Boolean);
  const share = (re: RegExp) => (v.length ? v.filter((x) => new RegExp(`^${re.source}$`).test(x.replace(/\s/g, ""))).length / v.length : 0);
  const h = header.toLowerCase();
  if (/身份证|证件号|id ?card|idno|ssn/.test(h) || share(IDCARD) > 0.6) return { kind: "idcard", method: "partial" };
  if (/银行卡|卡号|bank|card ?no|account/.test(h) || share(BANK) > 0.6) return { kind: "bankcard", method: "partial" };
  if (/手机|电话|phone|mobile|tel/.test(h) || share(PHONE) > 0.6) return { kind: "phone", method: "partial" };
  if (/邮箱|e-?mail/.test(h) || share(EMAIL) > 0.6) return { kind: "email", method: "partial" };
  if (/姓名|名字|联系人|收件人|^name$|full ?name|customer/.test(h)) return { kind: "name", method: "pseudonym" };
  if (/地址|address|住址/.test(h)) return { kind: "address", method: "generalize" };
  if (/生日|出生|birth|dob/.test(h)) return { kind: "date", method: "generalize" };
  if (/备注|说明|note|comment|remark|描述/.test(h)) return { kind: "text", method: "scrub" };
  if (/(^|_)id$|编号|会员号|工号|学号/.test(h)) return { kind: "id", method: "keep" };
  if (v.length && v.every((x) => !isNaN(Number(x)))) return { kind: "number", method: "keep" };
  return { kind: "other", method: "keep" };
}

const keepEnds = (s: string, a: number, b: number, ch = "*") => { const c = [...s]; if (c.length <= a + b) return ch.repeat(c.length); return c.slice(0, a).join("") + ch.repeat(c.length - a - b) + (b ? c.slice(-b).join("") : ""); };

export function partial(v: string, kind: Kind): string {
  const s = v.trim();
  if (!s) return "";
  switch (kind) {
    case "phone": { const d = s.replace(/\D/g, ""); return d.length >= 7 ? d.slice(0, 3) + "****" + d.slice(-4) : keepEnds(s, 1, 1); }
    case "email": { const [u, dom] = s.split("@"); return dom ? `${u[0]}***@${dom}` : keepEnds(s, 1, 0); }
    case "idcard": return s.length >= 15 ? s.slice(0, 6) + "*".repeat(s.length - 10) + s.slice(-4) : keepEnds(s, 2, 2);
    case "bankcard": return "**** **** **** " + s.replace(/\D/g, "").slice(-4);
    case "name": return [...s].length <= 1 ? "*" : /^[\u4e00-\u9fff]+$/.test(s) ? [...s][0] + "*".repeat([...s].length - 1) : s.split(/\s+/).map((w) => w[0] + "*".repeat(Math.max(1, w.length - 1))).join(" ");
    case "address": return s.replace(/(\d+)(号|弄|室|栋|单元|楼|#)/g, "*$2").replace(/\d+/g, "*");
    default: return keepEnds(s, 1, 1);
  }
}

export function generalize(v: string, kind: Kind): string {
  const s = v.trim();
  if (!s) return "";
  if (kind === "date" || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return kind === "date" ? s.slice(0, 4) : s.slice(0, 7);
  if (kind === "address") { const m = s.match(/^(.+?(省|自治区|市))?(.+?(市|州|盟))?(.+?(区|县|旗))?/); return m && m[0] ? m[0] : s.slice(0, 6); }
  const n = Number(s);
  if (!isNaN(n)) { const step = n < 100 ? 10 : n < 1000 ? 100 : n < 10000 ? 1000 : 10000; const lo = Math.floor(n / step) * step; return `${lo}-${lo + step}`; }
  return s.slice(0, 1) + "…";
}

export function scrub(v: string): string {
  return v.replace(IDCARD, (m) => partial(m, "idcard")).replace(BANK, (m) => partial(m, "bankcard")).replace(PHONE, (m) => partial(m, "phone")).replace(EMAIL, (m) => partial(m, "email"));
}

export const hash = (v: string, salt: string) => (v.trim() ? createHmac("sha256", salt).update(v.trim()).digest("hex").slice(0, 16) : "");

export class Pseudonyms {
  private maps = new Map<string, Map<string, string>>();
  get(col: string, v: string, prefix: string) {
    if (!v.trim()) return "";
    if (!this.maps.has(col)) this.maps.set(col, new Map());
    const m = this.maps.get(col)!;
    if (!m.has(v.trim())) m.set(v.trim(), `${prefix}${String(m.size + 1).padStart(4, "0")}`);
    return m.get(v.trim())!;
  }
}

export function apply(v: string, method: Method, kind: Kind, ctx: { salt: string; col: string; prefix: string; ps: Pseudonyms }): string {
  switch (method) {
    case "keep": return v;
    case "partial": return partial(v, kind);
    case "hash": return hash(v, ctx.salt);
    case "pseudonym": return ctx.ps.get(ctx.col, v, ctx.prefix);
    case "generalize": return generalize(v, kind);
    case "scrub": return scrub(v);
    case "drop": return "";
  }
}

/** 粗查：一个已处理的值里是否还残留明显的个人信息。 */
export function leaks(v: string): string[] {
  const out: string[] = [];
  if (new RegExp(PHONE.source).test(v)) out.push("phone");
  if (new RegExp(EMAIL.source).test(v) && !/^\w\*\*\*@/.test(v)) out.push("email");
  if (new RegExp(IDCARD.source).test(v)) out.push("ID number");
  return out;
}
