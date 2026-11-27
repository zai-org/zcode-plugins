import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfFontkit } from "./kit/pdf-fontkit.ts";
import { findPdfFonts } from "./kit/pdf-fonts.ts";

export type Pos = "bottom-right" | "bottom-center" | "bottom-left" | "top-right" | "top-center" | "top-left";
export const POSITIONS: Pos[] = ["bottom-right", "bottom-center", "bottom-left", "top-right", "top-center", "top-left"];
export interface StampOpts { size: number; margin: number; color: string; box: boolean; pos: Pos; label: string; labelPos: Pos; fileLabel: string; fileLabelPos: Pos; fontPath?: string }

export const batesId = (prefix: string, n: number, digits: number, suffix = "") => `${prefix}${String(n).padStart(digits, "0")}${suffix}`;
export const needsCjk = (t: string) => /[^\x20-\x7e\u00a0-\u00ff]/.test(t);

let cjkCache: Uint8Array | null | undefined;
async function cjkFont(path?: string) {
  if (cjkCache === undefined || path) { try { cjkCache = (await findPdfFonts(path)).regular; } catch { cjkCache = null; } }
  return cjkCache;
}

const hex = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0; return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

/** 在页面“看到的”方向上写字：处理 /Rotate 和 CropBox 偏移 */
function drawVisual(page: PDFPage, text: string, font: PDFFont, o: StampOpts, pos: Pos, color = o.color) {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const vw = rot === 90 || rot === 270 ? crop.height : crop.width, vh = rot === 90 || rot === 270 ? crop.width : crop.height;
  const tw = font.widthOfTextAtSize(text, o.size), th = o.size;
  const vx = pos.endsWith("left") ? o.margin : pos.endsWith("right") ? vw - o.margin - tw : (vw - tw) / 2;
  const vy = pos.startsWith("bottom") ? o.margin : vh - o.margin - th * 0.8;
  // 看到的坐标 → 页面坐标
  const map = (x: number, y: number): [number, number] => {
    if (rot === 90) return [crop.x + crop.width - y, crop.y + x];
    if (rot === 180) return [crop.x + crop.width - x, crop.y + crop.height - y];
    if (rot === 270) return [crop.x + y, crop.y + crop.height - x];
    return [crop.x + x, crop.y + y];
  };
  const pad = 2.5;
  if (o.box) {
    const [bx, by] = map(vx - pad, vy - pad - th * 0.22);
    page.drawRectangle({ x: bx, y: by, width: tw + pad * 2, height: th + pad * 2, color: rgb(1, 1, 1), opacity: 0.9, rotate: degrees(rot) });
  }
  const [x, y] = map(vx, vy);
  page.drawText(text, { x, y, size: o.size, font, color: hex(color), rotate: degrees(rot) });
}

export interface StampResult { bytes: Uint8Array; pages: number; cjkMissing: boolean }
/** 给一个 PDF 盖章：每页 Bates 号，可选全局标签（如“副本”）和首页文件标签（如“证据 1”） */
export async function stampPdf(src: Uint8Array, startNo: number, idFor: (n: number) => string, o: StampOpts): Promise<StampResult> {
  const doc = await PDFDocument.load(src, { updateMetadata: false });
  const texts = [idFor(startNo), o.label, o.fileLabel].join("");
  let font: PDFFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let cjkMissing = false;
  if (needsCjk(texts)) {
    const data = await cjkFont(o.fontPath);
    if (data) { doc.registerFontkit(pdfFontkit as never); font = await doc.embedFont(data, { subset: true }); }
    else cjkMissing = true;
  }
  const safe = (t: string) => (cjkMissing ? t.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?") : t);
  doc.getPages().forEach((page, i) => {
    drawVisual(page, safe(idFor(startNo + i)), font, o, o.pos);
    if (o.label) drawVisual(page, safe(o.label), font, o, o.labelPos, "#b91c1c");
    if (o.fileLabel && i === 0) drawVisual(page, safe(o.fileLabel), font, { ...o, size: o.size + 2 }, o.fileLabelPos);
  });
  return { bytes: await doc.save(), pages: doc.getPageCount(), cjkMissing };
}

export async function pageCount(src: Uint8Array): Promise<{ pages: number; encrypted: boolean; error?: string }> {
  try { const d = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false }); return { pages: d.getPageCount(), encrypted: d.isEncrypted }; }
  catch (e) { return { pages: 0, encrypted: false, error: (e as Error).message }; }
}

export function fileLabelFor(pattern: string, n: number, name: string) {
  const letters = (k: number) => { let s = ""; while (k > 0) { s = String.fromCharCode(65 + ((k - 1) % 26)) + s; k = Math.floor((k - 1) / 26); } return s; };
  return pattern.replace(/\{n\}/g, String(n)).replace(/\{A\}/g, letters(n)).replace(/\{a\}/g, letters(n).toLowerCase()).replace(/\{name\}/g, name);
}
