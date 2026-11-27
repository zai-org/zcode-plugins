/** 动图参数和 ffmpeg 参数（纯函数，方便测试） */
export type Format = "gif" | "webp";
export type Job = { start: number; end: number; fps: number; width: number; speed: number; format: Format; colors: number; dither: string; quality: number; loop: boolean; reverse: boolean };

/** "1:05.5" / "65.5" / "" → 秒；空值返回 null */
export function parseSec(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/s$/i, "");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
export const fmtSec = (s: number) => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };

export function filters(j: Job, srcW: number) {
  const w = Math.max(16, Math.min(Math.round(j.width) || srcW, srcW));
  const even = w % 2 ? w - 1 : w;
  const v = [`setpts=PTS/${j.speed}`, `fps=${j.fps}`, `scale=${even}:-2:flags=lanczos`, ...(j.reverse ? ["reverse"] : [])].join(",");
  return { chain: v, width: even };
}

export function args(input: string, out: string, j: Job, srcW: number): string[] {
  const { chain } = filters(j, srcW);
  const dur = Math.max(0.1, j.end - j.start);
  const head = ["-ss", j.start.toFixed(3), "-t", dur.toFixed(3), "-i", input, "-an"];
  if (j.format === "gif") {
    const dither = j.dither === "none" ? "dither=none" : j.dither === "sierra" ? "dither=sierra2_4a" : "dither=bayer:bayer_scale=4";
    return [...head, "-filter_complex", `[0:v]${chain},split[a][b];[a]palettegen=max_colors=${j.colors}:stats_mode=diff[p];[b][p]paletteuse=${dither}:diff_mode=rectangle`, "-loop", j.loop ? "0" : "-1", out];
  }
  return [...head, "-vf", chain, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(j.quality), "-compression_level", "6", "-loop", j.loop ? "0" : "1", out];
}

/** 超过目标大小时下一次尝试：先降帧率，再缩小宽度，再减少颜色 */
export function shrink(j: Job, ratio: number): Job {
  const k = Math.max(0.5, Math.min(0.9, Math.sqrt(1 / ratio)));
  const n = { ...j };
  if (n.fps > 8) n.fps = Math.max(8, Math.round(n.fps * k));
  else if (n.width > 240) n.width = Math.max(240, Math.round(n.width * k));
  else if (n.format === "gif" && n.colors > 32) n.colors = Math.max(32, Math.round(n.colors / 2));
  else n.quality = Math.max(20, n.quality - 15);
  if (n.width > 320 && ratio > 2) n.width = Math.max(320, Math.round(n.width * k));
  return n;
}
