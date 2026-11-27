import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { KitError } from "./kit/workspace.ts";
import { hms, parseChapters, parseHms, parseSilences, safeName, tracksFromSilences } from "./split.ts";
import { pad2, s } from "./util.ts";

export const NAME = "audio-splitter";
export const VERSION = "0.1.0";
const AUDIO = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus", ".mp4", ".mov"];

const live = (p: Project) => p.rows.map((r, i) => ({ r, i, start: parseHms(r.start), end: parseHms(r.end) })).filter((x) => x.r.include !== false);
const nameOf = (p: Project, k: number, title: string, ext: string) => `${safeName((s(p.settings.naming) || "{n} {title}").replace(/\{n\}/g, pad2(k + 1)).replace(/\{title\}/g, title || `Track ${k + 1}`).replace(/\{album\}/g, s(p.settings.album)))}${ext}`;

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "split",
    title: ["长音频切分", "Audio Splitter"],
    openDescription:
      "Split a long recording (lecture, podcast, meeting, live set; mp3/m4a/wav/flac/ogg or a video's audio) into tracks at silences, at fixed intervals, or at the times in a chapter list. Optionally pick a chapter/track list (.txt/.csv: one title per line, optionally starting with mm:ss) — with times it sets the cuts, without times it names the tracks in order. Silence detection uses ffmpeg (threshold dB and minimum silence length); tracks shorter than the minimum are merged into a neighbour, longer than the maximum are cut again at their longest silence. Rows are tracks (start, end, title): move cut points by editing times, rename, untick to skip, add rows. Exports the audio tracks (copy without re-encoding, or mp3/m4a/wav), tracks.csv, a YouTube-style chapters.txt and a .cue sheet. Needs ffmpeg.",
    inputs: { exts: [...AUDIO, ".txt", ".csv"], min: 1, max: 2, label: ["选择长音频（可加章节列表）", "Pick the recording (and a chapter list)"] },
    settings: [
      { key: "mode", label: ["切分方式", "Split by"], type: "select", default: "silence", reload: true, options: [{ value: "silence", label: ["静音", "Silences"] }, { value: "interval", label: ["固定时长", "Fixed length"] }, { value: "chapters", label: ["章节表时间", "Chapter list times"] }] },
      { key: "noise", label: ["静音阈值（dB）", "Silence threshold (dB)"], type: "number", default: -35, min: -80, max: -10, reload: true },
      { key: "minSilence", label: ["最短静音（秒）", "Min silence (s)"], type: "number", default: 1, min: 0.2, max: 30, reload: true },
      { key: "minLen", label: ["每段最短（秒）", "Min track length (s)"], type: "number", default: 10, min: 1, max: 3600, reload: true },
      { key: "maxLen", label: ["每段最长（秒）", "Max track length (s)"], type: "number", default: 1800, min: 10, max: 36000, reload: true },
      { key: "interval", label: ["固定时长（秒）", "Fixed length (s)"], type: "number", default: 600, min: 5, max: 36000, reload: true },
      { key: "trim", label: ["去掉每段首尾静音", "Trim silence at track edges"], type: "bool", default: true, reload: true },
      { key: "format", label: ["输出格式", "Output format"], type: "select", default: "copy", options: [{ value: "copy", label: ["原格式（不重新编码）", "Same as source (no re-encode)"] }, { value: "mp3", label: ["MP3", "MP3"] }, { value: "m4a", label: ["M4A (AAC)", "M4A (AAC)"] }, { value: "wav", label: ["WAV", "WAV"] }] },
      { key: "naming", label: ["文件名（{n} 序号，{title} 标题）", "File name ({n}, {title}, {album})"], type: "text", default: "{n} {title}" },
      { key: "album", label: ["专辑/系列名", "Album / series"], type: "text", default: "" },
      { key: "artist", label: ["作者/讲者", "Artist / speaker"], type: "text", default: "" },
    ],
    columns: () => [
      { key: "include", label: ["导出", "Export"], type: "bool" },
      { key: "start", label: ["开始", "Start"] },
      { key: "end", label: ["结束", "End"] },
      { key: "title", label: ["标题", "Title"], wide: true },
      { key: "_len", label: ["时长", "Length"], readOnly: true },
      { key: "_file", label: ["文件名", "File"], readOnly: true },
    ],
    newRow: () => ({ include: true, start: "", end: "", title: "" }),
    async load({ ws, files, settings, previous }) {
      const audio = files.find((f) => AUDIO.includes(extname(f).toLowerCase()));
      const list = files.find((f) => /\.(txt|csv)$/i.test(f));
      if (!audio) throw new KitError("no_audio", "Pick an audio (or video) file to split.");
      const abs = ws.resolve(audio);
      const info = await probe(abs);
      if (!info.hasAudio) throw new KitError("no_audio", `${audio} has no audio track.`);
      const dur = info.duration;
      const chapters = list ? parseChapters((await ws.readText(list)).replace(/,/g, " ")) : [];
      const mode = s(settings.mode) || "silence";
      let tracks: { start: number; end: number }[];
      let silences = 0;
      if (mode === "chapters") {
        const timed = chapters.filter((c) => c.at !== undefined);
        if (!timed.length) throw new KitError("no_times", "The chapter list has no times (write lines like “12:30 Title”), or switch mode to silence.");
        tracks = timed.map((c, i) => ({ start: c.at!, end: timed[i + 1]?.at ?? dur }));
      } else if (mode === "interval") {
        const n = Number(settings.interval ?? 600);
        tracks = Array.from({ length: Math.max(1, Math.ceil(dur / n - 0.01)) }, (_, i) => ({ start: i * n, end: Math.min(dur, (i + 1) * n) }));
      } else {
        const { stderr } = await ffmpeg(["-i", abs, "-vn", "-af", `silencedetect=noise=${Number(settings.noise ?? -35)}dB:d=${Number(settings.minSilence ?? 1)}`, "-f", "null", "-"], { timeoutMs: 600_000, duration: dur });
        const sil = parseSilences(stderr, dur);
        silences = sil.length;
        tracks = tracksFromSilences(sil, dur, { minLen: Number(settings.minLen ?? 10), maxLen: Number(settings.maxLen ?? 1800), trim: settings.trim !== false, pad: 0.3 });
      }
      const titles = chapters.map((c) => c.title);
      const prevTitles = (previous ?? []).map((r) => s(r.title));
      const rows: Row[] = tracks.map((t, i) => ({ include: true, start: hms(t.start, true), end: hms(t.end, true), title: (mode === "chapters" ? chapters.filter((c) => c.at !== undefined)[i]?.title : titles[i]) || prevTitles[i] || "" }));
      return { rows, meta: { audio, list: list ?? "", duration: dur, silences, chapters: titles.length } };
    },
    compute(p): Computed {
      const issues: Issue[] = [];
      const dur = Number(p.meta.duration) || 0;
      const xs = live(p);
      xs.forEach((x, k) => {
        if (!Number.isFinite(x.start)) issues.push({ level: "error", row: x.i, key: "start", message: `Start “${s(x.r.start)}” is not a time (use mm:ss or h:mm:ss).` });
        if (!Number.isFinite(x.end)) issues.push({ level: "error", row: x.i, key: "end", message: `End “${s(x.r.end)}” is not a time.` });
        if (!Number.isFinite(x.start) || !Number.isFinite(x.end)) return;
        if (x.end <= x.start) issues.push({ level: "error", row: x.i, key: "end", message: `Track ${k + 1} ends (${s(x.r.end)}) before it starts (${s(x.r.start)}).` });
        if (x.end > dur + 0.5) issues.push({ level: "warn", row: x.i, key: "end", message: `Track ${k + 1} ends after the recording (${hms(dur)}); it will stop at the end.` });
        const nx = xs[k + 1];
        if (nx && Number.isFinite(nx.start) && nx.start < x.end - 0.05) issues.push({ level: "error", row: nx.i, key: "start", message: `Track ${k + 2} starts at ${s(nx.r.start)}, before track ${k + 1} ends (${s(x.r.end)}) — they overlap.` });
        if (!s(x.r.title)) issues.push({ level: "info", row: x.i, key: "title", message: `Track ${k + 1} has no title — the file will be called “Track ${k + 1}”.` });
      });
      const names = new Map<string, number>();
      xs.forEach((x, k) => { const n = nameOf(p, k, s(x.r.title), "").toLowerCase(); if (names.has(n)) issues.push({ level: "error", row: x.i, key: "title", message: `Two tracks would get the file name “${n}” — rename one.` }); names.set(n, k); });
      if (Number(p.meta.chapters) && Number(p.meta.chapters) !== xs.length) issues.push({ level: "warn", message: `The chapter list has ${p.meta.chapters} title(s) but there are ${xs.length} track(s) — check the cuts (lower the minimum track length or the silence threshold) or the titles.` });
      const total = xs.reduce((a, x) => a + (Number.isFinite(x.end - x.start) ? x.end - x.start : 0), 0);
      const W = 900, X = (t: number) => (t / Math.max(1, dur)) * W;
      const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="46" viewBox="0 0 ${W} 46" style="max-width:100%"><rect width="${W}" height="46" fill="#f1f5f9"/>${xs.filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end)).map((x, k) => `<rect x="${X(x.start)}" y="6" width="${Math.max(2, X(x.end) - X(x.start) - 1)}" height="34" rx="4" fill="${["#2563eb", "#16a34a", "#f97316", "#9333ea", "#0891b2"][k % 5]}"><title>${esc(`${k + 1}. ${s(x.r.title)}`)}</title></rect><text x="${X(x.start) + 4}" y="28" font-size="12" fill="#fff" font-family="sans-serif">${k + 1}</text>`).join("")}</svg>`;
      return {
        rows: p.rows.map((r) => { const k = xs.findIndex((x) => x.r === r); const a = parseHms(r.start), b = parseHms(r.end); return { ...r, _len: Number.isFinite(b - a) ? hms(b - a) : "", _file: k >= 0 ? nameOf(p, k, s(r.title), ext(p)) : "" }; }),
        issues,
        summary: `${xs.length} track(s) from ${s(p.meta.audio)} (${hms(dur)}), ${hms(total)} kept${p.meta.silences ? `; ${p.meta.silences} silence(s) found` : ""}.`,
        stats: { tracks: xs.length, duration: Math.round(dur), silences: Number(p.meta.silences) || 0 },
        preview,
      };
    },
    exports: [
      {
        id: "tracks", label: ["切好的音频", "Audio tracks"], description: "tracks/NN title.ext",
        async run({ project, ws, outDir }: ExportCtx) {
          const abs = ws.resolve(s(project.meta.audio)), e = ext(project), fmt = s(project.settings.format) || "copy";
          const dir = join(ws.resolve(outDir), "tracks");
          await mkdir(dir, { recursive: true });
          const out: string[] = [];
          const xs = live(project).filter((x) => Number.isFinite(x.start) && x.end > x.start);
          for (const [k, x] of xs.entries()) {
            const name = nameOf(project, k, s(x.r.title), e);
            const codec = fmt === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : fmt === "m4a" ? ["-c:a", "aac", "-b:a", "160k"] : fmt === "wav" ? ["-c:a", "pcm_s16le"] : ["-c", "copy"];
            const meta = ["-metadata", `title=${s(x.r.title) || `Track ${k + 1}`}`, "-metadata", `track=${k + 1}/${xs.length}`, ...(s(project.settings.album) ? ["-metadata", `album=${s(project.settings.album)}`] : []), ...(s(project.settings.artist) ? ["-metadata", `artist=${s(project.settings.artist)}`] : [])];
            await ffmpeg(["-ss", String(x.start), "-to", String(x.end), "-i", abs, "-vn", "-map_metadata", "-1", ...codec, ...meta, join(dir, name)], { timeoutMs: 600_000 });
            out.push(`${outDir}/tracks/${name}`);
          }
          return out;
        },
      },
      {
        id: "lists", label: ["分段清单（CSV/章节/CUE）", "Track lists (CSV, chapters, CUE)"], description: "tracks.csv, chapters.txt, album.cue",
        async run({ project, write }: ExportCtx) {
          const xs = live(project).filter((x) => Number.isFinite(x.start) && x.end > x.start), e = ext(project);
          const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
          const csv = "\ufefftrack,start,end,length_s,title,file\n" + xs.map((x, k) => [k + 1, hms(x.start, true), hms(x.end, true), (x.end - x.start).toFixed(2), q(s(x.r.title)), q(nameOf(project, k, s(x.r.title), e))].join(",")).join("\n") + "\n";
          const chapters = xs.map((x, k) => `${hms(x.start)} ${s(x.r.title) || `Track ${k + 1}`}`).join("\n") + "\n";
          const cueT = (t: number) => { const f = Math.round(t * 75); return `${pad2(Math.floor(f / 4500))}:${pad2(Math.floor((f % 4500) / 75))}:${pad2(f % 75)}`; };
          const src = s(project.meta.audio).split("/").pop()!;
          const cue = `${s(project.settings.artist) ? `PERFORMER "${s(project.settings.artist)}"\n` : ""}TITLE "${s(project.settings.album) || src.replace(/\.[^.]+$/, "")}"\nFILE "${src}" ${/\.wav$/i.test(src) ? "WAVE" : "MP3"}\n` + xs.map((x, k) => `  TRACK ${pad2(k + 1)} AUDIO\n    TITLE "${(s(x.r.title) || `Track ${k + 1}`).replace(/"/g, "'")}"\n    INDEX 01 ${cueT(x.start)}`).join("\n") + "\n";
          return [await write("tracks.csv", csv), await write("chapters.txt", chapters), await write("album.cue", cue)];
        },
      },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [skip]" : ""} ${s(r.start)}–${s(r.end)} ${s(r.title)}`,
  };
}
const ext = (p: Project) => { const f = s(p.settings.format) || "copy"; return f === "copy" ? extname(s(p.meta.audio)).toLowerCase().replace(/^\.(mp4|mov)$/, ".m4a") : `.${f}`; };

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
