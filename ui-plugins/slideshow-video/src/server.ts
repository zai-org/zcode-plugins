import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { escapeXml, renderSvg, wrapLines, type FontSet } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";
import { readExif } from "./exif.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "slideshow-video";
export const VERSION = "0.1.0";
const IMG = [".jpg", ".jpeg", ".png", ".webp", ".bmp"], AUDIO = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"];
const FONT_ENV = "SLIDESHOW_FONT", FPS = 30;
const MOTIONS = ["auto", "zoom-in", "zoom-out", "pan-left", "pan-right", "none"];
const TRANS = ["fade", "dissolve", "slideleft", "wipeleft", "circleopen", "smoothleft", "none"];
const has = (f: string, e: string[]) => e.some((x) => f.toLowerCase().endsWith(x));

export function sizeFor(format: string) {
  return format === "square" ? { W: 1080, H: 1080 } : format === "vertical" ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 };
}

/** 计划：每张照片的时长、开始时间、动效；总时长。 */
export function plan(p: Project) {
  const T = s(p.settings.transition) === "none" ? 0 : Math.max(0, Number(p.settings.transitionSec ?? 0.8));
  const base = Math.max(0.5, Number(p.settings.perPhoto ?? 3));
  const list = p.rows.map((r, i) => ({ r, i })).filter((x) => yes(x.r.include) && x.r._ok !== false).sort((a, b) => (Number(a.r.order) || 0) - (Number(b.r.order) || 0) || a.i - b.i);
  let durs = list.map((x) => (Number(x.r.seconds) > 0 ? Number(x.r.seconds) : base));
  const music = Number(p.meta.musicDuration) || 0;
  let fitted = false;
  if (yes(p.settings.fitToMusic) && music > 0 && list.length) {
    const want = music + (list.length - 1) * T, sum = durs.reduce((a, b) => a + b, 0);
    durs = durs.map((d) => Math.max(T + 0.4, (d * want) / sum)); fitted = true;
  }
  let t = 0, k = 0;
  const items = list.map((x, j) => {
    const d = durs[j];
    const m = s(x.r.motion) || "auto", motion = m === "auto" ? ["zoom-in", "pan-right", "zoom-out", "pan-left"][k++ % 4] : m;
    const it = { row: x.i, file: s(x.r.file), caption: s(x.r.caption), d, start: t, motion };
    t += d - T;
    return it;
  });
  const total = items.length ? t + T : 0;
  return { items, T, total, music, fitted };
}

function motionFilter(motion: string, W: number, H: number, d: number) {
  const Z = 0.12, sw = Math.round(W * (1 + Z)), sh = Math.round(H * (1 + Z));
  const p = `(t/${d.toFixed(3)})`;
  if (motion === "zoom-in" || motion === "zoom-out") {
    const f = motion === "zoom-in" ? `(1+${Z}*${p})` : `(1+${Z}-${Z}*${p})`;
    return `scale=w='trunc(${W}*${f}/2)*2':h='trunc(${H}*${f}/2)*2':eval=frame,crop=${W}:${H}`;
  }
  if (motion === "pan-left" || motion === "pan-right") {
    const x = motion === "pan-right" ? `(iw-${W})*${p}` : `(iw-${W})*(1-${p})`;
    return `scale=${sw}:${sh},crop=${W}:${H}:x='${x}':y='(ih-${H})/2'`;
  }
  return `scale=${W}:${H}`;
}

/** 单张照片 → 中间片段（含字幕）。 */
async function segment(p: Project, it: ReturnType<typeof plan>["items"][number], abs: string, out: string, capPng: string | undefined, W: number, H: number) {
  const Z = 1.12, bw = Math.round(W * Z), bh = Math.round(H * Z);
  const fit = s(p.settings.fit) || "cover", bg = s(p.settings.bg) || "#000000";
  const compose = fit === "cover"
    ? `[0:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},setsar=1[f]`
    : fit === "blur"
      ? `[0:v]split[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=30:2,eq=brightness=-0.08[bgv];[b]scale=${bw}:${bh}:force_original_aspect_ratio=decrease[fg];[bgv][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[f]`
      : `[0:v]scale=${bw}:${bh}:force_original_aspect_ratio=decrease,pad=${bw}:${bh}:(ow-iw)/2:(oh-ih)/2:color=0x${bg.slice(1)},setsar=1[f]`;
  const g = [compose, `[f]fps=${FPS},${motionFilter(it.motion, W, H, it.d)},setsar=1[m]`];
  const args = ["-loop", "1", "-framerate", String(FPS), "-t", it.d.toFixed(3), "-i", abs];
  if (capPng) { args.push("-i", capPng); g.push(`[m][1:v]overlay=0:0:eof_action=repeat,format=yuv420p[v]`); } else g.push(`[m]format=yuv420p[v]`);
  args.push("-filter_complex", g.join(";"), "-map", "[v]", "-t", it.d.toFixed(3), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out);
  await ffmpeg(args, { timeoutMs: 10 * 60_000 });
}

function captionSvg(text: string, W: number, H: number, f: FontSet, pos: string) {
  const size = Math.round(Math.min(W, H) * 0.06), pad = Math.round(size * 0.5);
  const { lines } = wrapLines(text, W * 0.84, (t) => f.measure(t, size, true), 3);
  const w = Math.max(...lines.map((l) => f.measure(l, size, true))) + pad * 2, lh = size * 1.3, h = lines.length * lh + pad;
  const x = (W - w) / 2, y = pos === "top" ? H * 0.07 : H * 0.9 - h;
  const fam = escapeXml(f.boldFamily ?? f.family);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${size * 0.3}" fill="#000" fill-opacity="0.45"/>${lines.map((l, i) => `<text x="${W / 2}" y="${(y + pad / 2 + size * (1 + i * 1.3) - size * 0.1).toFixed(1)}" font-family="${fam}" font-weight="700" font-size="${size}" fill="#fff" text-anchor="middle">${escapeXml(l)}</text>`).join("")}</svg>`;
}

async function render(p: Project, ctx: ExportCtx, outAbs: string) {
  const { W, H } = sizeFor(s(p.settings.format) || "landscape");
  const pl = plan(p);
  if (!pl.items.length) throw new KitError("empty", "No photos are included.");
  const tmp = await mkdtemp(join(tmpdir(), "slideshow-"));
  const f = await fontsFor(ctx.assetRoot, FONT_ENV);
  try {
    const segs: string[] = [];
    for (const [k, it] of pl.items.entries()) {
      let cap: string | undefined;
      if (it.caption) { cap = join(tmp, `c${k}.png`); await writeFile(cap, (await renderSvg(captionSvg(it.caption, W, H, f, s(p.settings.captionPos) || "bottom"), f)).png); }
      const out = join(tmp, `s${k}.mp4`);
      await segment(p, it, ctx.ws.resolve(it.file), out, cap, W, H);
      segs.push(out);
      ctx.log(`segment ${k + 1}/${pl.items.length}`);
    }
    const args: string[] = [];
    segs.forEach((x) => args.push("-i", x));
    const g: string[] = [];
    let last = "0:v";
    const tr = s(p.settings.transition) || "fade";
    if (pl.T > 0 && segs.length > 1) {
      pl.items.slice(1).forEach((it, j) => { const o = `x${j}`; g.push(`[${last}][${j + 1}:v]xfade=transition=${tr}:duration=${pl.T.toFixed(3)}:offset=${it.start.toFixed(3)}[${o}]`); last = o; });
    } else if (segs.length > 1) { g.push(`${segs.map((_, j) => `[${j}:v]`).join("")}concat=n=${segs.length}:v=1:a=0[cc]`); last = "cc"; }
    g.push(`[${last}]format=yuv420p[vout]`);
    const music = s(p.meta.music);
    if (music) {
      args.push("-stream_loop", "-1", "-i", ctx.ws.resolve(music));
      const fo = Math.min(2, pl.total / 4);
      g.push(`[${segs.length}:a]atrim=0:${pl.total.toFixed(3)},afade=t=in:d=0.5,afade=t=out:st=${(pl.total - fo).toFixed(3)}:d=${fo.toFixed(3)}[aout]`);
    }
    args.push("-filter_complex", g.join(";"), "-map", "[vout]", ...(music ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] : []), "-t", pl.total.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", outAbs);
    await ffmpeg(args, { timeoutMs: 30 * 60_000, duration: pl.total });
    return pl;
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

function storyboardSvg(p: Project, thumbs: Map<string, string>, f?: FontSet) {
  const pl = plan(p), cols = 4, tw = 300, th = Math.round((tw * sizeFor(s(p.settings.format) || "landscape").H) / sizeFor(s(p.settings.format) || "landscape").W), gap = 18, lab = 46;
  const n = pl.items.length, rows = Math.max(1, Math.ceil(n / cols)), W = cols * tw + (cols + 1) * gap, H = 70 + rows * (th + lab + gap) + gap;
  const fam = escapeXml(f?.family ?? "sans-serif");
  const title = s(p.settings.title) || "Slideshow";
  const cells = pl.items.map((it, k) => {
    const x = gap + (k % cols) * (tw + gap), y = 70 + Math.floor(k / cols) * (th + lab + gap), href = thumbs.get(it.file);
    return `<g><rect x="${x}" y="${y}" width="${tw}" height="${th}" fill="#0f172a"/>${href ? `<image x="${x}" y="${y}" width="${tw}" height="${th}" href="${href}" preserveAspectRatio="xMidYMid ${s(p.settings.fit) === "cover" ? "slice" : "meet"}"/>` : ""}<rect x="${x + 6}" y="${y + 6}" width="34" height="24" rx="4" fill="#000" fill-opacity="0.6"/><text x="${x + 23}" y="${y + 23}" font-family="${fam}" font-size="15" fill="#fff" text-anchor="middle">${k + 1}</text><text x="${x}" y="${y + th + 19}" font-family="${fam}" font-size="15" fill="#334155">${esc(`${fmt(it.start)} · ${it.d.toFixed(1)}s · ${it.motion}`)}</text><text x="${x}" y="${y + th + 38}" font-family="${fam}" font-size="14" fill="#64748b">${escapeXml((it.caption || it.file.split("/").pop()!).slice(0, 26))}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f8fafc"/><text x="${gap}" y="44" font-family="${fam}" font-size="26" font-weight="700" fill="#0f172a">${escapeXml(title)}</text><text x="${W - gap}" y="44" font-family="${fam}" font-size="17" fill="#475569" text-anchor="end">${esc(`${n} photos · ${fmt(pl.total)}${p.meta.music ? " · ♪ " + s(p.meta.music).split("/").pop() : ""}`)}</text>${cells}</svg>`;
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "slideshow",
    title: ["图片幻灯片视频", "Slideshow Video"],
    openDescription:
      "Make an MP4 slideshow from photos and music. Pick photos (jpg/png/webp, or a folder) and optionally one music file. Each row is a photo: include, order (sort key), seconds (blank = perPhoto), motion (auto/zoom-in/zoom-out/pan-left/pan-right/none — Ken Burns), caption (burned in). Photos are sorted by EXIF date taken when available (settings.sort: date/name). Settings: title, format landscape/square/vertical, perPhoto (s), transition (fade/dissolve/slideleft/wipeleft/circleopen/smoothleft/none) and transitionSec, fit cover/blur/contain, bg colour, captionPos bottom/top, fitToMusic (stretch photo times so the video ends with the song). Checks: low-resolution photos, unreadable files, duplicates, photo shorter than the transition, music shorter (it loops) or much longer (cut with fade-out). Exports slideshow.mp4 and a storyboard PNG. Needs ffmpeg.",
    inputs: { exts: [...IMG, ...AUDIO], min: 1, max: 500, folders: true, label: ["选择照片（或文件夹），可加一首音乐", "Pick photos (or a folder) and optional music"] },
    settings: [
      { key: "title", label: ["标题（用于故事板和文件名）", "Title (storyboard and file name)"], type: "text", default: "" },
      { key: "format", label: ["画幅", "Format"], type: "select", default: "landscape", options: [{ value: "landscape", label: ["横屏 1920×1080", "Landscape 1920×1080"] }, { value: "square", label: ["方形 1080×1080", "Square 1080×1080"] }, { value: "vertical", label: ["竖屏 1080×1920", "Vertical 1080×1920"] }] },
      { key: "perPhoto", label: ["每张默认秒数", "Seconds per photo"], type: "number", default: 3, min: 0.5, max: 60 },
      { key: "transition", label: ["转场", "Transition"], type: "select", default: "fade", options: TRANS.map((t) => ({ value: t, label: [({ fade: "淡入淡出", dissolve: "溶解", slideleft: "左滑", wipeleft: "左擦除", circleopen: "圆形展开", smoothleft: "平滑左移", none: "无" } as Record<string, string>)[t], t] as [string, string] })) },
      { key: "transitionSec", label: ["转场秒数", "Transition (s)"], type: "number", default: 0.8, min: 0.1, max: 3 },
      { key: "fit", label: ["照片适配", "Fit"], type: "select", default: "blur", options: [{ value: "cover", label: ["铺满裁切", "Fill (crop)"] }, { value: "blur", label: ["完整显示 + 模糊背景", "Whole photo, blurred background"] }, { value: "contain", label: ["完整显示 + 纯色背景", "Whole photo, solid background"] }] },
      { key: "bg", label: ["背景色（纯色适配）", "Background (solid fit)"], type: "color", default: "#000000" },
      { key: "captionPos", label: ["字幕位置", "Caption position"], type: "select", default: "bottom", options: [{ value: "bottom", label: ["底部", "Bottom"] }, { value: "top", label: ["顶部", "Top"] }] },
      { key: "fitToMusic", label: ["按音乐长度调整时长", "Fit to music length"], type: "bool", default: false },
      { key: "sort", label: ["排序", "Sort"], type: "select", default: "date", reload: true, options: [{ value: "date", label: ["按拍摄时间", "Date taken"] }, { value: "name", label: ["按文件名", "File name"] }] },
    ],
    columns: () => [
      { key: "include", label: ["收录", "Include"], type: "bool" },
      { key: "order", label: ["顺序", "Order"], type: "number" },
      { key: "file", label: ["照片", "Photo"], readOnly: true },
      { key: "taken", label: ["拍摄时间", "Taken"], readOnly: true },
      { key: "size", label: ["尺寸", "Size"], readOnly: true },
      { key: "seconds", label: ["秒数（空=默认）", "Seconds (blank = default)"], type: "number" },
      { key: "motion", label: ["动效", "Motion"], type: "select", options: MOTIONS },
      { key: "caption", label: ["字幕", "Caption"], wide: true },
      { key: "_at", label: ["出现于", "At"], readOnly: true },
    ] as Column[],
    newRow: () => ({ include: true, order: 999, file: "", taken: "", size: "", seconds: "", motion: "auto", caption: "" }),
    async load({ ws, files, settings, previous }) {
      const imgs: string[] = [], music: string[] = [];
      for (const f of files) {
        if (has(f, IMG)) imgs.push(f); else if (has(f, AUDIO)) music.push(f);
        else for (const x of await ws.list({ dir: f, exts: [...IMG, ...AUDIO], limit: 2000 })) (has(x.path, AUDIO) ? music : imgs).push(x.path);
      }
      const list = [...new Set(imgs)].filter((f) => !f.startsWith(NAME + "/"));
      if (!list.length) throw new KitError("no_photos", "No photos found (jpg/png/webp).");
      const meta: Record<string, unknown> = { music: music[0] ?? "", extraMusic: music.slice(1) };
      if (music[0]) { const m = await probe(ws.resolve(music[0])); if (!m.hasAudio) throw new KitError("bad_music", `${music[0]} has no audio.`); meta.musicDuration = m.duration; }
      const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
      const info: Row[] = [];
      for (const f of list) {
        let w = 0, h = 0, taken = "", ok = true, hash = "";
        try {
          const buf = new Uint8Array(await ws.read(f, 200 * 1024 * 1024));
          hash = `${buf.length}:${Buffer.from(buf.subarray(0, 4096)).toString("base64").slice(0, 64)}:${Buffer.from(buf.subarray(-4096)).toString("base64").slice(-64)}`;
          if (/\.jpe?g$/i.test(f)) { const ex = readExif(buf); taken = ex.dateTaken ?? ""; if ((ex.orientation ?? 1) >= 5) hash += ":r"; }
          const pr = await probe(ws.resolve(f));
          w = pr.width ?? 0; h = pr.height ?? 0; if (hash.endsWith(":r")) [w, h] = [h, w];
          if (!w) ok = false;
        } catch { ok = false; }
        info.push({ file: f, taken, size: ok ? `${w}×${h}` : "unreadable", _w: w, _h: h, _ok: ok, _hash: hash });
      }
      const byDate = s(settings.sort) !== "name";
      info.sort((a, b) => (byDate && s(a.taken) && s(b.taken) && s(a.taken) !== s(b.taken) ? s(a.taken).localeCompare(s(b.taken)) : byDate && !!s(a.taken) !== !!s(b.taken) ? (s(a.taken) ? -1 : 1) : s(a.file).localeCompare(s(b.file), "en", { numeric: true })));
      const rows: Row[] = info.map((r, i) => {
        const o = prev.get(s(r.file));
        return { include: o?.include ?? r._ok, order: i + 1, ...r, seconds: o?.seconds ?? "", motion: o?.motion ?? "auto", caption: o?.caption ?? "" };
      });
      const thumbs: Record<string, string> = {};
      for (const r of rows.filter((x) => x._ok).slice(0, 60)) {
        try {
          const { stdout } = await ffmpeg(["-i", ws.resolve(s(r.file)), "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "6", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
          thumbs[s(r.file)] = `data:image/jpeg;base64,${stdout.toString("base64")}`;
        } catch { /* 预览缺图即可 */ }
      }
      meta.thumbs = thumbs;
      return { rows, meta };
    },
    async compute(p): Promise<Computed> {
      const issues: Issue[] = [];
      const { W, H } = sizeFor(s(p.settings.format) || "landscape");
      const pl = plan(p);
      const seen = new Map<string, number>();
      p.rows.forEach((r, i) => {
        if (r._ok === false) { issues.push({ level: "error", row: i, key: "file", message: `${s(r.file)} can't be read as an image — it is left out.` }); return; }
        if (!yes(r.include)) return;
        const w = Number(r._w), h = Number(r._h);
        if (w && (w < W * 0.5 && h < H * 0.5)) issues.push({ level: "warn", row: i, key: "size", message: `${s(r.file).split("/").pop()} is only ${w}×${h}; it will look blurry at ${W}×${H}.` });
        if (s(p.settings.fit) === "cover" && w && h && (w / h - W / H) * (W / H > 1 ? 1 : -1) < -0.4) issues.push({ level: "info", row: i, key: "file", message: `${s(r.file).split("/").pop()} is ${h > w ? "portrait" : "landscape"}; “Fill (crop)” will cut a lot of it — use the blurred-background fit or set its motion to none.` });
        const hk = s(r._hash);
        if (hk && seen.has(hk)) issues.push({ level: "warn", row: i, key: "include", message: `${s(r.file).split("/").pop()} looks like a duplicate of row #${seen.get(hk)} (${s(p.rows[seen.get(hk)!].file).split("/").pop()}).` });
        else if (hk) seen.set(hk, i);
        const sec = s(r.seconds);
        if (sec && !(Number(sec) > 0)) issues.push({ level: "error", row: i, key: "seconds", message: `Seconds “${sec}” must be a positive number.` });
        if (s(r.motion) && !MOTIONS.includes(s(r.motion))) issues.push({ level: "error", row: i, key: "motion", message: `Unknown motion “${s(r.motion)}” (use ${MOTIONS.join(", ")}).` });
      });
      pl.items.forEach((it) => { if (pl.T && it.d < pl.T * 2) issues.push({ level: "warn", row: it.row, key: "seconds", message: `Shown for ${it.d.toFixed(1)} s, which is less than two ${pl.T}s transitions — it will barely be visible.` }); });
      if (pl.music) {
        if (!pl.fitted && pl.music < pl.total - 0.5) issues.push({ level: "info", key: "fitToMusic", message: `The music (${fmt(pl.music)}) is shorter than the slideshow (${fmt(pl.total)}) and will loop. Turn on “Fit to music length” to end together.` });
        if (!pl.fitted && pl.music > pl.total + 2) issues.push({ level: "info", key: "fitToMusic", message: `The music (${fmt(pl.music)}) is longer than the slideshow (${fmt(pl.total)}); it will fade out at ${fmt(pl.total)}. Turn on “Fit to music length” to use the whole song.` });
      } else issues.push({ level: "info", message: "No music picked — the video will be silent." });
      if (((p.meta.extraMusic as string[]) ?? []).length) issues.push({ level: "info", message: `Only the first music file is used (${s(p.meta.music)}).` });
      const at = new Map(pl.items.map((it) => [it.row, it]));
      const thumbs = new Map<string, string>(Object.entries((p.meta.thumbs as Record<string, string>) ?? {}));
      return {
        rows: p.rows.map((r, i) => ({ ...r, _at: at.has(i) ? `${fmt(at.get(i)!.start)} · ${at.get(i)!.d.toFixed(1)}s` : "" })),
        issues,
        summary: `${pl.items.length} photo(s), ${fmt(pl.total)} at ${W}×${H}, ${s(p.settings.transition) || "fade"} transitions${p.meta.music ? `, music ${s(p.meta.music).split("/").pop()} (${fmt(pl.music)})${pl.fitted ? ", fitted to the music" : ""}` : ", no music"}.`,
        stats: { photos: pl.items.length, seconds: Math.round(pl.total * 10) / 10 },
        preview: thumbs.size ? storyboardSvg(p, thumbs).replace("<svg ", '<svg style="max-width:100%;height:auto" ') : "",
      };
    },
    exports: [
      { id: "mp4", label: ["MP4 视频", "MP4 video"], description: "<title>.mp4", async run(ctx: ExportCtx) {
        const name = `${stem(ctx.project)}.mp4`; await mkdir(ctx.ws.resolve(ctx.outDir), { recursive: true });
        const pl = await render(ctx.project, ctx, join(ctx.ws.resolve(ctx.outDir), name));
        return { files: [`${ctx.outDir}/${name}`], note: `${pl.items.length} photos, ${fmt(pl.total)}.` };
      } },
      { id: "storyboard", label: ["故事板 PNG", "Storyboard PNG"], description: "storyboard.png — every slide with its time", async run(ctx: ExportCtx) {
        const f = await fontsFor(ctx.assetRoot, FONT_ENV);
        const thumbs = await makeThumbs(ctx.project, ctx, 300);
        return [await ctx.write(`${stem(ctx.project)}-storyboard.png`, (await renderSvg(storyboardSvg(ctx.project, thumbs, f), f)).png)];
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.file)} ${s(r.size)} ${s(r.taken)} sec=${s(r.seconds) || "default"} motion=${s(r.motion)} ${s(r.caption) ? `“${s(r.caption)}”` : ""}`,
  };
}

async function makeThumbs(p: Project, ctx: { ws: ExportCtx["ws"] }, w: number) {
  const out = new Map<string, string>();
  for (const it of plan(p).items) {
    const { stdout } = await ffmpeg(["-i", ctx.ws.resolve(it.file), "-frames:v", "1", "-vf", `scale=${w * 2}:-2`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
    out.set(it.file, `data:image/jpeg;base64,${stdout.toString("base64")}`);
  }
  return out;
}

const stem = (p: Project) => (s(p.settings.title) || "slideshow").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  const app = createApp(makeDef(), options);
  return app.server;
}
