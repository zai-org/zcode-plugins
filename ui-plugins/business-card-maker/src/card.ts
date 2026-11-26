import QRCode from "qrcode";
import { rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface Person { name: string; nameEn: string; title: string; titleEn: string; dept: string; mobile: string; phone: string; email: string; address: string }
export interface CardOpts {
  company: string; companyEn: string; website: string; address: string;
  size: "90x54" | "85x55" | "89x51"; template: "left" | "center" | "band";
  accent: string; back: boolean; qr: "back" | "front" | "none"; bleed: number; bilingual: boolean;
  logo?: { bytes: Uint8Array; png: boolean };
}

export const SIZES: Record<CardOpts["size"], [number, number]> = { "90x54": [90, 54], "85x55": [85, 55], "89x51": [88.9, 50.8] };

const COMPOUND = ["欧阳", "司马", "诸葛", "上官", "东方", "皇甫", "尉迟", "公孙", "慕容", "长孙", "宇文", "司徒", "夏侯", "令狐", "端木", "独孤", "南宫", "西门"];
/** 拆姓名：中文按姓（含复姓）+ 名；英文按最后一个词为姓。 */
export function splitName(name: string): { family: string; given: string } {
  const n = name.trim();
  if (/^[\u4e00-\u9fff·]+$/.test(n)) {
    const c = COMPOUND.find((s) => n.startsWith(s) && n.length > 2);
    const k = c ? c.length : 1;
    return { family: n.slice(0, k), given: n.slice(k) };
  }
  const parts = n.split(/\s+/);
  if (parts.length < 2) return { family: n, given: "" };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const ve = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
export function vcard(p: Person, o: Pick<CardOpts, "company" | "companyEn" | "website" | "address">): string {
  const { family, given } = splitName(p.name);
  const L = ["BEGIN:VCARD", "VERSION:3.0", `N:${ve(family)};${ve(given)};;;`, `FN:${ve(p.name)}`];
  if (p.nameEn) L.push(`NICKNAME:${ve(p.nameEn)}`);
  if (o.company) L.push(`ORG:${ve(o.company)}${p.dept ? `;${ve(p.dept)}` : ""}`);
  if (p.title) L.push(`TITLE:${ve(p.title)}`);
  if (p.mobile) L.push(`TEL;TYPE=CELL:${p.mobile.replace(/[^\d+]/g, "")}`);
  if (p.phone) L.push(`TEL;TYPE=WORK,VOICE:${p.phone.replace(/[^\d+\-,;]/g, "")}`);
  if (p.email) L.push(`EMAIL;TYPE=INTERNET,WORK:${p.email}`);
  if (o.website) L.push(`URL:${/^https?:/i.test(o.website) ? o.website : `https://${o.website}`}`);
  const addr = p.address || o.address;
  if (addr) L.push(`ADR;TYPE=WORK:;;${ve(addr)};;;;`);
  L.push("END:VCARD");
  return L.join("\r\n") + "\r\n";
}

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number, dark = rgb(0, 0, 0)) {
  const q = QRCode.create(text, { errorCorrectionLevel: "L" });
  const n = q.modules.size, m = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!q.modules.get(r, c)) { c++; continue; }
      let e = c;
      while (e < n && q.modules.get(r, e)) e++;
      page.drawRectangle({ x: x + c * m, y: y + size - (r + 1) * m, width: (e - c) * m + 0.05, height: m + 0.05, color: dark, borderWidth: 0 });
      c = e;
    }
  }
}

const onDark = (hex: string) => {
  const c = hexRgb(hex);
  return 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue < 0.6;
};

export function contactLines(p: Person, o: CardOpts): string[] {
  const L: string[] = [];
  const b = o.bilingual;
  if (p.mobile) L.push(`${b ? "M" : "手机"}  ${p.mobile}`);
  if (p.phone) L.push(`${b ? "T" : "电话"}  ${p.phone}`);
  if (p.email) L.push(`${b ? "E" : "邮箱"}  ${p.email}`);
  if (o.website) L.push(`${b ? "W" : "网址"}  ${o.website.replace(/^https?:\/\//i, "")}`);
  const addr = p.address || o.address;
  if (addr) L.push(`${b ? "A" : "地址"}  ${addr}`);
  return L;
}

interface Ctx { k: PdfKit; o: CardOpts; logo?: PDFImage; W: number; H: number; b: number }

function fitLogo(logo: PDFImage, maxW: number, maxH: number) {
  const s = Math.min(maxW / logo.width, maxH / logo.height);
  return { width: logo.width * s, height: logo.height * s };
}

/** 在 (x, y) 为裁切框左下角的位置画一张正面。 */
function front(page: PDFPage, x: number, y: number, p: Person, c: Ctx) {
  const { k, o, W, H, b } = c;
  const pad = 6 * MM;
  const accent = hexRgb(o.accent);
  page.drawRectangle({ x: x - b, y: y - b, width: W + 2 * b, height: H + 2 * b, color: rgb(1, 1, 1), borderWidth: 0 });
  const lines = contactLines(p, o);
  const qrSize = o.qr === "front" ? 15 * MM : 0;
  const cs = 6.3;
  if (o.template === "band") page.drawRectangle({ x: x - b, y: y - b, width: 4 * MM + b, height: H + 2 * b, color: accent, borderWidth: 0 });
  const left = x + pad + (o.template === "band" ? 3 * MM : 0);
  const center = o.template === "center";
  const cx = x + W / 2;
  // 顶部：logo 或公司名
  const topY = y + H - pad;
  if (c.logo) {
    const d = fitLogo(c.logo, 26 * MM, 8 * MM);
    page.drawImage(c.logo, { x: center ? cx - d.width / 2 : left, y: topY - d.height, ...d });
    if (o.company && !center) k.text(page, o.company, x + W - pad, topY - 6, { size: 6.5, color: "#6b7280", align: "right", maxWidth: W - 2 * pad - d.width - 6 });
  } else if (o.company) {
    k.text(page, o.company, center ? cx : left, topY - 8, { size: 8.5, bold: true, color: o.accent, align: center ? "center" : "left", maxWidth: W - 2 * pad });
  }
  // 姓名 + 职位
  let ny = y + H * (center ? 0.56 : 0.6) - 4;
  const nameText = p.name;
  k.text(page, nameText, center ? cx : left, ny, { size: 14, bold: true, color: "#111827", align: center ? "center" : "left", maxWidth: W - 2 * pad });
  if (o.bilingual && p.nameEn && !center) {
    const nw = k.width(nameText, 14, true);
    k.text(page, p.nameEn, left + nw + 6, ny, { size: 7.5, color: "#6b7280", maxWidth: W - 2 * pad - nw - 6 - qrSize });
  }
  if (o.bilingual && p.nameEn && center) { ny -= 10; k.text(page, p.nameEn, cx, ny, { size: 7.5, color: "#6b7280", align: "center" }); }
  const t = [p.title, p.dept].filter(Boolean).join(" · ");
  if (t) { ny -= 11; k.text(page, t, center ? cx : left, ny, { size: 7.5, color: o.accent, align: center ? "center" : "left", maxWidth: W - 2 * pad }); }
  if (o.bilingual && p.titleEn) { ny -= 8.5; k.text(page, p.titleEn, center ? cx : left, ny, { size: 6.3, color: "#6b7280", align: center ? "center" : "left", maxWidth: W - 2 * pad }); }
  if (!center && o.template !== "band") page.drawLine({ start: { x: left, y: ny - 6 }, end: { x: left + 14 * MM, y: ny - 6 }, thickness: 1, color: accent });
  // 联系方式（底部）
  let ly = y + pad - 2 + (lines.length - 1) * cs * 1.35;
  for (const l of lines) {
    if (center) k.text(page, l, cx, ly, { size: cs, color: "#374151", align: "center", maxWidth: W - 2 * pad });
    else k.text(page, l, left, ly, { size: cs, color: "#374151", maxWidth: W - 2 * pad - qrSize - 4 - (left - x - pad) });
    ly -= cs * 1.35;
  }
  if (qrSize && !center) drawQr(page, vcard(p, o), x + W - pad - qrSize, y + pad - 2, qrSize);
}

function back(page: PDFPage, x: number, y: number, p: Person, c: Ctx) {
  const { k, o, W, H, b } = c;
  page.drawRectangle({ x: x - b, y: y - b, width: W + 2 * b, height: H + 2 * b, color: hexRgb(o.accent), borderWidth: 0 });
  const fg = onDark(o.accent) ? "#ffffff" : "#111827";
  const hasQr = o.qr === "back";
  const q = 20 * MM;
  const cx = hasQr ? x + W * 0.36 : x + W / 2;
  let cy = y + H / 2;
  if (c.logo) {
    const d = fitLogo(c.logo, (hasQr ? 0.5 : 0.6) * W, 0.3 * H);
    page.drawRectangle({ x: cx - d.width / 2 - 6, y: cy - d.height / 2 + 4, width: d.width + 12, height: d.height + 8, color: rgb(1, 1, 1), borderWidth: 0, opacity: c.logo && onDark(o.accent) ? 1 : 0 });
    page.drawImage(c.logo, { x: cx - d.width / 2, y: cy - d.height / 2 + 8, ...d });
    cy -= d.height / 2 + 6;
  }
  if (o.company) { k.text(page, o.company, cx, cy - 6, { size: 11, bold: true, color: fg, align: "center", maxWidth: hasQr ? W * 0.6 : W - 12 * MM }); cy -= 18; }
  if (o.companyEn && o.bilingual) k.text(page, o.companyEn, cx, cy - 2, { size: 6.5, color: fg, align: "center", maxWidth: hasQr ? W * 0.6 : W - 12 * MM });
  if (hasQr) {
    const qx = x + W - 6 * MM - q, qy = y + (H - q) / 2 + 3;
    page.drawRectangle({ x: qx - 2, y: qy - 2, width: q + 4, height: q + 4, color: rgb(1, 1, 1), borderWidth: 0 });
    drawQr(page, vcard(p, o), qx, qy, q);
    k.text(page, o.bilingual ? "扫码存名片 Save contact" : "扫码保存联系人", qx + q / 2, qy - 9, { size: 5, color: fg, align: "center" });
  }
}

function cropMarks(page: PDFPage, x: number, y: number, W: number, H: number, off: number, len: number, which = { l: true, r: true, t: true, bt: true }) {
  const k = rgb(0, 0, 0);
  const L = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: k });
  for (const yy of [y, y + H]) {
    if (which.l) L(x - off - len, yy, x - off, yy);
    if (which.r) L(x + W + off, yy, x + W + off + len, yy);
  }
  for (const xx of [x, x + W]) {
    if (which.bt) L(xx, y - off - len, xx, y - off);
    if (which.t) L(xx, y + H + off, xx, y + H + off + len);
  }
}

async function ctxOf(o: CardOpts, fontPath?: string) {
  const k = await newPdf(fontPath);
  k.doc.setTitle(`${o.company || "Business cards"}`);
  const [w, h] = SIZES[o.size];
  let logo: PDFImage | undefined;
  if (o.logo) logo = o.logo.png ? await k.doc.embedPng(o.logo.bytes) : await k.doc.embedJpg(o.logo.bytes);
  return { k, o, logo, W: w * MM, H: h * MM, b: Math.max(0, o.bleed) * MM } as Ctx;
}

/** 印刷文件：每页一张卡，含出血、裁切线，设置 TrimBox/BleedBox；正反面交替。 */
export async function printPdf(people: Person[], o: CardOpts, fontPath?: string): Promise<Uint8Array> {
  const c = await ctxOf(o, fontPath);
  const slug = 6 * MM;
  const off = c.b + slug;
  for (const p of people) {
    for (const side of o.back ? ["front", "back"] : ["front"]) {
      const page = c.k.doc.addPage([c.W + 2 * off, c.H + 2 * off]);
      (side === "front" ? front : back)(page, off, off, p, c);
      cropMarks(page, off, off, c.W, c.H, c.b + 1 * MM, slug - 1.5 * MM);
      page.setTrimBox(off, off, c.W, c.H);
      page.setBleedBox(off - c.b, off - c.b, c.W + 2 * c.b, c.H + 2 * c.b);
    }
  }
  return c.k.doc.save();
}

/** 办公室打印：A4 一页 2×5 张，背面页左右镜像便于双面长边翻转。 */
export async function sheetPdf(people: Person[], o: CardOpts, fill: boolean, fontPath?: string): Promise<Uint8Array> {
  const c = await ctxOf(o, fontPath);
  const [PW, PH] = PAGE.A4;
  const gap = 2 * c.b;
  const cols = Math.max(1, Math.floor((PW - 10 * MM + gap) / (c.W + gap)));
  const rows = Math.max(1, Math.floor((PH - 10 * MM + gap) / (c.H + gap)));
  const per = cols * rows;
  const slots: Person[][] = [];
  if (fill) for (const p of people) slots.push(Array(per).fill(p));
  else for (let i = 0; i < people.length; i += per) slots.push(people.slice(i, i + per));
  const gw = cols * c.W + (cols - 1) * gap, gh = rows * c.H + (rows - 1) * gap;
  const mx = (PW - gw) / 2, my = (PH - gh) / 2;
  const pos = (i: number, mirror: boolean) => {
    const r = Math.floor(i / cols); let col = i % cols;
    if (mirror) col = cols - 1 - col;
    return { x: mx + col * (c.W + gap), y: PH - my - (r + 1) * c.H - r * gap };
  };
  for (const set of slots) {
    for (const side of o.back ? ["front", "back"] : ["front"]) {
      const page = c.k.doc.addPage([PW, PH]);
      set.forEach((p, i) => { const { x, y } = pos(i, side === "back"); (side === "front" ? front : back)(page, x, y, p, c); });
      set.forEach((_, i) => {
        const { x, y } = pos(i, side === "back");
        const r = Math.floor(i / cols), col = i % cols;
        const mcol = side === "back" ? cols - 1 - col : col;
        const len = Math.min(mx, my) - c.b - 1.5 * MM;
        if (len > 1) cropMarks(page, x, y, c.W, c.H, c.b + 1 * MM, len, { l: mcol === 0, r: mcol === cols - 1, t: r === 0, bt: r === rows - 1 || i + cols >= set.length });
      });
      c.k.text(page, side === "front" ? "正面 Front" : "背面 Back（长边翻转 flip on long edge）", PW / 2, 3 * MM, { size: 6, color: "#9ca3af", align: "center" });
    }
  }
  return c.k.doc.save();
}

export function perSheet(o: CardOpts) {
  const [w, h] = SIZES[o.size];
  const gap = 2 * Math.max(0, o.bleed);
  return Math.floor((210 - 10 + gap) / (w + gap)) * Math.floor((297 - 10 + gap) / (h + gap));
}

const hh = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 面板预览：HTML 近似画出正反面。 */
export function previewHtml(people: Person[], o: CardOpts, logoUri: string): string {
  const [w, h] = SIZES[o.size];
  const sc = 3.4;
  const fg = onDark(o.accent) ? "#fff" : "#111827";
  const center = o.template === "center";
  const card = (p: Person) => `<div class="row"><div class="c f ${o.template}" style="width:${w * sc}px;height:${h * sc}px">
${o.template === "band" ? `<i class="band"></i>` : ""}
<div class="top">${logoUri ? `<img src="${logoUri}">` : `<b style="color:${o.accent}">${hh(o.company)}</b>`}</div>
<div class="nm"><b>${hh(p.name)}</b>${o.bilingual && p.nameEn ? ` <small>${hh(p.nameEn)}</small>` : ""}</div>
<div class="tt" style="color:${o.accent}">${hh([p.title, p.dept].filter(Boolean).join(" · "))}</div>
${o.bilingual && p.titleEn ? `<div class="te">${hh(p.titleEn)}</div>` : ""}
<div class="ct">${contactLines(p, o).map((l) => `<div>${hh(l)}</div>`).join("")}</div>
${o.qr === "front" && !center ? `<div class="qr">QR</div>` : ""}
</div>${o.back ? `<div class="c bk" style="width:${w * sc}px;height:${h * sc}px;background:${o.accent};color:${fg}">
<div class="bc">${logoUri ? `<img src="${logoUri}" style="background:#fff;padding:4px 8px;border-radius:3px">` : ""}<b>${hh(o.company)}</b>${o.bilingual && o.companyEn ? `<small>${hh(o.companyEn)}</small>` : ""}</div>
${o.qr === "back" ? `<div class="qr" style="position:static;background:#fff">QR</div>` : ""}</div>` : ""}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#f3f4f6;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.row{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap}.c{position:relative;box-shadow:0 2px 8px #0002;background:#fff;box-sizing:border-box;padding:${6 * sc}px;overflow:hidden}
.f.band{padding-left:${9 * sc}px}.band{position:absolute;left:0;top:0;bottom:0;width:${4 * sc}px;background:${o.accent}}
.top img{max-height:${8 * sc}px;max-width:${26 * sc}px}.top b{font-size:13px}.nm{margin-top:${6 * sc}px}.nm b{font-size:22px}.nm small{color:#6b7280;font-size:12px}
.tt{font-size:12px;margin-top:2px}.te{font-size:10px;color:#6b7280}.ct{position:absolute;bottom:${5 * sc}px;font-size:10px;color:#374151;line-height:1.35}
.center{text-align:center}.center .ct{left:0;right:0}.qr{position:absolute;right:${6 * sc}px;bottom:${5 * sc}px;width:${15 * sc}px;height:${15 * sc}px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;font-size:10px;color:#6b7280}
.bk{display:flex;align-items:center;justify-content:space-around}.bc{display:flex;flex-direction:column;align-items:center;gap:6px}.bc b{font-size:16px}.bc small{font-size:10px;opacity:.85}.bc img{max-height:${12 * sc}px;max-width:${40 * sc}px}
</style></head><body>${people.slice(0, 6).map(card).join("\n")}${people.length > 6 ? `<p style="color:#6b7280">… +${people.length - 6}</p>` : ""}</body></html>`;
}
