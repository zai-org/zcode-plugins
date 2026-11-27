import type { Cue } from "./subs.ts";

export type Pair = { start: number; end: number; top: string; bottom: string; a: number[]; b: number[] };

/** 中日韩字符占比，用来自动判断哪条是中文 */
export function cjkRatio(cues: Cue[]) {
  const t = cues.map((c) => c.text).join("").replace(/\s+/g, "");
  if (!t) return 0;
  const n = [...t].filter((ch) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3\uf900-\ufaff]/.test(ch)).length;
  return n / [...t].length;
}

const overlap = (x: Cue, y: Cue) => Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));

/**
 * 以上面一条（top）为准配对：下面每条字幕归到重叠最多的那条上，
 * 重叠时长 ≥ 较短一条时长 × minOverlap 才算配上；没配上的单独成行。
 */
export function pairUp(top: Cue[], bottom: Cue[], o: { minOverlap: number; timing: "top" | "union"; orphans: boolean; joiner?: string }): Pair[] {
  const assign: number[][] = top.map(() => []);
  const orphan: number[] = [];
  bottom.forEach((b, j) => {
    let best = -1, bestOv = 0;
    top.forEach((a, i) => { const ov = overlap(a, b); if (ov > bestOv) { bestOv = ov; best = i; } });
    const shorter = best >= 0 ? Math.min(top[best].end - top[best].start, b.end - b.start) : 0;
    if (best >= 0 && shorter > 0 && bestOv >= shorter * o.minOverlap) assign[best].push(j);
    else orphan.push(j);
  });
  const out: Pair[] = top.map((a, i) => {
    const bs = assign[i];
    const start = o.timing === "union" && bs.length ? Math.min(a.start, ...bs.map((j) => bottom[j].start)) : a.start;
    const end = o.timing === "union" && bs.length ? Math.max(a.end, ...bs.map((j) => bottom[j].end)) : a.end;
    return { start, end, top: a.text, bottom: bs.map((j) => bottom[j].text.replace(/\n/g, " ")).join(o.joiner ?? " "), a: [i], b: bs };
  });
  if (o.orphans) for (const j of orphan) out.push({ start: bottom[j].start, end: bottom[j].end, top: "", bottom: bottom[j].text.replace(/\n/g, " "), a: [], b: [j] });
  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}
