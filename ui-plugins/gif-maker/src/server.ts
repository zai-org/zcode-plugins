import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { ffmpeg, frameAt, probe } from "./kit/ffmpeg.ts";
import { args, filters, fmtSec, parseSec, shrink, type Format, type Job } from "./gif.ts";

export const NAME = "gif-maker";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif"];
const num = (v: unknown, d: number) => { const n = Number(String(v ?? "").trim()); return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : d; };
const thumbs = new Map<string, string>();

function job(r: Row, st: Record<string, unknown>, issues?: Issue[], i = 0): Job {
  const dur = Number(r._dur) || 0;
  const start = parseSec(r.start) ?? 0;
  let end = parseSec(r.end) ?? dur;
  if (issues) {
    if (s(r.start) && parseSec(r.start) === null) issues.push({ level: "error", row: i, key: "start", message: `Row ${i}: start “${s(r.start)}” — use seconds (2.5) or m:ss (0:02.5) / 开始时间格式不对` });
    if (s(r.end) && parseSec(r.end) === null) issues.push({ level: "error", row: i, key: "end", message: `Row ${i}: end “${s(r.end)}” — use seconds or m:ss / 结束时间格式不对` });
    if (end > dur + 0.05) issues.push({ level: "warn", row: i, key: "end", message: `Row ${i}: end ${fmtSec(end)} is after the clip ends (${fmtSec(dur)}) — using the end / 超出视频长度` });
    if (end <= start) issues.push({ level: "error", row: i, key: "end", message: `Row ${i}: end must be after start / 结束要晚于开始` });
  }
  end = Math.min(end, dur || end);
  const format = (s(r.format) || s(st.format) || "gif") as Format;
  return {
    start, end, format,
    fps: Math.min(50, Math.max(1, num(r.fps, num(st.fps, 12)))),
    width: Math.max(16, num(r.width, num(st.width, 640))),
    speed: Math.min(8, Math.max(0.25, num(r.speed, 1))),
    colors: Math.min(256, Math.max(2, num(st.colors, 128))),
    dither: s(st.dither) || "bayer",
    quality: Math.min(100, Math.max(1, num(st.quality, 70))),
    loop: st.loop !== false,
    reverse: r.reverse === true,
  };
}
const outName = (r: Row, j: Job) => `${s(r.name) || s(r.file).split("/").pop()!.replace(/\.[^.]+$/, "")}.${j.format}`;
/** 粗略估算：GIF 每像素每帧约 0.35 字节（简单录屏更小，实拍更大）；WebP 约为其 1/3 */
function estimate(j: Job, srcW: number, srcH: number) {
  const { width } = filters(j, srcW);
  const h = Math.round((srcH / srcW) * width);
  const frames = Math.ceil(((j.end - j.start) / j.speed) * j.fps);
  const bpp = j.format === "gif" ? 0.35 * (j.colors / 256) ** 0.3 : 0.12 * (j.quality / 70);
  return { frames, w: width, h: h % 2 ? h + 1 : h, bytes: frames * width * h * bpp };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "gif",
  title: ["视频转动图", "GIF Maker"],
  openDescription:
    "Turn screen recordings or video clips (MP4/MOV/WebM/MKV/AVI, or an existing GIF) into small animated GIF or WebP files with the ffmpeg already installed on this computer. One row per clip: start and end (seconds or m:ss; blank end = to the end), fps, width, speed (0.25–8), format (gif/webp), reverse and output name. Blank fps/width/format use the settings. Settings: format, fps (12), width (640), colors (2–256, GIF), dither (bayer/sierra/none), quality (WebP 1–100), loop, maxMB (if the result is bigger, it is re-encoded with lower fps, then smaller width, up to 4 tries; 0 = off). The panel shows start/middle/end frames and a rough size estimate. Exports <name>.gif/.webp and gif-report.csv with the real sizes. Needs ffmpeg (free) installed.",
  inputs: { exts: EXTS, min: 1, max: 20, folders: true, label: ["选择视频（MP4 / MOV / WebM）", "Pick videos (MP4 / MOV / WebM)"] },
  settings: [
    { key: "format", label: ["格式", "Format"], type: "select", default: "gif", options: [{ value: "gif", label: ["GIF（哪里都能放）", "GIF (plays everywhere)"] }, { value: "webp", label: ["WebP 动图（更小）", "Animated WebP (smaller)"] }] },
    { key: "fps", label: ["帧率", "Frames per second"], type: "number", default: 12, min: 1, max: 50 },
    { key: "width", label: ["宽度（像素）", "Width (px)"], type: "number", default: 640, min: 16, max: 3840 },
    { key: "colors", label: ["GIF 颜色数", "GIF colours"], type: "number", default: 128, min: 2, max: 256 },
    { key: "dither", label: ["GIF 抖动", "GIF dithering"], type: "select", default: "bayer", options: [{ value: "bayer", label: ["Bayer（体积小，适合录屏）", "Bayer (small, screen recordings)"] }, { value: "sierra", label: ["Sierra（细腻，适合实拍）", "Sierra (smooth, camera footage)"] }, { value: "none", label: ["不抖动（最小）", "None (smallest)"] }] },
    { key: "quality", label: ["WebP 质量", "WebP quality"], type: "number", default: 70, min: 1, max: 100 },
    { key: "loop", label: ["循环播放", "Loop"], type: "bool", default: true },
    { key: "maxMB", label: ["最大体积（MB，0 = 不限）", "Max size (MB, 0 = no limit)"], type: "number", default: 0, min: 0, max: 500 },
  ],
  columns: () => [
    { key: "file", label: ["视频", "Video"], readOnly: true },
    { key: "info", label: ["原视频", "Source"], readOnly: true },
    { key: "start", label: ["开始", "Start"] },
    { key: "end", label: ["结束", "End"] },
    { key: "fps", label: ["帧率", "FPS"], type: "number" },
    { key: "width", label: ["宽度", "Width"], type: "number" },
    { key: "speed", label: ["倍速", "Speed"], type: "number" },
    { key: "format", label: ["格式", "Format"], type: "select", options: ["", "gif", "webp"] },
    { key: "reverse", label: ["倒放", "Reverse"], type: "bool" },
    { key: "name", label: ["文件名", "Name"] },
    { key: "estimate", label: ["预计", "Estimate"], readOnly: true },
  ] as Column[],
  async load({ ws, files }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 200 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", `No ${EXTS.join(" ")} files found.`);
    const rows: Row[] = [];
    for (const f of uniq) {
      const info = await probe(ws.resolve(f));
      if (!info.hasVideo) throw new KitError("no_video", `${f} has no video stream.`);
      rows.push({ file: f, info: `${info.width}×${info.height} · ${fmtSec(info.duration)} · ${Math.round(info.fps ?? 0)} fps`, start: "0", end: info.duration > 10 ? "10" : "", fps: "", width: "", speed: 1, format: "", reverse: false, name: "", _dur: info.duration, _w: info.width, _h: info.height });
    }
    return { rows };
  },
  async compute(p, ctx): Promise<Computed> {
    const issues: Issue[] = [];
    const maxMB = num(p.settings.maxMB, 0);
    const names = new Map<string, number>();
    const cards: string[] = [];
    let total = 0;
    const rows = await Promise.all(p.rows.map(async (r, i) => {
      const j = job(r, p.settings, issues, i);
      const e = estimate(j, Number(r._w) || 640, Number(r._h) || 360);
      total += e.bytes;
      const n = outName(r, j);
      if (names.has(n)) issues.push({ level: "error", row: i, key: "name", message: `Rows ${names.get(n)} and ${i} would both write ${n} — give one a name / 文件名重复` });
      names.set(n, i);
      if (e.frames > 600) issues.push({ level: "warn", row: i, key: "end", message: `Row ${i}: ${e.frames} frames — a GIF this long will be large; trim it or lower fps / 帧数太多` });
      if (j.width > 1280) issues.push({ level: "info", row: i, key: "width", message: `Row ${i}: ${j.width}px wide — GIFs over 1280px get big quickly / 宽度较大` });
      if (maxMB && e.bytes > maxMB * 1048576 * 3) issues.push({ level: "info", row: i, message: `Row ${i}: estimated ${(e.bytes / 1048576).toFixed(1)} MB vs ${maxMB} MB max — expect a lower fps or width / 预计会自动降帧率或尺寸` });
      if (i < 6 && j.end > j.start) {
        const frames: string[] = [];
        for (const t of [j.start, (j.start + j.end) / 2, Math.max(j.start, j.end - 0.05)]) {
          const k = `${s(r.file)}@${t.toFixed(2)}`;
          if (!thumbs.has(k)) { try { thumbs.set(k, `data:image/jpeg;base64,${(await frameAt(ctx.ws.resolve(s(r.file)), t, 240)).toString("base64")}`); } catch { thumbs.set(k, ""); } }
          frames.push(thumbs.get(k)!);
        }
        cards[i] = `<div style="margin-bottom:10px"><div style="font-size:12px;margin-bottom:4px"><b>${esc(n)}</b> <span class="muted">${fmtSec(j.start)} → ${fmtSec(j.end)} · ${e.w}×${e.h} · ${e.frames} frames · ≈ ${(e.bytes / 1048576).toFixed(1)} MB</span></div><div style="display:flex;gap:4px">${frames.map((f) => (f ? `<img src="${f}" style="width:32%;border-radius:3px">` : "")).join("")}</div></div>`;
      }
      return { ...r, estimate: `${e.w}×${e.h} · ${e.frames}f · ≈${(e.bytes / 1048576).toFixed(1)}MB` };
    }));
    return {
      rows,
      issues,
      summary: `${p.rows.length} clip(s) → ${s(p.settings.format) === "webp" ? "WebP" : "GIF"} at ${num(p.settings.fps, 12)} fps, ${num(p.settings.width, 640)} px; about ${(total / 1048576).toFixed(1)} MB in total${maxMB ? `, max ${maxMB} MB each` : ""}. 共 ${p.rows.length} 段。`,
      stats: { clips: p.rows.length, estimateMB: Math.round((total / 1048576) * 10) / 10 },
      preview: cards.filter(Boolean).join("") + (p.rows.length > 6 ? `<p class="muted">… ${p.rows.length - 6} more</p>` : ""),
    };
  },
  exports: [
    {
      id: "files", label: ["生成动图", "Make animations"], description: "<name>.gif / <name>.webp for every row, re-encoded smaller when over maxMB",
      async run({ project, write, ws, outDir }: ExportCtx) {
        const issues: Issue[] = [];
        const jobs = project.rows.map((r, i) => job(r, project.settings, issues, i));
        const errs = issues.filter((x) => x.level === "error");
        if (errs.length) throw new KitError("bad_rows", errs.map((x) => x.message).join("\n"));
        const maxMB = num(project.settings.maxMB, 0);
        const files: string[] = [], report: unknown[][] = [], notes: string[] = [];
        for (const [i, r] of project.rows.entries()) {
          let j = jobs[i];
          const rel = `${outDir}/${outName(r, j)}`;
          const abs = ws.resolve(rel);
          await mkdir(dirname(abs), { recursive: true });
          let size = 0, tries = 0;
          for (;;) {
            tries++;
            await ffmpeg(args(ws.resolve(s(r.file)), abs, j, Number(r._w) || 640), { timeoutMs: 15 * 60_000 });
            size = (await stat(abs)).size;
            if (!maxMB || size <= maxMB * 1048576 || tries >= 5) break;
            j = shrink(j, size / (maxMB * 1048576));
          }
          if (maxMB && size > maxMB * 1048576) notes.push(`${outName(r, j)} is still ${(size / 1048576).toFixed(1)} MB after ${tries} tries — trim it or lower the width`);
          else if (tries > 1) notes.push(`${outName(r, j)}: re-encoded at ${j.fps} fps, ${j.width}px to fit ${maxMB} MB`);
          files.push(rel);
          report.push([s(r.file), outName(r, j), fmtSec(j.start), fmtSec(j.end), j.speed, j.fps, filters(j, Number(r._w) || 640).width, j.format === "gif" ? j.colors : j.quality, Math.round(size / 1024), tries]);
        }
        files.push(await write("gif-report.csv", toCsv(["video", "output", "start", "end", "speed", "fps", "width", "colors_or_quality", "size_kb", "tries"], report)));
        return { files, note: notes.join("\n") || undefined };
      },
    },
  ],
  /** 新行 = 复制最后一行的视频（同一视频再做一段） */
  newRow: (p) => ({ ...(p.rows[p.rows.length - 1] ?? {}), start: "0", end: "", name: "", reverse: false, speed: 1 }),
  describeRow: (r, i) => `#${i} ${s(r.file)} [${s(r.info)}] ${s(r.start) || "0"}→${s(r.end) || "end"}${s(r.fps) ? ` ${s(r.fps)}fps` : ""}${s(r.width) ? ` ${s(r.width)}px` : ""}${Number(r.speed) !== 1 ? ` ×${s(r.speed)}` : ""}${s(r.format) ? ` ${s(r.format)}` : ""}${r.reverse ? " reverse" : ""}${s(r.name) ? ` → ${s(r.name)}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
