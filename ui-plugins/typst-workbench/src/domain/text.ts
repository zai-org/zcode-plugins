// 取自 zotero 插件的 domain/text.ts（PDF 文本拼接、引文匹配、矩形插值），去掉了 Zotero 专用的排序键与搜索。
import type { Rect } from "#t/contract.ts";

/** pdf.js getTextContent() 的文本项（只取用到的字段）。 */
export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** 页面文本中一段字符对应的文本项几何。 */
export interface Span {
  start: number;
  end: number;
  x: number;
  /** 基线 y。 */
  y: number;
  width: number;
  /** 字号（行高的近似）。 */
  size: number;
}

export interface PageText {
  index: number;
  label: string;
  /** 页面 viewBox 宽高（pt）。 */
  width: number;
  height: number;
  /** viewBox 原点（多数 PDF 为 0, 0）。 */
  originX: number;
  originY: number;
  text: string;
  spans: Span[];
}

/** 把一页的文本项拼成文本：hasEOL 与换行处插入 \n，同一行明显的间隙补空格。 */
export function buildPage(
  items: TextItem[],
  page: { index: number; label: string; width: number; height: number; originX?: number; originY?: number },
): PageText {
  let text = "";
  const spans: Span[] = [];
  let previous: { x2: number; y: number; size: number } | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    if (previous && item.str) {
      const sameLine = Math.abs(f - previous.y) < size * 0.5;
      const last = text.at(-1) ?? "\n";
      if (!sameLine && !/\s/.test(last)) text += "\n";
      else if (sameLine && e - previous.x2 > size * 0.15 && !/\s/.test(last) && !/^\s/.test(item.str)) text += " ";
    }
    if (item.str) {
      const start = text.length;
      text += item.str;
      spans.push({ start, end: text.length, x: e, y: f, width: item.width, size });
      previous = { x2: e + item.width, y: f, size };
    }
    if (item.hasEOL && !text.endsWith("\n")) {
      text += "\n";
    }
  }
  return {
    index: page.index,
    label: page.label,
    width: page.width,
    height: page.height,
    originX: page.originX ?? 0,
    originY: page.originY ?? 0,
    text,
    spans,
  };
}

/** 供模型阅读的页面文本：合并行尾连字符断词，压缩多余空白。 */
export function readableText(text: string): string {
  return text
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// 归一化与匹配
// ---------------------------------------------------------------------------

const FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "­": "",
  "​": "",
  "…": "...",
};

/**
 * 归一化文本并记录每个结果字符来自原文的哪个位置：
 * NFKC（拆连字 ﬁ→fi）、统一引号与连字符、行尾连字符断词合并、空白折叠为单个空格、小写。
 * compact 时去掉所有空白（容忍 PDF 缺失或多出的空格）。
 */
export function normalize(text: string, compact = false): { value: string; map: number[] } {
  let value = "";
  const map: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    // 行尾连字符断词：小写字母-换行-小写字母，丢弃连字符与换行。
    if (char === "-" && text[index + 1] === "\n" && /\p{Ll}/u.test(text[index - 1] ?? "") && /\p{Ll}/u.test(text[index + 2] ?? "")) {
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      if (!compact && pendingSpace < 0 && value.length) pendingSpace = index;
      continue;
    }
    const folded = (FOLD[char] ?? char).normalize("NFKC").toLowerCase();
    if (!folded) continue;
    if (pendingSpace >= 0) {
      value += " ";
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    for (const part of folded) {
      value += part;
      map.push(index);
    }
  }
  return { value, map };
}

export interface Match {
  pageIndex: number;
  /** 原页面文本中的字符区间 [start, end)。 */
  start: number;
  end: number;
}

/** 在一页中查找引文：先按词间空格匹配，再忽略全部空白；带省略号的引文按首尾两段匹配。 */
export function findInPage(page: PageText, quote: string, from = 0): Match | null {
  for (const compact of [false, true]) {
    const haystack = normalize(page.text, compact);
    const needle = normalize(quote, compact).value.trim();
    if (!needle) return null;
    const startAt = haystack.map.findIndex((original) => original >= from);
    if (startAt < 0) continue;
    const position = haystack.value.indexOf(needle, startAt);
    if (position >= 0)
      return {
        pageIndex: page.index,
        start: haystack.map[position]!,
        end: haystack.map[position + needle.length - 1]! + 1,
      };
  }
  // “开头 … 结尾”：两段都在本页且顺序正确，跨度不超过 3000 字符。
  const parts = quote.split(/\s*(?:\.\.\.|…|\[\s*\.\.\.\s*\])\s*/).filter((part) => part.trim().length >= 8);
  if (parts.length >= 2) {
    const first = findInPage(page, parts[0]!, from);
    if (first) {
      const last = findInPage(page, parts.at(-1)!, first.end);
      if (last && last.end - first.start < 3_000) return { pageIndex: page.index, start: first.start, end: last.end };
    }
  }
  return null;
}

/** 在页面中查找引文；preferredPage 优先，然后按页序。 */
export function findQuote(pages: PageText[], quote: string, preferredPage?: number): Match | null {
  const order =
    preferredPage !== undefined && pages[preferredPage]
      ? [pages[preferredPage]!, ...pages.filter((page) => page.index !== preferredPage)]
      : pages;
  for (const page of order) {
    const match = findInPage(page, quote);
    if (match) return match;
  }
  // 跨页引文：拼接相邻两页再找，返回起始页上的部分。
  for (let index = 0; index + 1 < pages.length; index++) {
    const a = pages[index]!;
    const b = pages[index + 1]!;
    const joined = { ...a, text: `${a.text}\n${b.text}` };
    const match = findInPage(joined, quote);
    if (match && match.start < a.text.length && match.end > a.text.length)
      return { pageIndex: a.index, start: match.start, end: a.text.length };
  }
  return null;
}

// Helvetica 的 ASCII 字宽（1/1000 em，AFM）。文本项内部没有逐字几何，按字宽比例而不是字符数插值：
// 比例字体之间的相对字宽相近，误差远小于按字符数平分。
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,
  584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 32;
  if (code >= 32 && code < 127) return ASCII_WIDTHS[code - 32]!;
  // 中日韩字符与全角符号占满一个 em。
  if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xff00 && code <= 0xffef)) return 1000;
  return 556;
}

/** 文本项内 [0, offset) 的宽度占比。 */
function fraction(text: string, offset: number): number {
  let before = 0;
  let total = 0;
  let index = 0;
  for (const char of text) {
    const width = charWidth(char);
    if (index < offset) before += width;
    total += width;
    index += char.length;
  }
  return total ? before / total : 0;
}

/** 区间覆盖的文本项转为矩形（PDF 用户空间），同一行相邻的矩形合并。 */
export function rectsFor(page: PageText, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  for (const span of page.spans) {
    if (span.end <= start || span.start >= end) continue;
    const text = page.text.slice(span.start, span.end);
    const from = Math.max(start, span.start) - span.start;
    const to = Math.min(end, span.end) - span.start;
    const x1 = span.x + span.width * fraction(text, from);
    const x2 = span.x + span.width * fraction(text, to);
    const rect: Rect = [x1, span.y - span.size * 0.25, x2, span.y + span.size * 0.75];
    const last = rects.at(-1);
    if (last && Math.abs(last[1] - rect[1]) < span.size * 0.3 && rect[0] - last[2] < span.size * 1.5 && rect[0] >= last[0] - 1) {
      last[2] = Math.max(last[2], rect[2]);
      last[1] = Math.min(last[1], rect[1]);
      last[3] = Math.max(last[3], rect[3]);
    } else rects.push(rect);
  }
  return rects.map((rect) => rect.map((value) => Math.round(value * 1000) / 1000) as Rect);
}

/** 原文区间对应的文本（引文在页面中的实际写法）。 */
export function textAt(page: PageText, start: number, end: number): string {
  return readableText(page.text.slice(start, end)).replace(/\s+/g, " ");
}

/** 页面范围："3"、"2-5"、"1,4-6"、"10-"；按 1 起的页码，返回 0 起的页序。 */
export function parsePages(spec: string, pageCount: number): number[] {
  const result = new Set<number>();
  for (const part of spec.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const match = /^(\d+)?\s*(?:-\s*(\d+)?)?$/.exec(part);
    if (!match || (!match[1] && !match[2])) throw new Error(`Invalid page range "${part}". Use e.g. "3", "2-5" or "1,4-6".`);
    const isRange = part.includes("-");
    const from = match[1] ? Number(match[1]) : 1;
    const to = isRange ? (match[2] ? Number(match[2]) : pageCount) : from;
    for (let page = Math.max(from, 1); page <= Math.min(to, pageCount); page++) result.add(page - 1);
  }
  return [...result].sort((a, b) => a - b);
}
