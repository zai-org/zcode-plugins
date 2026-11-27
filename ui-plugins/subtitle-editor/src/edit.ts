import { cps, plain, width, type Cue } from "./subs.ts";

export type Action = "keep" | "merge" | "split" | "delete";
export type SrcCue = Cue & { action: Action; row: number };
export type OutCue = Cue & { rows: number[] };

/** 帧率换算：把按 a fps 做的字幕改到 b fps 的视频（时间 × a/b） */
export const FPS: Record<string, [number, number]> = {
  "23.976>25": [24000 / 1001, 25], "25>23.976": [25, 24000 / 1001], "24>25": [24, 25], "25>24": [25, 24], "23.976>24": [24000 / 1001, 24], "24>23.976": [24, 24000 / 1001], "29.97>25": [30000 / 1001, 25], "25>29.97": [25, 30000 / 1001],
};

/** 同步点：每行 “字幕里的时间 = 视频里正确的时间”。1 个点 = 整体平移；多个点 = 分段线性 */
export function syncMap(points: [number, number][]): ((t: number) => number) | null {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (!p.length) return null;
  if (p.length === 1) return (t) => t + (p[0][1] - p[0][0]);
  return (t) => {
    let i = 0;
    while (i < p.length - 2 && t > p[i + 1][0]) i++;
    const [a, b] = [p[i], p[i + 1]];
    const k = (b[1] - a[1]) / (b[0] - a[0] || 1);
    return a[1] + (t - a[0]) * k;
  };
}

function splitText(text: string): [string, string] {
  if (text.includes("|")) { const i = text.indexOf("|"); return [text.slice(0, i).trim(), text.slice(i + 1).trim()]; }
  const lines = text.split("\n");
  if (lines.length >= 2) { const h = Math.ceil(lines.length / 2); return [lines.slice(0, h).join("\n"), lines.slice(h).join("\n")]; }
  const chars = [...text], mid = chars.length / 2;
  let best = -1;
  chars.forEach((c, i) => { if (/[\s，。！？、；：,.!?;:]/.test(c) && i > 0 && i < chars.length - 1 && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
  const at = best >= 0 ? best + 1 : Math.round(mid);
  return [chars.slice(0, at).join("").trim(), chars.slice(at).join("").trim()];
}

/** 按每行的动作得到输出字幕（还没改时间） */
export function applyActions(src: SrcCue[]): OutCue[] {
  const out: OutCue[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c.action === "delete") continue;
    if (c.action === "merge") {
      const cur: OutCue = { start: c.start, end: c.end, text: c.text, style: c.style, rows: [c.row] };
      let j = i + 1;
      while (j < src.length && src[j].action === "delete") j++;
      while (j < src.length) {
        const n = src[j];
        cur.end = Math.max(cur.end, n.end); cur.text = `${cur.text}\n${n.text}`; cur.rows.push(n.row);
        i = j;
        if (n.action !== "merge") break;
        j++;
        while (j < src.length && src[j].action === "delete") j++;
      }
      out.push(cur);
      continue;
    }
    if (c.action === "split") {
      const [a, b] = splitText(c.text);
      if (!a || !b) { out.push({ ...c, raw: undefined, rows: [c.row] }); continue; }
      const wa = width(a), wb = width(b);
      const mid = Math.round(c.start + ((c.end - c.start) * wa) / (wa + wb || 1));
      out.push({ start: c.start, end: mid, text: a, style: c.style, rows: [c.row] }, { start: mid, end: c.end, text: b, style: c.style, rows: [c.row] });
      continue;
    }
    out.push({ ...c, rows: [c.row] });
  }
  return out;
}

export type Limits = { maxCps: number; maxWidth: number; maxLines: number; minDur: number; minGap: number };
export type Flag = { cue: number; kind: "overlap" | "cps" | "width" | "lines" | "short" | "order" | "empty" | "negative"; message: string };
export function check(cues: OutCue[], l: Limits): Flag[] {
  const f: Flag[] = [];
  cues.forEach((c, i) => {
    const t = plain(c.text).trim();
    if (!t) f.push({ cue: i, kind: "empty", message: "empty text / 空字幕" });
    if (c.start < 0) f.push({ cue: i, kind: "negative", message: "starts before 0 after shifting / 平移后时间小于 0" });
    if (c.end <= c.start) f.push({ cue: i, kind: "order", message: "ends before it starts / 结束早于开始" });
    else if (c.end - c.start < l.minDur) f.push({ cue: i, kind: "short", message: `on screen ${((c.end - c.start) / 1000).toFixed(2)}s (< ${(l.minDur / 1000).toFixed(1)}s) / 显示时间太短` });
    const v = cps(c);
    if (t && Number.isFinite(v) && v > l.maxCps) f.push({ cue: i, kind: "cps", message: `${v.toFixed(1)} chars/s (> ${l.maxCps}) / 读速过快` });
    const lines = t.split("\n");
    const wide = Math.max(...lines.map((x) => width(x)));
    if (wide > l.maxWidth) f.push({ cue: i, kind: "width", message: `line ${wide} wide (> ${l.maxWidth}) / 单行过长` });
    if (lines.length > l.maxLines) f.push({ cue: i, kind: "lines", message: `${lines.length} lines (> ${l.maxLines}) / 行数过多` });
    const n = cues[i + 1];
    if (n && n.start < c.end) f.push({ cue: i, kind: "overlap", message: `overlaps the next cue by ${((c.end - n.start) / 1000).toFixed(2)}s / 与下一条重叠` });
    if (n && n.start < c.start) f.push({ cue: i + 1, kind: "order", message: "starts before the previous cue / 顺序颠倒" });
  });
  return f;
}

/** 重叠时把前一条的结束时间提前到下一条开始前 minGap 毫秒 */
export function fixOverlaps(cues: OutCue[], minGap: number) {
  let n = 0;
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i], b = cues[i + 1];
    if (b.start >= a.start && a.end > b.start - minGap && a.end > b.start) { a.end = Math.max(a.start + 1, b.start - minGap); n++; }
  }
  return n;
}
