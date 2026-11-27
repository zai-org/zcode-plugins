import * as OpenCC from "opencc-js";
import TWPhrases from "opencc-js/dict/TWPhrases";
import TWPhrasesRev from "opencc-js/dict/TWPhrasesRev";
import HKPhrases from "opencc-js/dict/HKPhrases";
import HKPhrasesRev from "opencc-js/dict/HKPhrasesRev";
import STPhrases from "opencc-js/dict/STPhrases";

/** 转换方向：from/to 对应 opencc-js 的 locale；t = OpenCC 标准繁体 */
export const DIRECTIONS = [
  { id: "cn-tw", from: "cn", to: "tw", zh: "简体 → 繁体（台湾字形）", en: "Simplified → Traditional (Taiwan)" },
  { id: "cn-twp", from: "cn", to: "twp", zh: "简体 → 繁体（台湾用词）", en: "Simplified → Traditional (Taiwan phrasing)" },
  { id: "cn-hk", from: "cn", to: "hk", zh: "简体 → 繁体（香港字形）", en: "Simplified → Traditional (Hong Kong)" },
  { id: "cn-hkp", from: "cn", to: "hkp", zh: "简体 → 繁体（香港用词）", en: "Simplified → Traditional (Hong Kong phrasing)" },
  { id: "cn-t", from: "cn", to: "t", zh: "简体 → 繁体（OpenCC 标准）", en: "Simplified → Traditional (OpenCC standard)" },
  { id: "tw-cn", from: "tw", to: "cn", zh: "繁体（台湾）→ 简体", en: "Traditional (Taiwan) → Simplified" },
  { id: "twp-cn", from: "twp", to: "cn", zh: "繁体（台湾用词）→ 简体（大陆用词）", en: "Taiwan phrasing → Simplified (mainland phrasing)" },
  { id: "hk-cn", from: "hk", to: "cn", zh: "繁体（香港）→ 简体", en: "Traditional (Hong Kong) → Simplified" },
  { id: "hkp-cn", from: "hkp", to: "cn", zh: "繁体（香港用词）→ 简体", en: "Hong Kong phrasing → Simplified" },
  { id: "t-cn", from: "t", to: "cn", zh: "繁体（OpenCC 标准）→ 简体", en: "Traditional (OpenCC standard) → Simplified" },
] as const;
export type DirectionId = (typeof DIRECTIONS)[number]["id"];

const cache = new Map<string, (s: string) => string>();
export function converter(from: string, to: string) {
  const k = `${from}>${to}`;
  if (!cache.has(k)) cache.set(k, from === to ? (s: string) => s : OpenCC.Converter({ from, to }));
  return cache.get(k)!;
}

const tries = new Map<string, OpenCC.Trie>();
function trie(name: string, dict: string) {
  if (!tries.has(name)) { const t = new OpenCC.Trie(); t.loadDict(dict); tries.set(name, t); }
  return tries.get(name)!;
}
/** 用词词典（地区用语，比如 软件→軟體）：toPhrase 作用在繁体中间结果上，fromPhrase 作用在原文上 */
function phraseDict(dir: (typeof DIRECTIONS)[number]) {
  if (dir.to === "twp") return { on: "mid" as const, t: trie("TWPhrases", TWPhrases) };
  if (dir.to === "hkp") return { on: "mid" as const, t: trie("HKPhrases", HKPhrases) };
  if (dir.from === "twp") return { on: "src" as const, t: trie("TWPhrasesRev", TWPhrasesRev) };
  if (dir.from === "hkp") return { on: "src" as const, t: trie("HKPhrasesRev", HKPhrasesRev) };
  return null;
}

/** 一简对多繁的常见字：不在词组里时，自动转换可能选错 */
export const AMBIGUOUS = "干发后里面只台系冲复历范松准钟征制获汇尽斗谷丑卷余志签苏坛团凶须云郁折舍朴困秋克适借才几么划夸胡涂恶托";

export type Rule = { from: string; to: string };
/** “源=目标” 每行一条；也接受 “源 → 目标”、制表符、逗号 */
export function parseDict(text: string): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [], errors: string[] = [];
  for (const [i, raw] of String(text ?? "").split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s*(?:=>|=|→|->|\t|,|，)\s*(.+)$/);
    if (!m || !m[1].trim() || !m[2].trim()) { errors.push(`line ${i + 1}: ${raw.trim()}`); continue; }
    rules.push({ from: m[1].trim(), to: m[2].trim() });
  }
  return { rules, errors };
}
export function parseTerms(text: string): string[] {
  return [...new Set(String(text ?? "").split(/[\r\n,，、;；]+/).map((x) => x.trim()).filter(Boolean))];
}

export type Options = { dir: DirectionId; custom: Rule[]; exclude: string[] };
export type Hit = { kind: "phrase" | "custom" | "exclude" | "ambiguous"; from: string; to: string };
export type Result = { text: string; hits: Hit[] };

const PUA = 0xf0000; // 补充私用区，不会出现在正常文本、也不会被 OpenCC 改动

/**
 * 转换一段文字。自定义词条和排除词先换成占位符，转换后再放回去，
 * 所以“排除词”保持原样，“自定义词条”优先于 OpenCC 词典。
 */
export function convert(text: string, o: Options): Result {
  const dir = DIRECTIONS.find((d) => d.id === o.dir) ?? DIRECTIONS[0];
  const hits: Hit[] = [];
  const subs: { out: string; hit: Hit }[] = [];
  const keys = [
    ...o.custom.map((r) => ({ from: r.from, out: r.to, kind: "custom" as const })),
    ...o.exclude.map((t) => ({ from: t, out: t, kind: "exclude" as const })),
  ];
  let src = text;
  if (keys.length) {
    const byFirst = new Map<string, typeof keys>();
    for (const k of keys) { const a = byFirst.get(k.from[0]) ?? []; a.push(k); byFirst.set(k.from[0], a); }
    for (const a of byFirst.values()) a.sort((x, y) => y.from.length - x.from.length || (x.kind === "custom" ? -1 : 1));
    let out = "";
    for (let i = 0; i < text.length;) {
      const k = byFirst.get(text[i])?.find((c) => text.startsWith(c.from, i));
      if (!k) { out += text[i++]; continue; }
      const hit: Hit = { kind: k.kind, from: k.from, to: k.out };
      hits.push(hit);
      out += String.fromCodePoint(PUA + subs.length);
      subs.push({ out: k.out, hit });
      i += k.from.length;
    }
    src = out;
  }
  // 用词替换和易错字只统计，不影响转换结果
  const pd = phraseDict(dir);
  if (pd) {
    const base = pd.on === "mid" ? converter(dir.from, "t")(src) : src;
    for (let i = 0; i < base.length;) {
      const m = pd.t.matchPrefix(base, i);
      if (m && m.value !== base.slice(i, m.end)) {
        const from = pd.on === "mid" && base.length === src.length ? src.slice(i, m.end) : base.slice(i, m.end);
        hits.push({ kind: "phrase", from, to: m.value });
        i = m.end;
      } else i++;
    }
  }
  let converted = converter(dir.from, dir.to)(src);
  if (dir.from === "cn" && converted.length === src.length) {
    const st = trie("STPhrases", STPhrases);
    for (let i = 0; i < src.length;) {
      const m = st.matchPrefix(src, i);
      if (m) { i = m.end; continue; }
      if (AMBIGUOUS.includes(src[i]) && converted[i] !== src[i]) hits.push({ kind: "ambiguous", from: src[i], to: converted[i] });
      i++;
    }
  }
  if (subs.length) converted = converted.replace(/[\u{f0000}-\u{ffffd}]/gu, (c) => subs[c.codePointAt(0)! - PUA]?.out ?? c);
  return { text: converted, hits };
}

/** 中英文判断：粗略统计哪种字形占多数，用来提示“方向可能选反了” */
export function scriptGuess(text: string): { simp: number; trad: number } {
  const sample = text.slice(0, 20000);
  const s2t = converter("cn", "t")(sample), t2s = converter("t", "cn")(sample);
  let simp = 0, trad = 0;
  for (let i = 0; i < sample.length; i++) { if (s2t[i] !== sample[i]) simp++; if (t2s[i] !== sample[i]) trad++; }
  return { simp, trad };
}

/** Markdown 里不转换的部分：代码块、行内代码、链接地址、HTML 标签、URL */
export function protectMarkdown(line: string, inFence: boolean): { parts: { text: string; keep: boolean }[]; fence: boolean } {
  if (/^\s*(```|~~~)/.test(line)) return { parts: [{ text: line, keep: true }], fence: !inFence };
  if (inFence) return { parts: [{ text: line, keep: true }], fence: true };
  const parts: { text: string; keep: boolean }[] = [];
  const re = /(`+)[^`]*?\1|\]\([^)]*\)|<[^>\n]+>|https?:\/\/[^\s)<>]+/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) parts.push({ text: line.slice(last, m.index), keep: false });
    if (m[0].startsWith("](")) { parts.push({ text: "](", keep: false }); parts.push({ text: m[0].slice(2), keep: true }); }
    else parts.push({ text: m[0], keep: true });
    last = m.index! + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), keep: false });
  return { parts, fence: false };
}
