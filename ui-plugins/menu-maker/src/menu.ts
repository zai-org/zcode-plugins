import { rgb, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface Dish { section: string; name: string; nameEn: string; price: string; desc: string; allergens: string; spicy: number; star: boolean; veg: boolean }
export interface MenuOpts { title: string; subtitle: string; currency: string; layout: "classic" | "twocol" | "compact"; page: "A4" | "A5" | "Letter"; bilingual: boolean; accent: string; footer: string; qrPng?: Uint8Array; legend: boolean }

export function priceText(price: string, cur: string) {
  const p = price.trim();
  if (!p) return "";
  if (/^[\d.]+$/.test(p)) return `${cur}${Number(p) % 1 ? Number(p).toFixed(2) : Number(p)}`;
  return p.replace(/(\d+(?:\.\d+)?)/g, `${cur}$1`).replace(/\s*\/\s*/g, " / ");
}
export function sections(dishes: Dish[]) {
  const order: string[] = [];
  for (const d of dishes) if (!order.includes(d.section)) order.push(d.section);
  return order.map((s) => ({ name: s, dishes: dishes.filter((d) => d.section === s) }));
}

const SPICE = ["", "微辣", "中辣", "特辣"];
const SPICE_EN = ["", "mild", "medium", "hot"];

export async function menuPdf(dishes: Dish[], o: MenuOpts, fontPath?: string): Promise<Uint8Array> {
  const k = await newPdf(fontPath);
  const [W, H] = PAGE[o.page];
  const s = o.page === "A5" ? 0.8 : 1;
  const margin = 16 * MM * s;
  const cols = o.layout === "twocol" ? 2 : 1;
  const gap = 10 * MM * s;
  const colW = (W - 2 * margin - (cols - 1) * gap) / cols;
  const accent = hexRgb(o.accent, "#9a3412");
  const sz = { name: (o.layout === "compact" ? 10.5 : 12) * s, en: 8.5 * s, desc: 8.5 * s, sec: (o.layout === "compact" ? 13 : 16) * s, tag: 7 * s };
  const lh = 1.35;
  let page: PDFPage = k.doc.addPage([W, H]);
  let col = 0;
  let top = H - margin;
  const header = () => {
    k.text(page, o.title, W / 2, top - 24 * s, { size: 26 * s, bold: true, align: "center", color: o.accent });
    let y = top - 24 * s;
    if (o.subtitle) { y -= 16 * s; k.text(page, o.subtitle, W / 2, y, { size: 10 * s, align: "center", color: "#6b7280" }); }
    y -= 12 * s;
    page.drawLine({ start: { x: W / 2 - 40, y }, end: { x: W / 2 + 40, y }, thickness: 1.2, color: accent });
    return y - 16 * s;
  };
  let y = header();
  const colTop = () => (k.doc.getPageCount() === 1 ? firstTop : H - margin);
  const firstTop = y;
  const x0 = () => margin + col * (colW + gap);
  let balance = -Infinity; // 双栏时第一页左栏到这里就换栏，让两栏高度接近
  const next = (need: number) => {
    if (cols > 1 && col === 0 && k.doc.getPageCount() === 1 && y - need < balance && y < firstTop) { col++; y = colTop(); return; }
    if (y - need >= margin + 22 * s) return;
    if (col < cols - 1) { col++; y = colTop(); return; }
    page = k.doc.addPage([W, H]); col = 0; y = H - margin;
  };
  const itemHeight = (d: Dish) => {
    const w = colW - (d.price ? 0 : 0);
    let h = sz.name * lh;
    if (o.bilingual && d.nameEn) h += sz.en * lh;
    if (d.desc) h += k.wrap(d.desc, sz.desc, w).length * sz.desc * lh;
    if (d.allergens || d.spicy || d.veg) h += sz.tag * 1.8;
    return h + (o.layout === "compact" ? 4 : 8) * s;
  };
  if (cols > 1) {
    const total = sections(dishes).reduce((n, sec) => n + sz.sec * 2.2 + 6 * s + sec.dishes.reduce((m, d) => m + itemHeight(d), 0), 0);
    if (total < 2 * (firstTop - margin - 22 * s)) balance = firstTop - total / 2 - sz.name;
  }
  for (const sec of sections(dishes)) {
    next(sz.sec * 2.2 + itemHeight(sec.dishes[0]));
    y -= sz.sec;
    k.text(page, sec.name, x0(), y, { size: sz.sec, bold: true, color: o.accent });
    y -= sz.sec * 0.5;
    page.drawLine({ start: { x: x0(), y }, end: { x: x0() + colW, y }, thickness: 0.6, color: accent, opacity: 0.6 });
    y -= sz.sec * 0.7;
    for (const d of sec.dishes) {
      next(itemHeight(d));
      const x = x0();
      y -= sz.name;
      const price = priceText(d.price, o.currency);
      const pw = k.width(price, sz.name, true);
      const nameMax = colW - pw - 30;
      k.text(page, d.name, x, y, { size: sz.name, bold: true, maxWidth: nameMax });
      let nx = x + Math.min(k.width(d.name, sz.name, true), nameMax) + 6;
      if (d.star) {
        const badge = o.bilingual ? "推荐 Chef's pick" : "推荐";
        const bw = k.width(badge, sz.tag) + 8;
        page.drawRectangle({ x: nx, y: y - 1.5, width: bw, height: sz.tag + 4, color: accent, borderWidth: 0 });
        k.text(page, badge, nx + 4, y + 0.5, { size: sz.tag, color: "#ffffff" });
        nx += bw + 4;
      }
      if (price) {
        k.text(page, price, x + colW, y, { size: sz.name, bold: true, align: "right" });
        const from = nx + 4, to = x + colW - pw - 6;
        for (let dx = from; dx < to; dx += 4) page.drawCircle({ x: dx, y: y + 2, size: 0.45, color: rgb(0.6, 0.6, 0.6) });
      }
      y -= sz.name * (lh - 1);
      if (o.bilingual && d.nameEn) { y -= sz.en; k.text(page, d.nameEn, x, y, { size: sz.en, color: "#6b7280", maxWidth: colW }); y -= sz.en * (lh - 1); }
      if (d.desc) for (const line of k.wrap(d.desc, sz.desc, colW)) { y -= sz.desc; k.text(page, line, x, y, { size: sz.desc, color: "#374151" }); y -= sz.desc * (lh - 1); }
      if (d.allergens || d.spicy || d.veg) {
        y -= sz.tag * 1.5;
        let tx = x;
        for (let i = 0; i < d.spicy; i++) { page.drawCircle({ x: tx + 3, y: y + 2.5, size: 2.6, color: rgb(0.86, 0.15, 0.15) }); tx += 7; }
        if (d.spicy) { const t = o.bilingual ? `${SPICE[d.spicy]} ${SPICE_EN[d.spicy]}` : SPICE[d.spicy]; k.text(page, t, tx + 1, y, { size: sz.tag, color: "#b91c1c" }); tx += k.width(t, sz.tag) + 9; }
        if (d.veg) { const t = o.bilingual ? "素 Vegetarian" : "素食"; page.drawCircle({ x: tx + 3, y: y + 2.5, size: 2.6, color: rgb(0.13, 0.55, 0.13) }); k.text(page, t, tx + 8, y, { size: sz.tag, color: "#15803d" }); tx += k.width(t, sz.tag) + 16; }
        if (d.allergens) k.text(page, `${o.bilingual ? "含 Contains" : "含"}：${d.allergens}`, tx, y, { size: sz.tag, color: "#92400e", maxWidth: x + colW - tx });
      }
      y -= (o.layout === "compact" ? 4 : 8) * s;
    }
    y -= 6 * s;
  }
  const pages = k.doc.getPages();
  pages.forEach((pg, i) => {
    const fy = margin * 0.6;
    if (o.footer) k.text(pg, o.footer, W / 2, fy, { size: 8 * s, align: "center", color: "#6b7280" });
    if (pages.length > 1) k.text(pg, `${i + 1} / ${pages.length}`, W - margin, fy, { size: 8 * s, align: "right", color: "#9ca3af" });
  });
  if (o.qrPng) {
    const last = pages[pages.length - 1];
    const img = await k.doc.embedPng(o.qrPng);
    const q = 26 * MM * s;
    last.drawImage(img, { x: margin, y: margin * 0.4, width: q, height: q });
    k.text(last, o.bilingual ? "扫码看电子菜单 Scan for the web menu" : "扫码看电子菜单", margin + q + 6, margin * 0.4 + q / 2 - 3, { size: 8 * s, color: "#6b7280" });
  }
  void ({} as PdfKit);
  return k.doc.save();
}

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function menuHtml(dishes: Dish[], o: MenuOpts): string {
  const secs = sections(dishes);
  const id = (i: number) => `s${i + 1}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(o.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#fffaf5;color:#1f2937}
header{text-align:center;padding:28px 16px 10px}h1{margin:0;color:${o.accent};font-size:26px}.sub{color:#6b7280;margin-top:6px}
nav{position:sticky;top:0;background:#fffaf5ee;backdrop-filter:blur(6px);display:flex;gap:8px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid #f1e4d6}
nav a{flex:none;color:${o.accent};border:1px solid ${o.accent}55;border-radius:999px;padding:5px 12px;text-decoration:none;font-size:14px}
main{max-width:680px;margin:0 auto;padding:6px 16px 40px}h2{color:${o.accent};font-size:19px;margin:26px 0 8px;border-bottom:1px solid ${o.accent}44;padding-bottom:6px;scroll-margin-top:56px}
.d{padding:10px 0;border-bottom:1px dashed #eadccd}.r{display:flex;gap:10px;align-items:baseline}.n{font-weight:700;font-size:16px;flex:1}.p{font-weight:700;white-space:nowrap}
.en{color:#6b7280;font-size:13px}.ds{font-size:14px;color:#374151;margin-top:2px}.tags{margin-top:4px;font-size:12px;display:flex;gap:6px;flex-wrap:wrap}
.tags span{border-radius:4px;padding:1px 6px}.hot{background:#fee2e2;color:#b91c1c}.veg{background:#dcfce7;color:#15803d}.al{background:#fef3c7;color:#92400e}.star{background:${o.accent};color:#fff;font-size:11px;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:2px;font-weight:400}
footer{text-align:center;color:#9ca3af;font-size:12px;padding:20px}
</style></head><body>
<header><h1>${h(o.title)}</h1>${o.subtitle ? `<div class="sub">${h(o.subtitle)}</div>` : ""}</header>
<nav>${secs.map((s, i) => `<a href="#${id(i)}">${h(s.name)}</a>`).join("")}</nav>
<main>
${secs.map((s, i) => `<h2 id="${id(i)}">${h(s.name)}</h2>
${s.dishes.map((d) => `<div class="d"><div class="r"><span class="n">${h(d.name)}${d.star ? `<span class="star">推荐${o.bilingual ? " Chef's pick" : ""}</span>` : ""}</span><span class="p">${h(priceText(d.price, o.currency))}</span></div>${o.bilingual && d.nameEn ? `<div class="en">${h(d.nameEn)}</div>` : ""}${d.desc ? `<div class="ds">${h(d.desc)}</div>` : ""}${d.spicy || d.veg || d.allergens ? `<div class="tags">${d.spicy ? `<span class="hot">${"🌶".repeat(d.spicy)} ${SPICE[d.spicy]}</span>` : ""}${d.veg ? `<span class="veg">素食${o.bilingual ? " Vegetarian" : ""}</span>` : ""}${d.allergens ? `<span class="al">含：${h(d.allergens)}</span>` : ""}</div>` : ""}</div>`).join("\n")}`).join("\n")}
</main>
${o.footer ? `<footer>${h(o.footer)}</footer>` : ""}
</body></html>
`;
}
