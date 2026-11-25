import { KitError } from "./kit/workspace.ts";

/** 16 位 PCM WAV（单声道或立体声）。 */
export function encodeWav(ch: Float32Array[], sr: number): Buffer {
  const n = ch[0].length, c = ch.length;
  const buf = Buffer.alloc(44 + n * c * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * c * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(c, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * c * 2, 28); buf.writeUInt16LE(c * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * c * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[k][i])) * 32767), o); o += 2; }
  return buf;
}

/** 读 WAV：PCM 8/16/24/32 位或 32 位浮点。 */
export function decodeWav(buf: Buffer, name = "wav"): { channels: Float32Array[]; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new KitError("bad_wav", `${name} is not a WAV file.`);
  let o = 12, fmt = 0, c = 0, sr = 0, bits = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      fmt = buf.readUInt16LE(o + 8); c = buf.readUInt16LE(o + 10); sr = buf.readUInt32LE(o + 12); bits = buf.readUInt16LE(o + 22);
      if (fmt === 0xfffe) fmt = buf.readUInt16LE(o + 32);
    } else if (id === "data") {
      const bps = bits / 8, n = Math.floor(Math.min(size, buf.length - o - 8) / (bps * c));
      const channels = Array.from({ length: c }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) for (let k = 0; k < c; k++, p += bps) {
        channels[k][i] = fmt === 3 && bits === 32 ? buf.readFloatLE(p) : bits === 16 ? buf.readInt16LE(p) / 32768 : bits === 24 ? buf.readIntLE(p, 3) / 8388608 : bits === 32 ? buf.readInt32LE(p) / 2147483648 : (buf[p] - 128) / 128;
      }
      if (!c || !sr) break;
      return { channels, sampleRate: sr };
    }
    o += 8 + size + (size % 2);
  }
  throw new KitError("bad_wav", `${name}: unsupported or broken WAV.`);
}

export const mono = (ch: Float32Array[]) => {
  if (ch.length === 1) return ch[0];
  const out = new Float32Array(ch[0].length);
  for (const c of ch) for (let i = 0; i < out.length; i++) out[i] += c[i] / ch.length;
  return out;
};
const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/** 门限 RMS 响度（dBFS）：只统计 -50 dB 以上的 10 ms 块。 */
export function loudness(x: Float32Array, sr: number) {
  const block = Math.max(1, Math.round(sr / 100));
  let sum = 0, n = 0;
  for (let i = 0; i < x.length; i += block) {
    let s = 0;
    const e = Math.min(x.length, i + block);
    for (let k = i; k < e; k++) s += x[k] * x[k];
    if (db(Math.sqrt(s / (e - i))) > -50) { sum += s; n += e - i; }
  }
  return n ? db(Math.sqrt(sum / n)) : -100;
}
export const peak = (x: Float32Array) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; };

/** 统一响度：调到目标 RMS，但峰值不超过 -1 dBFS。返回实际增益。 */
export function normalize(x: Float32Array, sr: number, target: number) {
  let total = 0;
  let limited = false;
  // 门限会随增益变化，迭代两次让结果贴近目标
  for (let pass = 0; pass < 3; pass++) {
    const l = loudness(x, sr);
    if (l <= -99) break;
    let gain = target - l;
    const pk = db(peak(x)) + gain;
    if (pk > -1) { gain -= pk + 1; limited = true; }
    if (Math.abs(gain) < 0.01) break;
    const k = Math.pow(10, gain / 20);
    for (let i = 0; i < x.length; i++) x[i] *= k;
    total += gain;
    if (limited) break;
  }
  return { gain: total, limited };
}

/** 去掉首尾低于门限（-50 dB）的静音，边缘留 5 ms 淡入淡出。 */
export function trimSilence(x: Float32Array, sr: number, threshold = -50) {
  const th = Math.pow(10, threshold / 20);
  let a = 0, b = x.length;
  while (a < b && Math.abs(x[a]) < th) a++;
  while (b > a && Math.abs(x[b - 1]) < th) b--;
  const pad = Math.round(sr * 0.005);
  const out = x.slice(Math.max(0, a - pad), Math.min(x.length, b + pad));
  fade(out, sr, 0.005);
  return out;
}
export function fade(x: Float32Array, sr: number, seconds: number, ends: "both" | "out" = "both") {
  const n = Math.min(Math.floor(x.length / 2), Math.round(sr * seconds));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    if (ends === "both") x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
}

/** 无缝循环：把结尾 cross 秒与开头交叉淡化，输出长度 = 原长 - cross（首尾可以直接拼接）。 */
export function makeLoop(x: Float32Array, sr: number, cross: number) {
  const n = Math.min(Math.round(cross * sr), Math.floor(x.length / 3));
  if (n < 8) return x;
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const g = i / n; // 等功率
    out[i] = x[x.length - n + i] * Math.cos((g * Math.PI) / 2) + x[i] * Math.sin((g * Math.PI) / 2);
  }
  return out;
}

export function resample(x: Float32Array, from: number, to: number) {
  if (from === to) return x;
  const n = Math.round((x.length * to) / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? x[k] ?? 0) * f; }
  return out;
}
