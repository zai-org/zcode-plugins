import QRCode from "qrcode";
import { rgb, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface Coupon { code: string; batch: string; value: string; expiry: string; note: string }
export interface CardOpts { brand: string; accent: string; qr: string }

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) page.drawRectangle({ x: x + c * m, y: y + size - (r + 1) * m, width: m + 0.04, height: m + 0.04, color: rgb(0, 0, 0), borderWidth: 0 });
}
export const qrText = (tpl: string, code: string) => (tpl.includes("{code}") ? tpl.replace(/\{code\}/g, encodeURIComponent(code)) : tpl ? `${tpl}${code}` : code);

function card(page: PDFPage, x: number, y: number, W: number, H: number, c: Coupon, o: CardOpts, k: PdfKit) {
  const pad = 5 * MM;
  page.drawRectangle({ x, y, width: W, height: H, color: rgb(1, 1, 1), borderColor: rgb(0.82, 0.82, 0.82), borderWidth: 0.5 });
  page.drawRectangle({ x, y: y + H - 9 * MM, width: W, height: 9 * MM, color: hexRgb(o.accent), borderWidth: 0 });
  k.text(page, o.brand || c.batch, x + pad, y + H - 6 * MM, { size: 9, bold: true, color: "#ffffff", maxWidth: W * 0.6 });
  if (o.brand && c.batch) k.text(page, c.batch, x + W - pad, y + H - 6 * MM, { size: 7, color: "#ffffff", align: "right", maxWidth: W * 0.35 });
  const q = H - 9 * MM - 2 * pad + 2;
  const textW = W - 3 * pad - q;
  let vs = 18;
  while (vs > 8 && k.width(c.value, vs, true) > textW) vs -= 0.5;
  k.text(page, c.value, x + pad, y + H - 9 * MM - pad - vs * 0.8, { size: vs, bold: true, color: o.accent, maxWidth: textW });
  k.text(page, "兑换码 Code", x + pad, y + pad + 15, { size: 5.5, color: "#9ca3af" });
  let cs = 11;
  while (cs > 6 && k.width(c.code, cs, true) > textW) cs -= 0.5;
  k.text(page, c.code, x + pad, y + pad + 4, { size: cs, bold: true, color: "#111827" });
  const meta = [c.expiry ? `有效期至 ${c.expiry}` : "", c.note].filter(Boolean).join(" · ");
  if (meta) k.text(page, meta, x + pad, y + pad + 25, { size: 5.8, color: "#4b5563", maxWidth: textW });
  if (o.qr !== "none") drawQr(page, qrText(o.qr === "code" ? "" : o.qr, c.code), x + W - pad - q, y + pad - 1, q);
}

export async function cardsPdf(list: Coupon[], o: CardOpts, fontPath?: string): Promise<Uint8Array> {
  const k = await newPdf(fontPath);
  k.doc.setTitle(o.brand || "Coupons");
  const [PW, PH] = PAGE.A4;
  const W = 90 * MM, H = 54 * MM, cols = 2, rows = 5, per = cols * rows;
  const mx = (PW - cols * W) / 2, my = (PH - rows * H) / 2;
  for (let i = 0; i < list.length; i += per) {
    const page = k.doc.addPage([PW, PH]);
    list.slice(i, i + per).forEach((c, j) => {
      const r = Math.floor(j / cols), col = j % cols;
      card(page, mx + col * W, PH - my - (r + 1) * H, W, H, c, o, k);
    });
    // 裁切线（页边）
    const L = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb(0.5, 0.5, 0.5) });
    for (let c = 0; c <= cols; c++) { const x = mx + c * W; L(x, PH - my + 2, x, PH - 2); L(x, my - 2, x, 2); }
    for (let r = 0; r <= rows; r++) { const y = PH - my - r * H; L(2, y, mx - 2, y); L(PW - mx + 2, y, PW - 2, y); }
  }
  return k.doc.save();
}
