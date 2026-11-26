import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfFontkit } from "./pdf-fontkit.ts";
import { findPdfFonts } from "./pdf-fonts.ts";

export const MM = 72 / 25.4;
export const PAGE = { A4: [595.28, 841.89] as [number, number], Letter: [612, 792] as [number, number], A5: [419.53, 595.28] as [number, number] };

export interface PdfKit {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  /** 是否有中文字体（没有时中文会被替换成 ?）。 */
  cjk: boolean;
  width: (text: string, size: number, b?: boolean) => number;
  text: (page: PDFPage, text: string, x: number, y: number, o?: { size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right"; maxWidth?: number }) => void;
  wrap: (text: string, size: number, maxWidth: number, b?: boolean) => string[];
}

export function hexRgb(hex: string | undefined, fallback = "#111827") {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim()) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** 新建 PDF，并嵌入本机中文字体（找不到时退回 Helvetica）。 */
export async function newPdf(fontPath?: string | null): Promise<PdfKit> {
  const doc = await PDFDocument.create();
  doc.setCreator("Penova");
  doc.setProducer("pdf-lib");
  let font: PDFFont, bold: PDFFont, cjk = true;
  try {
    const f = await findPdfFonts(fontPath);
    doc.registerFontkit(pdfFontkit as never);
    font = await doc.embedFont(f.regular, { subset: true });
    bold = f.bold ? await doc.embedFont(f.bold, { subset: true }) : font;
  } catch {
    cjk = false;
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const safe = (t: string) => (cjk ? t : t.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?"));
  const width = (t: string, size: number, b = false) => (b ? bold : font).widthOfTextAtSize(safe(t), size);
  const wrap = (t: string, size: number, maxWidth: number, b = false) => {
    const out: string[] = [];
    for (const para of String(t ?? "").split(/\r?\n/)) {
      let line = "";
      const tokens = para.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+|\s+/g) ?? [""];
      for (const tok of tokens) {
        const next = line + tok;
        if (width(next, size, b) > maxWidth && line.trim()) {
          out.push(line.trimEnd());
          line = tok.trimStart();
        } else line = next;
      }
      out.push(line.trimEnd());
    }
    return out;
  };
  const text: PdfKit["text"] = (page, t, x, y, o = {}) => {
    const size = o.size ?? 10;
    const f = o.bold ? bold : font;
    let s = safe(String(t ?? ""));
    if (o.maxWidth) while (s.length > 1 && f.widthOfTextAtSize(s, size) > o.maxWidth) s = s.slice(0, -2) + "…";
    const w = f.widthOfTextAtSize(s, size);
    const dx = o.align === "center" ? -w / 2 : o.align === "right" ? -w : 0;
    page.drawText(s, { x: x + dx, y, size, font: f, color: hexRgb(o.color) });
  };
  return { doc, font, bold, cjk, width, text, wrap };
}
