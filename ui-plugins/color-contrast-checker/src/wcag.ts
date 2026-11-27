/** WCAG 2.x 对比度和修正色（不依赖第三方库） */
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", orange: "#ffa500", yellow: "#ffff00", purple: "#800080", teal: "#008080", maroon: "#800000", transparent: "#00000000" };

/** #rgb #rgba #rrggbb #rrggbbaa rgb() rgba() hsl() hsla() 和常见颜色名 */
export function parseColor(v: string): RGBA | null {
  let s = v.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (x: string) => (x.endsWith("%") ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [ch(m[1]), ch(m[2]), ch(m[3]), a];
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const [r, g, b] = hslToRgb([parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100]);
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [r, g, b, a];
  }
  return null;
}

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
export const blend = (fg: RGBA, bg: RGB): RGB => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as RGB;

export function luminance(c: RGB) {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, sat, l];
}
export function hslToRgb([h, sat, l]: [number, number, number]): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * sat, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** 要求：normal 文字 AA 4.5 / AAA 7；large（≥24px 或 ≥18.66px 粗体）AA 3 / AAA 4.5；ui 图形和边框 3 */
export function required(usage: string, level: string) {
  if (usage === "ui") return 3;
  if (usage === "large") return level === "AAA" ? 4.5 : 3;
  return level === "AAA" ? 7 : 4.5;
}

/**
 * 最接近的达标颜色：保持色相和饱和度，只改亮度。
 * 往更暗和更亮两个方向各找一次，取亮度变化最小的那个。
 */
export function nearestPassing(color: RGB, against: RGB, target: number): RGB | null {
  if (contrast(color, against) >= target) return color;
  const [h, sat, l0] = rgbToHsl(color);
  const find = (lo: number, hi: number, darker: boolean) => {
    const end = hslToRgb([h, sat, darker ? 0 : 1]);
    if (contrast(end, against) < target) return null;
    // 二分：在 l0 和端点之间找刚好达标的亮度
    let a = lo, b = hi;
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      const ok = contrast(hslToRgb([h, sat, mid]), against) >= target;
      if (darker) { if (ok) a = mid; else b = mid; } else { if (ok) b = mid; else a = mid; }
    }
    const l = darker ? a : b;
    // 取整到 hex 后再确认，必要时再走一步
    let rgb = hslToRgb([h, sat, l]).map(Math.round) as RGB;
    for (let k = 0; k < 20 && contrast(rgb, against) < target; k++) rgb = hslToRgb([h, sat, darker ? l - (k + 1) * 0.002 : l + (k + 1) * 0.002]).map(Math.round) as RGB;
    return contrast(rgb, against) >= target ? { rgb, dl: Math.abs(l - l0) } : null;
  };
  const d = find(0, l0, true), u = find(l0, 1, false);
  const best = [d, u].filter((x): x is { rgb: RGB; dl: number } => !!x).sort((x, y) => x.dl - y.dl)[0];
  return best ? best.rgb : null;
}
