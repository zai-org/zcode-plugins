import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFDocument, type PDFImage } from "pdf-lib";
import { createApp, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { decodeImage, encodeJpeg, fitWithin, type Raster } from "./kit/raster.ts";
import { newPdf } from "./kit/pdf.ts";
import { escapeXml, initRenderer, loadFonts, renderSvg } from "./kit/render.ts";
import { caption, fit, grid, PAGES, type SheetOpts } from "./sheet.ts";

export const NAME = "photo-contact-sheet";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".jpg", ".jpeg", ".png"];
const num = (v: unknown, d: number) => { const t = String(v ?? "").trim(); const n = Number(t); return t !== "" && Number.isFinite(n) ? n : d; };

function wasmPath(assetRoot: string) {
  const p = join(assetRoot, "resvg.wasm");
  return existsSync(p) ? p : createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}
const sheetOpts = (st: Record<string, unknown>): SheetOpts => ({
  page: s(st.page) in PAGES ? s(st.page) : "A4", landscape: s(st.orientation) === "landscape",
  cols: Math.round(Math.min(12, Math.max(1, num(st.cols, 4)))), rows: Math.round(Math.min(15, Math.max(1, num(st.rows, 5)))),
  margin: num(st.margin, 10), gap: num(st.gap, 4), header: !!s(st.title), captionLines: s(st.caption) ? 1 : 0, captionSize: num(st.captionSize, 7),
});
/** 按 order 列排序，排除未勾选 */
function ordered(p: Pick<Project, "rows">) {
  return p.rows.map((r, i) => ({ r, i })).filter((x) => x.r.include !== false && s(x.r.size) !== "unreadable").sort((a, b) => num(a.r.order, a.i + 1) - num(b.r.order, b.i + 1) || a.i - b.i);
}
const capFor = (st: Record<string, unknown>, r: Row, n: number) => {
  const file = s(r.file).split("/").pop()!;
  return caption(s(st.caption), { n, file, name: file.replace(/\.[^.]+$/, ""), w: Number(r._w), h: Number(r._h), folder: s(r.file).split("/").slice(-2, -1)[0] ?? "", caption: s(r.caption) || file.replace(/\.[^.]+$/, "") });
};

/** 每张图缩到格子需要的像素（按 dpi），减小 PDF 体积 */
const thumbCache = new Map<string, { jpg: Uint8Array; w: number; h: number }>();
async function thumb(ws: Workspace, file: string, maxPx: number) {
  const k = `${file}@${maxPx}`;
  if (!thumbCache.has(k)) {
    const img = decodeImage(new Uint8Array(await ws.read(file, 200 * 1024 * 1024)), file);
    const t = fitWithin(img, maxPx);
    thumbCache.set(k, { jpg: new Uint8Array(encodeJpeg(t, 85, [255, 255, 255])), w: t.width, h: t.height });
  }
  return thumbCache.get(k)!;
}

/** 整页 SVG（用于 JPG 和面板预览），图片用 data URI */
async function pageSvg(ws: Workspace, st: Record<string, unknown>, items: { r: Row }[], pageNo: number, pages: number, family: string, scale: number, startN: number) {
  const o = sheetOpts(st), g = grid(o), dark = s(st.background) === "black";
  const fg = dark ? "#e5e7eb" : "#111827", sub = dark ? "#9ca3af" : "#6b7280";
  const mode = s(st.fit) === "cover" ? "cover" : "contain";
  const parts: string[] = [];
  for (const [k, { r }] of items.entries()) {
    const c = g.cells[k];
    const t = await thumb(ws, s(r.file), Math.round(Math.max(c.w, c.h) * scale * 1.2));
    const f = fit({ w: t.w, h: t.h }, c, mode);
    const clip = `c${k}`;
    parts.push(`<clipPath id="${clip}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/></clipPath><image clip-path="url(#${clip})" x="${c.x + f.dx}" y="${c.y + f.dy}" width="${f.w}" height="${f.h}" preserveAspectRatio="none" href="data:image/jpeg;base64,${Buffer.from(t.jpg).toString("base64")}"/>`);
    if (o.captionLines) parts.push(`<text x="${c.x + c.w / 2}" y="${c.capY}" font-size="${o.captionSize}" text-anchor="middle" fill="${fg}" font-family="${escapeXml(family)}">${escapeXml(clipText(capFor(st, r, startN + k), c.w, o.captionSize))}</text>`);
  }
  const head = o.header ? `<text x="${g.margin}" y="${g.margin + 14}" font-size="14" font-weight="700" fill="${fg}" font-family="${escapeXml(family)}">${escapeXml(s(st.title))}</text>` : "";
  const foot = `<text x="${g.W - g.margin}" y="${g.H - g.margin}" font-size="7" text-anchor="end" fill="${sub}" font-family="${escapeXml(family)}">${pageNo} / ${pages}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}"><rect width="${g.W}" height="${g.H}" fill="${dark ? "#111111" : "#ffffff"}"/>${head}${parts.join("")}${foot}</svg>`;
}
/** 说明文字按宽度粗略截断（中文约 1 em，英文约 0.55 em） */
function clipText(t: string, w: number, size: number) {
  let width = 0, out = "";
  for (const ch of t) { width += /[\u2e80-\uffff]/.test(ch) ? size : size * 0.56; if (width > w) return out.slice(0, -1) + "…"; out += ch; }
  return out;
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "contact",
    title: ["照片小样表", "Photo Contact Sheet"],
    openDescription:
      "Lay out a folder of JPEG/PNG photos as a printable contact sheet: a PDF (and one JPG per page) with a grid of thumbnails and captions. Each photo is a row: include, order (sort key), caption (used by {caption}). Settings: title (page header; blank = none), page (A4/A3/Letter/Legal), orientation, cols, rows, margin and gap (mm), fit (contain = whole photo, cover = fill and crop), caption template ({n} {file} {name} {caption} {w} {h} {folder}; blank = no captions), captionSize (pt), background (white/black), dpi for the JPG pages. Exports contact-sheet.pdf, contact-sheet-<page>.jpg and contact-sheet.csv (number, file, page, caption).",
    inputs: { exts: EXTS, min: 1, max: 5000, folders: true, label: ["选择照片或文件夹", "Pick photos or a folder"] },
    settings: [
      { key: "title", label: ["标题（留空不显示）", "Title (blank = none)"], type: "text", default: "" },
      { key: "page", label: ["纸张", "Page size"], type: "select", default: "A4", options: Object.keys(PAGES).map((k) => ({ value: k, label: [k, k] as [string, string] })) },
      { key: "orientation", label: ["方向", "Orientation"], type: "select", default: "portrait", options: [{ value: "portrait", label: ["纵向", "Portrait"] }, { value: "landscape", label: ["横向", "Landscape"] }] },
      { key: "cols", label: ["每行张数", "Columns"], type: "number", default: 4, min: 1, max: 12 },
      { key: "rows", label: ["每页行数", "Rows"], type: "number", default: 5, min: 1, max: 15 },
      { key: "fit", label: ["缩放方式", "Fit"], type: "select", default: "contain", options: [{ value: "contain", label: ["完整显示", "Whole photo"] }, { value: "cover", label: ["填满裁切", "Fill and crop"] }] },
      { key: "caption", label: ["说明文字（{n} {file} {name} {caption} {w} {h}）", "Caption ({n} {file} {name} {caption} {w} {h})"], type: "text", default: "{n}. {file}" },
      { key: "captionSize", label: ["说明字号（pt）", "Caption size (pt)"], type: "number", default: 7, min: 4, max: 24 },
      { key: "margin", label: ["页边距（mm）", "Margin (mm)"], type: "number", default: 10, min: 0, max: 50 },
      { key: "gap", label: ["间距（mm）", "Gap (mm)"], type: "number", default: 4, min: 0, max: 30 },
      { key: "background", label: ["背景", "Background"], type: "select", default: "white", options: [{ value: "white", label: ["白色", "White"] }, { value: "black", label: ["黑色", "Black"] }] },
      { key: "dpi", label: ["JPG 分辨率（dpi）", "JPG resolution (dpi)"], type: "number", default: 150, min: 50, max: 300 },
    ],
    columns: () => [
      { key: "include", label: ["收录", "Include"], type: "bool" },
      { key: "order", label: ["顺序", "Order"], type: "number" },
      { key: "file", label: ["照片", "Photo"], readOnly: true },
      { key: "size", label: ["尺寸", "Size"], readOnly: true },
      { key: "caption", label: ["说明", "Caption"] },
      { key: "page", label: ["页", "Page"], readOnly: true },
    ] as Column[],
    async load({ ws, files, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 5000 })) list.push(x.path);
      }
      const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      if (!uniq.length) throw new KitError("no_files", "No JPEG/PNG photos found.");
      const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
      const rows: Row[] = [];
      for (const [i, f] of uniq.entries()) {
        let size = "unreadable", w = 0, h = 0;
        try { const im = decodeImage(new Uint8Array(await ws.read(f, 200 * 1024 * 1024)), f); w = im.width; h = im.height; size = `${w}×${h}`; } catch { /* 标记为无法读取 */ }
        const old = prev.get(f);
        rows.push({ include: old?.include ?? size !== "unreadable", order: old?.order ?? i + 1, file: f, size, caption: old?.caption ?? "", _w: w, _h: h });
      }
      return { rows };
    },
    async compute(p, ctx): Promise<Computed> {
      const issues: Issue[] = [];
      const o = sheetOpts(p.settings);
      const per = o.cols * o.rows;
      const list = ordered(p);
      const pageOf = new Map(list.map((x, k) => [x.i, Math.floor(k / per) + 1]));
      p.rows.forEach((r, i) => { if (s(r.size) === "unreadable") issues.push({ level: "warn", row: i, message: `${s(r.file)} can't be read (not a valid JPEG/PNG) — left out / 无法读取，已跳过` }); });
      const g = grid(o);
      if (g.cells[0].h < 30) issues.push({ level: "warn", message: `Thumbnails would be only ${(g.cells[0].h / (72 / 25.4)).toFixed(0)} mm tall — use fewer rows or a bigger page / 缩略图太小` });
      const orders = new Map<number, number>();
      p.rows.forEach((r, i) => { const n = num(r.order, NaN); if (r.include !== false && Number.isFinite(n)) { if (orders.has(n)) issues.push({ level: "info", row: i, key: "order", message: `Rows ${orders.get(n)} and ${i} share order ${n} — kept in list order / 顺序号重复` }); orders.set(n, i); } });
      const pages = Math.max(1, Math.ceil(list.length / per));
      let preview = "";
      try {
        await initRenderer(wasmPath(assetRoot));
        const fonts = await loadFonts(process.env.CONTACT_SHEET_FONT);
        const svg = await pageSvg(ctx.ws, p.settings, list.slice(0, per), 1, pages, fonts.family, 1, 1);
        const png = await renderSvg(svg, fonts, 520);
        preview = `<img src="data:image/png;base64,${Buffer.from(png.png).toString("base64")}" style="width:100%;max-width:520px;border:1px solid #e5e7eb;border-radius:4px"><p class="muted" style="font-size:12px">Page 1 of ${pages} · 第 1 页，共 ${pages} 页</p>`;
      } catch (e) { issues.push({ level: "warn", message: `Preview failed: ${(e as Error).message}` }); }
      return {
        rows: p.rows.map((r, i) => ({ ...r, page: pageOf.get(i) ?? "" })),
        issues,
        summary: `${list.length} of ${p.rows.length} photo(s) on ${pages} ${o.page} page(s), ${o.cols} × ${o.rows} per page. ${list.length} 张照片，${pages} 页。`,
        stats: { photos: list.length, excluded: p.rows.length - list.length, pages, perPage: per },
        preview,
      };
    },
    exports: [
      {
        id: "pdf", label: ["小样表 PDF", "Contact sheet PDF"], description: "contact-sheet.pdf — thumbnails with captions, page numbers and optional title",
        async run({ project, write, ws }: ExportCtx) {
          const st = project.settings, o = sheetOpts(st), g = grid(o), list = ordered(project), per = o.cols * o.rows;
          if (!list.length) throw new KitError("nothing", "No photos included.");
          const kit = await newPdf(process.env.CONTACT_SHEET_FONT);
          const doc: PDFDocument = kit.doc;
          doc.setTitle(s(st.title) || "Contact sheet");
          const dark = s(st.background) === "black", fg = dark ? "#e5e7eb" : "#111827";
          const mode = s(st.fit) === "cover" ? "cover" : "contain";
          const pages = Math.ceil(list.length / per);
          for (let pg = 0; pg < pages; pg++) {
            const page = doc.addPage([g.W, g.H]);
            if (dark) page.drawRectangle({ x: 0, y: 0, width: g.W, height: g.H, color: rgb(0.067, 0.067, 0.067) });
            if (o.header) kit.text(page, s(st.title), g.margin, g.H - g.margin - 14, { size: 14, bold: true, color: fg, maxWidth: g.W - 2 * g.margin - 60 });
            kit.text(page, `${pg + 1} / ${pages}`, g.W - g.margin, g.margin - 7, { size: 7, color: dark ? "#9ca3af" : "#6b7280", align: "right" });
            for (const [k, { r }] of list.slice(pg * per, pg * per + per).entries()) {
              const c = g.cells[k];
              // 按 200 dpi 准备缩略图
              const t = await thumb(ws, s(r.file), Math.round((Math.max(c.w, c.h) / 72) * 200 * (mode === "cover" ? 1.6 : 1)));
              const img: PDFImage = await doc.embedJpg(t.jpg);
              const f = fit({ w: t.w, h: t.h }, c, mode);
              const yTop = g.H - c.y; // pdf 坐标从下往上
              if (mode === "cover") {
                page.pushOperators(pushGraphicsState(), rectangle(c.x, yTop - c.h, c.w, c.h), clip(), endPath());
                page.drawImage(img, { x: c.x + f.dx, y: yTop - f.dy - f.h, width: f.w, height: f.h });
                page.pushOperators(popGraphicsState());
              } else page.drawImage(img, { x: c.x + f.dx, y: yTop - f.dy - f.h, width: f.w, height: f.h });
              if (o.captionLines) kit.text(page, capFor(st, r, pg * per + k + 1), c.x + c.w / 2, g.H - c.capY, { size: o.captionSize, color: fg, align: "center", maxWidth: c.w });
            }
          }
          return [await write("contact-sheet.pdf", await doc.save())];
        },
      },
      {
        id: "jpg", label: ["每页 JPG", "JPG per page"], description: "contact-sheet-<page>.jpg — each page as a JPEG at the chosen dpi",
        async run({ project, write, ws }: ExportCtx) {
          const st = project.settings, o = sheetOpts(st), list = ordered(project), per = o.cols * o.rows;
          if (!list.length) throw new KitError("nothing", "No photos included.");
          await initRenderer(wasmPath(assetRoot));
          const fonts = await loadFonts(process.env.CONTACT_SHEET_FONT);
          const dpi = num(st.dpi, 150), pages = Math.ceil(list.length / per), g = grid(o);
          const out: string[] = [];
          for (let pg = 0; pg < pages; pg++) {
            const svg = await pageSvg(ws, st, list.slice(pg * per, pg * per + per), pg + 1, pages, fonts.family, dpi / 72, pg * per + 1);
            const png = await renderSvg(svg, fonts, Math.round((g.W / 72) * dpi));
            const raster: Raster = decodeImage(png.png, "page");
            out.push(await write(`contact-sheet-${pg + 1}.jpg`, encodeJpeg(raster, 88)));
          }
          return out;
        },
      },
      {
        id: "csv", label: ["清单 CSV", "List (CSV)"], description: "contact-sheet.csv — number, file, page, caption, size",
        async run({ project, write }: ExportCtx) {
          const o = sheetOpts(project.settings), per = o.cols * o.rows;
          return [await write("contact-sheet.csv", toCsv(["number", "file", "page", "caption", "size"], ordered(project).map(({ r }, k) => [k + 1, s(r.file), Math.floor(k / per) + 1, capFor(project.settings, r, k + 1), s(r.size).replace("×", "x")])))];
        },
      },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [out]" : ""} order ${s(r.order)} ${s(r.file)} ${s(r.size)}${s(r.caption) ? ` “${s(r.caption)}”` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
