/**
 * 渲染文字与 Typst 源码之间的近似对应。
 *
 * typst CLI 不输出 PDF 位置到源码的映射，所以按文字匹配：两边都化为“骨架”（NFKC、小写、只保留字母与数字），
 * 这样标记符号（* _ # [ ] $ = -）、引号与破折号、换行、连字符断词、连字都不影响匹配。
 * 骨架里仍可能多出函数名与参数（源码中的 #emph、fill: red）或少掉生成的文字（标题编号、引用），
 * 所以长文本用种子串（k-gram）定位，再把位置一致的种子串成链，取覆盖最多的一条。
 */

export interface Skeleton {
  value: string;
  /** value 每个字符在原文中的位置。 */
  map: number[];
}

const FOLD: Record<string, string> = { "ſ": "s", "ı": "i" };

export function skeleton(text: string): Skeleton {
  let value = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const folded = (FOLD[char] ?? char).normalize("NFKC").toLowerCase();
    for (const part of folded)
      if (/[\p{L}\p{N}]/u.test(part)) {
        value += part;
        map.push(index);
      }
    index += char.length;
  }
  return { value, map };
}

export interface FuzzyHit {
  /** 原文区间 [start, end)。 */
  start: number;
  end: number;
  /** 0–1：被覆盖的骨架比例。 */
  score: number;
}

const SEED = 8;

/** 在 hay 中查找 needle（原文）；按 score 降序返回。 */
export function fuzzyFind(needle: string, hay: Skeleton, options: { max?: number; minScore?: number } = {}): FuzzyHit[] {
  const max = options.max ?? 5;
  const target = skeleton(needle).value;
  if (target.length < 2 || !hay.value.length) return [];
  const toHit = (from: number, to: number, score: number): FuzzyHit => ({
    start: hay.map[from]!,
    end: hay.map[to - 1]! + 1,
    score,
  });
  // 完全一致（短文本只接受这种）。
  const exact: FuzzyHit[] = [];
  for (let at = hay.value.indexOf(target); at >= 0 && exact.length < max; at = hay.value.indexOf(target, at + 1))
    exact.push(toHit(at, at + target.length, 1));
  if (exact.length || target.length < SEED * 2) return exact;

  // 种子：每隔 SEED/2 取一个 k-gram，记录它在 hay 中的所有出现位置（常见串最多 64 处）。
  const step = SEED / 2;
  const seeds: { offset: number; positions: number[] }[] = [];
  for (let offset = 0; offset + SEED <= target.length; offset += step) {
    const gram = target.slice(offset, offset + SEED);
    const positions: number[] = [];
    for (let at = hay.value.indexOf(gram); at >= 0 && positions.length < 64; at = hay.value.indexOf(gram, at + 1)) positions.push(at);
    seeds.push({ offset, positions });
  }
  const tailOffset = target.length - SEED;
  if (seeds.at(-1)!.offset !== tailOffset) {
    const gram = target.slice(tailOffset);
    const positions: number[] = [];
    for (let at = hay.value.indexOf(gram); at >= 0 && positions.length < 64; at = hay.value.indexOf(gram, at + 1)) positions.push(at);
    seeds.push({ offset: tailOffset, positions });
  }

  // 链：种子在 needle 与 hay 中的先后一致，且间距差在容忍范围内（hay 可多出标记、可少掉生成的文字）。
  interface Chain {
    first: { offset: number; at: number };
    last: { offset: number; at: number };
    covered: number;
  }
  const chains: Chain[] = [];
  for (const seed of seeds) {
    for (const at of seed.positions) {
      let best: Chain | null = null;
      for (const chain of chains) {
        const needleGap = seed.offset - chain.last.offset;
        const hayGap = at - chain.last.at;
        if (needleGap <= 0 || hayGap <= 0) continue;
        const drift = hayGap - needleGap;
        if (drift < -Math.max(24, needleGap) || drift > 160 + needleGap * 2) continue;
        if (!best || chain.covered > best.covered) best = chain;
      }
      const gain = (from: number) => Math.min(SEED, seed.offset + SEED - from);
      if (best) {
        best.covered += gain(best.last.offset + SEED);
        best.last = { offset: seed.offset, at };
      } else chains.push({ first: { offset: seed.offset, at }, last: { offset: seed.offset, at }, covered: SEED });
    }
  }
  const minScore = options.minScore ?? 0.35;
  const results = chains
    .map((chain) => ({ chain, score: Math.min(1, chain.covered / target.length) }))
    .filter(({ chain, score }) => score >= minScore && chain.covered >= SEED * 2)
    .sort((a, b) => b.score - a.score || a.chain.first.at - b.chain.first.at);
  const hits: FuzzyHit[] = [];
  for (const { chain, score } of results) {
    // 由链的两端外推到 needle 的首尾（不越过 hay 的边界）。
    const from = Math.max(0, chain.first.at - chain.first.offset);
    const to = Math.min(hay.value.length, chain.last.at + SEED + (target.length - chain.last.offset - SEED));
    const hit = toHit(from, Math.max(to, from + 1), score);
    if (hits.some((other) => other.start < hit.end && hit.start < other.end)) continue;
    hits.push(hit);
    if (hits.length >= max) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 行号
// ---------------------------------------------------------------------------

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}

/** 原文位置到 1 起的行与列。 */
export function lineColumn(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

/** 第 from 到 to 行（1 起，含）的原文区间。 */
export function lineRange(text: string, starts: number[], from: number, to: number): { start: number; end: number } {
  const start = starts[Math.max(1, from) - 1] ?? text.length;
  const next = starts[Math.min(to, starts.length)];
  return { start, end: next === undefined ? text.length : next - 1 };
}

/** 摘录第 from–to 行，最多 maxLines 行。 */
export function excerpt(text: string, from: number, to: number, maxLines = 8): string {
  const lines = text.split("\n").slice(from - 1, Math.min(to, from + maxLines - 1));
  const more = to - from + 1 > maxLines ? `\n… (${to - from + 1 - maxLines} more lines)` : "";
  return lines.join("\n").replace(/\s+$/, "") + more;
}

// ---------------------------------------------------------------------------
// 渲染文字 → 源码
// ---------------------------------------------------------------------------

export interface SourceFile {
  /** 工作区相对路径。 */
  path: string;
  text: string;
}

export interface SourceMatch {
  file: string;
  line: number;
  column: number;
  endLine: number;
  excerpt: string;
  score: number;
}

/**
 * 渲染文字 → 源码位置。focus 是 text 中真正要定位的一段（如点击的那一行），
 * text 提供上下文以减少歧义：先定位整段，再在附近找 focus。
 */
export function locateInSources(files: SourceFile[], text: string, focus?: string, max = 3): SourceMatch[] {
  const candidates: (SourceMatch & { start: number })[] = [];
  for (const file of files) {
    const hay = skeleton(file.text);
    const starts = lineStarts(file.text);
    for (const hit of fuzzyFind(text, hay, { max })) {
      let { start, end } = hit;
      if (focus && skeleton(focus).value.length >= 2) {
        // 在上下文附近找 focus：区间前后各放宽 400 个字符。
        const windowStart = Math.max(0, start - 400);
        const windowText = file.text.slice(windowStart, Math.min(file.text.length, end + 400));
        const inner = fuzzyFind(focus, skeleton(windowText), { max: 1 })[0];
        if (inner) {
          start = windowStart + inner.start;
          end = windowStart + inner.end;
        }
      }
      const from = lineColumn(starts, start);
      const to = lineColumn(starts, Math.max(start, end - 1));
      candidates.push({
        file: file.path,
        line: from.line,
        column: from.column,
        endLine: to.line,
        excerpt: excerpt(file.text, from.line, to.line),
        score: hit.score,
        start,
      });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ start: _start, ...rest }) => rest);
}
