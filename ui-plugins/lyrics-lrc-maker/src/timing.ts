/** 由 PCM（s16le 单声道）算出有声段。 */
export function voicedSegments(pcm: Buffer, rate: number, o: { frameMs?: number; minLen?: number; mergeGap?: number; sensitivity?: number } = {}) {
  const fm = o.frameMs ?? 20, n = Math.floor((rate * fm) / 1000), frames: number[] = [];
  for (let i = 0; i + n * 2 <= pcm.length; i += n * 2) { let s = 0; for (let k = 0; k < n; k++) { const v = pcm.readInt16LE(i + k * 2) / 32768; s += v * v; } frames.push(Math.sqrt(s / n)); }
  if (!frames.length) return { segs: [] as { start: number; end: number }[], duration: 0 };
  const sorted = [...frames].sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.1)], peak = sorted[Math.floor(sorted.length * 0.98)];
  const th = floor + (peak - floor) * (o.sensitivity ?? 0.12);
  const segs: { start: number; end: number }[] = [];
  let st = -1;
  frames.forEach((v, i) => { if (v > th && st < 0) st = i; if (v <= th && st >= 0) { segs.push({ start: (st * fm) / 1000, end: (i * fm) / 1000 }); st = -1; } });
  if (st >= 0) segs.push({ start: (st * fm) / 1000, end: (frames.length * fm) / 1000 });
  const merged: typeof segs = [];
  for (const s of segs) { const last = merged[merged.length - 1]; if (last && s.start - last.end < (o.mergeGap ?? 0.25)) last.end = s.end; else merged.push({ ...s }); }
  return { segs: merged.filter((s) => s.end - s.start >= (o.minLen ?? 0.3)), duration: (frames.length * fm) / 1000 };
}

/** 把 N 行歌词按字数比例匹配到 M 个有声段（一行占多段，或一段放多行）。 */
export function fitLines(weights: number[], segs: { start: number; end: number }[]) {
  const N = weights.length, M = segs.length;
  if (!N) return [];
  if (!M) return weights.map(() => ({ start: 0, end: 0 }));
  const W = weights.reduce((a, b) => a + b, 0), T = segs.reduce((a, s) => a + s.end - s.start, 0);
  const wp = [0], tp = [0];
  weights.forEach((w) => wp.push(wp[wp.length - 1] + w / W));
  segs.forEach((s) => tp.push(tp[tp.length - 1] + (s.end - s.start) / T));
  const D = Array.from({ length: N + 1 }, () => new Array<number>(M + 1).fill(Infinity));
  const B = Array.from({ length: N + 1 }, () => new Array<[number, number]>(M + 1));
  D[0][0] = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
    if (D[i][j] === Infinity) continue;
    for (let k = 1; k <= 6; k++) {
      for (const [di, dj] of [[1, k], [k, 1]] as [number, number][]) {
        if (k === 1 && di === 1 && dj === 1 && false) continue;
        const a = i + di, b = j + dj;
        if (a > N || b > M) continue;
        const c = D[i][j] + ((wp[a] - wp[i]) - (tp[b] - tp[j])) ** 2 * 100 + (di > 1 || dj > 1 ? 0.15 * (k - 1) : 0);
        if (c < D[a][b]) { D[a][b] = c; B[a][b] = [di, dj]; }
      }
    }
  }
  const out: { start: number; end: number }[] = new Array(N);
  let i = N, j = M;
  while (i > 0) {
    const [di, dj] = B[i][j];
    const group = segs.slice(j - dj, j), ws = weights.slice(i - di, i);
    if (di === 1) out[i - 1] = { start: group[0].start, end: group[group.length - 1].end };
    else {
      const s0 = group[0].start, len = group[0].end - s0, tw = ws.reduce((a, b) => a + b, 0);
      let acc = 0;
      ws.forEach((w, k) => { out[i - di + k] = { start: s0 + (len * acc) / tw, end: s0 + (len * (acc + w)) / tw }; acc += w; });
    }
    i -= di; j -= dj;
  }
  return out;
}

export function fmtLrc(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  return `${String(Math.floor(cs / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
export function fmtSrt(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
/** 00:12.34 / 0:12 / 12.5 / 1:02:03.4 → 秒；无法解析返回 NaN。 */
export function parseTime(v: unknown) {
  const t = String(v ?? "").trim().replace(/^\[|\]$/g, "");
  if (!t) return NaN;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:[.,]\d{1,3})?)$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3].replace(",", ".")) : NaN;
}

/** 读取 .lrc（含多时间标签行）或纯文本歌词。 */
export function parseLyrics(text: string) {
  const tags: Record<string, string> = {};
  const lines: { text: string; start?: number }[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    const tag = /^\[(ti|ar|al|by|au|length|offset|re|ve):(.*)\]$/i.exec(l);
    if (tag) { tags[tag[1].toLowerCase()] = tag[2].trim(); continue; }
    const times = [...l.matchAll(/\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g)].map((m) => parseTime(m[1].replace(/:(\d+)$/, ".$1")));
    const body = l.replace(/\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/g, "").replace(/<\d+:\d{2}\.\d{2}>/g, "").trim();
    if (times.length) for (const t of times) lines.push({ text: body, start: t });
    else if (l) lines.push({ text: body });
  }
  if (lines.some((x) => x.start !== undefined)) lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return { tags, lines };
}
