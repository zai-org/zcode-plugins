import { unzipSync, strFromU8 } from "fflate";

/** .docx 正文段落（不含页眉页脚）。 */
export function docxParagraphs(bytes: Uint8Array) {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return xml.split(/<\/w:p>/).map((p) => dec(p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, "\u0001$1\u0002").replace(/[^\u0001\u0002]*?\u0001([^\u0002]*)\u0002/g, "$1").replace(/<[^>]+>/g, ""))).map((t) => t.trim()).filter(Boolean);
}

export const paragraphsOf = (text: string) => text.replace(/\r/g, "").replace(/^---\n[\s\S]*?\n---\n/, "").split(/\n\s*\n|\n(?=#)|\n/).map((p) => p.replace(/^#+\s*|^[-*]\s+/, "").trim()).filter(Boolean);

const ABBR = /\b(Mr|Mrs|Ms|Dr|Prof|St|No|vs|etc|e\.g|i\.e|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|approx)\.$/i;

export function sentences(p: string): string[] {
  const out: string[] = [];
  let cur = "";
  const chars = [...p];
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    const c = chars[i], next = chars[i + 1] ?? "";
    if (/[。！？!?；…]/.test(c) && !/[。！？!?…”’"）)」』]/.test(next)) { out.push(cur.trim()); cur = ""; continue; }
    if (/[”’"）)」』]/.test(c) && /[。！？!?.…]/.test(chars[i - 1] ?? "") && !/[”’"）)」』]/.test(next)) { if (/^\s/.test(next) || !next || /[“"「『(（]/.test(next)) { out.push(cur.trim()); cur = ""; } continue; }
    if (c === "." && (/\s/.test(next) || !next) && !ABBR.test(cur.trim()) && !/\b[A-Z]\.$/.test(cur.trim())) { const rest = chars.slice(i + 1).join("").trimStart(); if (!rest || /^[A-Z0-9“"'(\u4e00-\u9fff]/.test(rest)) { out.push(cur.trim()); cur = ""; } }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const len = (s: string) => [...s.replace(/\s+/g, " ")].length;
const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(/,/g, ""));

// 标准正态尾概率（Gale-Church）
function pnorm(z: number) { const t = 1 / (1 + 0.2316419 * z); return 1 - 0.3989423 * Math.exp((-z * z) / 2) * ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t; }
const PRIOR: Record<string, number> = { "1-1": 0.89, "1-0": 0.0099, "0-1": 0.0099, "2-1": 0.089, "1-2": 0.089, "2-2": 0.011 };

export interface Pair { src: string; tgt: string; kind: string; cost: number }

/** 按长度比（加数字锚点）做 Gale-Church 动态规划对齐。 */
export function align(a: string[], b: string[], ratio?: number): Pair[] {
  const la = a.map(len), lb = b.map(len);
  const c = ratio ?? Math.max(0.1, lb.reduce((x, y) => x + y, 0) / Math.max(1, la.reduce((x, y) => x + y, 0)));
  const s2 = 6.8;
  const cost = (l1: number, l2: number, ta: string, tb: string, kind: string) => {
    if (l1 === 0 && l2 === 0) return 0;
    const mean = (l1 + l2 / c) / 2;
    const z = Math.abs((l1 * c - l2) / Math.sqrt(Math.max(1, mean) * s2 * c));
    const pd = Math.max(1e-12, 2 * (1 - pnorm(z)));
    let k = -Math.log(PRIOR[kind]) - Math.log(pd);
    const na = nums(ta), nb = nums(tb);
    if (na.length || nb.length) { const same = na.filter((x) => nb.includes(x)).length; k += (Math.max(na.length, nb.length) - same) * 2 - same * 1.5; }
    return k;
  };
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const B = Array.from({ length: n + 1 }, () => new Array<[number, number, string]>(m + 1));
  D[0][0] = 0;
  const moves: [number, number, string][] = [[1, 1, "1-1"], [1, 0, "1-0"], [0, 1, "0-1"], [2, 1, "2-1"], [1, 2, "1-2"], [2, 2, "2-2"]];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (i === 0 && j === 0) continue;
    for (const [di, dj, kind] of moves) {
      if (i < di || j < dj || D[i - di][j - dj] === Infinity) continue;
      const ta = a.slice(i - di, i).join(" "), tb = b.slice(j - dj, j).join(" ");
      const v = D[i - di][j - dj] + cost(la.slice(i - di, i).reduce((x, y) => x + y, 0), lb.slice(j - dj, j).reduce((x, y) => x + y, 0), ta, tb, kind);
      if (v < D[i][j]) { D[i][j] = v; B[i][j] = [di, dj, kind]; }
    }
  }
  const out: Pair[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const [di, dj, kind] = B[i][j];
    const join = (xs: string[]) => xs.join(/[\u4e00-\u9fff]/.test(xs.join("")) ? "" : " ");
    out.push({ src: join(a.slice(i - di, i)), tgt: join(b.slice(j - dj, j)), kind, cost: D[i][j] - D[i - di][j - dj] });
    i -= di; j -= dj;
  }
  return out.reverse();
}
