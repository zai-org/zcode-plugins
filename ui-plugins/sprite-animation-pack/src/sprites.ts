import { type Raster, createRaster } from "./kit/raster.ts";
import { KitError } from "./kit/workspace.ts";

export type AnchorMode = "auto" | "feet" | "center" | "keep";
export interface Region { x: number; y: number; w: number; h: number }
export interface Frame { source: string; region?: Region; duration: number; dx: number; dy: number }
export interface Action { name: string; frames: Frame[]; loop: boolean; anchor: AnchorMode }
export interface Project {
  version: 1;
  name: string;
  actions: Action[];
  scale: number;
  padding: number;
  background: string; // "none" | "auto" | "#rrggbb"：把纯色底变透明
  output: string;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "action";

export function normalizeProject(raw: any): { project: Project; warnings: string[] } {
  const warnings: string[] = [];
  const actions: Action[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(raw?.actions) ? raw.actions : []) {
    let name = slug(String(a?.name ?? ""));
    for (let k = 2; seen.has(name); k++) name = `${slug(String(a?.name ?? ""))}_${k}`;
    const fps = Number(a?.fps);
    const frames: Frame[] = (Array.isArray(a?.frames) ? a.frames : []).map((f: any) => {
      if (typeof f?.source !== "string" || !f.source) throw new KitError("bad_frame", `Action ${name}: every frame needs a source image.`);
      const r = f.region;
      const region = r && [r.x, r.y, r.w, r.h].every((v) => Number.isInteger(v) && v >= 0) && r.w > 0 && r.h > 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : undefined;
      const duration = Math.round(Number(f?.duration) || (fps > 0 ? 1000 / fps : 100));
      return { source: f.source, ...(region ? { region } : {}), duration: Math.max(10, Math.min(10_000, duration)), dx: Math.round(Number(f?.dx) || 0), dy: Math.round(Number(f?.dy) || 0) };
    });
    if (!frames.length) {
      warnings.push(`Action "${name}" has no frames — dropped.`);
      continue;
    }
    seen.add(name);
    actions.push({ name, frames, loop: a?.loop !== false, anchor: ["auto", "feet", "center", "keep"].includes(a?.anchor) ? a.anchor : "auto" });
  }
  if (!actions.length) throw new KitError("no_actions", "No actions with frames.");
  const bg = String(raw?.background ?? "auto");
  return {
    project: {
      version: 1,
      name: slug(String(raw?.name ?? "")) || "character",
      actions,
      scale: Math.max(1, Math.min(8, Math.round(Number(raw?.scale) || 1))),
      padding: Math.max(0, Math.min(16, Math.round(Number(raw?.padding ?? 1)))),
      background: bg === "none" || /^#[0-9a-f]{6}$/i.test(bg) ? bg.toLowerCase() : "auto",
      output: String(raw?.output ?? "").replace(/^\/+|\/+$/g, "") || "sprites",
    },
    warnings,
  };
}

export function crop(src: Raster, r: Region): Raster {
  const out = createRaster(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y;
    if (sy >= src.height) break;
    const from = (sy * src.width + r.x) * 4;
    const w = Math.max(0, Math.min(r.w, src.width - r.x));
    out.data.set(src.data.subarray(from, from + w * 4), y * r.w * 4);
  }
  return out;
}

/** 纯色底变透明：auto = 左上角像素不透明时用它的颜色。 */
export function keyBackground(img: Raster, mode: string): Raster {
  if (mode === "none") return img;
  let color: number[] | undefined;
  if (mode === "auto") {
    if (img.data[3] < 250) return img;
    color = [img.data[0], img.data[1], img.data[2]];
  } else color = [1, 3, 5].map((i) => parseInt(mode.slice(i, i + 2), 16));
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    if (Math.abs(out.data[i] - color[0]) + Math.abs(out.data[i + 1] - color[1]) + Math.abs(out.data[i + 2] - color[2]) <= 24) out.data[i + 3] = 0;
  }
  return out;
}

export interface Box { x0: number; y0: number; x1: number; y1: number } // x1/y1 不含
export function opaqueBox(img: Raster, threshold = 8): Box | undefined {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? undefined : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** 锚点：feet = 不透明像素的水平重心、贴着最低点；center = 包围盒中心；keep = 原画布底边中点（保持原位置，跳跃等动作用）。 */
export function anchorOf(img: Raster, box: Box, mode: Exclude<AnchorMode, "auto">): [number, number] {
  if (mode === "keep") return [Math.floor(img.width / 2), img.height];
  if (mode === "center") return [Math.round((box.x0 + box.x1) / 2), Math.round((box.y0 + box.y1) / 2)];
  // 水平方向用全部不透明像素的重心（躯干占主导，跑步时比脚的位置稳定），垂直方向贴着最低点
  let sum = 0, n = 0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > 8) {
        sum += x;
        n++;
      }
  return [n ? Math.round(sum / n + 0.5) : Math.round((box.x0 + box.x1) / 2), box.y1];
}

export interface Placed { action: string; index: number; name: string; img: Raster; box: Box; anchor: [number, number]; duration: number; x: number; y: number }
export interface Layout {
  cellW: number;
  cellH: number;
  pivot: [number, number]; // 像素（未缩放），在单元格内
  width: number;
  height: number;
  frames: Placed[];
  modes: Record<string, Exclude<AnchorMode, "auto">>;
  empty: string[];
}

/** 统一单元格：所有帧按锚点对齐到同一个点，单元格大小取所有帧的最大外扩；每个动作从新的一行开始。 */
export function layout(p: Project, load: (f: Frame) => Raster, maxWidth = 4096): Layout {
  const items: Omit<Placed, "x" | "y">[] = [];
  const modes: Layout["modes"] = {};
  const empty: string[] = [];
  for (const a of p.actions) {
    const imgs = a.frames.map((f) => load(f));
    // 同尺寸画布、且画布四周留有透明边（不是裁切过的）→ 原画已经对齐好，保持原位置
    const sameSize = imgs.every((i) => i.width === imgs[0].width && i.height === imgs[0].height);
    const padded = imgs.some((i) => {
      const b = opaqueBox(i);
      return !!b && (b.x0 > 0 || b.y0 > 0 || b.x1 < i.width || b.y1 < i.height);
    });
    const mode = a.anchor === "auto" ? (sameSize && padded && imgs.length > 1 ? "keep" : "feet") : a.anchor;
    modes[a.name] = mode;
    imgs.forEach((img, i) => {
      const f = a.frames[i];
      const name = `${a.name}_${String(i + 1).padStart(2, "0")}`;
      const box = opaqueBox(img) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
      if (!opaqueBox(img)) empty.push(name);
      const [ax, ay] = anchorOf(img, box, mode);
      items.push({ action: a.name, index: i, name, img, box, anchor: [ax - f.dx, ay - f.dy], duration: f.duration });
    });
  }
  let left = 0, right = 0, up = 0, down = 0;
  for (const it of items) {
    left = Math.max(left, it.anchor[0] - it.box.x0);
    right = Math.max(right, it.box.x1 - it.anchor[0]);
    up = Math.max(up, it.anchor[1] - it.box.y0);
    down = Math.max(down, it.box.y1 - it.anchor[1]);
  }
  // 左右对称，方便翻转朝向
  const half = Math.max(left, right);
  const cellW = 2 * half + 2 * p.padding;
  const cellH = up + down + 2 * p.padding;
  const cols = Math.max(1, Math.min(Math.max(...p.actions.map((a) => a.frames.length)), Math.floor(maxWidth / (cellW * p.scale))));
  const frames: Placed[] = [];
  let row = 0;
  for (const a of p.actions) {
    const list = items.filter((it) => it.action === a.name);
    list.forEach((it, i) => frames.push({ ...it, x: (i % cols) * cellW, y: (row + Math.floor(i / cols)) * cellH }));
    row += Math.ceil(list.length / cols);
  }
  return { cellW, cellH, pivot: [p.padding + half, p.padding + up], width: cols * cellW, height: row * cellH, frames, modes, empty };
}

/** 合成图集（未缩放）。 */
export function compose(l: Layout): Raster {
  const out = createRaster(l.width, l.height);
  for (const f of l.frames) {
    const ox = f.x + l.pivot[0] - f.anchor[0];
    const oy = f.y + l.pivot[1] - f.anchor[1];
    for (let y = f.box.y0; y < f.box.y1; y++)
      for (let x = f.box.x0; x < f.box.x1; x++) {
        const s = (y * f.img.width + x) * 4;
        if (!f.img.data[s + 3]) continue;
        const tx = ox + x, ty = oy + y;
        if (tx < f.x || ty < f.y || tx >= f.x + l.cellW || ty >= f.y + l.cellH) continue;
        out.data.set(f.img.data.subarray(s, s + 4), (ty * l.width + tx) * 4);
      }
  }
  return out;
}

/** 整数倍最近邻放大（像素画不糊）。 */
export function upscale(img: Raster, k: number): Raster {
  if (k === 1) return img;
  const out = createRaster(img.width * k, img.height * k);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  return out;
}

/** 按网格切整张精灵图：by = row 时每行一个动作，column 时每列一个动作；全透明的格子跳过。 */
export function sliceSheet(sheet: Raster, source: string, grid: { cols?: number; rows?: number; width?: number; height?: number }, by: "row" | "column", names: string[], background: string, fps: number) {
  let cw = grid.width ?? (grid.cols ? Math.floor(sheet.width / grid.cols) : undefined);
  let ch = grid.height ?? (grid.rows ? Math.floor(sheet.height / grid.rows) : undefined);
  if (!cw && !ch && sheet.width > sheet.height && sheet.width % sheet.height === 0) cw = ch = sheet.height; // 单行等宽条
  if (!cw && ch) cw = ch;
  if (!ch && cw) ch = cw;
  if (!cw || !ch) throw new KitError("need_grid", `${source} is ${sheet.width}×${sheet.height}. Pass grid: {width, height} (cell size in px) or {cols, rows}.`);
  const cols = Math.floor(sheet.width / cw);
  const rows = Math.floor(sheet.height / ch);
  const keyed = keyBackground(sheet, background);
  const lines = by === "row" ? rows : cols;
  const per = by === "row" ? cols : rows;
  const actions: Action[] = [];
  for (let l = 0; l < lines; l++) {
    const frames: Frame[] = [];
    for (let k = 0; k < per; k++) {
      const [c, r] = by === "row" ? [k, l] : [l, k];
      const region = { x: c * cw, y: r * ch, w: cw, h: ch };
      if (opaqueBox(crop(keyed, region))) frames.push({ source, region, duration: Math.round(1000 / fps), dx: 0, dy: 0 });
    }
    if (frames.length) actions.push({ name: names[actions.length] ?? `${by}${l + 1}`, frames, loop: true, anchor: "auto" });
  }
  return { actions, cell: [cw, ch] as [number, number], cols, rows };
}

/** 从文件名分组：子文件夹名，或去掉末尾编号后的名字（再去掉所有组共同的前缀）。 */
export function groupFiles(files: string[], fps: number): Action[] {
  const coll = new Intl.Collator(undefined, { numeric: true });
  const groups = new Map<string, string[]>();
  const sub = new Set(files.map((f) => f.split("/").slice(0, -1).join("/")));
  for (const f of [...files].sort(coll.compare)) {
    const parts = f.split("/");
    const stem = parts[parts.length - 1].replace(/\.[^.]+$/, "");
    const key = sub.size > 1 ? parts[parts.length - 2] ?? "default" : stem.replace(/[\s_.-]*\d+$/, "") || "default";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  let keys = [...groups.keys()];
  if (keys.length > 1) {
    let prefix = keys[0];
    for (const k of keys) while (!k.startsWith(prefix)) prefix = prefix.slice(0, -1);
    const cut = prefix.match(/^.*[\s_.-]/)?.[0] ?? "";
    if (cut && keys.every((k) => k.length > cut.length)) keys = keys.map((k) => k.slice(cut.length));
  }
  return [...groups.values()].map((list, i) => ({ name: keys[i], frames: list.map((source) => ({ source, duration: Math.round(1000 / fps), dx: 0, dy: 0 })), loop: true, anchor: "auto" }));
}
