/** 水印位置计算（纯函数） */
export const POSITIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right", "tile"] as const;
export type Position = (typeof POSITIONS)[number];
export const POS_ZH: Record<Position, string> = { "top-left": "左上", top: "上中", "top-right": "右上", left: "左中", center: "正中", right: "右中", "bottom-left": "左下", bottom: "下中", "bottom-right": "右下", tile: "平铺" };

/** 支持中文写法：右下、左上、平铺… */
export function parsePosition(v: unknown, fallback: Position): Position {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if ((POSITIONS as readonly string[]).includes(s)) return s as Position;
  const zh = (Object.entries(POS_ZH) as [Position, string][]).find(([, z]) => z === s || (s.length === 2 && z.includes(s)));
  if (zh) return zh[0];
  const alias: Record<string, Position> = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right", c: "center", middle: "center", 中: "center", 中间: "center", 居中: "center", 右下角: "bottom-right", 左下角: "bottom-left", 右上角: "top-right", 左上角: "top-left" };
  return alias[s] ?? fallback;
}

/**
 * 单个水印左上角坐标。margin、dx、dy 都是相对图片短边的百分比，
 * dx 向右、dy 向下为正。
 */
export function place(img: { w: number; h: number }, mark: { w: number; h: number }, pos: Position, marginPct: number, dxPct = 0, dyPct = 0) {
  const short = Math.min(img.w, img.h);
  const m = (short * marginPct) / 100;
  const col = /left$/.test(pos) ? 0 : /right$/.test(pos) ? 2 : 1;
  const row = /^top/.test(pos) ? 0 : /^bottom/.test(pos) ? 2 : 1;
  const x = col === 0 ? m : col === 2 ? img.w - mark.w - m : (img.w - mark.w) / 2;
  const y = row === 0 ? m : row === 2 ? img.h - mark.h - m : (img.h - mark.h) / 2;
  return { x: Math.round(x + (short * dxPct) / 100), y: Math.round(y + (short * dyPct) / 100) };
}

/** 平铺：按水印尺寸加间距排成交错网格，覆盖整张图 */
export function tiles(img: { w: number; h: number }, mark: { w: number; h: number }, gapPct: number) {
  const gap = (Math.min(img.w, img.h) * gapPct) / 100;
  const sx = mark.w + gap, sy = mark.h + gap;
  const out: { x: number; y: number }[] = [];
  let r = 0;
  for (let y = -mark.h / 2; y < img.h; y += sy, r++) for (let x = (r % 2 ? -sx / 2 : 0) - mark.w / 2; x < img.w; x += sx) out.push({ x: Math.round(x), y: Math.round(y) });
  return out;
}

/** 文字水印字号（px）：短边的百分比；Logo 宽度：图片宽度的百分比 */
export const textSize = (img: { w: number; h: number }, pct: number) => Math.max(8, Math.round((Math.min(img.w, img.h) * pct) / 100));
export const logoWidth = (img: { w: number; h: number }, pct: number) => Math.max(8, Math.round((img.w * pct) / 100));
