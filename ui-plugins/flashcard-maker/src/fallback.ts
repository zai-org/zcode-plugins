// 音标等主字体（中文字体）缺字时，用本机的拉丁字体补字
import { access, readFile } from "node:fs/promises";
import type { PDFFont, PDFPage } from "pdf-lib";
import { hexRgb, type PdfKit } from "./kit/pdf.ts";
import { pdfFontkit } from "./kit/pdf-fontkit.ts";

const CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "C:\\Windows\\Fonts\\segoeui.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

export interface Mixed { text: (page: PDFPage, t: string, x: number, y: number, o: { size: number; color?: string; align?: "left" | "center" | "right"; bold?: boolean }) => void; width: (t: string, size: number) => number; hasFallback: boolean }

export async function mixedText(k: PdfKit): Promise<Mixed> {
  let fb: PDFFont | undefined;
  if (k.cjk) {
    for (const c of CANDIDATES) {
      try { await access(c); k.doc.registerFontkit(pdfFontkit as never); fb = await k.doc.embedFont(await readFile(c), { subset: true }); break; } catch { /* 下一个 */ }
    }
  }
  const sets = new Map<PDFFont, Set<number>>();
  const has = (f: PDFFont, cp: number) => { let s = sets.get(f); if (!s) { s = new Set(f.getCharacterSet()); sets.set(f, s); } return s.has(cp); };
  const runs = (t: string, bold = false) => {
    const main = bold ? k.bold : k.font, out: { font: PDFFont; text: string }[] = [];
    for (const ch of t) {
      const f = !fb || has(main, ch.codePointAt(0)!) || !has(fb, ch.codePointAt(0)!) ? main : fb;
      if (out.length && out[out.length - 1].font === f) out[out.length - 1].text += ch; else out.push({ font: f, text: ch });
    }
    return out;
  };
  const width = (t: string, size: number, bold = false) => runs(t, bold).reduce((a, r) => a + r.font.widthOfTextAtSize(r.text, size), 0);
  return {
    hasFallback: !!fb,
    width: (t, size) => width(t, size),
    text: (page, t, x, y, o) => {
      if (!k.cjk) { k.text(page, t, x, y, o); return; }
      const w = width(t, o.size, o.bold);
      let cx = x + (o.align === "center" ? -w / 2 : o.align === "right" ? -w : 0);
      for (const r of runs(t, o.bold)) { page.drawText(r.text, { x: cx, y, size: o.size, font: r.font, color: hexRgb(o.color) }); cx += r.font.widthOfTextAtSize(r.text, o.size); }
    },
  };
}
