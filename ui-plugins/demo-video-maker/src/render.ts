import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./kit/ffmpeg.ts";
import { escapeXml, renderSvg, textSvg, wrapLines, type FontSet } from "./kit/render.ts";
import { segmentKey, type Project, type Segment } from "./project.ts";

/** 叠加层：整幅透明 PNG（说明条或字幕）。 */
export async function overlayPng(kind: "callout" | "subtitle" | "callout-top", text: string, project: Project, fonts: FontSet) {
  const { width: W, height: H } = project;
  const size = Math.round(H * (kind === "subtitle" ? 0.042 : 0.046));
  const maxW = W * (kind === "subtitle" ? 0.8 : 0.7);
  const bold = kind !== "subtitle";
  const { lines } = wrapLines(text, maxW, (t) => fonts.measure(t, size, bold), 3);
  const lh = size * 1.3;
  const textW = Math.max(...lines.map((l) => fonts.measure(l, size, bold)));
  const padX = size * 0.8;
  const padY = size * 0.5;
  const boxW = textW + padX * 2 + (kind === "subtitle" ? 0 : size * 0.35);
  const boxH = lines.length * lh + padY * 2 - (lh - size);
  const x = (W - boxW) / 2;
  const y = kind === "subtitle" ? H * 0.94 - boxH : kind === "callout" ? H * 0.8 - boxH : H * 0.07;
  const family = bold && fonts.boldFamily ? fonts.boldFamily : fonts.family;
  const accentBar = kind === "subtitle" ? "" : `<rect x="${x}" y="${y}" width="${size * 0.35}" height="${boxH}" rx="${size * 0.17}" fill="${project.accent}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${size * 0.45}" fill="${kind === "subtitle" ? "#000000" : "#0f172a"}" fill-opacity="${kind === "subtitle" ? 0.62 : 0.9}"/>
${accentBar}
${textSvg(lines, { x: W / 2 + (kind === "subtitle" ? 0 : size * 0.17), y: y + padY, size, color: "#ffffff", family, weight: bold ? 700 : 400, anchor: "middle", lineHeight: 1.3, boldStroke: bold && !fonts.boldFamily })}
</svg>`;
  return (await renderSvg(svg, fonts)).png;
}

export async function introPng(project: Project, fonts: FontSet) {
  const { width: W, height: H } = project;
  const intro = project.intro!;
  const size = Math.round(H * 0.085);
  const family = fonts.boldFamily ?? fonts.family;
  const { lines } = wrapLines(intro.title, W * 0.8, (t) => fonts.measure(t, size, true), 2);
  const sub = intro.subtitle ? wrapLines(intro.subtitle, W * 0.75, (t) => fonts.measure(t, size * 0.42), 2).lines : [];
  const blockH = lines.length * size * 1.2 + (sub.length ? size * 0.5 + sub.length * size * 0.42 * 1.35 : 0);
  const top = (H - blockH) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${project.background}"/><stop offset="1" stop-color="${project.accent}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<rect x="${W / 2 - size * 0.6}" y="${top - size * 0.55}" width="${size * 1.2}" height="${size * 0.09}" rx="${size * 0.045}" fill="#ffffff" fill-opacity="0.85"/>
${textSvg(lines, { x: W / 2, y: top, size, color: "#ffffff", family, weight: 700, anchor: "middle", lineHeight: 1.2, boldStroke: !fonts.boldFamily })}
${textSvg(sub, { x: W / 2, y: top + lines.length * size * 1.2 + size * 0.35, size: Math.round(size * 0.42), color: "#e2e8f0", family: fonts.family, anchor: "middle", lineHeight: 1.35 })}
</svg>`;
  return (await renderSvg(svg, fonts)).png;
}

const VIDEO_OUT = (fps: number) => ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];

export interface RenderContext {
  project: Project;
  fonts: FontSet;
  cacheDir: string;
  abs: (p: string) => string;
  hasAudio: (source: string) => boolean;
  mtime: (source: string) => number;
  onProgress?: (text: string) => void;
}

/** 渲染一段；已有缓存（同一内容）时直接复用。返回缓存文件路径与是否新渲染。 */
export async function renderSegment(seg: Segment, ctx: RenderContext) {
  const { project, fonts } = ctx;
  const key = segmentKey(seg, project, ctx.mtime(seg.source), fonts.path);
  const out = join(ctx.cacheDir, `${seg.id}-${key}.mp4`);
  try {
    if ((await stat(out)).size > 0) return { file: out, fresh: false };
  } catch {
    // 需要渲染
  }
  const W = project.width;
  const H = project.height;
  const len = seg.end - seg.start;
  const tmp = join(ctx.cacheDir, `tmp-${seg.id}-${key}`);
  await mkdir(tmp, { recursive: true });
  try {
    const args = ["-ss", seg.start.toFixed(3), "-t", len.toFixed(3), "-i", ctx.abs(seg.source)];
    const overlays: { file: string; at: number; duration: number }[] = [];
    let n = 0;
    for (const c of seg.callouts) {
      const file = join(tmp, `o${n++}.png`);
      await writeFile(file, await overlayPng(c.position === "top" ? "callout-top" : "callout", c.text, project, fonts));
      overlays.push({ file, at: c.at, duration: c.duration });
    }
    for (const s of seg.subtitles) {
      const file = join(tmp, `o${n++}.png`);
      await writeFile(file, await overlayPng("subtitle", s.text, project, fonts));
      overlays.push({ file, at: s.at, duration: s.duration });
    }
    for (const o of overlays) args.push("-loop", "1", "-framerate", String(project.fps), "-t", len.toFixed(3), "-i", o.file);
    const useAudio = ctx.hasAudio(seg.source) && !seg.mute;
    if (!useAudio) args.push("-f", "lavfi", "-t", len.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    const f: string[] = [];
    f.push(`[0:v]fps=${project.fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${project.background},setsar=1,setpts=PTS-STARTPTS[b0]`);
    let last = "b0";
    if (seg.zooms.length) {
      // crop 的 x/y 上限在配置时按首帧尺寸算死（首帧未放大时恒为 0，画面会钉在左上角），
      // 所以改为把逐帧放大的画面 overlay 回原尺寸底图，偏移量自己按放大后尺寸计算。
      const { zoomScale, offX, offY } = scaleCropExprs(seg, W, H);
      f.push(`[b0]split[zb][zs]`);
      f.push(`[zs]scale=w='${zoomScale.w}':h='${zoomScale.h}':eval=frame:flags=bicubic[zz]`);
      f.push(`[zb][zz]overlay=x='${offX}':y='${offY}':eval=frame,setsar=1[bz]`);
      last = "bz";
    }
    overlays.forEach((o, i) => {
      const fadeOut = Math.max(o.at, o.at + o.duration - 0.2);
      f.push(`[${i + 1}:v]format=rgba,fade=t=in:st=${o.at.toFixed(3)}:d=0.2:alpha=1,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.2:alpha=1[ov${i}]`);
      f.push(`[${last}][ov${i}]overlay=0:0:enable='between(t,${o.at.toFixed(3)},${(o.at + o.duration).toFixed(3)})':shortest=0[l${i}]`);
      last = `l${i}`;
    });
    f.push(`[${last}]format=yuv420p[v]`);
    const audioIndex = useAudio ? "0:a" : `${overlays.length + 1}:a`;
    f.push(`[${audioIndex}]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS[a]`);
    args.push("-filter_complex", f.join(";"), "-map", "[v]", "-map", "[a]", "-t", len.toFixed(3), ...VIDEO_OUT(project.fps), out);
    await ffmpeg(args, { timeoutMs: 30 * 60_000, duration: len });
    return { file: out, fresh: true };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** 放大：按缓动系数把画面放大，再按中心对齐贴回输出尺寸（逐帧求值，比 zoompan 平滑）。 */
export function scaleCropExprs(seg: Segment, W: number, H: number) {
  const parts = seg.zooms.map((z) => {
    const ramp = Math.min(0.45, z.duration / 3);
    const a = z.at;
    const b = z.at + z.duration;
    const m = `min(clip((t-${a.toFixed(3)})/${ramp.toFixed(3)},0,1),clip((${b.toFixed(3)}-t)/${ramp.toFixed(3)},0,1))`;
    const e = `(${m})*(${m})*(3-2*(${m}))`;
    return { e, k: 1 / Math.max(z.w, z.h) - 1, cx: z.x + z.w / 2 - 0.5, cy: z.y + z.h / 2 - 0.5 };
  });
  const Z = `(1+${parts.map((p) => `${p.k.toFixed(4)}*${p.e}`).join("+")})`;
  const CX = `(0.5+${parts.map((p) => `${p.cx.toFixed(4)}*${p.e}`).join("+")})`;
  const CY = `(0.5+${parts.map((p) => `${p.cy.toFixed(4)}*${p.e}`).join("+")})`;
  // scale 的宽高必须是偶数。
  const SW = `(2*trunc(${W}*${Z}/2))`;
  const SH = `(2*trunc(${H}*${Z}/2))`;
  return {
    zoomScale: { w: SW, h: SH },
    // overlay 偏移 = -(裁剪起点)，裁剪起点夹在 [0, 放大尺寸-输出尺寸]。
    offX: `-clip(${CX}*${SW}-${W}/2,0,${SW}-${W})`,
    offY: `-clip(${CY}*${SH}-${H}/2,0,${SH}-${H})`,
  };
}

export async function renderIntro(ctx: RenderContext) {
  const { project, fonts } = ctx;
  const intro = project.intro!;
  const key = segmentKey({ id: "intro", label: "", source: "", start: 0, end: intro.seconds, zooms: [], callouts: [], subtitles: [{ at: 0, duration: 0, text: `${intro.title}|${intro.subtitle}` }], mute: true }, project, 0, fonts.path);
  const out = join(ctx.cacheDir, `intro-${key}.mp4`);
  try {
    if ((await stat(out)).size > 0) return { file: out, fresh: false };
  } catch {
    // 渲染
  }
  const png = join(ctx.cacheDir, `intro-${key}.png`);
  await writeFile(png, await introPng(project, fonts));
  const s = intro.seconds;
  await ffmpeg(
    ["-loop", "1", "-framerate", String(project.fps), "-t", s.toFixed(3), "-i", png, "-f", "lavfi", "-t", s.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex", `[0:v]fade=t=in:st=0:d=0.4,fade=t=out:st=${(s - 0.4).toFixed(3)}:d=0.4,format=yuv420p[v]`, "-map", "[v]", "-map", "1:a", "-t", s.toFixed(3), ...VIDEO_OUT(project.fps), out],
    { timeoutMs: 5 * 60_000 },
  );
  await rm(png, { force: true });
  return { file: out, fresh: true };
}

export async function concat(files: string[], output: string, listFile: string) {
  await writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output], { timeoutMs: 30 * 60_000 });
  await rm(listFile, { force: true });
}

export { escapeXml };
