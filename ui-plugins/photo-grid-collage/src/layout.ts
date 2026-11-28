/** 拼图版式：返回每个格子的像素矩形。 */
export interface Cell { x: number; y: number; w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }

export const TEMPLATES = ["auto", "grid-2x2", "grid-3x3", "hero-2", "hero-3", "hero-4", "mosaic", "strip"] as const;
export const SLOTS: Record<string, number | undefined> = { "grid-2x2": 4, "grid-3x3": 9, "hero-2": 3, "hero-3": 4, "hero-4": 5 };

function grid(b: Box, cols: number, rows: number, gap: number, n = cols * rows): Cell[] {
  const cw = (b.w - gap * (cols - 1)) / cols, ch = (b.h - gap * (rows - 1)) / rows, out: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    if (inRow <= 0) break;
    // 最后一行不满时把格子拉宽铺满。
    const w = inRow < cols ? (b.w - gap * (inRow - 1)) / inRow : cw;
    for (let c = 0; c < inRow; c++) out.push({ x: b.x + c * (w + gap), y: b.y + r * (ch + gap), w, h: ch });
  }
  return out;
}

/** 按宽高比排成等高行（不裁切）。 */
export function mosaic(b: Box, aspects: number[], gap: number): Cell[] {
  if (!aspects.length) return [];
  const target = b.h / Math.max(1, Math.round(Math.sqrt((aspects.length * b.h) / b.w / 1.3)));
  const rows: number[][] = [];
  let cur: number[] = [], sum = 0;
  aspects.forEach((a, i) => { cur.push(i); sum += a; if ((b.w - gap * (cur.length - 1)) / sum <= target) { rows.push(cur); cur = []; sum = 0; } });
  if (cur.length) rows.push(cur);
  const hs = rows.map((r) => (b.w - gap * (r.length - 1)) / r.reduce((x, i) => x + aspects[i], 0));
  const total = hs.reduce((x, h) => x + h, 0) + gap * (rows.length - 1), k = Math.min(1, b.h / total);
  const out: Cell[] = new Array(aspects.length);
  let y = b.y + Math.max(0, (b.h - (total * k)) / 2);
  rows.forEach((r, ri) => {
    const h = hs[ri] * k, rowW = r.reduce((x, i) => x + aspects[i] * h, 0) + gap * (r.length - 1);
    let x = b.x + (b.w - rowW) / 2;
    for (const i of r) { out[i] = { x, y, w: aspects[i] * h, h }; x += aspects[i] * h + gap; }
    y += h + gap;
  });
  return out;
}

export function cells(template: string, b: Box, n: number, gap: number, aspects: number[]): Cell[] {
  const g = gap;
  switch (template) {
    case "grid-2x2": return grid(b, 2, 2, g);
    case "grid-3x3": return grid(b, 3, 3, g);
    case "hero-2": { const bw = (b.w - g) * 0.62; return [{ x: b.x, y: b.y, w: bw, h: b.h }, ...grid({ x: b.x + bw + g, y: b.y, w: b.w - bw - g, h: b.h }, 1, 2, g)]; }
    case "hero-3": { const bh = (b.h - g) * 0.6; return [{ x: b.x, y: b.y, w: b.w, h: bh }, ...grid({ x: b.x, y: b.y + bh + g, w: b.w, h: b.h - bh - g }, 3, 1, g)]; }
    case "hero-4": { const bw = (b.w - g) / 2; return [{ x: b.x, y: b.y, w: bw, h: b.h }, ...grid({ x: b.x + bw + g, y: b.y, w: b.w - bw - g, h: b.h }, 2, 2, g)]; }
    case "mosaic": return mosaic(b, aspects, g);
    case "strip": return grid(b, 1, Math.max(1, n), g);
    default: {
      // 自动：行数按画布比例估算，每行张数尽量平均（7 张 → 3/2/2）。
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * (b.w / b.h)))), rows = Math.max(1, Math.ceil(n / cols));
      const per = Math.floor(n / rows), extra = n % rows, rh = (b.h - g * (rows - 1)) / rows, out: Cell[] = [];
      for (let r = 0; r < rows; r++) {
        const k = per + (r < extra ? 1 : 0), w = (b.w - g * (k - 1)) / k;
        for (let c = 0; c < k; c++) out.push({ x: b.x + c * (w + g), y: b.y + r * (rh + g), w, h: rh });
      }
      return out;
    }
  }
}

/** 按焦点把图片裁成目标宽高比，返回源图里的裁切框。 */
export function cropBox(w: number, h: number, aspect: number, focus: string) {
  if (w / h > aspect) {
    const cw = h * aspect, free = w - cw;
    const x = focus === "left" ? 0 : focus === "right" ? free : free / 2;
    return { x: Math.round(x), y: 0, w: Math.round(cw), h };
  }
  const ch = w / aspect, free = h - ch;
  const y = focus === "top" ? 0 : focus === "bottom" ? free : focus === "upper" ? free * 0.25 : free / 2;
  return { x: 0, y: Math.round(y), w, h: Math.round(ch) };
}
