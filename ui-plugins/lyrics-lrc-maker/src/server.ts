import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { KitError } from "./kit/workspace.ts";
import { fitLines, fmtLrc, fmtSrt, parseLyrics, parseTime, voicedSegments } from "./timing.ts";
import { s } from "./util.ts";

export const NAME = "lyrics-lrc-maker";
export const VERSION = "0.1.0";
const AUDIO = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"], TEXT = [".txt", ".lrc"];
const weight = (t: string) => Math.max(1, [...t].filter((c) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c)).length + (t.match(/[A-Za-z']+/g) ?? []).length * 1.6);
const units = (t: string) => t.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9']+\s*|[^\sA-Za-z0-9'\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+\s*|\s+/g) ?? [t];

function timed(p: Project) {
  const off = (Number(p.settings.offset) || 0) / 1000;
  const rows = p.rows.map((r, i) => ({ i, text: s(r.text), start: parseTime(r.start), end: parseTime(r.end) })).filter((x) => x.text || Number.isFinite(x.start));
  return rows.map((x, k) => {
    const next = rows.slice(k + 1).find((y) => Number.isFinite(y.start));
    const end = Number.isFinite(x.end) ? x.end : next ? next.start : x.start + 4;
    return { ...x, start: x.start + off, end: end + off };
  });
}

function lrc(p: Project, enhanced: boolean) {
  const head = (["ti", "ar", "al", "by"] as const).map((k) => [k, s(p.settings[{ ti: "title", ar: "artist", al: "album", by: "by" }[k]])]).filter(([, v]) => v).map(([k, v]) => `[${k}:${v}]`);
  const dur = Number(p.meta.duration) || 0;
  if (dur) head.push(`[length:${fmtLrc(dur).slice(0, 5)}]`);
  head.push("[re:Penova lyrics-lrc-maker]");
  const body = timed(p).filter((x) => Number.isFinite(x.start)).map((x) => {
    if (!enhanced || !x.text) return `[${fmtLrc(x.start)}]${x.text}`;
    const us = units(x.text), tw = us.reduce((a, u) => a + (u.trim() ? weight(u) : 0), 0) || 1, len = Math.max(0.2, x.end - x.start - 0.15);
    let acc = 0;
    return `[${fmtLrc(x.start)}]` + us.map((u) => { const t = x.start + (len * acc) / tw; if (u.trim()) acc += weight(u); return u.trim() ? `<${fmtLrc(t)}>${u}` : u; }).join("") + `<${fmtLrc(x.start + len)}>`;
  });
  return [...head, ...body].join("\n") + "\n";
}

function srt(p: Project) {
  return timed(p).filter((x) => x.text && Number.isFinite(x.start)).map((x, k) => `${k + 1}\n${fmtSrt(x.start)} --> ${fmtSrt(Math.max(x.start + 0.5, x.end - 0.05))}\n${x.text}\n`).join("\n");
}

function timeline(p: Project) {
  const dur = Number(p.meta.duration) || Math.max(10, ...timed(p).map((x) => x.end || 0));
  const segs = (p.meta.segments as { start: number; end: number }[] | undefined) ?? [];
  const W = 900, X = (t: number) => (t / dur) * W;
  const lines = timed(p).filter((x) => Number.isFinite(x.start) && x.text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="70" viewBox="0 0 ${W} 70" style="max-width:100%"><rect width="${W}" height="70" fill="#f8fafc"/>${segs.map((g) => `<rect x="${X(g.start)}" y="8" width="${Math.max(1, X(g.end) - X(g.start))}" height="16" fill="#93c5fd"/>`).join("")}${lines.map((x, k) => `<rect x="${X(x.start)}" y="${30 + (k % 2) * 18}" width="${Math.max(2, X(x.end) - X(x.start) - 2)}" height="14" rx="3" fill="${k % 2 ? "#f97316" : "#2563eb"}"><title>${esc(x.text)}</title></rect>`).join("")}</svg>`;
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "lrc",
    title: ["歌词时间轴", "Lyrics Timer"],
    openDescription:
      "Time song lyrics and export LRC/SRT. Pick a lyrics file (.txt, one line per lyric line, or an existing .lrc to re-time) and, optionally, the song (mp3/m4a/wav/flac). With audio, the sung parts are detected from the loudness envelope and lyric lines are matched to them in proportion to their length (one line can span several phrases, or several short lines share one); without audio, lines are spaced evenly. Each row is one line with start (and optional end) as mm:ss.xx — edit to nudge, or set offset (ms) to shift everything. Checks: times out of order, missing times, lines after the end of the song. Exports .lrc (with ti/ar/al tags), enhanced word-timed .lrc and .srt. Needs ffmpeg for audio.",
    inputs: { exts: [...TEXT, ...AUDIO], min: 1, max: 2, label: ["选择歌词（.txt/.lrc）和歌曲音频", "Pick the lyrics (.txt/.lrc) and the song"] },
    settings: [
      { key: "title", label: ["歌名", "Title"], type: "text", default: "" },
      { key: "artist", label: ["歌手", "Artist"], type: "text", default: "" },
      { key: "album", label: ["专辑", "Album"], type: "text", default: "" },
      { key: "by", label: ["制作人", "LRC by"], type: "text", default: "" },
      { key: "offset", label: ["整体偏移（毫秒，正数延后）", "Offset (ms, + = later)"], type: "number", default: 0, min: -60000, max: 60000 },
      { key: "retime", label: ["重新自动打轴", "Re-time automatically"], type: "select", default: "keep", reload: true, options: [{ value: "keep", label: ["保留已有时间", "Keep existing times"] }, { value: "audio", label: ["按音频重新打轴", "Re-time from audio"] }, { value: "even", label: ["平均分布", "Even spacing"] }] },
      { key: "sensitivity", label: ["人声检测灵敏度（0.05-0.4，小=更灵敏）", "Voice detection threshold (0.05–0.4)"], type: "number", default: 0.12, min: 0.02, max: 0.6, reload: true },
      { key: "evenStart", label: ["平均分布：第一行时间（秒）", "Even: first line at (s)"], type: "number", default: 5, min: 0, max: 600, reload: true },
      { key: "evenGap", label: ["平均分布：每行间隔（秒）", "Even: seconds per line"], type: "number", default: 4, min: 0.5, max: 60, reload: true },
    ],
    columns: () => [
      { key: "start", label: ["开始", "Start"] },
      { key: "end", label: ["结束（可空）", "End (optional)"] },
      { key: "text", label: ["歌词", "Lyric"], wide: true },
      { key: "_dur", label: ["时长", "Length"], readOnly: true },
    ],
    newRow: () => ({ start: "", end: "", text: "" }),
    async load({ ws, files, settings, previous }) {
      const lyr = files.find((f) => TEXT.some((e) => f.toLowerCase().endsWith(e))), audio = files.find((f) => AUDIO.some((e) => f.toLowerCase().endsWith(e)));
      if (!lyr) throw new KitError("no_lyrics", "Pick a lyrics file (.txt or .lrc).");
      const { tags, lines } = parseLyrics(await ws.readText(lyr));
      if (!lines.length) throw new KitError("empty", "The lyrics file has no lines.");
      const meta: Record<string, unknown> = { lyrics: lyr, audio: audio ?? "", tags };
      let segs: { start: number; end: number }[] = [];
      if (audio) {
        const abs = ws.resolve(audio);
        const info = await probe(abs);
        if (!info.hasAudio) throw new KitError("no_audio", `${audio} has no audio track.`);
        const { stdout } = await ffmpeg(["-i", abs, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { timeoutMs: 180_000 });
        const v = voicedSegments(stdout, 8000, { sensitivity: Number(settings.sensitivity ?? 0.12) });
        segs = v.segs; meta.duration = info.duration || v.duration; meta.segments = segs;
      }
      const mode = s(settings.retime) || "keep";
      const keep = mode === "keep" && previous?.length === lines.length && previous.every((r) => Number.isFinite(parseTime(r.start)));
      const hasTimes = lines.every((l) => l.start !== undefined);
      let times: { start: number; end?: number }[];
      if (keep) times = previous!.map((r) => ({ start: parseTime(r.start), end: Number.isFinite(parseTime(r.end)) ? parseTime(r.end) : undefined }));
      else if (hasTimes && mode === "keep") times = lines.map((l) => ({ start: l.start! }));
      else if (segs.length && mode !== "even") {
        const idx = lines.map((l, i) => (l.text ? i : -1)).filter((i) => i >= 0);
        const fit = fitLines(idx.map((i) => weight(lines[i].text)), segs);
        times = lines.map(() => ({ start: NaN }));
        idx.forEach((li, k) => (times[li] = { start: fit[k].start, end: fit[k].end }));
        times.forEach((t, i) => { if (!Number.isFinite(t.start)) t.start = (times[i - 1]?.end ?? 0) + 0.2; });
      } else times = lines.map((_, i) => ({ start: Number(settings.evenStart ?? 5) + i * Number(settings.evenGap ?? 4) }));
      const rows: Row[] = lines.map((l, i) => ({ text: keep ? s(previous![i].text) : l.text, start: fmtLrc(times[i].start), end: times[i].end !== undefined ? fmtLrc(times[i].end!) : "" }));
      return { rows, meta };
    },
    compute(p): Computed {
      const issues: Issue[] = [];
      const dur = Number(p.meta.duration) || 0;
      let prev = -1;
      p.rows.forEach((r, i) => {
        const st = parseTime(r.start), en = parseTime(r.end);
        if (!s(r.start)) { if (s(r.text)) issues.push({ level: "error", row: i, key: "start", message: `“${s(r.text)}” has no start time.` }); return; }
        if (!Number.isFinite(st)) { issues.push({ level: "error", row: i, key: "start", message: `Start “${s(r.start)}” is not a time (use mm:ss.xx, e.g. 01:23.45).` }); return; }
        if (s(r.end) && !Number.isFinite(en)) issues.push({ level: "error", row: i, key: "end", message: `End “${s(r.end)}” is not a time.` });
        if (Number.isFinite(en) && en <= st) issues.push({ level: "error", row: i, key: "end", message: `End ${s(r.end)} is not after start ${s(r.start)}.` });
        if (st < prev) issues.push({ level: "error", row: i, key: "start", message: `Line ${i} (“${s(r.text)}”) starts at ${s(r.start)}, before the previous line — times must go up.` });
        if (dur && st > dur) issues.push({ level: "warn", row: i, key: "start", message: `Starts at ${s(r.start)}, after the song ends (${fmtLrc(dur)}).` });
        if (!s(r.text)) issues.push({ level: "info", row: i, key: "text", message: "Empty lyric — shown as a pause (clears the previous line)." });
        prev = Math.max(prev, st);
      });
      const segs = ((p.meta.segments as unknown[]) ?? []).length;
      const t = timed(p);
      return {
        rows: p.rows.map((r) => { const st = parseTime(r.start), x = t.find((y) => y.start === st + (Number(p.settings.offset) || 0) / 1000 && y.text === s(r.text)); return { ...r, _dur: x && Number.isFinite(x.end - x.start) ? `${(x.end - x.start).toFixed(1)}s` : "" }; }),
        issues,
        summary: `${p.rows.filter((r) => s(r.text)).length} lyric line(s)${p.meta.audio ? `, song ${fmtLrc(dur)} with ${segs} sung phrase(s) detected` : ", no audio (even spacing)"}; first line at ${s(p.rows[0]?.start)}${Number(p.settings.offset) ? `, offset ${p.settings.offset} ms` : ""}.`,
        stats: { lines: p.rows.length, phrases: segs, duration: Math.round(dur) },
        preview: timeline(p),
      };
    },
    exports: [
      { id: "lrc", label: ["LRC 歌词", "LRC"], description: "<name>.lrc", async run({ project, write }: ExportCtx) { return [await write(`${stem(project)}.lrc`, lrc(project, false))]; } },
      { id: "elrc", label: ["逐字 LRC", "Enhanced LRC"], description: "<name>.enhanced.lrc — word/character timing", async run({ project, write }: ExportCtx) { return [await write(`${stem(project)}.enhanced.lrc`, lrc(project, true))]; } },
      { id: "srt", label: ["SRT 字幕", "SRT"], description: "<name>.srt — for video editors", async run({ project, write }: ExportCtx) { return [await write(`${stem(project)}.srt`, srt(project))]; } },
    ],
    describeRow: (r, i) => `#${i} [${s(r.start)}${s(r.end) ? `–${s(r.end)}` : ""}] ${s(r.text)}`,
  };
}
const stem = (p: Project) => (s(p.settings.title) || s(p.meta.lyrics).split("/").pop()!.replace(/\.[^.]+$/, "") || "lyrics").replace(/[\\/:*?"<>|]/g, "_");

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
