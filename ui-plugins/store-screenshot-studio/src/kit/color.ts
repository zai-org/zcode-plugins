import { parseColor, type Raster } from "./raster.ts";

export type RGB = [number, number, number];

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

export function luminance(c: RGB) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** 在 bg 上更易读的文字颜色。 */
export function readableOn(bg: string | RGB, dark = "#111827", light = "#ffffff") {
  const c = typeof bg === "string" ? parseColor(bg) : bg;
  return contrast(c, parseColor(dark)) >= contrast(c, parseColor(light)) ? dark : light;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

/** 从图片里取主色：忽略透明、接近白/黑/灰的像素，按出现次数排序。 */
export function extractPalette(image: Raster, count = 4): { colors: RGB[]; average: RGB; hasAlpha: boolean } {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let transparent = 0;
  let total = 0;
  const avg = [0, 0, 0];
  const step = Math.max(1, Math.floor((image.width * image.height) / 60000));
  for (let p = 0; p < image.width * image.height; p += step) {
    const i = p * 4;
    const a = image.data[i + 3];
    if (a < 128) {
      transparent++;
      continue;
    }
    const c: RGB = [image.data[i], image.data[i + 1], image.data[i + 2]];
    total++;
    avg[0] += c[0];
    avg[1] += c[1];
    avg[2] += c[2];
    const [, s, l] = rgbToHsl(c);
    if (s < 0.18 || l > 0.94 || l < 0.08) continue;
    const key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += c[0];
    bin.g += c[1];
    bin.b += c[2];
    bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n);
  // 抗锯齿边缘产生的过渡色数量很少，忽略。
  const sorted = ranked.filter((b) => b.n >= (ranked[0]?.n ?? 0) * 0.06).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n] as RGB);
  const colors: RGB[] = [];
  for (const c of sorted) {
    if (colors.length >= count) break;
    const [h] = rgbToHsl(c);
    if (colors.every((d) => Math.abs(rgbToHsl(d)[0] - h) > 18 || Math.abs(luminance(c) - luminance(d)) > 0.25)) colors.push(c);
  }
  const average: RGB = total ? [avg[0] / total, avg[1] / total, avg[2] / total] : [0, 0, 0];
  return { colors, average, hasAlpha: transparent > (image.width * image.height) / step / 50 };
}
