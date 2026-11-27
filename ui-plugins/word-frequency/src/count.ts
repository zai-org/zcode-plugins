export const ZH_STOP = new Set("的 了 和 是 在 我 有 也 就 不 人 都 一 一个 上 中 对 到 说 要 去 你 会 着 没有 看 好 这 那 他 她 它 们 我们 你们 他们 与 及 或 等 将 被 把 从 而 并 但 为 以 之 其 于 由 让 向 给 很 还 又 再 更 最 已 已经 可以 能 可 这个 那个 这些 那些 什么 自己 进行 通过 以及 对于 因为 所以 如果 虽然 但是 并且 而且 其中 方面 情况 工作 问题 我们的 年 月 日 个 次 吗 呢 吧 啊 哦 嗯 该 此 每 各 某 本 第 两 三 多 少 大 小 新".split(" "));
export const EN_STOP = new Set("a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they me him her us them my your our their not no so do does did have has had will would can could should may might must than then there here what which who whom when where why how all any each more most other some such only own same too very just also into over under about after before up down out off again further once s t don't it's i'm we're".split(" "));

export interface Counted { word: string; count: number; files: Record<string, number> }

/** 用 Intl.Segmenter 分词（中文按词、英文按单词），可选二元/三元词组。 */
export function countWords(docs: { name: string; text: string }[], o: { stop: Set<string>; minLen: number; ngram: number; numbers: boolean }) {
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const map = new Map<string, Counted>();
  let total = 0;
  const add = (w: string, f: string) => { const c = map.get(w) ?? { word: w, count: 0, files: {} }; c.count++; c.files[f] = (c.files[f] ?? 0) + 1; map.set(w, c); total++; };
  for (const d of docs) {
    for (const para of d.text.split(/\n\s*\n|[。！？!?；;]/)) {
      const words = [...seg.segment(para)].filter((x) => x.isWordLike).map((x) => (/^[A-Za-z][A-Za-z'’-]*$/.test(x.segment) && !/^[A-Z]{2,5}s?$/.test(x.segment) ? x.segment.toLowerCase().replace(/’/g, "'") : x.segment));
      const keep = (w: string) => !o.stop.has(w) && !o.stop.has(w.toLowerCase()) && [...w].length >= (/[\u4e00-\u9fff]/.test(w) ? Math.max(1, o.minLen) : Math.max(2, o.minLen)) && (o.numbers || !/^[\d.,%]+$/.test(w));
      for (const w of words) if (keep(w)) add(w, d.name);
      for (let n = 2; n <= o.ngram; n++) for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        if (g.some((w) => o.stop.has(w) || o.stop.has(w.toLowerCase()) || /^[\d.]+$/.test(w))) continue;
        add(g.join(/[\u4e00-\u9fff]/.test(g.join("")) ? "" : " "), d.name);
      }
    }
  }
  return { list: [...map.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)), total };
}

export const textW = (t: string, size: number) => [...t].reduce((a, c) => a + (/[\u2e80-\uffff]/.test(c) ? size : /[A-Z]/.test(c) ? size * 0.66 : size * 0.56), 0);

export interface Placed { word: string; x: number; y: number; size: number; rot: boolean; color: string; w: number; h: number }

/** 阿基米德螺线排布词云：大词先放，矩形不重叠。 */
export function layoutCloud(words: { word: string; weight: number }[], o: { width: number; height: number; palette: string[]; rotate: boolean; circle: boolean; minSize: number; maxSize: number }) {
  const max = Math.max(1, ...words.map((w) => w.weight)), min = Math.min(max, ...words.map((w) => w.weight));
  const placed: Placed[] = [];
  const cx = o.width / 2, cy = o.height / 2;
  const hit = (a: { x: number; y: number; w: number; h: number }) => placed.some((b) => Math.abs(a.x - b.x) * 2 < a.w + b.w + 4 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 2);
  const inside = (a: { x: number; y: number; w: number; h: number }) => {
    if (a.x - a.w / 2 < 6 || a.x + a.w / 2 > o.width - 6 || a.y - a.h / 2 < 6 || a.y + a.h / 2 > o.height - 6) return false;
    if (!o.circle) return true;
    const rx = o.width / 2 - 6, ry = o.height / 2 - 6;
    return [[a.x - a.w / 2, a.y - a.h / 2], [a.x + a.w / 2, a.y - a.h / 2], [a.x - a.w / 2, a.y + a.h / 2], [a.x + a.w / 2, a.y + a.h / 2]].every(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
  };
  words.forEach((w, i) => {
    const t = max === min ? 1 : Math.sqrt((w.weight - min) / (max - min));
    const size = Math.round(o.minSize + (o.maxSize - o.minSize) * t);
    const rot = o.rotate && i % 4 === 3 && [...w.word].length <= 6;
    for (let shrink = 1; shrink >= 0.55; shrink -= 0.15) {
      const sz = Math.max(o.minSize * 0.8, Math.round(size * shrink));
      const tw = textW(w.word, sz), th = sz * 1.08;
      const box = { w: rot ? th : tw, h: rot ? tw : th };
      const lim = Math.hypot(o.width, o.height) / 2;
      for (let k = 0; k < 30000; k++) {
        const a = k * 0.12, r = 1.1 * a;
        if (r > lim) break;
        const x = cx + r * Math.cos(a) * (o.width / o.height), y = cy + r * Math.sin(a);
        const cand = { x, y, ...box };
        if (inside(cand) && !hit(cand)) { placed.push({ word: w.word, x, y, size: sz, rot, color: o.palette[i % o.palette.length], ...box }); return; }
      }
    }
  });
  return placed;
}
