// 文本工具：分句、数字识别、引文与引用标记、检索特征。
import { unradical } from "./cjk.ts";

export const isCjk = (c: string) => /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(c);

/** 统一写法：NFKC（全角数字/字母/％ → 半角）、部首码位 → 汉字、各种减号 → "-"。 */
export function norm(s: string): string {
  return unradical(s).normalize("NFKC").replace(/[\u2212\u2012\u2013\u2014\u2015]/g, (m) => (m === "\u2212" ? "-" : m));
}

export interface Span { start: number; end: number; text: string }

const OPEN: Record<string, string> = { "“": "”", "「": "」", "『": "』", "《": "》", "‘": "’" };
const CLOSERS = new Set(["”", "」", "』", "’", "\"", "'", ")", "）", "]", "】", "》"]);
const ABBR = /(?:^|[^A-Za-z.])(?:Mr|Mrs|Ms|Dr|Prof|St|No|Fig|Figs|Vol|vs|etc|e\.g|i\.e|al|approx|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K)$/i;
export const CITE_RE = /\[\^?\d+(?:\s*[,，\-–]\s*\d+)*\]|【\d+(?:[,，\-–]\d+)*】|\[\^[\w-]+\]/g;
const AUTHOR_YEAR = /[(（](?:[A-Z][\w'’\-]+(?: et al\.?)?(?:\s*(?:and|&)\s*[A-Z][\w'’\-]+)?|[\u4e00-\u9fa5]{2,4}等?)[,，]?\s*\d{4}[a-z]?[)）]/;
const CITE_AT = new RegExp(`^(?:\\s*(?:${CITE_RE.source}|${AUTHOR_YEAR.source}))+`);

/** 按句切分（中文 。！？ 与英文 .!?），引号里不切；句末紧跟的右引号、右括号和引用标记 [1] 留在本句。 */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0, i = 0;
  const stack: string[] = [];
  let ascii = false;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ start: start + lead, end: start + lead + t.length, text: t });
    start = end;
  };
  while (i < text.length) {
    const c = text[i];
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (stack.length && c === stack[stack.length - 1]) stack.pop();
    else if (c === "\"") ascii = !ascii;
    if (c === "\n") { if (!stack.length) { push(i); i++; ascii = false; continue; } }
    let end = false;
    if (!stack.length && !ascii) {
      if ("。！？!?".includes(c)) end = true;
      else if (c === "." && !/\d/.test(text[i + 1] ?? "") && (i + 1 >= text.length || /[\s"”’)）\]】]/.test(text[i + 1]) || isCjk(text[i + 1])) && !ABBR.test(text.slice(Math.max(0, i - 8), i)) && !/(?:^|\s)[A-Z]$/.test(text.slice(Math.max(0, i - 2), i))) end = true;
    } else if (stack.length && "。！？!?.".includes(c) && CLOSERS.has(text[i + 1] ?? "") && stack.length === 1 && text[i + 1] === stack[0]) {
      // 句号在引号里：“……。”——引号收尾后断句
      stack.pop(); i++; end = true;
    } else if (ascii && "。!?.".includes(c) && text[i + 1] === "\"") { ascii = false; i++; end = true; }
    i++;
    if (end) {
      while (i < text.length && CLOSERS.has(text[i])) i++;
      const m = CITE_AT.exec(text.slice(i));
      if (m) i += m[0].length;
      while (i < text.length && "。.".includes(text[i])) i++;
      push(i);
    }
  }
  push(text.length);
  return out;
}

export type Unit = "" | "%" | "‰" | "pp";
export interface Num { raw: string; value: number; tol: number; unit: Unit; start: number; end: number; date: boolean; context: string }

const MULT: Record<string, number> = { "万亿": 1e12, "亿": 1e8, "万": 1e4, "千": 1e3, "百万": 1e6, "千万": 1e7, trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3 };
const NUM_RE = /(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:万亿|千万|百万|亿|万|千|trillion|billion|million|thousand)(?![a-z]))?(\s*(?:%|‰|个百分点|百分点|percentage points?|per ?cent(?![a-z])|pp(?![a-z])))?/gi;

/** 找出文本中的数字（含万/亿/million 等量级与 %、‰、百分点）；date=true 表示年份、月日、序号等，只作检索线索、不单独核对。 */
export function numbers(text: string): Num[] {
  const t = norm(text);
  const out: Num[] = [];
  for (const m of t.matchAll(NUM_RE)) {
    const s = m.index!, e = s + m[0].length;
    const before = t.slice(Math.max(0, s - 2), s), after = t.slice(e, e + 3);
    if (/[\w.]$/.test(before) && !/\s$/.test(before) && !(m[1] && /[\s(（:：，,]$/.test(before))) {
      if (/[a-z]$/i.test(before) || /\d$/.test(before) || /\.$/.test(before)) continue; // 版本号、型号等
    }
    if (/[\[【^]$/.test(before) && /^[\]】,，\-–\d]/.test(after)) continue; // 引用标记 [3]
    const intPart = m[2].replace(/,/g, "");
    const dec = m[3] ?? "";
    const multWord = (m[4] ?? "").trim().toLowerCase();
    const unitWord = (m[5] ?? "").trim().toLowerCase();
    const mult = MULT[multWord] ?? 1;
    const unit: Unit = !unitWord ? "" : unitWord === "%" || unitWord.startsWith("per") ? "%" : unitWord === "‰" ? "‰" : "pp";
    const neg = m[1] === "-" && !/\d$/.test(before.trim());
    const value = (neg ? -1 : 1) * Number(intPart + dec) * mult;
    const decimals = dec ? dec.length - 1 : 0;
    const tol = 0.5 * 10 ** -decimals * mult + 1e-9 * Math.abs(value);
    const next = t.slice(e).trimStart()[0] ?? "";
    const year = !dec && !multWord && !unit && /^(1[5-9]|20)\d\d$/.test(intPart) && !/^\d/.test(after);
    const date = (!unit && !multWord && /[年月日号时]/.test(next)) || /第\s*$/.test(t.slice(Math.max(0, s - 3), s)) || year;
    out.push({ raw: m[0].trim(), value, tol, unit, start: s, end: e, date, context: t.slice(Math.max(0, s - 12), s) });
  }
  return out;
}

export const sameNumber = (a: Num, b: Num) => a.unit === b.unit && Math.abs(a.value - b.value) <= Math.max(a.tol, 1e-9);

/** 引号里的原话（≥ 8 个字符，避免把“十四五”之类的词语当引文）。 */
export function quotes(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/“([^“”]+)”|「([^「」]+)」|『([^『』]+)』|"([^"]+)"/g)) {
    const q = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    if (compact(q).length >= 8) out.push({ text: q, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** 引用标记：[1]、[1,2]、[1-3]、[^1]、【1】、(Smith, 2020)、（张三，2020）。 */
export function cites(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CITE_RE)) {
    const inner = m[0].replace(/^[\[【]\^?|[\]】]$/g, "");
    for (const part of inner.split(/[,，]/)) {
      const r = part.split(/[\-–]/).map((x) => Number(x.trim()));
      if (r.length === 2 && r.every(Number.isFinite) && r[1] >= r[0] && r[1] - r[0] < 50) for (let k = r[0]; k <= r[1]; k++) out.add(String(k));
      else out.add(part.trim());
    }
  }
  for (const m of text.matchAll(/[(（]([A-Z][\w'’\-]+(?: et al\.?)?(?:\s*(?:and|&)\s*[A-Z][\w'’\-]+)?|[\u4e00-\u9fa5]{2,4}等?)[,，]?\s*(\d{4}[a-z]?)[)）]/g)) out.add(`${m[1]} ${m[2]}`);
  return [...out];
}

export const stripCites = (s: string) => s.replace(CITE_RE, "").replace(/[(（]([A-Z][\w'’\-]+(?: et al\.?)?|[\u4e00-\u9fa5]{2,4}等?)[,，]?\s*\d{4}[a-z]?[)）]/g, "");

/** 紧凑形式（比对引文用）：统一写法、小写、去掉空白、引用标记与引号。返回字符串及每个字符在原文中的位置。 */
export function compactMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  const src = s.replace(CITE_RE, (m) => " ".repeat(m.length));
  for (let i = 0; i < src.length; i++) {
    let c = norm(src[i]).toLowerCase();
    if (/\s/.test(c) || /["“”'‘’「」『』]/.test(c)) continue;
    if (c === "，") c = ",";
    for (const ch of c) { text += ch; map.push(i); }
  }
  return { text, map };
}
export const compact = (s: string) => compactMap(s).text.replace(/[.。,，;；:：!！?？]+$/, "");

const STOP = new Set("a an the of in on at to for and or but is are was were be been being by with as from that this these those it its their there which who whom whose has have had not no than then so such into over about after before per also more most other some any each can could may might will would shall should do does did".split(" "));

/** 检索特征：中日韩文字取相邻二字，英文取词（去停用词），数字取规范值。 */
export function features(text: string): Map<string, number> {
  const f = new Map<string, number>();
  const add = (k: string, w = 1) => f.set(k, (f.get(k) ?? 0) + w);
  const t = norm(stripCites(text)).toLowerCase();
  let run = "";
  const flush = () => {
    if (run.length === 1) add(run);
    for (let i = 0; i + 1 < run.length; i++) add(run.slice(i, i + 2));
    run = "";
  };
  for (const c of t) { if (isCjk(c)) run += c; else flush(); }
  flush();
  for (const w of t.match(/[a-z][a-z'-]+/g) ?? []) if (!STOP.has(w)) add(w.replace(/'s$/, "").replace(/(?<=..)s$/, ""));
  for (const n of numbers(text)) add(`#${n.unit}${Number(n.value.toPrecision(6))}`, n.date ? 0.5 : 1);
  return f;
}

/** 二元组 Dice 相似度（0–1）。 */
export function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i + 1 < a.length; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) ?? 0) + 1); }
  let hit = 0;
  for (let i = 0; i + 1 < b.length; i++) { const g = b.slice(i, i + 2); const n = grams.get(g); if (n) { hit++; grams.set(g, n - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}
