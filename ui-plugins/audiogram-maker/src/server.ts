import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { escapeXml, fitTextBlock, renderSvg, wrapLines, type FontSet } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";
import { envelope, fmtSrt, fmtTime, parseLrc, parseSrt, parseTime, spreadText, type Cue } from "./captions.ts";
import { layoutFor, type Layout } from "./layout.ts";
import { fontsFor } from "./png.ts";
import { s } from "./util.ts";

export const NAME = "audiogram-maker";
export const VERSION = "0.1.0";
const AUDIO = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"], IMAGE = [".png", ".jpg", ".jpeg", ".webp"], CAPS = [".srt", ".lrc", ".txt"];
const FONT_ENV = "AUDIOGRAM_FONT";
const PER_SEC = 20;
const has = (f: string, exts: string[]) => exts.some((e) => f.toLowerCase().endsWith(e));
const hex = (c: unknown, d: string) => (/^#[0-9a-f]{6}$/i.test(s(c)) ? s(c) : d);

function clip(p: Project) {
  const dur = Number(p.meta.duration) || 0;
  let a = parseTime(p.settings.clipStart), b = parseTime(p.settings.clipEnd);
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b) || b <= a) b = dur;
  return { a: Math.max(0, Math.min(a, dur)), b: Math.min(b, dur || b), dur };
}

/** 视频里实际出现的字幕（相对片段开头的时间）。 */
function shown(p: Project) {
  const { a, b } = clip(p);
  return p.rows.map((r, i) => ({ i, text: s(r.text), st: parseTime(r.start), en: parseTime(r.end) }))
    .filter((x) => x.text && Number.isFinite(x.st) && Number.isFinite(x.en) && x.en > x.st && x.en > a && x.st < b)
    .map((x) => ({ ...x, st: Math.max(0, x.st - a), en: Math.min(b, x.en) - a }));
}

function bgFill(p: Project, L: Layout) {
  const bg = hex(p.settings.bg, "#1e293b");
  if (s(p.settings.bgStyle) !== "gradient") return { defs: "", fill: bg };
  return { defs: `<linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${hex(p.settings.accent, "#38bdf8")}" stop-opacity="0.3"/></linearGradient>`, fill: "url(#g)" };
}

/** 背景帧（标题、封面、进度条底槽），可选：静态波形、字幕、进度。 */
function frameSvg(p: Project, L: Layout, f: FontSet, o: { cover?: string; peaks?: number[]; caption?: string; progress?: number }) {
  const text = hex(p.settings.textColor, "#ffffff"), accent = hex(p.settings.accent, "#38bdf8");
  const { defs, fill } = bgFill(p, L);
  const c = L.cover, r = Math.round(c.s * 0.06);
  const title = s(p.settings.title), sub = s(p.settings.subtitle);
  const parts: string[] = [`<rect width="${L.W}" height="${L.H}" fill="${fill}"/>`];
  parts.push(`<clipPath id="cv"><rect x="${c.x}" y="${c.y}" width="${c.s}" height="${c.s}" rx="${r}"/></clipPath>`);
  if (o.cover) parts.push(`<image x="${c.x}" y="${c.y}" width="${c.s}" height="${c.s}" href="${o.cover}" clip-path="url(#cv)" preserveAspectRatio="xMidYMid slice"/>`);
  else parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.s}" height="${c.s}" rx="${r}" fill="${accent}" opacity="0.9"/><text x="${c.x + c.s / 2}" y="${c.y + c.s * 0.66}" font-family="${escapeXml(f.boldFamily ?? f.family)}" font-weight="700" font-size="${Math.round(c.s * 0.45)}" fill="${text}" text-anchor="middle">${escapeXml([...(title || "♪")][0])}</text>`);
  const T = L.title, tx = T.anchor === "middle" ? T.x : T.x;
  let subY = L.sub.y;
  if (title) {
    const fit = fitTextBlock(title, { width: T.w, height: T.size * 2.5 }, { size: T.size, minSize: Math.round(T.size * 0.6), maxLines: 2, lineHeight: 1.2 }, (t, z) => f.measure(t, z, true));
    fit.lines.forEach((ln, i) => parts.push(`<text x="${tx}" y="${T.y + fit.size * (0.9 + i * 1.2)}" font-family="${escapeXml(f.boldFamily ?? f.family)}" font-weight="700" font-size="${fit.size}" fill="${text}" text-anchor="${T.anchor}">${escapeXml(ln)}</text>`));
    subY = Math.round(T.y + fit.lines.length * fit.size * 1.2 + 18);
  }
  if (sub) parts.push(`<text x="${tx}" y="${subY + L.sub.size * 0.9}" font-family="${escapeXml(f.family)}" font-size="${L.sub.size}" fill="${text}" fill-opacity="0.75" text-anchor="${T.anchor}">${escapeXml(wrapLines(sub, T.w, (t) => f.measure(t, L.sub.size), 1).lines[0])}</text>`);
  const B = L.bar;
  parts.push(`<rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="${B.h / 2}" fill="${text}" fill-opacity="0.22"/>`);
  if (o.progress) parts.push(`<rect x="${B.x}" y="${B.y}" width="${B.w * o.progress}" height="${B.h}" rx="${B.h / 2}" fill="${text}"/>`);
  if (o.peaks?.length) {
    const V = L.wave, n = Math.min(o.peaks.length, Math.floor(V.w / 9)), bw = V.w / n, mid = V.y + V.h / 2;
    for (let i = 0; i < n; i++) {
      const v = o.peaks[Math.floor((i * o.peaks.length) / n)] ?? 0, h = Math.max(4, Math.sqrt(v) * V.h);
      parts.push(`<rect x="${(V.x + i * bw + bw * 0.2).toFixed(1)}" y="${(mid - h / 2).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${h.toFixed(1)}" rx="${(bw * 0.3).toFixed(1)}" fill="${accent}"/>`);
    }
  }
  if (o.caption) { const cap = captionSvgParts(p, L, f, o.caption); parts.push(`<g transform="translate(${L.cap.cx - cap.w / 2},${L.cap.cy - cap.h / 2})">${cap.body}</g>`); }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}"><defs>${defs}</defs>${parts.join("")}</svg>`;
}

function captionSvgParts(p: Project, L: Layout, f: FontSet, text: string) {
  const C = L.cap, size = C.size, pad = Math.round(size * 0.45);
  const { lines } = wrapLines(text, C.w - pad * 2, (t) => f.measure(t, size, true), 3);
  const w = Math.ceil(Math.max(...lines.map((l) => f.measure(l, size, true))) + pad * 2), lh = size * 1.3, h = Math.ceil(lines.length * lh + pad * 1.2);
  const style = s(p.settings.captionStyle) || "box";
  const color = style === "accent" ? hex(p.settings.accent, "#38bdf8") : hex(p.settings.textColor, "#ffffff");
  const box = style === "box" ? `<rect width="${w}" height="${h}" rx="${Math.round(size * 0.35)}" fill="#000000" fill-opacity="0.45"/>` : "";
  const body = box + lines.map((l, i) => `<text x="${w / 2}" y="${(pad * 0.6 + size * (1.02 + i * 1.3) - size * 0.08).toFixed(1)}" font-family="${escapeXml(f.boldFamily ?? f.family)}" font-weight="700" font-size="${size}" fill="${color}" text-anchor="middle"${style === "plain" ? ` stroke="#000000" stroke-opacity="0.35" stroke-width="${(size * 0.05).toFixed(1)}" paint-order="stroke"` : ""}>${escapeXml(l)}</text>`).join("");
  return { w, h, body, lines: lines.length };
}

function peaksFor(p: Project) {
  const env = (p.meta.envelope as number[] | undefined) ?? [], { a, b } = clip(p);
  return env.slice(Math.floor(a * PER_SEC), Math.ceil(b * PER_SEC));
}

const hexFF = (c: string) => `0x${c.slice(1)}`;

async function renderVideo(p: Project, ctx: ExportCtx, outAbs: string) {
  const L = layoutFor(s(p.settings.format) || "square");
  const f = await fontsFor(ctx.assetRoot, FONT_ENV);
  const { a, b } = clip(p), D = b - a;
  if (!(D > 0.5)) throw new KitError("clip", "The clip is shorter than half a second — check clip start / end.");
  const tmp = await mkdtemp(join(tmpdir(), "audiogram-"));
  try {
    const cover = await coverHref(p, ctx, L.cover.s, tmp);
    await writeFile(join(tmp, "bg.png"), (await renderSvg(frameSvg(p, L, f, { cover }), f)).png);
    const caps = shown(p);
    const args = ["-loop", "1", "-framerate", "25", "-i", join(tmp, "bg.png"), "-ss", String(a), "-t", String(D), "-i", ctx.ws.resolve(s(p.meta.audio))];
    const accent = hex(p.settings.accent, "#38bdf8"), V = L.wave, B = L.bar;
    args.push("-f", "lavfi", "-i", `color=c=${hexFF(hex(p.settings.textColor, "#ffffff"))}:s=${B.w}x${B.h}:r=25`);
    const pos: { x: number; y: number }[] = [];
    for (const [k, c] of caps.entries()) {
      const cap = captionSvgParts(p, L, f, c.text);
      await writeFile(join(tmp, `c${k}.png`), (await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${cap.w}" height="${cap.h}" viewBox="0 0 ${cap.w} ${cap.h}">${cap.body}</svg>`, f)).png);
      args.push("-i", join(tmp, `c${k}.png`));
      pos.push({ x: Math.round(L.cap.cx - cap.w / 2), y: Math.round(L.cap.cy - cap.h / 2) });
    }
    const mode = s(p.settings.waveStyle) || "cline";
    const fade = Math.min(0.4, D / 4);
    const g: string[] = [
      `[1:a]afade=t=in:d=${fade},afade=t=out:st=${(D - fade).toFixed(2)}:d=${fade},asplit[aout][aw]`,
      `[aw]showwaves=s=${V.w}x${V.h}:mode=${mode}:rate=25:colors=${hexFF(accent)}:scale=sqrt:draw=full,format=rgba[wave]`,
      `[0:v]split[bg][bgm]`, `[bgm]crop=${B.x}:${B.h}:0:${B.y}[mask]`,
      `[bg][wave]overlay=${V.x}:${V.y}:shortest=1[v0]`,
      `[v0][2:v]overlay=x='${B.x}-${B.w}+${B.w}*t/${D.toFixed(3)}':y=${B.y}:shortest=1[v1]`,
      `[v1][mask]overlay=0:${B.y}:shortest=1[v2]`,
    ];
    let last = "v2";
    caps.forEach((c, k) => { g.push(`[${last}][${3 + k}:v]overlay=${pos[k].x}:${pos[k].y}:eof_action=repeat:enable='between(t,${c.st.toFixed(2)},${c.en.toFixed(2)})'[c${k}]`); last = `c${k}`; });
    g.push(`[${last}]format=yuv420p[vout]`);
    args.push("-filter_complex", g.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", D.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outAbs);
    await ffmpeg(args, { timeoutMs: 30 * 60_000, duration: D });
    return { D, caps: caps.length };
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

async function coverHref(p: Project, ctx: ExportCtx, size: number, tmp: string) {
  const img = s(p.meta.cover);
  if (!img) return undefined;
  const out = join(tmp, "cover.png");
  await ffmpeg(["-i", ctx.ws.resolve(img), "-vf", `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`, "-frames:v", "1", out], { timeoutMs: 60_000 });
  return `data:image/png;base64,${(await readFile(out)).toString("base64")}`;
}

function srt(p: Project) {
  return shown(p).map((c, k) => `${k + 1}\n${fmtSrt(c.st)} --> ${fmtSrt(c.en)}\n${c.text}\n`).join("\n");
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "audiogram",
    title: ["音频波形视频", "Audiogram Maker"],
    openDescription:
      "Turn an audio clip into a shareable video: animated waveform, cover image, title, progress bar and burned-in captions. Pick an audio file (mp3/m4a/wav/flac), optionally a cover image (png/jpg/webp) and captions (.srt, .lrc, or .txt with one caption per line — spread over the clip by length). Settings: format square/vertical/landscape, clipStart/clipEnd (mm:ss, cut a segment of a long episode), title, subtitle, colours (bg, accent, textColor), bgStyle solid/gradient, waveStyle cline/line/p2p/point, captionStyle box/plain/accent. Each row is one caption with start/end as mm:ss.xx in the ORIGINAL audio's time (captions outside the clip are skipped). Checks: bad or reversed times, overlaps, captions too long for 3 lines, clips over 90 s. Exports an H.264 MP4, a poster PNG and the clip's SRT (times relative to the clip). Needs ffmpeg.",
    inputs: { exts: [...AUDIO, ...IMAGE, ...CAPS], min: 1, max: 3, label: ["选择音频，可加封面图和字幕（.srt/.lrc/.txt）", "Pick the audio, plus an optional cover image and captions (.srt/.lrc/.txt)"] },
    settings: [
      { key: "format", label: ["画幅", "Format"], type: "select", default: "square", options: [{ value: "square", label: ["方形 1080×1080", "Square 1080×1080"] }, { value: "vertical", label: ["竖屏 1080×1920", "Vertical 1080×1920"] }, { value: "landscape", label: ["横屏 1920×1080", "Landscape 1920×1080"] }] },
      { key: "clipStart", label: ["片段开始（mm:ss）", "Clip start (mm:ss)"], type: "text", default: "" },
      { key: "clipEnd", label: ["片段结束（mm:ss，空=到结尾）", "Clip end (mm:ss, empty = end)"], type: "text", default: "" },
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "subtitle", label: ["副标题（节目 / 嘉宾）", "Subtitle (show / guest)"], type: "text", default: "" },
      { key: "bg", label: ["背景色", "Background"], type: "color", default: "#1e293b" },
      { key: "bgStyle", label: ["背景样式", "Background style"], type: "select", default: "gradient", options: [{ value: "solid", label: ["纯色", "Solid"] }, { value: "gradient", label: ["渐变", "Gradient"] }] },
      { key: "accent", label: ["波形 / 强调色", "Wave / accent colour"], type: "color", default: "#38bdf8" },
      { key: "textColor", label: ["文字颜色", "Text colour"], type: "color", default: "#ffffff" },
      { key: "waveStyle", label: ["波形样式", "Waveform style"], type: "select", default: "cline", options: [{ value: "cline", label: ["居中填充", "Filled (centred)"] }, { value: "line", label: ["竖线", "Lines"] }, { value: "p2p", label: ["连线", "Peak-to-peak"] }, { value: "point", label: ["点", "Points"] }] },
      { key: "captionStyle", label: ["字幕样式", "Caption style"], type: "select", default: "box", options: [{ value: "box", label: ["半透明底框", "Box"] }, { value: "plain", label: ["描边文字", "Outlined text"] }, { value: "accent", label: ["强调色文字", "Accent text"] }] },
    ],
    columns: () => [
      { key: "start", label: ["开始", "Start"] },
      { key: "end", label: ["结束", "End"] },
      { key: "text", label: ["字幕", "Caption"], wide: true },
      { key: "_inClip", label: ["视频里", "In video"], readOnly: true },
    ],
    newRow: () => ({ start: "", end: "", text: "" }),
    async load({ ws, files, settings, previous }) {
      const audio = files.find((f) => has(f, AUDIO)), cover = files.find((f) => has(f, IMAGE)), caps = files.find((f) => has(f, CAPS));
      if (!audio) throw new KitError("no_audio", "Pick an audio file (mp3/m4a/wav/flac/ogg).");
      const abs = ws.resolve(audio), info = await probe(abs);
      if (!info.hasAudio) throw new KitError("no_audio", `${audio} has no audio track.`);
      const { stdout } = await ffmpeg(["-i", abs, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { timeoutMs: 300_000 });
      const env = envelope(stdout, 8000, PER_SEC), duration = info.duration || env.length / PER_SEC;
      const meta: Record<string, unknown> = { audio, cover: cover ?? "", captions: caps ?? "", duration, envelope: env };
      if (cover) {
        const tmp = await mkdtemp(join(tmpdir(), "audiogram-"));
        try {
          await ffmpeg(["-i", ws.resolve(cover), "-vf", "scale=240:240:force_original_aspect_ratio=increase,crop=240:240", "-frames:v", "1", "-q:v", "4", join(tmp, "p.jpg")], { timeoutMs: 60_000 });
          meta.coverThumb = `data:image/jpeg;base64,${(await readFile(join(tmp, "p.jpg"))).toString("base64")}`;
        } finally { await rm(tmp, { recursive: true, force: true }); }
      }
      if (previous?.length) return { rows: previous, meta };
      let cues: Cue[] = [];
      if (caps) {
        const t = await ws.readText(caps);
        if (caps.toLowerCase().endsWith(".srt")) cues = parseSrt(t);
        else if (caps.toLowerCase().endsWith(".lrc")) cues = parseLrc(t);
        else {
          let a = parseTime(settings.clipStart), b = parseTime(settings.clipEnd);
          if (!Number.isFinite(a)) a = 0; if (!Number.isFinite(b) || b <= a) b = duration;
          cues = spreadText(t, a + 0.3, Math.min(b, duration) - 0.2);
        }
      }
      const rows: Row[] = cues.map((c) => ({ start: fmtTime(c.start), end: c.end !== undefined ? fmtTime(c.end) : "", text: c.text }));
      return { rows, meta };
    },
    async compute(p): Promise<Computed> {
      const issues: Issue[] = [];
      const { a, b, dur } = clip(p), D = b - a;
      const L = layoutFor(s(p.settings.format) || "square");
      const f = await fontsFor(assetRoot, FONT_ENV);
      const cs = parseTime(p.settings.clipStart), ce = parseTime(p.settings.clipEnd);
      if (s(p.settings.clipStart) && !Number.isFinite(cs)) issues.push({ level: "error", key: "clipStart", message: `Clip start “${s(p.settings.clipStart)}” is not a time (use mm:ss, e.g. 01:05).` });
      if (s(p.settings.clipEnd) && !Number.isFinite(ce)) issues.push({ level: "error", key: "clipEnd", message: `Clip end “${s(p.settings.clipEnd)}” is not a time (use mm:ss).` });
      if (Number.isFinite(ce) && dur && ce > dur + 0.05) issues.push({ level: "warn", key: "clipEnd", message: `Clip end ${s(p.settings.clipEnd)} is after the audio ends (${fmtTime(dur)}); the video stops at ${fmtTime(dur)}.` });
      if (Number.isFinite(cs) && Number.isFinite(ce) && ce <= cs) issues.push({ level: "error", key: "clipEnd", message: `Clip end ${s(p.settings.clipEnd)} is not after clip start ${s(p.settings.clipStart)}.` });
      if (D > 90) issues.push({ level: "warn", message: `The clip is ${Math.round(D)} s long; audiograms for social posts work best under 60–90 s. Set clipStart / clipEnd to pick a segment.` });
      if (!s(p.settings.title)) issues.push({ level: "info", key: "title", message: "No title set — the video will show only the cover and waveform." });
      let prevEnd = -1, prevStart = -1;
      const rows = p.rows.map((r, i) => {
        const st = parseTime(r.start), en = parseTime(r.end), text = s(r.text);
        let inClip = "";
        if (!text) { issues.push({ level: "info", row: i, key: "text", message: "Empty caption — skipped." }); return { ...r, _inClip: "" }; }
        if (!Number.isFinite(st)) issues.push({ level: "error", row: i, key: "start", message: `Start “${s(r.start)}” is not a time (use mm:ss.xx).` });
        else if (!Number.isFinite(en)) issues.push({ level: "error", row: i, key: "end", message: `“${text}” has no valid end time.` });
        else if (en <= st) issues.push({ level: "error", row: i, key: "end", message: `End ${s(r.end)} is not after start ${s(r.start)} (“${text}”) — this caption would never show.` });
        else {
          if (st < prevStart) issues.push({ level: "warn", row: i, key: "start", message: `Starts at ${s(r.start)}, before the previous caption — check the order.` });
          else if (st < prevEnd - 0.05) issues.push({ level: "warn", row: i, key: "start", message: `Overlaps the previous caption (which ends at ${fmtTime(prevEnd)}); two captions would show at once.` });
          prevEnd = en; prevStart = st;
          inClip = en > a && st < b ? (st < a || en > b ? "partly" : "yes") : "no";
          const { lines, overflow } = wrapLines(text, L.cap.w - L.cap.size * 0.9, (t) => f.measure(t, L.cap.size, true), 3);
          if (overflow) issues.push({ level: "warn", row: i, key: "text", message: `“${text.slice(0, 24)}…” needs more than 3 lines at this size and will be cut — split it into two captions.` });
          else if (lines.length === 3) issues.push({ level: "info", row: i, key: "text", message: "Caption wraps to 3 lines; shorter captions read better." });
        }
        return { ...r, _inClip: inClip === "yes" ? "✓" : inClip === "partly" ? "partly" : inClip === "no" ? "—" : "" };
      });
      const sh = shown(p);
      const first = sh[0]?.text;
      const svg = frameSvg(p, L, f, { cover: s(p.meta.coverThumb) || undefined, peaks: peaksFor(p), caption: first, progress: 0.35 });
      const scale = L.W > L.H ? 640 : L.H > L.W ? 300 : 480;
      return {
        rows,
        issues,
        summary: `${fmtTime(D)} clip (${fmtTime(a)}–${fmtTime(b)} of ${fmtTime(dur)}), ${L.W}×${L.H}, ${sh.length} of ${p.rows.filter((r) => s(r.text)).length} caption(s) in the clip${p.meta.cover ? ", with cover" : ", no cover (title initial shown)"}.`,
        stats: { duration: Math.round(D * 10) / 10, captions: sh.length, width: L.W, height: L.H },
        preview: `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div style="width:${scale}px;max-width:100%;box-shadow:0 4px 18px #0003;border-radius:8px;overflow:hidden">${svg.replace("<svg ", '<svg style="display:block;width:100%;height:auto" ')}</div><div style="font-size:13px;color:#475569;max-width:280px">${esc(`Poster frame: the real video animates the waveform and the progress bar, and shows each caption at its time.`)}</div></div>`,
      };
    },
    exports: [
      { id: "mp4", label: ["MP4 视频", "MP4 video"], description: "audiogram.mp4 — H.264 + AAC", async run(ctx: ExportCtx) { const name = `${stem(ctx.project)}.mp4`; await mkdir(ctx.ws.resolve(ctx.outDir), { recursive: true }); const r = await renderVideo(ctx.project, ctx, join(ctx.ws.resolve(ctx.outDir), name)); return { files: [`${ctx.outDir}/${name}`], note: `${r.D.toFixed(1)} s video with ${r.caps} caption(s).` }; } },
      { id: "poster", label: ["封面图 PNG", "Poster PNG"], description: "poster.png — still frame for the post thumbnail", async run(ctx: ExportCtx) {
        const p = ctx.project, L = layoutFor(s(p.settings.format) || "square"), f = await fontsFor(ctx.assetRoot, FONT_ENV);
        const tmp = await mkdtemp(join(tmpdir(), "audiogram-"));
        try { const cover = await coverHref(p, ctx, L.cover.s, tmp); return [await ctx.write(`${stem(p)}-poster.png`, (await renderSvg(frameSvg(p, L, f, { cover, peaks: peaksFor(p), caption: shown(p)[0]?.text, progress: 0.35 }), f)).png)]; }
        finally { await rm(tmp, { recursive: true, force: true }); }
      } },
      { id: "srt", label: ["片段字幕 SRT", "Clip SRT"], description: "captions re-timed to the clip", async run({ project, write }: ExportCtx) { return [await write(`${stem(project)}.srt`, srt(project))]; } },
    ],
    describeRow: (r, i) => `#${i} [${s(r.start)}–${s(r.end)}] ${s(r.text)}`,
  };
}

const stem = (p: Project) => (s(p.settings.title) || s(p.meta.audio).split("/").pop()!.replace(/\.[^.]+$/, "") || "audiogram").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
