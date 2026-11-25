/** 程序化音效合成（sfxr 思路的自写实现）：振荡器 + 包络 + 频率滑动 / 颤音 / 琶音 + 占空比 + 滤波 + 重复。 */
export const SR = 44100;
export type Wave = "square" | "saw" | "sine" | "triangle" | "noise";
export interface Params {
  wave: Wave;
  freq: number; // 起始频率 Hz
  slide: number; // 每秒变化多少个八度（负数向下）
  deltaSlide: number; // slide 本身每秒的变化
  minFreq: number;
  vibratoDepth: number; // 0..1（半音的比例）
  vibratoSpeed: number; // Hz
  arpMult: number; // 琶音跳变的频率倍数（1 = 无）
  arpTime: number; // 秒
  duty: number; // 方波占空比 0.05..0.95
  dutySweep: number; // 每秒
  attack: number; // 秒
  sustain: number;
  punch: number; // 0..1：持续段开头的额外音量
  decay: number;
  lpf: number; // 低通截止 Hz（0 = 关）
  hpf: number; // 高通截止 Hz（0 = 关）
  repeat: number; // 秒（0 = 不重复）：每隔这么久把频率重置
  gain: number; // dB
}

const BASE: Params = { wave: "square", freq: 440, slide: 0, deltaSlide: 0, minFreq: 20, vibratoDepth: 0, vibratoSpeed: 0, arpMult: 1, arpTime: 0, duty: 0.5, dutySweep: 0, attack: 0, sustain: 0.1, punch: 0, decay: 0.2, lpf: 0, hpf: 0, repeat: 0, gain: 0 };

/** 可复现的伪随机。 */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PRESETS = ["pickup", "laser", "explosion", "powerup", "hit", "jump", "blip", "confirm", "error", "step", "whoosh", "coin"] as const;
export type Preset = (typeof PRESETS)[number];

/** 每个预设：由种子生成一组参数（同一种子总是同一个声音，换种子 = 换一个变体）。 */
export function preset(kind: Preset, seed: number): Params {
  const r = rng(seed * 7919 + PRESETS.indexOf(kind) * 104729);
  const between = (a: number, b: number) => a + (b - a) * r();
  const pick = <T,>(...xs: T[]) => xs[Math.floor(r() * xs.length)];
  const p: Params = { ...BASE };
  switch (kind) {
    case "coin":
    case "pickup":
      Object.assign(p, { wave: pick("square", "triangle"), freq: between(700, 1400), sustain: between(0.03, 0.08), punch: between(0.3, 0.6), decay: between(0.15, 0.35), arpMult: kind === "coin" ? 1.5 : between(1.3, 1.6), arpTime: between(0.04, 0.09) });
      break;
    case "laser":
      Object.assign(p, { wave: pick("square", "saw", "sine"), freq: between(800, 2200), slide: -between(3, 8), minFreq: 120, duty: between(0.2, 0.5), dutySweep: between(-0.5, 0.5), sustain: between(0.05, 0.12), decay: between(0.05, 0.2), hpf: between(0, 300) });
      break;
    case "explosion":
      Object.assign(p, { wave: "noise", freq: between(60, 220), slide: -between(0.2, 1.5), sustain: between(0.1, 0.3), punch: between(0.3, 0.7), decay: between(0.4, 0.9), lpf: between(1500, 5000), repeat: r() < 0.3 ? between(0.15, 0.3) : 0 });
      break;
    case "powerup":
      Object.assign(p, { wave: pick("square", "saw"), freq: between(200, 500), slide: between(1, 3), sustain: between(0.2, 0.35), decay: between(0.1, 0.3), vibratoDepth: between(0, 0.3), vibratoSpeed: between(8, 20), repeat: r() < 0.5 ? between(0.08, 0.15) : 0 });
      break;
    case "hit":
      Object.assign(p, { wave: pick("noise", "square", "saw"), freq: between(150, 500), slide: -between(2, 6), sustain: between(0.01, 0.05), punch: between(0.2, 0.6), decay: between(0.08, 0.2), lpf: between(2000, 8000) });
      break;
    case "jump":
      Object.assign(p, { wave: "square", freq: between(250, 450), slide: between(1.5, 3.5), duty: between(0.2, 0.5), sustain: between(0.08, 0.15), decay: between(0.08, 0.2), hpf: between(0, 200) });
      break;
    case "blip":
      Object.assign(p, { wave: pick("square", "sine", "triangle"), freq: between(600, 1600), sustain: between(0.02, 0.05), decay: between(0.02, 0.07), duty: between(0.3, 0.5) });
      break;
    case "confirm":
      Object.assign(p, { wave: pick("sine", "triangle", "square"), freq: between(500, 900), sustain: between(0.06, 0.1), decay: between(0.12, 0.25), arpMult: pick(1.25, 1.333, 1.5), arpTime: between(0.06, 0.1), punch: 0.2 });
      break;
    case "error":
      Object.assign(p, { wave: pick("square", "saw"), freq: between(120, 220), slide: -between(0, 0.5), sustain: between(0.12, 0.2), decay: between(0.05, 0.12), repeat: between(0.08, 0.12), duty: 0.5 });
      break;
    case "step":
      Object.assign(p, { wave: "noise", freq: between(400, 1200), sustain: 0.005, punch: 0.3, decay: between(0.04, 0.09), lpf: between(800, 2500), hpf: between(80, 200) });
      break;
    case "whoosh":
      Object.assign(p, { wave: "noise", freq: between(600, 1500), attack: between(0.08, 0.2), sustain: between(0.05, 0.15), decay: between(0.15, 0.35), lpf: between(1200, 3000), hpf: between(200, 600), slide: between(-1, 1) });
      break;
  }
  return p;
}

export function normalizeParams(raw: any, base: Params): Params {
  const out: any = { ...base };
  const num = (k: keyof Params, lo: number, hi: number) => {
    const v = Number(raw?.[k]);
    if (raw?.[k] !== undefined && Number.isFinite(v)) out[k] = Math.max(lo, Math.min(hi, v));
  };
  if (["square", "saw", "sine", "triangle", "noise"].includes(raw?.wave)) out.wave = raw.wave;
  num("freq", 20, 8000); num("slide", -16, 16); num("deltaSlide", -32, 32); num("minFreq", 10, 4000); num("vibratoDepth", 0, 1); num("vibratoSpeed", 0, 60);
  num("arpMult", 0.25, 4); num("arpTime", 0, 2); num("duty", 0.05, 0.95); num("dutySweep", -2, 2); num("attack", 0, 3); num("sustain", 0, 5); num("punch", 0, 1); num("decay", 0, 5);
  num("lpf", 0, 20000); num("hpf", 0, 8000); num("repeat", 0, 3); num("gain", -24, 12);
  return out;
}

/** 合成单声道浮点样本。 */
export function synth(p: Params, seed = 1): Float32Array {
  const len = Math.max(1, Math.round((p.attack + p.sustain + p.decay) * SR));
  const out = new Float32Array(len);
  const noise = rng(seed);
  let phase = 0;
  let freq = p.freq;
  let slide = p.slide;
  let duty = p.duty;
  let noiseVal = noise() * 2 - 1;
  let lp = 0, hpPrev = 0, hpOut = 0;
  const lpA = p.lpf > 0 ? 1 - Math.exp((-2 * Math.PI * p.lpf) / SR) : 1;
  const hpA = p.hpf > 0 ? 1 / (1 + (2 * Math.PI * p.hpf) / SR) : 0;
  let sinceRepeat = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (p.repeat > 0 && (sinceRepeat += 1 / SR) >= p.repeat) {
      sinceRepeat = 0;
      freq = p.freq;
      slide = p.slide;
      duty = p.duty;
    }
    slide += p.deltaSlide / SR;
    freq = Math.max(p.minFreq, freq * Math.pow(2, slide / SR));
    let f = freq;
    if (p.arpTime > 0 && (p.repeat > 0 ? sinceRepeat : t) >= p.arpTime) f *= p.arpMult;
    if (p.vibratoDepth > 0) f *= Math.pow(2, (p.vibratoDepth * Math.sin(2 * Math.PI * p.vibratoSpeed * t)) / 12);
    duty = Math.max(0.05, Math.min(0.95, duty + p.dutySweep / SR));
    const prev = phase;
    phase = (phase + f / SR) % 1;
    let s: number;
    switch (p.wave) {
      case "square": s = phase < duty ? 0.5 : -0.5; break;
      case "saw": s = phase * 2 - 1; break;
      case "sine": s = Math.sin(2 * Math.PI * phase); break;
      case "triangle": s = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; break;
      default:
        if (phase < prev) noiseVal = noise() * 2 - 1; // 每个周期换一个噪声值：频率越高越“嘶”
        s = noiseVal;
    }
    // 包络
    let env: number;
    if (t < p.attack) env = t / p.attack;
    else if (t < p.attack + p.sustain) env = 1 + p.punch * (1 - (t - p.attack) / Math.max(1e-6, p.sustain));
    else env = Math.max(0, 1 - (t - p.attack - p.sustain) / Math.max(1e-6, p.decay));
    s *= env;
    lp += lpA * (s - lp);
    s = lp;
    if (hpA) {
      hpOut = hpA * (hpOut + s - hpPrev);
      hpPrev = s;
      s = hpOut;
    }
    out[i] = s;
  }
  return out;
}
