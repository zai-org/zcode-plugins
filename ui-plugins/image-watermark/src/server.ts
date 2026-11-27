import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Row } from "./kit/app.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { decodeImage, drawOver, encodeJpeg, encodePng, fitWithin, resize, type Raster } from "./kit/raster.ts";
import { escapeXml, initRenderer, loadFonts, renderSvg } from "./kit/render.ts";
import { logoWidth, parsePosition, place, POS_ZH, POSITIONS, textSize, tiles } from "./layout.ts";

export const NAME = "image-watermark";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".jpg", ".jpeg", ".png"];
const num = (v: unknown, d: number) => { const t = String(v ?? "").trim(); const n = Number(t); return t !== "" && Number.isFinite(n) ? n : d; };
const HEX = /^#?[0-9a-f]{6}$/i;

function wasmPath(assetRoot: string) {
  const p = join(assetRoot, "resvg.wasm");
  return existsSync(p) ? p : createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}

type Opts = { mode: "text" | "logo" | "both"; text: string; color: string; shadow: boolean; textPct: number; logoPct: number; opacity: number; margin: number; angle: number; gap: number; quality: number };
const opts = (st: Record<string, unknown>): Opts => ({
  mode: (s(st.mode) || "text") as Opts["mode"], text: String(st.text ?? ""), color: HEX.test(s(st.color)) ? `#${s(st.color).replace("#", "")}` : "#ffffff", shadow: st.shadow !== false,
  textPct: num(st.textSize, 4), logoPct: num(st.logoSize, 15), opacity: Math.min(1, Math.max(0.02, num(st.opacity, 0.6))), margin: num(st.margin, 3), angle: num(st.angle, -30), gap: num(st.gap, 8), quality: num(st.quality, 90),
});

/** 文字印章：SVG 渲染成透明 PNG（可旋转） */
async function textStamp(text: string, px: number, o: Opts, angle: number, assetRoot: string): Promise<Raster> {
  await initRenderer(wasmPath(assetRoot));
  const fonts = await loadFonts(process.env.IMAGE_WATERMARK_FONT);
  const lines = text.split(/\\n|\n/);
  const lh = px * 1.25;
  const w = Math.ceil(Math.max(...lines.map((l) => fonts.measure(l, px, true))) + px * 0.6), h = Math.ceil(lh * lines.length + px * 0.4);
  const rad = (angle * Math.PI) / 180, cw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))), ch = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
  const t = (dx: number, dy: number, fill: string, op: number) => lines.map((l, i) => `<text x="${w / 2 + dx}" y="${px * 0.2 + lh * i + px * 0.95 + dy}" font-size="${px}" font-family="${escapeXml(fonts.boldFamily ?? fonts.family)}" font-weight="700" text-anchor="middle" fill="${fill}" fill-opacity="${op}">${escapeXml(l)}</text>`).join("");
  const off = Math.max(1, px * 0.06);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><g transform="translate(${cw / 2} ${ch / 2}) rotate(${angle}) translate(${-w / 2} ${-h / 2})">${o.shadow ? t(off, off, "#000000", 0.45) : ""}${t(0, 0, o.color, 1)}</g></svg>`;
  const png = await renderSvg(svg, fonts);
  return decodeImage(png.png, "watermark");
}

/** 双线性旋转（透明背景） */
export function rotate(img: Raster, angle: number): Raster {
  if (!angle) return img;
  const rad = (angle * Math.PI) / 180, c = Math.cos(rad), sn = Math.sin(rad);
  const W = Math.ceil(Math.abs(img.width * c) + Math.abs(img.height * sn)), H = Math.ceil(Math.abs(img.width * sn) + Math.abs(img.height * c));
  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const px = (x: number, y: number, k: number) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + k]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ux = (x + 0.5 - W / 2) * c + (y + 0.5 - H / 2) * sn + img.width / 2 - 0.5, uy = -(x + 0.5 - W / 2) * sn + (y + 0.5 - H / 2) * c + img.height / 2 - 0.5;
    const ix = Math.floor(ux), iy = Math.floor(uy), fx = ux - ix, fy = uy - iy;
    if (ix < -1 || iy < -1 || ix >= img.width || iy >= img.height) continue;
    const w00 = (1 - fx) * (1 - fy) * px(ix, iy, 3), w10 = fx * (1 - fy) * px(ix + 1, iy, 3), w01 = (1 - fx) * fy * px(ix, iy + 1, 3), w11 = fx * fy * px(ix + 1, iy + 1, 3);
    const a = w00 + w10 + w01 + w11;
    if (a <= 0) continue;
    const di = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) out.data[di + k] = (px(ix, iy, k) * w00 + px(ix + 1, iy, k) * w10 + px(ix, iy + 1, k) * w01 + px(ix + 1, iy + 1, k) * w11) / a;
    out.data[di + 3] = a;
  }
  return out;
}

type Ctx = { ws: Workspace; assetRoot: string; logo?: Raster };
/** 给一张图加水印（原地修改 img） */
async function stamp(img: Raster, r: Row, o: Opts, c: Ctx) {
  const pos = parsePosition(r.position, parsePosition(r._pos, "bottom-right"));
  const opacity = num(r.opacity, o.opacity);
  const scale = num(r.scale, 100) / 100;
  const dims = { w: img.width, h: img.height };
  const marks: Raster[] = [];
  const tile = pos === "tile";
  if ((o.mode === "logo" || o.mode === "both") && c.logo) {
    const lw = Math.round(logoWidth(dims, o.logoPct) * scale * (tile ? 0.7 : 1));
    marks.push(resize(c.logo, lw, (c.logo.height / c.logo.width) * lw));
  }
  if ((o.mode === "text" || o.mode === "both") && s(o.text)) marks.push(await textStamp(o.text, Math.round(textSize(dims, o.textPct) * scale), o, 0, c.assetRoot));
  if (!marks.length) return 0;
  // Logo + 文字：文字放在 Logo 右边，垂直居中
  let mark = marks[0];
  if (marks.length === 2) {
    const [a, b] = marks, gap = Math.round(b.height * 0.25);
    const h = Math.max(a.height, b.height);
    mark = { width: a.width + gap + b.width, height: h, data: new Uint8ClampedArray((a.width + gap + b.width) * h * 4) };
    drawOver(mark, a, 0, Math.round((h - a.height) / 2));
    drawOver(mark, b, a.width + gap, Math.round((h - b.height) / 2));
  }
  if (tile) {
    const m = rotate(mark, o.angle);
    const at = tiles(dims, { w: m.width, h: m.height }, o.gap);
    for (const q of at) drawOver(img, m, q.x, q.y, opacity);
    return at.length;
  }
  const p = place(dims, { w: mark.width, h: mark.height }, pos, o.margin, num(r.dx, 0), num(r.dy, 0));
  drawOver(img, mark, p.x, p.y, opacity);
  return 1;
}

async function loadLogo(ws: Workspace, path: string) {
  if (!path) return undefined;
  try { return decodeImage(new Uint8Array(await ws.read(path, 20 * 1024 * 1024)), path); } catch (e) { throw new KitError("bad_logo", `Logo ${path}: ${(e as Error).message}`); }
}
const outPath = (f: string, fmt: string) => {
  const base = f.replace(/^\.?\/*/, "");
  return fmt === "png" ? base.replace(/\.(jpe?g)$/i, ".png") : fmt === "jpg" ? base.replace(/\.png$/i, ".jpg") : base;
};
const previews = new Map<string, string>();

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "watermark",
    title: ["图片批量水印", "Image Watermark"],
    openDescription:
      "Add a text and/or logo watermark to many JPEG/PNG photos at once. Pick photos or folders; a PNG whose name contains 'logo' (or settings.logo) is used as the logo and not watermarked. Settings: mode (text/logo/both), text (\\n for a second line), color, shadow, textSize (% of the short side), logoSize (% of the width), position (top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right, tile; Chinese like 右下 works), opacity (0–1), margin (% of the short side), angle and gap for tile, format (same/jpg/png), quality. Each photo is a row where you can skip it or nudge it: position, dx/dy (% of the short side, + = right/down), scale (%), opacity. The panel previews the first photos. Exports watermarked/<path> copies (originals untouched) and watermark-report.csv. Runs locally.",
    inputs: { exts: EXTS, min: 1, max: 2000, folders: true, label: ["选择照片或文件夹（可附带 logo.png）", "Pick photos or a folder (plus logo.png)"] },
    settings: [
      { key: "mode", label: ["水印类型", "Watermark"], type: "select", default: "text", options: [{ value: "text", label: ["文字", "Text"] }, { value: "logo", label: ["Logo", "Logo"] }, { value: "both", label: ["Logo + 文字", "Logo + text"] }] },
      { key: "text", label: ["水印文字", "Text"], type: "text", default: "© 2026 Sample Studio" },
      { key: "logo", label: ["Logo 文件（留空 = 自动找 logo*.png）", "Logo file (blank = find logo*.png)"], type: "text", default: "" },
      { key: "position", label: ["位置", "Position"], type: "select", default: "bottom-right", options: POSITIONS.map((p) => ({ value: p, label: [POS_ZH[p], p] as [string, string] })) },
      { key: "opacity", label: ["不透明度（0–1）", "Opacity (0–1)"], type: "number", default: 0.6, min: 0.02, max: 1 },
      { key: "textSize", label: ["文字大小（短边 %）", "Text size (% of short side)"], type: "number", default: 4, min: 0.5, max: 40 },
      { key: "logoSize", label: ["Logo 宽度（图宽 %）", "Logo width (% of width)"], type: "number", default: 15, min: 1, max: 100 },
      { key: "margin", label: ["边距（短边 %）", "Margin (% of short side)"], type: "number", default: 3, min: 0, max: 40 },
      { key: "color", label: ["文字颜色", "Text colour"], type: "text", default: "#FFFFFF" },
      { key: "shadow", label: ["文字阴影", "Text shadow"], type: "bool", default: true },
      { key: "angle", label: ["平铺角度", "Tile angle"], type: "number", default: -30, min: -90, max: 90 },
      { key: "gap", label: ["平铺间距（短边 %）", "Tile gap (% of short side)"], type: "number", default: 8, min: 0, max: 100 },
      { key: "format", label: ["输出格式", "Output format"], type: "select", default: "same", options: [{ value: "same", label: ["和原图一样", "Same as source"] }, { value: "jpg", label: ["JPEG", "JPEG"] }, { value: "png", label: ["PNG", "PNG"] }] },
      { key: "quality", label: ["JPEG 质量", "JPEG quality"], type: "number", default: 90, min: 40, max: 100 },
    ],
    columns: () => [
      { key: "use", label: ["加水印", "Apply"], type: "bool" },
      { key: "file", label: ["图片", "Image"], readOnly: true },
      { key: "size", label: ["尺寸", "Size"], readOnly: true },
      { key: "position", label: ["位置", "Position"], type: "select", options: ["", ...POSITIONS] },
      { key: "dx", label: ["右移%", "dx %"], type: "number" },
      { key: "dy", label: ["下移%", "dy %"], type: "number" },
      { key: "scale", label: ["缩放%", "Scale %"], type: "number" },
      { key: "opacity", label: ["不透明度", "Opacity"], type: "number" },
    ] as Column[],
    async load({ ws, files, settings, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 5000 })) list.push(x.path);
      }
      let logo = s(settings.logo);
      if (!logo) logo = list.find((f) => /(^|\/)[^/]*logo[^/]*\.png$/i.test(f)) ?? "";
      const uniq = [...new Set(list)].filter((f) => f !== logo && !f.split("/").includes("watermarked")).sort((a, b) => a.localeCompare(b, "en"));
      if (!uniq.length) throw new KitError("no_files", "No JPEG/PNG photos found.");
      const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
      const rows: Row[] = [];
      for (const f of uniq) {
        const buf = new Uint8Array(await ws.read(f, 200 * 1024 * 1024));
        let size = "?", w = 0, h = 0;
        try { const im = decodeImage(buf, f); w = im.width; h = im.height; size = `${w}×${h}`; } catch { size = "unreadable"; }
        const old = prev.get(f);
        rows.push({ use: old?.use ?? size !== "unreadable", file: f, size, position: old?.position ?? "", dx: old?.dx ?? "", dy: old?.dy ?? "", scale: old?.scale ?? "", opacity: old?.opacity ?? "", _w: w, _h: h });
      }
      return { rows, meta: { logo } };
    },
    async compute(p, ctx): Promise<Computed> {
      const issues: Issue[] = [];
      const o = opts(p.settings);
      const logoPath = s((p.meta as { logo?: string }).logo);
      if ((o.mode === "logo" || o.mode === "both") && !logoPath) issues.push({ level: "error", message: "No logo: pick a logo PNG together with the photos (name containing “logo”) or set settings.logo / 没有找到 Logo 图片" });
      if ((o.mode === "text" || o.mode === "both") && !s(o.text)) issues.push({ level: "error", message: "Watermark text is empty / 水印文字为空" });
      if (!HEX.test(s(p.settings.color))) issues.push({ level: "warn", message: `Colour “${s(p.settings.color)}” is not #RRGGBB — using white / 颜色格式不对` });
      p.rows.forEach((r, i) => {
        if (s(r.size) === "unreadable") issues.push({ level: "warn", row: i, message: `${s(r.file)} can't be read (not a valid JPEG/PNG) — skipped / 无法读取` });
        if (s(r.position) && parsePosition(r.position, "center") !== s(r.position)) issues.push({ level: "warn", row: i, key: "position", message: `Row ${i}: unknown position “${s(r.position)}” / 位置不认识` });
        if (Math.abs(num(r.dx, 0)) > 50 || Math.abs(num(r.dy, 0)) > 50) issues.push({ level: "warn", row: i, key: "dx", message: `Row ${i}: nudged by more than 50% — the watermark may be off the image / 偏移过大` });
        const sm = Math.min(Number(r._w), Number(r._h));
        if (sm && sm < 400) issues.push({ level: "info", row: i, message: `${s(r.file)} is small (${s(r.size)}) — the watermark scales with it / 图片较小` });
      });
      const used = p.rows.filter((r) => r.use !== false && s(r.size) !== "unreadable");
      let preview = "";
      if (!issues.some((x) => x.level === "error")) {
        let logo: Raster | undefined;
        try { logo = logoPath && o.mode !== "text" ? await loadLogo(ctx.ws, logoPath) : undefined; } catch (e) { issues.push({ level: "error", message: (e as Error).message }); }
        const cards: string[] = [];
        for (const r of used.slice(0, 4)) {
          const key = JSON.stringify([r.file, r.position, r.dx, r.dy, r.scale, r.opacity, p.settings, logoPath]);
          if (!previews.has(key)) {
            try {
              const img = fitWithin(decodeImage(new Uint8Array(await ctx.ws.read(s(r.file), 200 * 1024 * 1024)), s(r.file)), 480);
              await stamp(img, { ...r, _pos: p.settings.position }, o, { ws: ctx.ws, assetRoot, logo });
              previews.set(key, `data:image/jpeg;base64,${encodeJpeg(img, 80).toString("base64")}`);
            } catch (e) { previews.set(key, ""); issues.push({ level: "warn", message: `Preview of ${s(r.file)} failed: ${(e as Error).message}` }); }
          }
          const src = previews.get(key);
          if (src) cards.push(`<figure style="margin:0;width:48%"><img src="${src}" style="width:100%;border-radius:4px"><figcaption class="muted" style="font-size:11px">${esc(s(r.file).split("/").pop()!)}</figcaption></figure>`);
        }
        preview = `<div style="display:flex;flex-wrap:wrap;gap:8px">${cards.join("")}</div>`;
      }
      const pos = parsePosition(p.settings.position, "bottom-right");
      return {
        rows: p.rows,
        issues,
        summary: `${used.length} of ${p.rows.length} image(s) get a ${o.mode === "both" ? "logo + text" : o.mode} watermark at ${pos}, opacity ${o.opacity}${logoPath ? ` (logo: ${logoPath})` : ""}. ${used.length} 张图片加水印（${POS_ZH[pos]}）。`,
        stats: { images: p.rows.length, watermarked: used.length, skipped: p.rows.length - used.length },
        preview,
      };
    },
    exports: [
      {
        id: "images", label: ["加水印的图片", "Watermarked images"], description: "watermarked/<path> — a watermarked copy of every ticked image (originals untouched)",
        async run({ project, write, ws }: ExportCtx) {
          const o = opts(project.settings);
          const logoPath = s((project.meta as { logo?: string }).logo);
          if ((o.mode === "logo" || o.mode === "both") && !logoPath) throw new KitError("no_logo", "No logo image — pick one or set settings.logo.");
          if ((o.mode === "text" || o.mode === "both") && !s(o.text)) throw new KitError("no_text", "Watermark text is empty.");
          const logo = o.mode !== "text" ? await loadLogo(ws, logoPath) : undefined;
          const files: string[] = [], report: unknown[][] = [];
          const fmt = s(project.settings.format) || "same";
          for (const r of project.rows) {
            if (r.use === false || s(r.size) === "unreadable") { report.push([s(r.file), "", "skipped", "", ""]); continue; }
            const img = decodeImage(new Uint8Array(await ws.read(s(r.file), 200 * 1024 * 1024)), s(r.file));
            const n = await stamp(img, { ...r, _pos: project.settings.position }, o, { ws, assetRoot, logo });
            const out = `watermarked/${outPath(s(r.file), fmt)}`;
            const png = /\.png$/i.test(out);
            files.push(await write(out, png ? encodePng(img) : encodeJpeg(img, o.quality)));
            report.push([s(r.file), out, parsePosition(r.position, parsePosition(project.settings.position, "bottom-right")), n, `${img.width}x${img.height}`]);
          }
          if (!files.length) throw new KitError("nothing", "No images ticked.");
          files.push(await write("watermark-report.csv", toCsv(["image", "output", "position", "marks", "size"], report)));
          return files;
        },
      },
    ],
    describeRow: (r, i) => `#${i}${r.use === false ? " [skip]" : ""} ${s(r.file)} ${s(r.size)}${s(r.position) ? ` @${s(r.position)}` : ""}${s(r.dx) || s(r.dy) ? ` nudge ${s(r.dx) || 0},${s(r.dy) || 0}%` : ""}${s(r.scale) ? ` ×${s(r.scale)}%` : ""}${s(r.opacity) ? ` α${s(r.opacity)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
