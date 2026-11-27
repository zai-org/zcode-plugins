/** 小样表排版（单位：pt，原点在左上角） */
export const PAGES: Record<string, [number, number]> = { A4: [595.28, 841.89], A3: [841.89, 1190.55], Letter: [612, 792], Legal: [612, 1008] };
export const MM = 72 / 25.4;

export type SheetOpts = { page: string; landscape: boolean; cols: number; rows: number; margin: number; gap: number; header: boolean; captionLines: number; captionSize: number };
export type Cell = { x: number; y: number; w: number; h: number; capY: number };

export function pageSize(o: Pick<SheetOpts, "page" | "landscape">): [number, number] {
  const [w, h] = PAGES[o.page] ?? PAGES.A4;
  return o.landscape ? [h, w] : [w, h];
}

/** 一页的格子：图片框 + 下方说明文字的基线 */
export function grid(o: SheetOpts) {
  const [W, H] = pageSize(o);
  const m = o.margin * MM, g = o.gap * MM;
  const top = m + (o.header ? 28 : 0), bottom = m + 16;
  const capH = o.captionLines ? o.captionLines * o.captionSize * 1.3 + 4 : 0;
  const cw = (W - 2 * m - (o.cols - 1) * g) / o.cols;
  const ch = (H - top - bottom - (o.rows - 1) * g) / o.rows;
  const cells: Cell[] = [];
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
    const x = m + c * (cw + g), y = top + r * (ch + g);
    cells.push({ x, y, w: cw, h: Math.max(10, ch - capH), capY: y + ch - capH + o.captionSize + 2 });
  }
  return { W, H, cells, top, bottom: H - bottom + 10, margin: m };
}

/** 图片在框内的位置：contain = 完整显示（靠下，贴着说明文字），cover = 填满裁切 */
export function fit(img: { w: number; h: number }, box: { w: number; h: number }, mode: "contain" | "cover") {
  const k = mode === "cover" ? Math.max(box.w / img.w, box.h / img.h) : Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * k, h = img.h * k;
  return { w, h, dx: (box.w - w) / 2, dy: mode === "cover" ? (box.h - h) / 2 : box.h - h };
}

/** 说明文字模板：{name} {file} {n} {w} {h} {folder} {caption} */
export function caption(tpl: string, v: Record<string, string | number>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
}
