import { createRaster, resize, type Raster } from "./kit/raster.ts";

export type Rect = [number, number, number, number];

/** "x,y,w,h"（图片宽高的百分比），多个用 ; 分隔。空 = []，格式错 = undefined。 */
export function parseRects(v: string): Rect[] | undefined {
  const t = v.trim();
  if (!t || /^(auto|自动|none|无)$/i.test(t)) return [];
  const out: Rect[] = [];
  for (const part of t.split(/[;；]/).map((x) => x.trim()).filter(Boolean)) {
    const n = part.split(/[,，\s]+/).filter(Boolean).map(Number);
    if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return undefined;
    out.push(n as Rect);
  }
  return out;
}
export const rectOk = ([x, y, w, h]: Rect) => x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100.5 && y + h <= 100.5;

export interface Step { title: string; text: string; box?: string; blur?: string; crop?: string }

/** 步骤文本：Markdown 的 ## 标题 / 编号行（1. / 1、/ 第1步）开始一步；“框: / 打码: / 裁剪:” 行写标注。 */
export function parseSteps(src: string): { title: string; steps: Step[] } {
  const lines = src.replace(/\r/g, "").split("\n");
  let title = "";
  const steps: Step[] = [];
  let cur: Step | undefined;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const h1 = /^#\s+(.+)$/.exec(l);
    if (h1 && !steps.length && !cur) { title = h1[1].trim(); continue; }
    const head = /^(?:#{2,6}\s+|(?:\d+)[.、)]\s*|第\s*\d+\s*步[:：]?\s*|step\s*\d+[:.]?\s*)(.+)$/i.exec(l);
    if (head) { cur = { title: head[1].trim(), text: "" }; steps.push(cur); continue; }
    const ann = /^(框|高亮|box|highlight|打码|模糊|blur|裁剪|crop)\s*[:：]\s*(.+)$/i.exec(l);
    if (ann && cur) {
      const k = /框|高亮|box|highlight/i.test(ann[1]) ? "box" : /打码|模糊|blur/i.test(ann[1]) ? "blur" : "crop";
      cur[k] = cur[k] ? `${cur[k]}; ${ann[2].trim()}` : ann[2].trim();
      continue;
    }
    if (!cur) { cur = { title: "", text: "" }; steps.push(cur); }
    cur.text = cur.text ? `${cur.text}\n${l}` : l;
  }
  return { title, steps };
}

const px = (r: Rect, w: number, h: number) => ({ x: Math.round((r[0] / 100) * w), y: Math.round((r[1] / 100) * h), w: Math.max(1, Math.round((r[2] / 100) * w)), h: Math.max(1, Math.round((r[3] / 100) * h)) });

export function crop(img: Raster, r: Rect): Raster {
  const { x, y, w, h } = px(r, img.width, img.height);
  const cw = Math.min(w, img.width - x), ch = Math.min(h, img.height - y), out = createRaster(cw, ch);
  for (let j = 0; j < ch; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + cw) * 4), j * cw * 4);
  return out;
}

/** 马赛克打码（不可还原：块内取平均色）。 */
export function pixelate(img: Raster, r: Rect) {
  const { x, y, w, h } = px(r, img.width, img.height), b = Math.max(8, Math.round(Math.min(img.width, img.height) / 50));
  for (let by = y; by < Math.min(img.height, y + h); by += b) for (let bx = x; bx < Math.min(img.width, x + w); bx += b) {
    const ex = Math.min(bx + b, x + w, img.width), ey = Math.min(by + b, y + h, img.height), sum = [0, 0, 0, 0];
    let n = 0;
    for (let yy = by; yy < ey; yy++) for (let xx = bx; xx < ex; xx++) { const i = (yy * img.width + xx) * 4; for (let c = 0; c < 4; c++) sum[c] += img.data[i + c]; n++; }
    for (let yy = by; yy < ey; yy++) for (let xx = bx; xx < ex; xx++) { const i = (yy * img.width + xx) * 4; for (let c = 0; c < 4; c++) img.data[i + c] = sum[c] / n; }
  }
}

/** 和上一张相比变化的区域（百分比）；整屏都变了或几乎没变返回 undefined。 */
export function changedRegion(a: Raster, b: Raster): { rect?: Rect; share: number } {
  const W = 160, H = Math.max(1, Math.round((b.height / b.width) * W));
  if (Math.abs(a.height / a.width - b.height / b.width) > 0.02) return { share: 1 };
  const ra = resize(a, W, H), rb = resize(b, W, H);
  const diff = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(ra.data[i * 4 + c] - rb.data[i * 4 + c]);
    diff[i] = d > 60 ? 1 : 0;
  }
  // 去掉孤立点：3×3 邻域里至少 3 个变化
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!diff[y * W + x]) continue;
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) k += diff[(y + dy) * W + x + dx];
    if (k < 3) continue;
    n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!n) return { share: 0 };
  const share = n / (W * H), pad = 1.5;
  const rect: Rect = [Math.max(0, (x0 / W) * 100 - pad), Math.max(0, (y0 / H) * 100 - pad), 0, 0];
  rect[2] = Math.min(100 - rect[0], ((x1 + 1 - x0) / W) * 100 + 2 * pad);
  rect[3] = Math.min(100 - rect[1], ((y1 + 1 - y0) / H) * 100 + 2 * pad);
  const area = (rect[2] * rect[3]) / 10000;
  return area > 0.4 ? { share: Math.max(share, area) } : { rect: rect.map((v) => Math.round(v * 10) / 10) as Rect, share };
}
