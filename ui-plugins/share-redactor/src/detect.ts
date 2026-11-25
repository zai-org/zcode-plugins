import { createHash } from "node:crypto";

export type Kind = "phone" | "id" | "bank" | "email" | "amount" | "keyword";
export const KINDS: Kind[] = ["phone", "id", "bank", "email", "amount", "keyword"];
export const LABEL: Record<Kind, { zh: string; en: string }> = {
  phone: { zh: "手机号", en: "PHONE" },
  id: { zh: "身份证号", en: "ID" },
  bank: { zh: "银行卡号", en: "CARD" },
  email: { zh: "邮箱", en: "EMAIL" },
  amount: { zh: "金额", en: "AMOUNT" },
  keyword: { zh: "已隐去", en: "REDACTED" },
};
export interface Hit { kind: Kind; start: number; end: number; value: string }
export interface DetectOptions { kinds: Kind[]; keywords: string[] }
export type Mask = "label" | "block" | "partial";

const digits = (s: string) => s.replace(/\D/g, "");

/** 18 位身份证：校验码 + 出生日期合理。 */
export function validId(s: string) {
  const v = s.toUpperCase();
  if (!/^\d{17}[\dX]$/.test(v)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = w.reduce((t, k, i) => t + k * Number(v[i]), 0);
  if ("10X98765432"[sum % 11] !== v[17]) return false;
  const y = Number(v.slice(6, 10)), m = Number(v.slice(10, 12)), d = Number(v.slice(12, 14));
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function luhn(s: string) {
  const v = digits(s);
  if (v.length < 15 || v.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    let n = Number(v[v.length - 1 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

const RULES: { kind: Exclude<Kind, "keyword">; re: RegExp; ok?: (m: string) => boolean }[] = [
  { kind: "id", re: /(?<![\dA-Za-z])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g, ok: validId },
  { kind: "bank", re: /(?<![\d-])(?:\d{4}[ -]?){3,4}\d{1,4}(?![\d-])/g, ok: (m) => luhn(m) && !/^1[3-9]\d{9}$/.test(digits(m)) },
  { kind: "phone", re: /(?<![\d+])(?:(?:\+|00)86[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?!\d)/g },
  { kind: "phone", re: /(?<![\d+])(?:\(0\d{2,3}\)|0\d{2,3}-)\s?\d{7,8}(?:-\d{1,6})?(?!\d)/g },
  { kind: "phone", re: /(?<![\w+])\+(?!86)[1-9]\d{0,2}[ -]?(?:\(?\d{1,4}\)?[ -]?){2,4}\d{2,4}(?!\d)/g, ok: (m) => digits(m).length >= 8 && digits(m).length <= 15 },
  // 域名允许中文（IDN，如 wang@公司.cn、li@例子.中国）；顶级域只吃拉丁字母或常见中文顶级域，避免把后面的正文并进来
  { kind: "email", re: /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9\p{Script=Han}](?:[A-Za-z0-9\p{Script=Han}-]*[A-Za-z0-9\p{Script=Han}])?\.)+(?:[A-Za-z]{2,}|中国|中國|公司|网络|網絡|香港|台湾|台灣|新加坡)/gu },
  { kind: "amount", re: /(?:[¥￥$€£]|RMB|CNY|USD|EUR)\s?\d[\d,]*(?:\.\d+)?(?:\s?[万亿])?|\d[\d,]*(?:\.\d+)?\s?(?:万元|亿元|元|美元|欧元|块钱)/g },
];

/** 找出所有敏感信息；重叠时按优先级（关键词 > 身份证 > 银行卡 > 手机 > 邮箱 > 金额）与长度取舍。 */
export function detect(text: string, o: DetectOptions): Hit[] {
  const hits: (Hit & { pri: number })[] = [];
  const kw = [...new Set(o.keywords.map((k) => k.trim()).filter((k) => k.length >= 2))].sort((a, b) => b.length - a.length);
  if (kw.length) {
    const re = new RegExp(kw.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    for (const m of text.matchAll(re)) hits.push({ kind: "keyword", start: m.index!, end: m.index! + m[0].length, value: m[0], pri: 0 });
  }
  RULES.forEach((r, pri) => {
    if (!o.kinds.includes(r.kind)) return;
    for (const m of text.matchAll(r.re)) if (!r.ok || r.ok(m[0])) hits.push({ kind: r.kind, start: m.index!, end: m.index! + m[0].length, value: m[0], pri: pri + 1 });
  });
  hits.sort((a, b) => a.pri - b.pri || b.end - b.start - (a.end - a.start));
  const taken: Hit[] = [];
  for (const h of hits) if (!taken.some((t) => h.start < t.end && t.start < h.end)) taken.push({ kind: h.kind, start: h.start, end: h.end, value: h.value });
  return taken.sort((a, b) => a.start - b.start);
}

/** 值的指纹（用于“保留”名单与自检，不落盘原文）。数字类按纯数字归一。 */
export function valueKey(kind: Kind, value: string) {
  const v = kind === "phone" || kind === "id" || kind === "bank" ? digits(value).replace(/^(?:0086|86)(?=1[3-9]\d{9}$)/, "") : value.trim().toLowerCase();
  return createHash("sha256").update(`${kind}:${v}`).digest("hex").slice(0, 16);
}

export function maskValue(kind: Kind, value: string, mask: Mask, zh: boolean): string {
  if (mask === "label") return `[${zh ? LABEL[kind].zh : LABEL[kind].en}]`;
  if (mask === "block") return "█".repeat(Math.min(12, Math.max(4, [...value].length)));
  // partial：保留便于核对的少量字符
  const d = digits(value);
  if (kind === "phone") return !/^\s*(?:\+|00)(?!86)/.test(value) && /^(?:0{0,2}86)?1[3-9]\d{9}$/.test(d) ? `${d.slice(-11, -8)}****${d.slice(-4)}` : `****${d.slice(-4)}`;
  if (kind === "id") return `${value.slice(0, 3)}${"*".repeat(11)}${value.slice(-4)}`;
  if (kind === "bank") return `**** **** **** ${d.slice(-4)}`;
  if (kind === "email") { const [u, dom] = value.split("@"); return `${u.slice(0, 1)}***@${dom}`; }
  if (kind === "amount") return "***";
  const chars = [...value];
  return chars.length <= 2 ? `${chars[0]}*` : `${chars[0]}${"*".repeat(chars.length - 1)}`;
}

/** 自检用：一个值可能出现的写法（原样、去空格横线的纯数字）。 */
export function variants(kind: Kind, value: string) {
  const out = new Set([value]);
  if (kind === "phone" || kind === "id" || kind === "bank") { out.add(digits(value)); if (kind === "phone") out.add(digits(value).slice(-11)); }
  return [...out].filter((v) => v.length >= 4);
}
