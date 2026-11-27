/** 压缩方案：纯函数，方便测试 */
export const PRESETS = {
  high: { crf: 20, zh: "高画质", en: "High quality", bpp: 0.11 },
  balanced: { crf: 23, zh: "均衡", en: "Balanced", bpp: 0.075 },
  small: { crf: 28, zh: "小体积", en: "Small file", bpp: 0.04 },
  target: { crf: 0, zh: "指定大小", en: "Target size", bpp: 0 },
} as const;
export type Preset = keyof typeof PRESETS;
export const AUDIO = { aac160: 160, aac128: 128, aac96: 96, aac64: 64, copy: -1, none: 0 } as const;
export type Audio = keyof typeof AUDIO;

export type Src = { width: number; height: number; fps: number; duration: number; bytes: number; hasAudio: boolean };
export type Plan = { preset: Preset; targetMB: number; maxHeight: number; audio: Audio; speed: string };

/** 输出尺寸：只缩小不放大，宽高取偶数 */
export function outSize(src: Src, maxHeight: number) {
  let h = src.height, w = src.width;
  if (maxHeight && h > maxHeight) { w = Math.round((w * maxHeight) / h); h = maxHeight; }
  return { w: w - (w % 2), h: h - (h % 2) };
}

/** 指定大小时的视频码率（kbps），已扣除音频和约 2% 的封装开销 */
export function targetKbps(src: Src, p: Plan) {
  const audio = !src.hasAudio || p.audio === "none" ? 0 : p.audio === "copy" ? 160 : AUDIO[p.audio];
  const total = (p.targetMB * 1024 * 1024 * 8 * 0.98) / 1000 / Math.max(0.1, src.duration);
  return { video: Math.floor(total - audio), audio };
}

/** 粗略估计输出大小（字节） */
export function estimate(src: Src, p: Plan) {
  if (p.preset === "target") return p.targetMB * 1048576;
  const { w, h } = outSize(src, p.maxHeight);
  const audioKbps = !src.hasAudio || p.audio === "none" ? 0 : p.audio === "copy" ? 160 : AUDIO[p.audio];
  const v = (PRESETS[p.preset].bpp * w * h * (src.fps || 30) * src.duration) / 8;
  return Math.min(src.bytes * 1.1, v + (audioKbps * 1000 * src.duration) / 8);
}

export function args(input: string, output: string, src: Src, p: Plan, pass?: { n: 1 | 2; log: string }): string[] {
  const { h } = outSize(src, p.maxHeight);
  const vf = h < src.height - (src.height % 2) ? `scale=-2:${h}:flags=lanczos` : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const v = ["-c:v", "libx264", "-preset", p.speed, "-pix_fmt", "yuv420p", "-vf", vf];
  if (p.preset === "target") {
    const k = targetKbps(src, p);
    v.push("-b:v", `${Math.max(50, k.video)}k`, "-maxrate", `${Math.round(Math.max(50, k.video) * 1.5)}k`, "-bufsize", `${Math.max(100, k.video * 2)}k`);
    if (pass) v.push("-pass", String(pass.n), "-passlogfile", pass.log);
  } else v.push("-crf", String(PRESETS[p.preset].crf));
  const map = ["-map", "0:v:0", ...(src.hasAudio && p.audio !== "none" ? ["-map", "0:a:0?"] : [])];
  if (pass?.n === 1) return ["-i", input, ...map.slice(0, 2), ...v, "-an", "-f", "null", "-"];
  const a = !src.hasAudio || p.audio === "none" ? ["-an"] : p.audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", `${AUDIO[p.audio]}k`];
  return ["-i", input, ...map, ...v, ...a, "-movflags", "+faststart", "-map_metadata", "0", output];
}

export const mb = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1);
