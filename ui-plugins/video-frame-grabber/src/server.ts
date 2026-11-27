import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { escapeXml, renderSvg } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "video-frame-grabber";
export const VERSION = "0.1.0";
const VIDEO = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"];
const MAX = 200;
const FONT_ENV = "FRAME_GRABBER_FONT";

export function parseTime(v: unknown): number {
  const t = String(v ?? "").trim().replace(",", ".");
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return NaN;
  return [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number).reduce((a, x) => a * 60 + x, 0);
}
export const fmtTime = (t: number) => {
  const c = Math.round(Math.max(0, t) * 100), h = Math.floor(c / 360000), m = Math.floor(c / 6000) % 60, sec = ((c % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${sec}`;
};

/** 按间隔 / 数量取时间点。 */
export function pickTimes(mode: string, dur: number, o: { interval: number; count: number; skipStart: number; skipEnd: number }) {
  const a = Math.min(dur, Math.max(0, o.skipStart)), b = Math.max(a, dur - Math.max(0, o.skipEnd) - 0.05);
  const out: number[] = [];
  if (mode === "count") { const n = Math.max(1, Math.min(MAX, Math.round(o.count))); for (let i = 0; i < n; i++) out.push(n === 1 ? (a + b) / 2 : a + ((b - a) * (i + 0.5)) / n); }
  else { const step = Math.max(0.2, o.interval); for (let t = a; t <= b + 1e-6 && out.length < MAX; t += step) out.push(t); }
  return out.map((t) => Math.round(t * 100) / 100);
}

/** ffmpeg 场景检测：返回 [时间, 分数]。 */
export function parseScenes(text: string) {
  const out: { t: number; score: number }[] = [];
  let t = NaN;
  for (const line of text.split("\n")) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m) t = Number(m[1]);
    const sc = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (sc && Number.isFinite(t)) { out.push({ t: Math.round(t * 100) / 100, score: Number(sc[1]) }); t = NaN; }
  }
  return out;
}

async function grayAt(abs: string, t: number) {
  const { stdout } = await ffmpeg(["-ss", String(t), "-i", abs, "-frames:v", "1", "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "pipe:1"], { timeoutMs: 60_000 });
  return stdout;
}
const meanOf = (b: Buffer) => b.reduce((a, v) => a + v, 0) / (b.length || 1);
const diffOf = (a: Buffer, b: Buffer) => { let d = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]); return n ? d / n : 255; };

/** 场景切换后找画面稳定下来的时间（跳过淡入淡出和转场），并返回该帧灰度图。 */
export async function settle(abs: string, t: number, limit: number) {
  const ts = [0.4, 0.9, 1.5, 2.2, 3].map((x) => Math.round((t + x) * 100) / 100).filter((x) => x < limit);
  if (!ts.length) return { t: Math.round(Math.min(t + 0.2, limit) * 100) / 100, g: undefined as Buffer | undefined };
  const gs: Buffer[] = [];
  for (const x of ts) gs.push(await grayAt(abs, x));
  for (let i = 0; i + 1 < gs.length; i++) if (diffOf(gs[i], gs[i + 1]) < 2.5 && meanOf(gs[i]) >= 18) return { t: ts[i], g: gs[i] };
  return { t: ts[0], g: gs[0] };
}

async function grabGray(abs: string, t: number) {
  const stdout = await grayAt(abs, t);
  if (!stdout.length) return { luma: NaN, flat: NaN };
  let sum = 0; for (const v of stdout) sum += v;
  const mean = sum / stdout.length;
  let vs = 0; for (const v of stdout) vs += (v - mean) ** 2;
  return { luma: Math.round(mean), flat: Math.round(Math.sqrt(vs / stdout.length)) };
}

async function thumb(abs: string, t: number, w = 240) {
  const { stdout } = await ffmpeg(["-ss", String(t), "-i", abs, "-frames:v", "1", "-vf", `scale=${w}:-2`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
  return stdout.length ? `data:image/jpeg;base64,${stdout.toString("base64")}` : "";
}

/** 能导出的帧：勾选、时间有效且不超过视频长度。 */
function usable(p: Project) {
  const d = (p.meta.durations as Record<string, number>) ?? {};
  return p.rows.filter((r) => { const t = parseTime(r.time); return yes(r.include) && Number.isFinite(t) && d[s(r.video)] !== undefined && t <= d[s(r.video)]; });
}

const base = (f: string) => f.split("/").pop()!.replace(/\.[^.]+$/, "");

function frameName(r: Row, ext: string, idx: number) {
  return `${base(s(r.video))}-${String(idx + 1).padStart(3, "0")}-${fmtTime(parseTime(r.time)).replace(/:/g, "-")}${s(r.label) ? "-" + s(r.label).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) : ""}.${ext}`;
}

function sheetSvg(p: Project, thumbs: Record<string, string>, family: string) {
  const rows = usable(p);
  const cols = Math.max(1, Math.min(8, Number(p.settings.cols) || 4)), tw = 320;
  const ar = Number(p.meta.aspect) || 16 / 9, th = Math.round(tw / ar), gap = 16, lab = s(p.settings.labels) === "off" ? 0 : 44;
  const W = cols * tw + (cols + 1) * gap, nRows = Math.max(1, Math.ceil(rows.length / cols)), top = 76, H = top + nRows * (th + lab + gap) + gap;
  const fam = escapeXml(family), title = s(p.settings.title) || [...new Set(rows.map((r) => base(s(r.video))))].join(", ");
  const cells = rows.map((r, k) => {
    const x = gap + (k % cols) * (tw + gap), y = top + Math.floor(k / cols) * (th + lab + gap), href = thumbs[`${s(r.video)}@${parseTime(r.time)}`];
    const stamp = fmtTime(parseTime(r.time));
    return `<rect x="${x}" y="${y}" width="${tw}" height="${th}" fill="#0f172a"/>${href ? `<image x="${x}" y="${y}" width="${tw}" height="${th}" href="${href}" preserveAspectRatio="xMidYMid meet"/>` : ""}<rect x="${x + tw - 92}" y="${y + th - 28}" width="86" height="22" rx="4" fill="#000" fill-opacity="0.65"/><text x="${x + tw - 49}" y="${y + th - 12}" font-family="${fam}" font-size="14" fill="#fff" text-anchor="middle">${stamp}</text>${lab ? `<text x="${x}" y="${y + th + 20}" font-family="${fam}" font-size="15" font-weight="700" fill="#0f172a">${escapeXml(`${k + 1}. ${s(r.label) || stamp}`.slice(0, 34))}</text><text x="${x}" y="${y + th + 38}" font-family="${fam}" font-size="12" fill="#64748b">${escapeXml(base(s(r.video)).slice(0, 40))}</text>` : ""}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f8fafc"/><text x="${gap}" y="46" font-family="${fam}" font-size="26" font-weight="700" fill="#0f172a">${escapeXml(title)}</text><text x="${W - gap}" y="46" font-family="${fam}" font-size="16" fill="#475569" text-anchor="end">${esc(`${rows.length} frames`)}</text>${cells}</svg>`;
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "frames",
    title: ["视频截帧", "Video Frame Grabber"],
    openDescription:
      "Grab still frames from videos and make a contact sheet. Pick one or more videos (mp4/mov/mkv/webm/avi). settings.mode: scene (a frame at every cut / slide change, threshold sceneThreshold 0.01–0.9, default 0.1; slides and screen recordings need ≈0.03, minGap seconds between frames), interval (every N seconds) or count (N frames spread evenly); skipStart/skipEnd trim the ends. Each row is a frame: include, video, time (mm:ss.xx — edit to move it, or add rows for exact times), label (used in file names and on the sheet), plus read-only brightness/scene score. Checks: times past the end, near-duplicate times, black or blank frames (fades), more than 200 frames. Exports a frames/ folder (jpg or png, optional max width), contact-sheet.png and frames.csv. Needs ffmpeg.",
    inputs: { exts: VIDEO, min: 1, max: 20, label: ["选择视频", "Pick videos"] },
    settings: [
      { key: "mode", label: ["截取方式", "Mode"], type: "select", default: "scene", reload: true, options: [{ value: "scene", label: ["按场景变化（换镜头 / 换幻灯片）", "Scene changes"] }, { value: "interval", label: ["按固定间隔", "Every N seconds"] }, { value: "count", label: ["平均取 N 张", "N frames evenly"] }] },
      { key: "interval", label: ["间隔（秒）", "Interval (s)"], type: "number", default: 10, min: 0.2, max: 3600, reload: true },
      { key: "count", label: ["张数", "Count"], type: "number", default: 12, min: 1, max: MAX, reload: true },
      { key: "sceneThreshold", label: ["场景阈值（0.01–0.9，小=更灵敏；幻灯片用 0.03）", "Scene threshold (0.01–0.9; slides ≈ 0.03)"], type: "number", default: 0.1, min: 0.01, max: 0.95, reload: true },
      { key: "minGap", label: ["两帧最小间隔（秒）", "Min gap between frames (s)"], type: "number", default: 2, min: 0, max: 600, reload: true },
      { key: "skipStart", label: ["跳过开头（秒）", "Skip start (s)"], type: "number", default: 0, min: 0, reload: true },
      { key: "skipEnd", label: ["跳过结尾（秒）", "Skip end (s)"], type: "number", default: 0, min: 0, reload: true },
      { key: "format", label: ["图片格式", "Image format"], type: "select", default: "jpg", options: [{ value: "jpg", label: ["JPG", "JPG"] }, { value: "png", label: ["PNG（无损）", "PNG (lossless)"] }] },
      { key: "width", label: ["最大宽度（像素，0=原尺寸）", "Max width (px, 0 = original)"], type: "number", default: 0, min: 0, max: 7680 },
      { key: "title", label: ["小样图标题", "Contact sheet title"], type: "text", default: "" },
      { key: "cols", label: ["小样图每行几张", "Sheet columns"], type: "number", default: 4, min: 1, max: 8 },
      { key: "labels", label: ["小样图文字", "Sheet labels"], type: "select", default: "on", options: [{ value: "on", label: ["显示", "Show"] }, { value: "off", label: ["不显示", "Hide"] }] },
    ],
    columns: () => [
      { key: "include", label: ["导出", "Export"], type: "bool" },
      { key: "video", label: ["视频", "Video"], readOnly: true },
      { key: "time", label: ["时间", "Time"] },
      { key: "label", label: ["标签", "Label"], wide: true },
      { key: "_luma", label: ["亮度", "Brightness"], readOnly: true },
      { key: "_score", label: ["场景分", "Scene score"], readOnly: true },
    ] as Column[],
    newRow: (p) => ({ include: true, video: s(p.inputs[0]), time: "", label: "" }),
    async load({ ws, files, settings, previous }) {
      const meta: Record<string, unknown> = { durations: {} as Record<string, number> };
      const rows: Row[] = [];
      const mode = s(settings.mode) || "scene";
      for (const f of files) {
        const abs = ws.resolve(f), info = await probe(abs);
        if (!info.hasVideo) throw new KitError("no_video", `${f} has no video track.`);
        (meta.durations as Record<string, number>)[f] = info.duration;
        if (info.width && info.height) meta.aspect ??= info.width / info.height;
        const o = { interval: Number(settings.interval ?? 10), count: Number(settings.count ?? 12), skipStart: Number(settings.skipStart ?? 0), skipEnd: Number(settings.skipEnd ?? 0) };
        let pts: { t: number; score?: number }[];
        if (mode === "scene") {
          const th = Number(settings.sceneThreshold ?? 0.1), gap = Number(settings.minGap ?? 2);
          const { stdout } = await ffmpeg(["-i", abs, "-an", "-vf", `scale=320:-2,select='gt(scene,${th})',metadata=print:file=-`, "-f", "null", "-"], { timeoutMs: 30 * 60_000, duration: info.duration });
          const a = o.skipStart, b = info.duration - o.skipEnd;
          const first = Math.min(Math.max(a, 0.5), Math.max(0, info.duration - 0.1));
          pts = [{ t: Math.round(first * 100) / 100 }];
          let prevG: Buffer | undefined = await grayAt(abs, first);
          const scenes = parseScenes(stdout.toString()).filter((x) => x.t >= a && x.t <= b);
          for (const [j, sc] of scenes.entries()) {
            if (sc.t - pts[pts.length - 1].t < gap) continue;
            const limit = Math.min(b, scenes[j + 1]?.t ?? b, info.duration - 0.05);
            const st = await settle(abs, sc.t, limit);
            // 淡出又淡入回到同一画面时不重复截取。
            if (st.g && prevG && diffOf(st.g, prevG) < 3) continue;
            if (st.t - pts[pts.length - 1].t < gap) continue;
            pts.push({ t: st.t, score: sc.score }); prevG = st.g ?? prevG;
            if (pts.length >= MAX) break;
          }
        } else pts = pickTimes(mode, info.duration, o).map((t) => ({ t }));
        for (const x of pts) rows.push({ include: true, video: f, time: fmtTime(x.t), label: "", _score: x.score !== undefined ? x.score.toFixed(2) : "" });
      }
      // 保留用户改过的标签（同一视频、同一时间）。
      const prev = new Map((previous ?? []).map((r) => [`${s(r.video)}@${s(r.time)}`, r]));
      for (const r of rows) { const o = prev.get(`${s(r.video)}@${s(r.time)}`); if (o) { r.label = o.label; r.include = o.include; } }
      await measure(ws, rows, meta);
      return { rows, meta };
    },
    async compute(p, ctx): Promise<Computed> {
      const issues: Issue[] = [];
      const durs = (p.meta.durations as Record<string, number>) ?? {};
      // 新增或改过时间的行补测亮度和缩略图。
      const thumbs = (p.meta.thumbs as Record<string, string>) ?? {};
      const need = p.rows.filter((r) => Number.isFinite(parseTime(r.time)) && !thumbs[`${s(r.video)}@${parseTime(r.time)}`] && parseTime(r.time) <= (durs[s(r.video)] ?? 0));
      if (need.length && need.length <= 40) await measure(ctx.ws, need, p.meta);
      const seen = new Map<string, number>();
      p.rows.forEach((r, i) => {
        const t = parseTime(r.time), d = durs[s(r.video)];
        if (!s(r.video) || d === undefined) { issues.push({ level: "error", row: i, key: "video", message: `Video “${s(r.video)}” is not one of the opened files.` }); return; }
        if (!Number.isFinite(t)) { issues.push({ level: "error", row: i, key: "time", message: `Time “${s(r.time)}” is not a time (use mm:ss or mm:ss.xx).` }); return; }
        if (t > d) { issues.push({ level: "error", row: i, key: "time", message: `${fmtTime(t)} is after the end of ${base(s(r.video))} (${fmtTime(d)}).` }); return; }
        if (!yes(r.include)) return;
        const k = `${s(r.video)}@${Math.round(t * 2)}`;
        if (seen.has(k)) issues.push({ level: "warn", row: i, key: "time", message: `Almost the same moment as row #${seen.get(k)} (${s(p.rows[seen.get(k)!].time)}) — you will get two identical frames.` });
        else seen.set(k, i);
        const m = (p.meta.measure as Record<string, { luma: number; flat: number }>)?.[`${s(r.video)}@${t}`];
        if (m && m.luma < 18) issues.push({ level: "warn", row: i, key: "time", message: `The frame at ${fmtTime(t)} is almost black (brightness ${m.luma}) — probably a fade; move it a little or untick it.` });
        else if (m && m.flat < 4) issues.push({ level: "info", row: i, key: "time", message: `The frame at ${fmtTime(t)} is nearly a single colour (blank screen or title card).` });
      });
      if ((s(p.settings.mode) || "scene") === "scene") for (const [v, d] of Object.entries(durs)) {
        const n = p.rows.filter((r) => s(r.video) === v).length;
        if (n <= Math.max(3, d / 60)) issues.push({ level: "info", key: "sceneThreshold", message: `Only ${n} scene change(s) found in ${base(v)} (${fmtTime(d)}). For slides or screen recordings, lower sceneThreshold to 0.03–0.05, or use interval mode.` });
      }
      if (p.rows.length >= MAX) issues.push({ level: "warn", message: `Capped at ${MAX} frames — raise the interval or the scene threshold.` });
      const inc = p.rows.filter((r) => yes(r.include));
      const meas = (p.meta.measure as Record<string, { luma: number }>) ?? {};
      const f = await fontsFor(ctx.assetRoot, FONT_ENV);
      return {
        rows: p.rows.map((r) => ({ ...r, _luma: meas[`${s(r.video)}@${parseTime(r.time)}`]?.luma ?? "" })),
        issues,
        summary: `${inc.length} of ${p.rows.length} frame(s) from ${Object.keys(durs).length} video(s) (${Object.entries(durs).map(([k, d]) => `${base(k)} ${fmtTime(d)}`).join(", ")}), mode ${s(p.settings.mode) || "scene"}.`,
        stats: { frames: inc.length, videos: Object.keys(durs).length },
        preview: sheetSvg(p, thumbs, f.family).replace("<svg ", '<svg style="max-width:100%;height:auto" '),
      };
    },
    exports: [
      { id: "frames", label: ["帧图片", "Frame images"], description: "frames/<video>-NNN-<time>.jpg", async run({ project, ws, outDir }: ExportCtx) {
        const ext = s(project.settings.format) === "png" ? "png" : "jpg", w = Number(project.settings.width) || 0;
        const dir = join(ws.resolve(outDir), "frames"); await mkdir(dir, { recursive: true });
        const out: string[] = [];
        for (const [k, r] of usable(project).entries()) {
          const name = frameName(r, ext, k);
          await ffmpeg(["-ss", String(parseTime(r.time)), "-i", ws.resolve(s(r.video)), "-frames:v", "1", ...(w ? ["-vf", `scale='min(${w},iw)':-2`] : []), ...(ext === "jpg" ? ["-q:v", "2"] : []), join(dir, name)], { timeoutMs: 120_000 });
          out.push(`${outDir}/frames/${name}`);
        }
        return out;
      } },
      { id: "sheet", label: ["小样图 PNG", "Contact sheet PNG"], description: "contact-sheet.png", async run(ctx: ExportCtx) {
        const p = ctx.project, f = await fontsFor(ctx.assetRoot, FONT_ENV), big: Record<string, string> = {};
        for (const r of usable(p)) big[`${s(r.video)}@${parseTime(r.time)}`] = await thumb(ctx.ws.resolve(s(r.video)), parseTime(r.time), 640);
        return [await ctx.write("contact-sheet.png", (await renderSvg(sheetSvg(p, big, f.family), f)).png)];
      } },
      { id: "csv", label: ["帧列表 CSV", "Frame list CSV"], description: "frames.csv", async run({ project, write }: ExportCtx) {
        const ext = s(project.settings.format) === "png" ? "png" : "jpg", q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const lines = ["number,file,video,time,seconds,label", ...usable(project).map((r, k) => [String(k + 1), `frames/${frameName(r, ext, k)}`, s(r.video), fmtTime(parseTime(r.time)), parseTime(r.time).toFixed(2), s(r.label)].map(q).join(","))];
        return [await write("frames.csv", "\ufeff" + lines.join("\n") + "\n")];
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${base(s(r.video))} @ ${s(r.time)}${s(r.label) ? ` “${s(r.label)}”` : ""}${s(r._score) ? ` scene=${s(r._score)}` : ""}`,
  };
}

async function measure(ws: { resolve: (p: string) => string }, rows: Row[], meta: Record<string, unknown>) {
  const m = ((meta.measure as Record<string, { luma: number; flat: number }>) ??= {});
  const th = ((meta.thumbs as Record<string, string>) ??= {});
  for (const r of rows.slice(0, MAX)) {
    const t = parseTime(r.time), key = `${s(r.video)}@${t}`;
    if (!Number.isFinite(t) || th[key]) continue;
    const abs = ws.resolve(s(r.video));
    try { m[key] = await grabGray(abs, t); th[key] = await thumb(abs, t); } catch { /* 读不出就跳过 */ }
  }
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
