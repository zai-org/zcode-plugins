import { ffmpeg } from "./kit/ffmpeg.ts";
import { keptSegments, type Project } from "./project.ts";

export const PEAK_RATE = 10; // 波形：每秒 10 个峰值
export const DECODE_RATE = 2000; // 对齐用的低采样率信号（语音基频与共振峰的低频部分足够定位）

export interface Analysis { duration: number; peaks: Uint8Array; head: Float32Array }

/** 解码成 2 kHz 单声道，算波形峰值，并保留前若干秒的样本用于对齐。 */
export async function analyse(abs: string, headSeconds = 300): Promise<Analysis> {
  const { stdout } = await ffmpeg(["-v", "error", "-i", abs, "-vn", "-ac", "1", "-ar", String(DECODE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], { timeoutMs: 600_000 });
  const n = Math.floor(stdout.length / 2);
  const pcm = new Int16Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + n * 2));
  const per = DECODE_RATE / PEAK_RATE;
  const peaks = new Uint8Array(Math.ceil(n / per));
  for (let i = 0; i < peaks.length; i++) {
    let m = 0;
    for (let k = i * per, e = Math.min(n, k + per); k < e; k++) m = Math.max(m, Math.abs(pcm[k]));
    peaks[i] = Math.min(255, Math.round(Math.sqrt(m / 32768) * 255));
  }
  const head = new Float32Array(Math.min(n, headSeconds * DECODE_RATE));
  for (let i = 0; i < head.length; i++) head[i] = pcm[i] / 32768;
  return { duration: n / DECODE_RATE, peaks, head };
}

/** 原地基 2 复数 FFT。 */
function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * GCC-PHAT 互相关估计 b 相对 a 的偏移（秒）：b 的本地时间 t 对应 a 的 t + offset。
 * 能利用串音（另一支话筒录到的微弱声音）或开头拍手对齐。confidence = 最高峰 / 远离最高峰处的次高峰。
 */
export function estimateOffset(a: Float32Array, b: Float32Array, maxLagSeconds = 60) {
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai);
  fft(br, bi);
  for (let k = 0; k < n; k++) {
    // X · conj(Y)，PHAT 加权
    const r = ar[k] * br[k] + ai[k] * bi[k];
    const i = ai[k] * br[k] - ar[k] * bi[k];
    const mag = Math.hypot(r, i) || 1;
    ar[k] = r / mag;
    ai[k] = i / mag;
  }
  fft(ar, ai, true);
  const maxLag = Math.min(Math.round(maxLagSeconds * DECODE_RATE), n / 2 - 1);
  const at = (lag: number) => ar[(lag + n) % n];
  let best = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) if (at(lag) > at(best)) best = lag;
  let second = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) if (Math.abs(lag - best) > DECODE_RATE / 20) second = Math.max(second, at(lag));
  return { offset: best / DECODE_RATE, confidence: second > 0 ? at(best) / second : 99 };
}

const DENOISE: Record<string, string> = { off: "", light: "highpass=f=70,afftdn=nr=10:nf=-40", strong: "highpass=f=80,afftdn=nr=20:nf=-35:tn=1" };
const SR = 48000;

export interface GraphInput { abs: string }
export interface GraphOptions {
  range?: [number, number];
  cuts?: boolean;
  intro?: string;
  outro?: string;
  loudnorm?: { measured?: Record<string, string> } | false;
  total: number;
}

/** 生成 ffmpeg 输入参数与 filter_complex。音轨统一 48 kHz 单声道，按偏移对齐、增益、降噪后混音；剪辑区间所有音轨同步剪掉（片段边缘 15 ms 淡入淡出防爆音）。 */
export function buildGraph(p: Project, abs: (file: string) => string, o: GraphOptions) {
  const inputs: string[] = [];
  const parts: string[] = [];
  const live = p.tracks.filter((t) => !t.mute);
  const tracks = live.length ? live : p.tracks.slice(0, 1);
  tracks.forEach((t, i) => {
    inputs.push("-i", abs(t.file));
    const chain = [`aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=mono`];
    if (t.offset > 0) chain.push(`adelay=delays=${Math.round(t.offset * 1000)}:all=1`);
    chain.push(`volume=${live.length ? t.gain : -91}dB`);
    if (DENOISE[p.denoise]) chain.push(DENOISE[p.denoise]);
    chain.push(`apad=whole_dur=${o.total.toFixed(3)}`);
    parts.push(`[${i}:a]${chain.join(",")}[t${i}]`);
  });
  parts.push(tracks.length > 1 ? `${tracks.map((_, i) => `[t${i}]`).join("")}amix=inputs=${tracks.length}:normalize=0:duration=longest[mix]` : `[t0]anull[mix]`);
  let body = "mix";
  if (o.range) {
    parts.push(`[mix]atrim=start=${o.range[0].toFixed(3)}:end=${o.range[1].toFixed(3)},asetpts=PTS-STARTPTS[body]`);
    body = "body";
  } else if (o.cuts !== false && p.cuts.length) {
    const segs = keptSegments(p.cuts, o.total);
    parts.push(`[mix]asplit=${segs.length}${segs.map((_, i) => `[s${i}]`).join("")}`);
    segs.forEach(([a, b], i) => {
      const len = b - a;
      const fade = Math.min(0.015, len / 4);
      parts.push(`[s${i}]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${fade.toFixed(3)},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)}[g${i}]`);
    });
    parts.push(`${segs.map((_, i) => `[g${i}]`).join("")}concat=n=${segs.length}:v=0:a=1[body]`);
    body = "body";
  }
  parts.push(`[${body}]aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo[voice]`);
  const seq = ["[voice]"];
  for (const [kind, file] of [["intro", o.intro], ["outro", o.outro]] as const) {
    if (!file) continue;
    const idx = inputs.length / 2;
    inputs.push("-i", abs(file));
    parts.push(`[${idx}:a]aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo,loudnorm=I=${p.loudness}:TP=-1.5,aresample=${SR}[${kind}]`);
    if (kind === "intro") seq.unshift("[intro]");
    else seq.push("[outro]");
  }
  parts.push(seq.length > 1 ? `${seq.join("")}concat=n=${seq.length}:v=0:a=1[prog]` : `[voice]anull[prog]`);
  if (o.loudnorm) {
    const m = o.loudnorm.measured;
    const base = `loudnorm=I=${p.loudness}:TP=-1.5:LRA=11`;
    const f = m ? `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json` : `${base}:print_format=json`;
    parts.push(`[prog]${f},aresample=${SR}[out]`);
  } else parts.push(`[prog]anull[out]`);
  return { inputs, filter: parts.join(";") };
}

export function parseLoudnorm(stderr: string): Record<string, string> {
  const m = /\{\s*"input_i"[\s\S]*?\}/.exec(stderr);
  if (!m) throw new Error("loudnorm stats missing");
  return JSON.parse(m[0]);
}
