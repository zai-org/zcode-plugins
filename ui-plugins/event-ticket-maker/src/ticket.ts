import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { rgb, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉 0/O/1/I，避免认错

function check(body: string) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (ALPHABET.indexOf(body[i]) + 1) * (i + 3);
  return ALPHABET[sum % 32];
}
/** 生成票号：前缀-XXXX-XXXX，最后一位是校验位。 */
export function makeCode(prefix: string, taken: Set<string>): string {
  for (;;) {
    const b = randomBytes(7);
    const body = Array.from(b, (x) => ALPHABET[x % 32]).join("");
    const code = `${prefix ? `${prefix}-` : ""}${body.slice(0, 4)}-${body.slice(4)}${check(body)}`;
    if (!taken.has(code)) { taken.add(code); return code; }
  }
}
/** 规范化扫描结果：去空格、转大写，并检查校验位。 */
export function normalizeCode(raw: string): { code: string; valid: boolean } {
  const code = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const m = /([2-9A-HJ-NP-Z]{4})-([2-9A-HJ-NP-Z]{4})$/.exec(code);
  if (!m) return { code, valid: false };
  const body = m[1] + m[2].slice(0, 3);
  return { code, valid: check(body) === m[2][3] };
}

export interface Guest { code: string; name: string; type: string; seat: string }
export interface TicketOpts { event: string; date: string; venue: string; accent: string; note: string; layout: "a4" | "single" }

const TW = 180 * MM, TH = 66 * MM;

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) page.drawRectangle({ x: x + c * m, y: y + size - (r + 1) * m, width: m + 0.04, height: m + 0.04, color: rgb(0, 0, 0), borderWidth: 0 });
}

function ticket(page: PDFPage, x: number, y: number, g: Guest, o: TicketOpts, k: PdfKit) {
  const ac = hexRgb(o.accent);
  const stub = 52 * MM;
  const pad = 7 * MM;
  page.drawRectangle({ x, y, width: TW, height: TH, color: rgb(1, 1, 1), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.6 });
  page.drawRectangle({ x, y, width: 5 * MM, height: TH, color: ac, borderWidth: 0 });
  // 主体
  const mx = x + 5 * MM + pad, mw = TW - stub - 5 * MM - 2 * pad;
  let ty = y + TH - pad - 14;
  for (const line of k.wrap(o.event || "Event", 16, mw, true).slice(0, 2)) { k.text(page, line, mx, ty, { size: 16, bold: true, color: "#111827" }); ty -= 19; }
  const info = [o.date, o.venue].filter(Boolean).join("  ·  ");
  if (info) { k.text(page, info, mx, ty + 2, { size: 8.5, color: "#4b5563", maxWidth: mw }); }
  // 底部：姓名 / 票种 / 座位
  const by = y + pad + 2;
  const cols: [string, string][] = [["姓名 Name", g.name], ["票种 Type", g.type], ["座位 Seat", g.seat || "—"]];
  const cw = [mw * 0.46, mw * 0.27, mw * 0.27];
  let cx = mx;
  cols.forEach(([label, val], i) => {
    k.text(page, label, cx, by + 16, { size: 6.5, color: "#9ca3af" });
    k.text(page, val || "—", cx, by, { size: i === 0 ? 13 : 12, bold: true, color: i === 1 ? o.accent : "#111827", maxWidth: cw[i] - 6 });
    cx += cw[i];
  });
  page.drawLine({ start: { x: mx, y: by + 28 }, end: { x: mx + mw, y: by + 28 }, thickness: 0.4, color: rgb(0.88, 0.88, 0.88) });
  if (o.note) k.text(page, o.note, mx, by + 33, { size: 6.3, color: "#6b7280", maxWidth: mw });
  // 撕线 + 存根
  const sx = x + TW - stub;
  for (let yy = y + 3; yy < y + TH - 3; yy += 6) page.drawLine({ start: { x: sx, y: yy }, end: { x: sx, y: Math.min(yy + 3, y + TH - 3) }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) });
  page.drawCircle({ x: sx, y: y + TH, size: 4, color: rgb(1, 1, 1), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.6 });
  page.drawCircle({ x: sx, y, size: 4, color: rgb(1, 1, 1), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.6 });
  const q = 32 * MM;
  const qx = sx + (stub - q) / 2, qy = y + TH - 6 * MM - q;
  drawQr(page, g.code, qx, qy, q);
  k.text(page, g.code, sx + stub / 2, qy - 10, { size: 7.5, bold: true, color: "#111827", align: "center", maxWidth: stub - 6 });
  k.text(page, "入场请出示二维码 Show at entry", sx + stub / 2, qy - 20, { size: 5.5, color: "#6b7280", align: "center", maxWidth: stub - 6 });
}

export async function ticketsPdf(guests: Guest[], o: TicketOpts, fontPath?: string): Promise<Uint8Array> {
  const k = await newPdf(fontPath);
  k.doc.setTitle(`${o.event || "Tickets"}`);
  if (o.layout === "single") {
    const m = 6 * MM;
    for (const g of guests) ticket(k.doc.addPage([TW + 2 * m, TH + 2 * m]), m, m, g, o, k);
  } else {
    const [PW, PH] = PAGE.A4;
    const per = 3, gap = (PH - per * TH) / (per + 1);
    for (let i = 0; i < guests.length; i += per) {
      const page = k.doc.addPage([PW, PH]);
      guests.slice(i, i + per).forEach((g, j) => ticket(page, (PW - TW) / 2, PH - (j + 1) * (gap + TH), g, o, k));
    }
  }
  return k.doc.save();
}
