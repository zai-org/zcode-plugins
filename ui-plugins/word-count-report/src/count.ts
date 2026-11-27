// 中英文分开计数（与 Word “字数统计”口径一致）
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u{20000}-\u{2FA1F}]/u;
const CJK_G = new RegExp(CJK.source, "gu");
// 全角标点、中文引号、省略号、破折号、间隔号（不含全角字母数字）
const CJK_PUNCT_G = /[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u2018-\u201F\u2026\u2014\u00B7\uFE30-\uFE4F]/gu;
const WORD_G = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]+(?:['’\-.][A-Za-z0-9\u00C0-\u024F\u0400-\u04FF]+)*/gu;

export interface Counts { cjk: number; punct: number; latin: number; numbers: number; chars: number; charsWithSpaces: number; words: number; paragraphs: number }
export const ZERO: Counts = { cjk: 0, punct: 0, latin: 0, numbers: 0, chars: 0, charsWithSpaces: 0, words: 0, paragraphs: 0 };

export function count(text: string, o: { numbers?: boolean } = {}): Counts {
  const t = String(text ?? "");
  const cjk = (t.match(CJK_G) ?? []).length;
  const punct = (t.match(CJK_PUNCT_G) ?? []).length;
  const tokens = t.replace(CJK_G, " ").replace(CJK_PUNCT_G, " ").match(WORD_G) ?? [];
  const numbers = tokens.filter((w) => /^[\d\uFF10-\uFF19.,'’-]+$/.test(w)).length;
  const latin = o.numbers === false ? tokens.length - numbers : tokens.length;
  const chars = [...t.replace(/\s/g, "")].length;
  const charsWithSpaces = [...t.replace(/[\r\n]/g, "")].length;
  const paragraphs = t.split(/\n/).filter((l) => l.trim()).length;
  return { cjk, punct, latin, numbers, chars, charsWithSpaces, words: cjk + punct + latin, paragraphs };
}

export function add(a: Counts, b: Counts): Counts {
  return Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k as keyof Counts] + b[k as keyof Counts]])) as unknown as Counts;
}

/** 阅读时长（分钟）：中文按每分钟 cjkPerMin 字，其他按每分钟 wpm 词。 */
export function minutes(c: Counts, cjkPerMin = 400, wpm = 230): number {
  return c.cjk / Math.max(1, cjkPerMin) + c.latin / Math.max(1, wpm);
}

export function fmtMinutes(m: number): string {
  if (m < 1) return m > 0 ? "<1 min" : "0 min";
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h} h ${r} min` : `${Math.round(m)} min`;
}
