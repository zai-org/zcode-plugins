import QRCode from "qrcode";
import { degrees, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface Attendee { name: string; nameEn: string; org: string; title: string; role: string; table: string; code: string }
export interface BadgeOpts {
  event: string; eventSub: string; size: keyof typeof SIZES; accent: string; bilingual: boolean;
  qr: "none" | "code"; roleColors: Record<string, string>; logo?: { bytes: Uint8Array; png: boolean }; tentOrg: boolean;
}

export const SIZES = {
  "100x70": { w: 100, h: 70, label: "100×70 mm" },
  "90x120": { w: 90, h: 120, label: "90×120 mm" },
  "4x3in": { w: 101.6, h: 76.2, label: "4×3 in" },
  "86x54": { w: 85.6, h: 54, label: "85.6×54 mm" },
  A6: { w: 105, h: 148, label: "A6" },
};

export const PALETTE = ["#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f", "#475569", "#c2410c"];
/** 按出现顺序给身份分配颜色（已手动指定的保留）。 */
export function assignRoleColors(roles: string[], given: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  for (const r of roles) {
    if (!r || out[r]) continue;
    out[r] = /^#[0-9a-f]{6}$/i.test(given[r] ?? "") ? given[r] : PALETTE[i++ % PALETTE.length];
  }
  return out;
}

/** 让文字在宽度内尽量大。 */
export function fitSize(k: Pick<PdfKit, "width">, text: string, maxW: number, max: number, min = 6, bold = true) {
  let s = max;
  while (s > min && k.width(text, s, bold) > maxW) s -= 0.5;
  return s;
}

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) page.drawRectangle({ x: x + c * m, y: y + size - (r + 1) * m, width: m + 0.04, height: m + 0.04, color: rgb(0, 0, 0), borderWidth: 0 });
}

const isDark = (hex: string) => { const c = hexRgb(hex); return 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue < 0.62; };

function badge(page: PDFPage, x: number, y: number, W: number, H: number, a: Attendee, o: BadgeOpts, k: PdfKit, logo?: PDFImage) {
  const pad = Math.min(W, H) * 0.07;
  const portrait = H > W * 1.1;
  page.drawRectangle({ x, y, width: W, height: H, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.4 });
  // 顶部：活动名 / logo
  const headH = H * (portrait ? 0.2 : 0.22);
  page.drawRectangle({ x, y: y + H - headH, width: W, height: headH, color: hexRgb(o.accent), borderWidth: 0 });
  const hf = isDark(o.accent) ? "#ffffff" : "#111827";
  let tx = x + pad;
  if (logo) {
    const lh = headH - pad * 0.9, s = Math.min(lh / logo.height, (W * 0.3) / logo.width);
    const lw = logo.width * s;
    page.drawRectangle({ x: x + pad - 2, y: y + H - headH / 2 - logo.height * s / 2 - 2, width: lw + 4, height: logo.height * s + 4, color: rgb(1, 1, 1), borderWidth: 0 });
    page.drawImage(logo, { x: x + pad, y: y + H - headH / 2 - logo.height * s / 2, width: lw, height: logo.height * s });
    tx += lw + 6;
  }
  const ev = o.event || "";
  if (ev) {
    const es = fitSize(k, ev, x + W - pad - tx, portrait ? 13 : 11, 6);
    const hasSub = !!o.eventSub;
    k.text(page, ev, tx, y + H - headH / 2 + (hasSub ? 1 : -es / 2.8), { size: es, bold: true, color: hf, maxWidth: x + W - pad - tx });
    if (hasSub) k.text(page, o.eventSub, tx, y + H - headH / 2 - 7.5, { size: Math.min(6.5, es * 0.7), color: hf, maxWidth: x + W - pad - tx });
  }
  // 底部身份条
  const role = a.role;
  const footH = role ? H * 0.16 : 0;
  if (role) {
    const col = o.roleColors[role] ?? "#475569";
    page.drawRectangle({ x, y, width: W, height: footH, color: hexRgb(col), borderWidth: 0 });
    const rs = Math.min(footH * 0.5, 13);
    k.text(page, role, x + W / 2, y + footH / 2 - rs / 2.8, { size: rs, bold: true, color: isDark(col) ? "#ffffff" : "#111827", align: "center", maxWidth: W - 2 * pad });
  }
  // 中部：二维码 + 名字
  const qrS = o.qr === "code" && a.code ? Math.min(H * (portrait ? 0.24 : 0.34), W * 0.3) : 0;
  const bodyTop = y + H - headH, bodyBot = y + footH;
  if (qrS) {
    const qx = portrait ? x + W / 2 - qrS / 2 : x + W - pad - qrS;
    const qy = portrait ? bodyBot + pad * 0.8 : (bodyTop + bodyBot) / 2 - qrS / 2;
    drawQr(page, a.code, qx, qy, qrS);
  }
  const textW = portrait ? W - 2 * pad : W - 2 * pad - (qrS ? qrS + pad : 0);
  const cx = portrait ? x + W / 2 : x + pad;
  const align = portrait ? "center" : "left";
  const lines: { t: string; size: number; bold?: boolean; color: string }[] = [];
  const ns = fitSize(k, a.name, textW, portrait ? 34 : 28, 10);
  lines.push({ t: a.name, size: ns, bold: true, color: "#111827" });
  if (o.bilingual && a.nameEn) lines.push({ t: a.nameEn, size: Math.min(11, fitSize(k, a.nameEn, textW, 11, 6, false)), color: "#4b5563" });
  if (a.title) lines.push({ t: a.title, size: Math.min(9, fitSize(k, a.title, textW, 9, 6, false)), color: "#374151" });
  if (a.org) lines.push({ t: a.org, size: Math.min(10, fitSize(k, a.org, textW, 10, 6, true)), bold: true, color: o.accent });
  const gaps = lines.map((l, i) => (i === 0 ? l.size : l.size * 1.55));
  const total = gaps.reduce((s, g) => s + g, 0);
  const areaTop = bodyTop, areaBot = portrait && qrS ? bodyBot + qrS + pad * 1.4 : bodyBot;
  let ly = (areaTop + areaBot) / 2 + total / 2;
  lines.forEach((l, i) => { ly -= gaps[i]; k.text(page, l.t, cx, ly + (i === 0 ? l.size * 0.12 : 0), { size: l.size, bold: l.bold, color: l.color, align, maxWidth: textW }); if (i === 0) ly -= l.size * 0.15; });
}

function marks(page: PDFPage, x: number, y: number, W: number, H: number, len: number, e = { l: true, r: true, t: true, b: true }) {
  const L = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb(0.4, 0.4, 0.4) });
  for (const [px, py, dx, dy] of [[x, y, -1, -1], [x + W, y, 1, -1], [x, y + H, -1, 1], [x + W, y + H, 1, 1]] as const) {
    if ((dx < 0 && e.l) || (dx > 0 && e.r)) L(px + dx * 1.5, py, px + dx * (1.5 + len), py);
    if ((dy < 0 && e.b) || (dy > 0 && e.t)) L(px, py + dy * 1.5, px, py + dy * (1.5 + len));
  }
}

export function layoutOf(size: BadgeOpts["size"]) {
  const s = SIZES[size];
  const W = s.w * MM, H = s.h * MM;
  const [PW, PH] = PAGE.A4;
  const fit = (gap: number, margin: number) => {
    const cols = Math.max(1, Math.floor((PW - 2 * margin + gap + 0.01) / (W + gap)));
    const rows = Math.max(1, Math.floor((PH - 2 * margin + gap + 0.01) / (H + gap)));
    return { W, H, gap, PW, PH, cols, rows, per: cols * rows };
  };
  // 有间距（每张独立裁切）放得下就用；放不下时改成紧挨着排（共用裁切线），至少留 5 mm 打印边距
  const a = fit(6 * MM, 6 * MM), b = fit(0, 5 * MM);
  return b.per > a.per ? b : a;
}

async function prep(o: BadgeOpts, fontPath?: string) {
  const k = await newPdf(fontPath);
  k.doc.setTitle(o.event || "Badges");
  const logo = o.logo ? (o.logo.png ? await k.doc.embedPng(o.logo.bytes) : await k.doc.embedJpg(o.logo.bytes)) : undefined;
  return { k, logo };
}

/** 胸牌：A4 拼版，带角线。 */
export async function badgesPdf(list: Attendee[], o: BadgeOpts, fontPath?: string): Promise<Uint8Array> {
  const { k, logo } = await prep(o, fontPath);
  const L = layoutOf(o.size);
  const gw = L.cols * L.W + (L.cols - 1) * L.gap, gh = L.rows * L.H + (L.rows - 1) * L.gap;
  const mx = (L.PW - gw) / 2, my = (L.PH - gh) / 2;
  for (let i = 0; i < list.length; i += L.per) {
    const page = k.doc.addPage([L.PW, L.PH]);
    list.slice(i, i + L.per).forEach((a, j) => {
      const r = Math.floor(j / L.cols), c = j % L.cols;
      const x = mx + c * (L.W + L.gap), y = L.PH - my - (r + 1) * L.H - r * L.gap;
      badge(page, x, y, L.W, L.H, a, o, k, logo);
      if (L.gap) marks(page, x, y, L.W, L.H, 3 * MM);
      else marks(page, x, y, L.W, L.H, Math.max(1, Math.min(mx, my) - 2 * MM), { l: c === 0, r: c === L.cols - 1, t: r === 0, b: r === L.rows - 1 || j + L.cols >= Math.min(L.per, list.length - i) });
    });
    k.text(page, `${o.event || ""}  ${Math.floor(i / L.per) + 1}/${Math.ceil(list.length / L.per)}`, L.PW / 2, 4 * MM, { size: 6, color: "#9ca3af", align: "center" });
  }
  return k.doc.save();
}

/** 桌签：A4 横向，对折成三角；上半部分倒置，两面都能读。 */
export async function tentsPdf(list: Attendee[], o: BadgeOpts, fontPath?: string): Promise<Uint8Array> {
  const { k } = await prep(o, fontPath);
  const [PH, PW] = PAGE.A4; // 横向
  const half = PH / 2;
  for (const a of list) {
    const page = k.doc.addPage([PW, half * 2]);
    const face = (flip: boolean) => {
      const baseY = flip ? half : 0;
      const cx = PW / 2;
      const ns = fitSize(k, a.name, PW - 40 * MM, 96, 20);
      const sub = [o.bilingual ? a.nameEn : "", o.tentOrg ? [a.org, a.title].filter(Boolean).join(" · ") : ""].filter(Boolean);
      const subSize = 18;
      const block = ns * 0.85 + (sub.length ? ns * 0.2 : 0) + sub.length * subSize * 1.5;
      // 面内居中（以折线为界，各自一半）
      const top = half / 2 + block / 2;
      const items: { t: string; size: number; bold: boolean; color: string; dy: number }[] = [{ t: a.name, size: ns, bold: true, color: "#111827", dy: top - ns * 0.85 }];
      let dy = top - ns * 0.85 - (sub.length ? ns * 0.2 : 0);
      for (const s of sub) { dy -= subSize * 1.5; items.push({ t: s, size: fitSize(k, s, PW - 40 * MM, subSize, 8, false), bold: false, color: "#4b5563", dy }); }
      for (const it of items) {
        const f = it.bold ? k.bold : k.font;
        const t = k.cjk ? it.t : it.t.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?");
        const w = f.widthOfTextAtSize(t, it.size);
        if (!flip) page.drawText(t, { x: cx - w / 2, y: baseY + it.dy, size: it.size, font: f, color: hexRgb(it.color) });
        else page.drawText(t, { x: cx + w / 2, y: baseY + half - it.dy, size: it.size, font: f, color: hexRgb(it.color), rotate: degrees(180) });
      }
      // 色条
      const col = a.role ? o.roleColors[a.role] ?? o.accent : o.accent;
      if (!flip) page.drawRectangle({ x: 0, y: baseY, width: PW, height: 8 * MM, color: hexRgb(col), borderWidth: 0 });
      else page.drawRectangle({ x: 0, y: baseY + half - 8 * MM, width: PW, height: 8 * MM, color: hexRgb(col), borderWidth: 0 });
    };
    face(false);
    face(true);
    for (let x = 6 * MM; x < PW - 6 * MM; x += 6 * MM) page.drawLine({ start: { x, y: half }, end: { x: x + 3 * MM, y: half }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) });
    if (o.event) k.text(page, o.event, PW / 2, 12 * MM, { size: 10, color: "#6b7280", align: "center" });
  }
  return k.doc.save();
}
