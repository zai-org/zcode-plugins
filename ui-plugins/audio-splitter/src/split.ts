export interface Silence { start: number; end: number }

export function parseSilences(stderr: string, duration: number): Silence[] {
  const out: Silence[] = [];
  let st: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === "start") st = t;
    else if (st !== null) { out.push({ start: st, end: t }); st = null; }
  }
  if (st !== null) out.push({ start: st, end: duration });
  return out;
}

/** 从静音得到音轨区间：每段静音中点切开，短于 minLen 的段并入相邻段，长于 maxLen 的按最长静音再切。 */
export function tracksFromSilences(sil: Silence[], duration: number, o: { minLen: number; maxLen: number; trim: boolean; pad: number }) {
  const inner = sil.filter((s) => s.start > 0.05 && s.end < duration - 0.05);
  const lead = sil.find((s) => s.start <= 0.05), tail = sil.find((s) => s.end >= duration - 0.05);
  let cuts = inner.map((s) => ({ at: (s.start + s.end) / 2, s }));
  const start0 = o.trim && lead ? Math.max(0, lead.end - o.pad) : 0, end0 = o.trim && tail ? Math.min(duration, tail.start + o.pad) : duration;
  const bounds = () => [start0, ...cuts.map((c) => c.at), end0];
  // 合并过短的段：删掉相邻段较短一侧的切点
  for (let guard = 0; guard < 500; guard++) {
    const b = bounds();
    const lens = b.slice(1).map((x, i) => x - b[i]);
    const i = lens.findIndex((l) => l < o.minLen);
    if (i < 0 || !cuts.length) break;
    const left = i - 1, right = i; // cut indices around segment i
    const drop = right >= cuts.length ? left : left < 0 ? right : lens[i - 1] <= lens[i + 1] ? left : right;
    cuts.splice(drop, 1);
  }
  // 过长的段：在段内最长静音处再切（没有静音就按 maxLen 硬切）
  const out: { start: number; end: number; reason: string }[] = [];
  const b = bounds();
  for (let i = 0; i + 1 < b.length; i++) {
    let a = b[i];
    const z = b[i + 1];
    while (z - a > o.maxLen) {
      const cand = sil.filter((s) => s.start > a + o.minLen && s.end < Math.min(z, a + o.maxLen)).sort((x, y) => y.end - y.start - (x.end - x.start))[0];
      const at = cand ? (cand.start + cand.end) / 2 : a + o.maxLen;
      out.push({ start: a, end: at, reason: cand ? "silence" : "max length" });
      a = at;
    }
    out.push({ start: a, end: z, reason: i === 0 && i + 2 === b.length ? "whole" : "silence" });
  }
  if (o.trim) for (const t of out) {
    const s1 = sil.find((s) => s.start <= t.start + 0.01 && s.end > t.start), s2 = sil.find((s) => s.start < t.end && s.end >= t.end - 0.01);
    if (s1) t.start = Math.max(t.start, s1.end - o.pad);
    if (s2) t.end = Math.min(t.end, s2.start + o.pad);
  }
  return out;
}

/** 章节表：每行“mm:ss 标题”或只有标题。 */
export function parseChapters(text: string) {
  return text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^\[?((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?\s*[-–—:：]?\s*(.*)$/.exec(l);
    if (!m) return { title: l };
    const p = m[1].replace(",", ".").split(":").map(Number);
    return { at: p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1], title: m[2] };
  });
}

export const hms = (t: number, ms = false) => {
  const neg = t < 0; t = Math.abs(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = ms ? s.toFixed(2).padStart(5, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${neg ? "-" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : String(m).padStart(2, "0")}:${ss}`;
};
export function parseHms(v: unknown) {
  const t = String(v ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const p = t.replace(",", ".").split(":");
  if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  return p.reduce((a, x) => a * 60 + Number(x), 0);
}
export const safeName = (t: string) => t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
