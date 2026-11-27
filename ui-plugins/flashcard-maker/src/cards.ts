// 单词卡排版：网格、双面对齐、字号自适应（纯函数，便于测试）
export const MM = 72 / 25.4;
export const PAGES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;
export type Grid = { cols: number; rows: number };
export const GRIDS: Record<string, Grid> = { "2x4": { cols: 2, rows: 4 }, "2x5": { cols: 2, rows: 5 }, "3x3": { cols: 3, rows: 3 }, "3x4": { cols: 3, rows: 4 }, "3x6": { cols: 3, rows: 6 }, "4x6": { cols: 4, rows: 6 } };

export interface Slot { x: number; y: number; w: number; h: number }

/** 一页上的卡片位置（PDF 坐标，左下原点），按行从左到右、从上到下。 */
export function slots(page: readonly [number, number], grid: Grid, marginMm = 10): Slot[] {
  const [W, H] = page, m = marginMm * MM;
  const w = (W - 2 * m) / grid.cols, h = (H - 2 * m) / grid.rows;
  const out: Slot[] = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) out.push({ x: m + c * w, y: H - m - (r + 1) * h, w, h });
  return out;
}

/**
 * 背面第 i 张卡放在哪个格子，使双面打印后正反面对齐。
 * long：沿长边翻（普通双面）→ 每行左右镜像；short：沿短边翻 → 上下镜像。
 */
export function backIndex(i: number, grid: Grid, flip: "long" | "short"): number {
  const r = Math.floor(i / grid.cols), c = i % grid.cols;
  return flip === "short" ? (grid.rows - 1 - r) * grid.cols + c : r * grid.cols + (grid.cols - 1 - c);
}

/** 正面页、背面页交替：[{side, cards: [卡片序号…]}]。 */
export function plan(n: number, grid: Grid, duplex: boolean): { side: "front" | "back"; cards: number[] }[] {
  const per = grid.cols * grid.rows, out: { side: "front" | "back"; cards: number[] }[] = [];
  for (let s = 0; s < n; s += per) {
    const cards = Array.from({ length: Math.min(per, n - s) }, (_, k) => s + k);
    out.push({ side: "front", cards });
    if (duplex) out.push({ side: "back", cards });
  }
  return out;
}

/** 选最大的字号，使文字在宽 w、高 h 内放下。wrapFn 返回折行。 */
export function fit(text: string, w: number, h: number, maxSize: number, minSize: number, wrapFn: (t: string, size: number, w: number) => string[], lineGap = 1.25): { size: number; lines: string[]; overflow: boolean } {
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lines = wrapFn(text, size, w);
    if (lines.length * size * lineGap <= h) return { size, lines, overflow: false };
  }
  const lines = wrapFn(text, minSize, w), max = Math.max(1, Math.floor(h / (minSize * lineGap)));
  return { size: minSize, lines: lines.slice(0, max), overflow: lines.length > max };
}

/** Anki 等导入：TSV，字段内换行变 <br>，制表符换空格。 */
export const tsvCell = (s: string) => String(s ?? "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
