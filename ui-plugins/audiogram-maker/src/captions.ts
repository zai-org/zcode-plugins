/** 字幕时间解析：SRT / LRC / 纯文本。 */
export interface Cue { start: number; end?: number; text: string }

export function parseTime(v: unknown): number {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!t) return NaN;
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return NaN;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((a, x) => a * 60 + x, 0);
}

export function fmtTime(sec: number) {
  if (!Number.isFinite(sec)) return "";
  const c = Math.round(Math.max(0, sec) * 100), m = Math.floor(c / 6000), s = (c % 6000) / 100;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function fmtSrt(sec: number) {
  const ms = Math.round(Math.max(0, sec) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export function parseSrt(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->").map((x) => x.trim().split(/\s/)[0]);
    out.push({ start: parseTime(a), end: parseTime(b), text: lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").trim() });
  }
  return out;
}

export function parseLrc(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const tags = [...line.matchAll(/\[(\d+:\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const body = line.replace(/\[[^\]]*\]/g, "").replace(/<[^>]+>/g, "").trim();
    for (const t of tags) cues.push({ start: parseTime(t[1].split(":").length === 3 ? t[1].replace(/:(\d+)$/, ".$1") : t[1]), text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  cues.forEach((c, i) => (c.end = cues[i + 1]?.start ?? c.start + 4));
  return cues.filter((c) => c.text);
}

export const weight = (t: string) => Math.max(2, [...t].filter((c) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c)).length + (t.match(/[A-Za-z0-9']+/g) ?? []).length * 1.6);

/** 纯文本：每行一条，按长度分配到 [a, b]。 */
export function spreadText(text: string, a: number, b: number): Cue[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tw = lines.reduce((x, l) => x + weight(l), 0) || 1;
  let t = a;
  return lines.map((l) => { const d = ((b - a) * weight(l)) / tw; const c = { start: t, end: t + d - 0.1, text: l }; t += d; return c; });
}

/** 每秒 20 个峰值（0..1）。 */
export function envelope(pcm: Buffer, rate = 8000, perSec = 20) {
  const n = Math.floor(pcm.length / 2), win = Math.floor(rate / perSec), out: number[] = [];
  let max = 1;
  for (let i = 0; i + win <= n; i += win) {
    let sq = 0;
    for (let j = i; j < i + win; j++) { const v = pcm.readInt16LE(j * 2); sq += v * v; }
    const r = Math.sqrt(sq / win); out.push(r); if (r > max) max = r;
  }
  return out.map((x) => Math.round((x / max) * 100) / 100);
}
