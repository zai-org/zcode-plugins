import { blurChannel, createRaster, drawOver, fitWithin, parseColor, resize, type Raster } from "./kit/raster.ts";

export interface Settings {
  /** auto：已有透明通道就直接用，否则去掉与边缘相连的纯色/浅色背景；off：不去背景。 */
  removeBackground: "auto" | "off";
  /** 去背景容差 1–100。 */
  tolerance: number;
  /** 主体占画布的比例（长边方向）。 */
  fill: number;
  /** 垂直偏移，画布高度的比例，正数向下。 */
  offsetY: number;
  align: "center" | "bottom";
  shadow: "none" | "ground" | "drop";
  shadowOpacity: number;
  background: string;
}

export interface Preset {
  id: string;
  label: string;
  width: number;
  height: number;
  format: "jpg" | "png";
  transparent?: boolean;
  quality?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  removeBackground: "auto",
  tolerance: 20,
  fill: 0.85,
  offsetY: 0,
  align: "center",
  shadow: "ground",
  shadowOpacity: 0.3,
  background: "#ffffff",
};

export const PRESETS: Preset[] = [
  { id: "white-800", label: "白底 800×800（淘宝/天猫/京东主图）", width: 800, height: 800, format: "jpg", quality: 92 },
  { id: "white-1000", label: "白底 1000×1000（拼多多/抖店）", width: 1000, height: 1000, format: "jpg", quality: 92 },
  { id: "amazon-2000", label: "Amazon 2000×2000 white", width: 2000, height: 2000, format: "jpg", quality: 90 },
  { id: "shopify-2048", label: "Shopify 2048×2048", width: 2048, height: 2048, format: "jpg", quality: 90 },
  { id: "square-1080", label: "社媒方图 1080×1080", width: 1080, height: 1080, format: "jpg", quality: 92 },
  { id: "portrait-1080x1440", label: "小红书竖图 1080×1440", width: 1080, height: 1440, format: "jpg", quality: 92 },
  { id: "transparent-png", label: "透明 PNG 1600×1600", width: 1600, height: 1600, format: "png", transparent: true },
];

export interface CutoutReport {
  /** 原图边缘中接近背景色的比例；低说明背景复杂，去背可能不准。 */
  borderUniform: number;
  /** 被去掉的像素比例。 */
  removed: number;
  hadAlpha: boolean;
  touchesEdge: boolean;
  warnings: string[];
}

export interface Cutout {
  subject: Raster;
  report: CutoutReport;
}

const WORK_SIZE = 1800;

function colorDistance(data: ArrayLike<number>, i: number, r: number, g: number, b: number) {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1] ?? 0;
}

/** 去背景并裁到主体。 */
export function cutout(source: Raster, settings: Settings): Cutout {
  const image = fitWithin(source, WORK_SIZE);
  const { width: w, height: h, data } = image;
  const n = w * h;
  const alpha = new Float32Array(n);
  let transparent = 0;
  for (let p = 0; p < n; p++) {
    alpha[p] = data[p * 4 + 3] / 255;
    if (alpha[p] < 0.98) transparent++;
  }
  const hadAlpha = transparent > n * 0.01;
  const warnings: string[] = [];
  let borderUniform = 1;
  let removed = 0;
  let bg: [number, number, number] = [255, 255, 255];

  if (!hadAlpha && settings.removeBackground === "auto") {
    // 1. 边缘取样估计背景色。
    const border: number[] = [];
    const band = Math.max(1, Math.round(Math.min(w, h) * 0.004));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
    bg = [0, 1, 2].map((c) => median(border.map((p) => data[p * 4 + c]))) as [number, number, number];
    const tol = Math.max(1, Math.min(100, settings.tolerance));
    const globalTol = tol * 2.2;
    const localTol = 4 + tol * 0.35;
    borderUniform = border.filter((p) => colorDistance(data, p * 4, ...bg) < globalTol).length / border.length;

    // 2. 从边缘开始洪水填充：与相邻背景像素接近、且与背景色不太远。
    const isBg = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (const p of border)
      if (!isBg[p] && colorDistance(data, p * 4, ...bg) < globalTol) {
        isBg[p] = 1;
        queue[tail++] = p;
      }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      const i = p * 4;
      const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of neighbors) {
        if (q < 0 || isBg[q]) continue;
        const j = q * 4;
        if (colorDistance(data, j, data[i], data[i + 1], data[i + 2]) < localTol && colorDistance(data, j, ...bg) < globalTol * 1.3) {
          isBg[q] = 1;
          queue[tail++] = q;
        }
      }
    }
    removed = tail / n;

    // 3. 去掉零碎小块：只保留面积不小于最大块 2% 的前景连通区域。
    const label = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    for (let p = 0; p < n; p++) {
      if (isBg[p] || label[p] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      head = tail = 0;
      queue[tail++] = p;
      label[p] = id;
      while (head < tail) {
        const q = queue[head++];
        size++;
        const x = q % w;
        const neighbors = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q >= w ? q - w : -1, q < n - w ? q + w : -1];
        for (const r of neighbors)
          if (r >= 0 && !isBg[r] && label[r] < 0) {
            label[r] = id;
            queue[tail++] = r;
          }
      }
      sizes.push(size);
    }
    const largest = Math.max(0, ...sizes);
    for (let p = 0; p < n; p++) alpha[p] = !isBg[p] && sizes[label[p]] >= largest * 0.02 ? 1 : 0;

    // 4. 边缘柔化 + 去除背景色溢色。
    const soft = blurChannel(alpha, w, h, 1, 2);
    for (let p = 0; p < n; p++) {
      const a = Math.min(1, Math.max(0, (soft[p] - 0.3) / 0.6));
      alpha[p] = Math.min(alpha[p] > 0 ? 1 : a, a);
    }
    if (borderUniform < 0.6) warnings.push("background_not_uniform");
    if (removed < 0.05) warnings.push("little_background_removed");
  }

  // 5. 主体包围盒。
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] > 0.05) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) {
    warnings.push("empty_subject");
    minX = minY = 0;
    maxX = w - 1;
    maxY = h - 1;
    alpha.fill(1);
  }
  const edges = [minX === 0, minY === 0, maxX === w - 1, maxY === h - 1].filter(Boolean).length;
  const touchesEdge = settings.removeBackground === "auto" && edges >= 1 && !warnings.includes("empty_subject");
  if (touchesEdge && !hadAlpha) warnings.push("subject_touches_edge");
  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;
  const subject = createRaster(sw, sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const p = (y + minY) * w + (x + minX);
      const a = alpha[p];
      const o = (y * sw + x) * 4;
      const i = p * 4;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) {
        // 半透明边缘：把混进来的背景色减掉。
        const value = !hadAlpha && a < 1 ? (data[i + c] - (1 - a) * bg[c]) / a : data[i + c];
        subject.data[o + c] = value;
      }
      subject.data[o + 3] = hadAlpha ? data[i + 3] : a * 255;
    }
  return { subject, report: { borderUniform: round(borderUniform), removed: round(removed), hadAlpha, touchesEdge, warnings } };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 把主体按设置放到指定尺寸的画布上（含阴影与背景）。 */
export function compose(subject: Raster, preset: { width: number; height: number; transparent?: boolean }, settings: Settings): Raster {
  const { width: W, height: H } = preset;
  const fill = Math.min(0.99, Math.max(0.2, settings.fill));
  const scale = Math.min((W * fill) / subject.width, (H * fill) / subject.height);
  const sw = Math.max(1, Math.round(subject.width * scale));
  const sh = Math.max(1, Math.round(subject.height * scale));
  const scaled = resize(subject, sw, sh);
  const x = Math.round((W - sw) / 2);
  let y = settings.align === "bottom" ? Math.round(H - (H - H * fill) / 2 - sh) : Math.round((H - sh) / 2);
  y += Math.round(settings.offsetY * H);

  const canvas = preset.transparent ? createRaster(W, H) : createRaster(W, H, [...parseColor(settings.background), 255]);
  const opacity = Math.min(1, Math.max(0, settings.shadowOpacity));
  if (settings.shadow !== "none" && opacity > 0) {
    const shadow = new Float32Array(W * H);
    if (settings.shadow === "ground") {
      // 地面椭圆柔影：位于主体底部。
      const cx = x + sw / 2;
      const cy = y + sh - Math.max(1, sh * 0.01);
      const rx = sw * 0.46;
      const ry = Math.max(3, sw * 0.05);
      for (let py = Math.max(0, Math.floor(cy - ry * 3)); py < Math.min(H, Math.ceil(cy + ry * 3)); py++)
        for (let px = Math.max(0, Math.floor(cx - rx * 1.6)); px < Math.min(W, Math.ceil(cx + rx * 1.6)); px++) {
          const d = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
          shadow[py * W + px] = Math.exp(-d * 1.6);
        }
    } else {
      // 投影：主体轮廓向下偏移并模糊。
      const dy = Math.round(sh * 0.025);
      for (let py = 0; py < sh; py++)
        for (let px = 0; px < sw; px++) {
          const ty = y + py + dy;
          const tx = x + px;
          if (tx >= 0 && tx < W && ty >= 0 && ty < H) shadow[ty * W + tx] = scaled.data[(py * sw + px) * 4 + 3] / 255;
        }
    }
    const blurred = settings.shadow === "drop" ? blurChannel(shadow, W, H, Math.max(2, Math.round(Math.min(W, H) * 0.012))) : shadow;
    const layer = createRaster(W, H);
    for (let p = 0; p < W * H; p++) layer.data[p * 4 + 3] = Math.min(1, blurred[p]) * opacity * 255;
    drawOver(canvas, layer, 0, 0);
  }
  drawOver(canvas, scaled, x, y);
  return canvas;
}

export function mergeSettings(base: Settings, overrides?: Partial<Settings>): Settings {
  const merged = { ...base, ...overrides } as Settings;
  merged.tolerance = clamp(Number(merged.tolerance) || DEFAULT_SETTINGS.tolerance, 1, 100);
  merged.fill = clamp(Number(merged.fill) || DEFAULT_SETTINGS.fill, 0.2, 0.99);
  merged.offsetY = clamp(Number(merged.offsetY) || 0, -0.4, 0.4);
  merged.shadowOpacity = clamp(Number(merged.shadowOpacity ?? DEFAULT_SETTINGS.shadowOpacity), 0, 1);
  if (!["auto", "off"].includes(merged.removeBackground)) merged.removeBackground = "auto";
  if (!["none", "ground", "drop"].includes(merged.shadow)) merged.shadow = "ground";
  if (!["center", "bottom"].includes(merged.align)) merged.align = "center";
  return merged;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
