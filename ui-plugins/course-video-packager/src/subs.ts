import { KitError } from "./kit/workspace.ts";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const toSec = (t: string) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(t.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
};

/** 解析 SRT / WebVTT（忽略样式和注释块）。 */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = toSec(a);
    const end = toSec(b.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (body) cues.push({ start, end: Math.max(end, start + 0.1), text: body });
  }
  if (!cues.length && text.trim()) throw new KitError("bad_subtitles", "No subtitle cues found (expected SRT or WebVTT).");
  return cues.sort((x, y) => x.start - y.start);
}

/** 取 [a, b) 区间内的字幕并平移到从 0 开始；跨边界的字幕裁剪。 */
export function sliceCues(cues: Cue[], a: number, b: number): Cue[] {
  return cues
    .filter((c) => c.end > a + 0.05 && c.start < b - 0.05)
    .map((c) => ({ start: Math.max(0, c.start - a), end: Math.min(b, c.end) - a, text: c.text }));
}

const stamp = (s: number, sep: string) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;

export const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** 给 Agent 看的逐段文字稿：每约 blockSeconds 秒一行，带时间戳；总长度受限。 */
export function digest(cues: Cue[], blockSeconds = 30, maxChars = 24000) {
  const lines: string[] = [];
  let cur: Cue[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push(`[${clock(cur[0].start)}] ${cur.map((c) => c.text.replace(/\s+/g, " ")).join(" ")}`);
    cur = [];
  };
  for (const c of cues) {
    if (cur.length && c.start - cur[0].start >= blockSeconds) flush();
    cur.push(c);
  }
  flush();
  let text = lines.join("\n");
  if (text.length > maxChars) {
    const keep = Math.floor(maxChars / 2);
    text = `${text.slice(0, keep)}\n…（中间省略 / middle omitted）…\n${text.slice(-keep)}`;
  }
  return text;
}

/** 字幕之间较长的空隙（可能的换章处）。 */
export function gaps(cues: Cue[], min = 2) {
  const out: { at: number; length: number }[] = [];
  for (let i = 1; i < cues.length; i++) {
    const g = cues[i].start - cues[i - 1].end;
    if (g >= min) out.push({ at: Math.round(((cues[i - 1].end + cues[i].start) / 2) * 10) / 10, length: Math.round(g * 10) / 10 });
  }
  return out;
}
