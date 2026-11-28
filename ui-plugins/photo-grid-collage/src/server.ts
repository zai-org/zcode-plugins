import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { decodeImage, encodeJpeg, encodePng, resize, type Raster } from "./kit/raster.ts";
import { escapeXml, renderSvg, wrapLines, type FontSet } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";
import { cells, cropBox, SLOTS, TEMPLATES, type Box } from "./layout.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "photo-grid-collage";
export const VERSION = "0.1.0";
const EXTS = [".jpg", ".jpeg", ".png"];
const FONT_ENV = "COLLAGE_FONT";
const SIZES: Record<string, [number, number]> = { square: [2048, 2048], portrait45: [1080, 1350], story: [1080, 1920], landscape: [1920, 1080], a4: [2480, 3508] };
const FOCUS = ["center", "top", "upper", "bottom", "left", "right"];

export function crop(img: Raster, b: { x: number; y: number; w: number; h: number }): Raster {
  const out = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    const src = ((b.y + y) * img.width + b.x) * 4;
    out.set(img.data.subarray(src, src + b.w * 4), y * b.w * 4);
  }
  return { width: b.w, height: b.h, data: out };
}

function canvasSize(p: Project): [number, number] {
  const k = s(p.settings.size) || "square";
  if (k === "custom") return [Math.max(200, Math.min(10000, Number(p.settings.width) || 2048)), Math.max(200, Math.min(10000, Number(p.settings.height) || 2048))];
  return SIZES[k] ?? SIZES.square;
}

/** 版面：标题区、内容区、每张图的格子。 */
export function plan(p: Project) {
  const [W, H] = canvasSize(p), unit = Math.min(W, H) / 1000;
  const margin = Math.round((Number(p.settings.margin ?? 30)) * unit), gap = Math.round(Number(p.settings.gap ?? 16) * unit);
  const title = s(p.settings.title), footer = s(p.settings.footer);
  const tSize = Math.round(56 * unit), fSize = Math.round(28 * unit);
  const top = margin + (title ? Math.round(tSize * 1.9) : 0), bottom = margin + (footer ? Math.round(fSize * 2) : 0);
  const box: Box = { x: margin, y: top, w: W - margin * 2, h: H - top - bottom };
  const photos = p.rows.map((r, i) => ({ r, i })).filter((x) => yes(x.r.include) && x.r._ok !== false).sort((a, b) => (Number(a.r.order) || 0) - (Number(b.r.order) || 0) || a.i - b.i);
  const tpl = s(p.settings.template) || "auto", slots = SLOTS[tpl];
  const used = slots ? photos.slice(0, slots) : photos;
  const cs = cells(tpl, box, used.length, gap, used.map((x) => (Number(x.r._w) || 1) / (Number(x.r._h) || 1)));
  return { W, H, unit, margin, gap, title, footer, tSize, fSize, box, tpl, slots, cells: cs, items: used.map((x, k) => ({ row: x.i, r: x.r, cell: cs[k] })), extra: photos.slice(used.length).map((x) => x.i), empty: slots ? Math.max(0, slots - used.length) : 0 };
}

function svg(p: Project, f: FontSet, images: Map<number, string>, preview = false) {
  const pl = plan(p), bg = s(p.settings.bg) || "#ffffff", fg = s(p.settings.textColor) || "#1f2937", rad = Math.round(Number(p.settings.radius ?? 0) * pl.unit);
  const fam = escapeXml(f.family), bold = escapeXml(f.boldFamily ?? f.family);
  const parts = [`<rect width="${pl.W}" height="${pl.H}" fill="${bg}"/>`];
  if (pl.title) parts.push(`<text x="${pl.W / 2}" y="${pl.margin + pl.tSize * 1.1}" font-family="${bold}" font-weight="700" font-size="${pl.tSize}" fill="${fg}" text-anchor="middle">${escapeXml(wrapLines(pl.title, pl.box.w, (t) => f.measure(t, pl.tSize, true), 1).lines[0])}</text>`);
  if (pl.footer) parts.push(`<text x="${pl.W / 2}" y="${pl.H - pl.margin - pl.fSize * 0.5}" font-family="${fam}" font-size="${pl.fSize}" fill="${fg}" fill-opacity="0.7" text-anchor="middle">${escapeXml(pl.footer)}</text>`);
  // 九宫格等固定格数不够时画空格。
  if (pl.empty) pl.cells.slice(pl.items.length).forEach((c) => parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${rad}" fill="${fg}" fill-opacity="0.08"/>`));
  pl.items.forEach((it, k) => {
    const c = it.cell; if (!c) return;
    const href = images.get(it.row);
    parts.push(`<clipPath id="c${k}"><rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.w.toFixed(1)}" height="${c.h.toFixed(1)}" rx="${rad}"/></clipPath>`);
    parts.push(href ? `<image x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.w.toFixed(1)}" height="${c.h.toFixed(1)}" href="${href}" preserveAspectRatio="${preview ? par(pl.tpl, s(it.r.focus)) : "none"}" clip-path="url(#c${k})"/>` : `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#cbd5e1"/>`);
    const cap = s(it.r.caption);
    if (cap && yes(p.settings.captions ?? true)) {
      const size = Math.max(12, Math.round(Math.min(c.w, c.h) * 0.06)), line = wrapLines(cap, c.w - size, (t) => f.measure(t, size, true), 1).lines[0];
      parts.push(`<g clip-path="url(#c${k})"><rect x="${c.x}" y="${c.y + c.h - size * 2}" width="${c.w}" height="${size * 2}" fill="#000" fill-opacity="0.42"/><text x="${c.x + size * 0.5}" y="${c.y + c.h - size * 0.62}" font-family="${bold}" font-weight="700" font-size="${size}" fill="#fff">${escapeXml(line)}</text></g>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pl.W}" height="${pl.H}" viewBox="0 0 ${pl.W} ${pl.H}">${parts.join("")}</svg>`;
}

/** 按格子裁切缩放好的图片（scale<1 用于预览）。 */
async function tileImages(p: Project, read: (f: string) => Promise<Uint8Array>, scale: number) {
  const pl = plan(p), out = new Map<number, string>();
  for (const it of pl.items) {
    const c = it.cell; if (!c) continue;
    const img = decodeImage(await read(s(it.r.file)), s(it.r.file));
    const fit = pl.tpl === "mosaic" ? { x: 0, y: 0, w: img.width, h: img.height } : cropBox(img.width, img.height, c.w / c.h, s(it.r.focus) || "center");
    const tw = Math.max(8, Math.round(c.w * scale)), th = Math.max(8, Math.round(c.h * scale));
    out.set(it.row, `data:image/jpeg;base64,${encodeJpeg(resize(crop(img, fit), tw, th), 90).toString("base64")}`);
  }
  return out;
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "collage",
    title: ["拼图海报", "Photo Grid Collage"],
    openDescription:
      "Arrange photos into a collage or grid poster. Pick JPEG/PNG photos or a folder. settings.template: auto (even grid), grid-2x2, grid-3x3 (九宫格, 9 slots), hero-2 (one big + 2), hero-3 (big on top + 3), hero-4 (big left + 4), mosaic (justified rows, no cropping), strip (one column). size: square (2048²), portrait45 (1080×1350), story (1080×1920), landscape (1920×1080), a4 (2480×3508 @300dpi) or custom width/height. gap, margin, radius (per-mille of the short side), bg, textColor, title, footer, captions (on/off). Each row is a photo: include, order (sort key, decides which slot), focus (center/top/upper/bottom/left/right — which part to keep when cropping), caption. Checks: unreadable/unsupported files, too few or too many photos for fixed templates, photos that will look blurry in their cell, heavy crops. Exports collage.png and collage.jpg.",
    inputs: { exts: EXTS, min: 1, max: 200, folders: true, label: ["选择照片或文件夹", "Pick photos or a folder"] },
    settings: [
      { key: "template", label: ["版式", "Template"], type: "select", default: "auto", options: [["auto", "自动网格", "Auto grid"], ["grid-2x2", "四宫格 2×2", "2×2 grid"], ["grid-3x3", "九宫格 3×3", "3×3 grid"], ["hero-2", "大图 + 2", "Hero + 2"], ["hero-3", "上大图 + 3", "Hero top + 3"], ["hero-4", "左大图 + 4", "Hero left + 4"], ["mosaic", "瀑布拼接（不裁切）", "Mosaic (no crop)"], ["strip", "竖条", "Strip"]].map(([v, z, e]) => ({ value: v, label: [z, e] as [string, string] })) },
      { key: "size", label: ["画布尺寸", "Canvas"], type: "select", default: "square", options: [["square", "方形 2048×2048", "Square 2048×2048"], ["portrait45", "竖版 4:5 1080×1350", "Portrait 4:5 1080×1350"], ["story", "竖屏 1080×1920", "Story 1080×1920"], ["landscape", "横版 1920×1080", "Landscape 1920×1080"], ["a4", "A4 海报 2480×3508", "A4 poster 2480×3508"], ["custom", "自定义", "Custom"]].map(([v, z, e]) => ({ value: v, label: [z, e] as [string, string] })) },
      { key: "width", label: ["自定义宽（像素）", "Custom width (px)"], type: "number", default: 2048, min: 200, max: 10000 },
      { key: "height", label: ["自定义高（像素）", "Custom height (px)"], type: "number", default: 2048, min: 200, max: 10000 },
      { key: "gap", label: ["间距（‰ 短边）", "Gap (‰ of short side)"], type: "number", default: 16, min: 0, max: 100 },
      { key: "margin", label: ["外边距（‰ 短边）", "Margin (‰ of short side)"], type: "number", default: 30, min: 0, max: 200 },
      { key: "radius", label: ["圆角（‰ 短边）", "Corner radius (‰)"], type: "number", default: 0, min: 0, max: 100 },
      { key: "bg", label: ["背景色", "Background"], type: "color", default: "#ffffff" },
      { key: "textColor", label: ["文字颜色", "Text colour"], type: "color", default: "#1f2937" },
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "footer", label: ["底部文字", "Footer"], type: "text", default: "" },
      { key: "captions", label: ["显示图片说明", "Show captions"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "include", label: ["使用", "Use"], type: "bool" },
      { key: "order", label: ["顺序", "Order"], type: "number" },
      { key: "file", label: ["照片", "Photo"], readOnly: true },
      { key: "size", label: ["尺寸", "Size"], readOnly: true },
      { key: "focus", label: ["裁切焦点", "Crop focus"], type: "select", options: FOCUS },
      { key: "caption", label: ["说明", "Caption"], wide: true },
      { key: "_slot", label: ["位置", "Slot"], readOnly: true },
    ] as Column[],
    async load({ ws, files, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [...EXTS, ".webp", ".heic"], limit: 500 })) list.push(x.path);
      }
      const uniq = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      if (!uniq.length) throw new KitError("no_files", "No JPEG/PNG photos found.");
      const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
      const thumbs: Record<string, string> = {};
      const rows: Row[] = [];
      for (const [i, f] of uniq.entries()) {
        let w = 0, h = 0, ok = true, err = "";
        try {
          const img = decodeImage(new Uint8Array(await ws.read(f, 200 * 1024 * 1024)), f);
          w = img.width; h = img.height;
          const k = 360 / Math.max(w, h);
          thumbs[f] = `data:image/jpeg;base64,${encodeJpeg(resize(img, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), 80).toString("base64")}`;
        } catch (e) { ok = false; err = (e instanceof Error ? e.message.replace(/^\[\w+\]\s*/, "") : String(e)).replace(`${f}: `, ""); }
        const o = prev.get(f);
        rows.push({ include: o?.include ?? ok, order: o?.order ?? i + 1, file: f, size: ok ? `${w}×${h}` : "unreadable", focus: o?.focus ?? "center", caption: o?.caption ?? "", _w: w, _h: h, _ok: ok, _err: err });
      }
      return { rows, meta: { thumbs } };
    },
    async compute(p): Promise<Computed> {
      const issues: Issue[] = [];
      const pl = plan(p);
      const slot = new Map(pl.items.map((it, k) => [it.row, k]));
      p.rows.forEach((r, i) => {
        if (r._ok === false) { issues.push({ level: "error", row: i, key: "file", message: `${s(r.file).split("/").pop()}: ${s(r._err) || "cannot be read"} — left out.` }); return; }
        if (s(r.focus) && !FOCUS.includes(s(r.focus))) issues.push({ level: "error", row: i, key: "focus", message: `Unknown focus “${s(r.focus)}” (use ${FOCUS.join(", ")}).` });
        const k = slot.get(i); if (k === undefined) return;
        const c = pl.items[k].cell, w = Number(r._w), h = Number(r._h);
        if (!c || !w) return;
        const cb = pl.tpl === "mosaic" ? { w, h } : cropBox(w, h, c.w / c.h, "center");
        if (cb.w < c.w * 0.8 || cb.h < c.h * 0.8) issues.push({ level: "warn", row: i, key: "size", message: `${s(r.file).split("/").pop()} (${w}×${h}) is small for its ${Math.round(c.w)}×${Math.round(c.h)} cell and will look blurry — give it a smaller slot (change order) or use a smaller canvas.` });
        const kept = (cb.w * cb.h) / (w * h);
        if (pl.tpl !== "mosaic" && kept < 0.55) issues.push({ level: "info", row: i, key: "focus", message: `${s(r.file).split("/").pop()} is ${h > w ? "portrait" : "landscape"} and its cell is ${c.h > c.w ? "tall" : "wide"}; only ${Math.round(kept * 100)}% of it is kept. Set focus (e.g. top for faces) or move it to another slot.` });
      });
      if (pl.empty) issues.push({ level: "warn", key: "template", message: `This template has ${pl.slots} slots but only ${pl.items.length} photo(s) are included — ${pl.empty} cell(s) will be empty.` });
      if (pl.extra.length) issues.push({ level: "warn", key: "template", message: `This template has ${pl.slots} slots; ${pl.extra.length} included photo(s) (${pl.extra.map((i) => s(p.rows[i].file).split("/").pop()).join(", ")}) will not be used. Untick some or pick another template.` });
      const f = await fontsFor(assetRoot, FONT_ENV);
      const thumbs = (p.meta.thumbs as Record<string, string>) ?? {};
      // 预览：直接用缩略图按格子裁（不精确裁切，用 slice）。
      const images = new Map<number, string>();
      for (const it of pl.items) if (thumbs[s(it.r.file)]) images.set(it.row, thumbs[s(it.r.file)]);
      const pv = svg(p, f, images, true);
      return {
        rows: p.rows.map((r, i) => ({ ...r, _slot: slot.has(i) ? String(slot.get(i)! + 1) : yes(r.include) && r._ok !== false ? "unused" : "" })),
        issues,
        summary: `${pl.items.length} photo(s) in a ${pl.tpl} collage, ${pl.W}×${pl.H}${pl.title ? `, title “${pl.title}”` : ""}.`,
        stats: { photos: pl.items.length, width: pl.W, height: pl.H },
        preview: `<div style="max-width:520px">${pv.replace("<svg ", '<svg style="width:100%;height:auto;box-shadow:0 2px 12px #0002" ')}</div>`,
      };
    },
    exports: [
      { id: "png", label: ["PNG", "PNG"], description: "collage.png", async run(ctx: ExportCtx) {
        const f = await fontsFor(ctx.assetRoot, FONT_ENV);
        const imgs = await tileImages(ctx.project, (x) => ctx.ws.read(x, 200 * 1024 * 1024).then((b) => new Uint8Array(b)), 1);
        const r = await renderSvg(svg(ctx.project, f, imgs), f);
        const name = stem(ctx.project);
        const files = [await ctx.write(`${name}.png`, r.png)];
        files.push(await ctx.write(`${name}.jpg`, encodeJpeg({ width: r.width, height: r.height, data: r.pixels }, 92, hexRgb(s(ctx.project.settings.bg) || "#ffffff"))));
        return files;
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.file)} ${s(r.size)} order=${s(r.order)} focus=${s(r.focus)}${s(r.caption) ? ` “${s(r.caption)}”` : ""}`,
  };
}

const par = (tpl: string, fc: string) => (tpl === "mosaic" ? "none" : `${fc === "left" ? "xMin" : fc === "right" ? "xMax" : "xMid"}${fc === "top" ? "YMin" : fc === "bottom" ? "YMax" : fc === "upper" ? "YMid" : "YMid"} slice`);
const hexRgb = (h: string): [number, number, number] => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0xffffff; return [n >> 16, (n >> 8) & 255, n & 255]; };
const stem = (p: Project) => (s(p.settings.title) || "collage").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
void encodePng;

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
export { TEMPLATES };
