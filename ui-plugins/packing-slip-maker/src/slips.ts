import type { PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { code128 } from "./code128.ts";

export interface Line { row: number; sku: string; item: string; variant: string; qty: number; location: string; price: number }
export interface Order { number: string; date: string; customer: string; phone: string; address: string; method: string; gift: string; note: string; lines: Line[]; rows: number[] }
export interface Issue { level: "error" | "warn" | "info"; message: string; row?: number; key?: string }
export interface SlipSettings { shop: string; shopInfo: string; footer: string; paper: "A4" | "A5"; maskPhone: boolean; showPrices: boolean; currency: string; accent: string; barcode: boolean }

const s = (v: unknown) => String(v ?? "").trim();
const numOf = (v: unknown) => { const n = Number(String(v ?? "").replace(/[,，\s¥￥$]/g, "")); return String(v ?? "").trim() === "" ? NaN : n; };

/** 同一订单号的行合成一个订单；订单级字段取第一个非空值，不一致时提示。 */
export function groupOrders(rows: Record<string, unknown>[]) {
  const issues: Issue[] = [];
  const orders = new Map<string, Order>();
  rows.forEach((r, row) => {
    const number = s(r.order);
    if (!number) { issues.push({ level: "error", row, key: "order", message: "No order number / 没有订单号" }); return; }
    let o = orders.get(number);
    if (!o) { o = { number, date: "", customer: "", phone: "", address: "", method: "", gift: "", note: "", lines: [], rows: [] }; orders.set(number, o); }
    for (const k of ["date", "customer", "phone", "address", "method", "gift", "note"] as const) {
      const v = s(r[k]);
      if (!v) continue;
      if (!o[k]) o[k] = v;
      else if (o[k] !== v && k !== "gift" && k !== "note") issues.push({ level: "warn", row, key: k, message: `Order ${number}: ${k} differs from an earlier row (“${o[k]}” vs “${v}”); using the first / 同一订单的${k}不一致` });
      else if (o[k] !== v) o[k] = `${o[k]}\n${v}`;
    }
    const qty = numOf(r.qty);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) { issues.push({ level: "error", row, key: "qty", message: `Quantity “${s(r.qty)}” should be a whole number above 0 / 数量应为正整数` }); }
    const sku = s(r.sku), variant = s(r.variant);
    const same = o.lines.find((l) => l.sku && l.sku === sku && l.variant === variant);
    if (same && Number.isFinite(qty)) { same.qty += qty; issues.push({ level: "info", row, message: `Order ${number}: ${sku} appears twice — merged into one line of ${same.qty} / 同一商品出现两次，已合并` }); }
    else o.lines.push({ row, sku, item: s(r.item), variant, qty: Number.isFinite(qty) ? qty : 0, location: s(r.location), price: numOf(r.price) });
    o.rows.push(row);
  });
  for (const o of orders.values()) {
    if (!o.customer) issues.push({ level: "warn", row: o.rows[0], key: "customer", message: `Order ${o.number}: no recipient / 没有收件人` });
    if (!o.address) issues.push({ level: "warn", row: o.rows[0], key: "address", message: `Order ${o.number}: no shipping address / 没有收货地址` });
    if (o.gift.length > 160) issues.push({ level: "warn", row: o.rows[0], key: "gift", message: `Order ${o.number}: gift message is ${o.gift.length} characters; only about 160 fit on the slip / 礼品留言过长` });
    if (/[^\x20-\x7e]/.test(o.number)) issues.push({ level: "info", row: o.rows[0], message: `Order ${o.number}: not plain ASCII, so no barcode is printed / 订单号含中文，不打印条码` });
  }
  return { orders: [...orders.values()], issues };
}

/** 电话打码：保留前 3 位和后 4 位数字，中间换成 *（13812345678 → 138****5678）。 */
export function maskPhone(p: string) {
  const total = p.replace(/\D/g, "").length;
  if (total < 8) return p;
  let n = 0;
  return p.replace(/\d/g, (d) => (n++ >= 3 && n <= total - 4 ? "*" : d));
}

/** 按货号（和规格）汇总拣货数量；按库位排序，便于一趟走完。 */
export function pickList(orders: Order[]) {
  const map = new Map<string, { sku: string; item: string; variant: string; location: string; qty: number; orders: string[] }>();
  for (const o of orders) for (const l of o.lines) {
    const k = `${l.sku}\u0000${l.variant}`;
    const e = map.get(k) ?? { sku: l.sku, item: l.item, variant: l.variant, location: l.location, qty: 0, orders: [] };
    e.qty += l.qty;
    if (!e.orders.includes(o.number)) e.orders.push(o.number);
    if (!e.location && l.location) e.location = l.location;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => (a.location || "\uffff").localeCompare(b.location || "\uffff") || a.sku.localeCompare(b.sku));
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, h: number, maxW: number) {
  const widths = code128(text);
  const modules = widths.reduce((a, b) => a + b, 0);
  const mod = Math.min(1.1, maxW / modules);
  let bx = x - modules * mod; // 右对齐
  widths.forEach((w, i) => { if (i % 2 === 0) page.drawRectangle({ x: bx, y, width: w * mod, height: h }); bx += w * mod; });
}

function drawSlip(k: PdfKit, o: Order, st: SlipSettings) {
  const [W, H] = PAGE[st.paper] ?? PAGE.A4;
  const small = st.paper === "A5";
  const m = (small ? 12 : 18) * MM;
  const f = small ? 0.88 : 1;
  const accent = hexRgb(st.accent || "#111827");
  let page = k.doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: accent });
  let y = H - m;
  k.text(page, st.shop, m, y - 2, { size: 14 * f, bold: true, maxWidth: W / 2 });
  k.text(page, "发货单 PACKING SLIP", m, y - 20 * f, { size: 10 * f, color: "#6b7280" });
  const ascii = !/[^\x20-\x7e]/.test(o.number);
  if (st.barcode && ascii) drawBarcode(page, o.number, W - m, y - 30 * f, 28 * f, W / 2 - m);
  k.text(page, o.number, W - m, y - 42 * f, { size: 10 * f, bold: true, align: "right" });
  if (o.date) k.text(page, o.date, W - m, y - 54 * f, { size: 8.5 * f, color: "#6b7280", align: "right" });
  y -= 76 * f;
  k.text(page, "收件人 Ship to", m, y, { size: 8 * f, color: "#6b7280" });
  k.text(page, `${o.customer}${o.phone ? "   " + (st.maskPhone ? maskPhone(o.phone) : o.phone) : ""}`, m, y - 14 * f, { size: 11 * f, bold: true, maxWidth: W * 0.62 - m });
  const addr = k.wrap(o.address || "（没有地址 no address）", 9.5 * f, W * 0.62 - m).slice(0, 3);
  addr.forEach((l, i) => k.text(page, l, m, y - 28 * f - i * 12 * f, { size: 9.5 * f, color: o.address ? "#111827" : "#dc2626" }));
  if (o.method) { k.text(page, "配送 Shipping", W - m, y, { size: 8 * f, color: "#6b7280", align: "right" }); k.text(page, o.method, W - m, y - 14 * f, { size: 10.5 * f, bold: true, align: "right" }); }
  y -= (34 + addr.length * 12) * f;
  const X = { box: m + 4, sku: m + 20, item: m + (small ? 90 : 110), variant: W - m - (st.showPrices ? 200 : 130), loc: W - m - (st.showPrices ? 140 : 70), qty: W - m - (st.showPrices ? 60 : 4), price: W - m - 4 };
  const header = () => {
    page.drawRectangle({ x: m, y: y - 5, width: W - 2 * m, height: 17 * f, color: hexRgb("#f3f4f6") });
    k.text(page, "货号 SKU", X.sku, y, { size: 8 * f, bold: true });
    k.text(page, "商品 Item", X.item, y, { size: 8 * f, bold: true });
    k.text(page, "规格 Variant", X.variant, y, { size: 8 * f, bold: true });
    k.text(page, "库位 Bin", X.loc, y, { size: 8 * f, bold: true });
    k.text(page, "数量 Qty", X.qty, y, { size: 8 * f, bold: true, align: "right" });
    if (st.showPrices) k.text(page, "金额 Amount", X.price, y, { size: 8 * f, bold: true, align: "right" });
    y -= 20 * f;
  };
  header();
  for (const l of o.lines) {
    const lines = k.wrap(l.item, 9 * f, X.variant - X.item - 6).slice(0, 2);
    if (y - lines.length * 11 < 100 * f) { page = k.doc.addPage([W, H]); y = H - m; k.text(page, `${o.number} (续 cont.)`, m, y, { size: 9, color: "#6b7280" }); y -= 20; header(); }
    page.drawRectangle({ x: X.box, y: y - 2, width: 8 * f, height: 8 * f, borderColor: hexRgb("#6b7280"), borderWidth: 0.6 });
    k.text(page, l.sku, X.sku, y, { size: 8.5 * f, maxWidth: X.item - X.sku - 4 });
    lines.forEach((t, i) => k.text(page, t, X.item, y - i * 11 * f, { size: 9 * f }));
    k.text(page, l.variant, X.variant, y, { size: 8.5 * f, color: "#374151", maxWidth: X.loc - X.variant - 4 });
    k.text(page, l.location, X.loc, y, { size: 8.5 * f, color: "#374151", maxWidth: X.qty - X.loc - 24 });
    k.text(page, String(l.qty), X.qty, y, { size: 11 * f, bold: true, align: "right" });
    if (st.showPrices && Number.isFinite(l.price)) k.text(page, `${st.currency}${(l.price * l.qty).toFixed(2)}`, X.price, y, { size: 8.5 * f, align: "right" });
    y -= (lines.length * 11 + 7) * f;
    page.drawLine({ start: { x: m, y: y + 10 * f }, end: { x: W - m, y: y + 10 * f }, thickness: 0.3, color: hexRgb("#e5e7eb") });
  }
  const totalQty = o.lines.reduce((a, l) => a + l.qty, 0);
  k.text(page, `共 ${o.lines.length} 种 ${totalQty} 件 · ${o.lines.length} line(s), ${totalQty} item(s)`, W - m, y - 4, { size: 9 * f, bold: true, align: "right" });
  y -= 22 * f;
  if (o.note) { for (const [i, t] of k.wrap(`备注 Note: ${o.note.replace(/\n/g, "；")}`, 8.5 * f, W - 2 * m).slice(0, 2).entries()) k.text(page, t, m, y - i * 11, { size: 8.5 * f, color: "#b45309" }); y -= 26 * f; }
  if (o.gift) {
    const g = k.wrap(o.gift.replace(/\n/g, " "), 11 * f, W - 2 * m - 24).slice(0, 4);
    const gh = (24 + g.length * 15) * f;
    if (y - gh < 50) { page = k.doc.addPage([W, H]); y = H - m; }
    page.drawRectangle({ x: m, y: y - gh, width: W - 2 * m, height: gh, borderColor: accent, borderWidth: 0.8, borderDashArray: [3, 2] });
    k.text(page, "礼品留言 Gift message", m + 12, y - 14 * f, { size: 8 * f, color: "#6b7280" });
    g.forEach((t, i) => k.text(page, t, m + 12, y - (30 + i * 15) * f, { size: 11 * f }));
    y -= gh + 12;
  }
  const foot = [st.footer, st.shopInfo].filter(Boolean).join("\n").split(/\r?\n/).filter(Boolean).slice(0, 3);
  foot.forEach((t, i) => k.text(page, t, W / 2, m + (foot.length - 1 - i) * 11, { size: 8 * f, color: "#6b7280", align: "center", maxWidth: W - 2 * m }));
}

export async function renderSlips(orders: Order[], st: SlipSettings) {
  const k = await newPdf();
  for (const o of orders) drawSlip(k, o, st);
  return { bytes: await k.doc.save(), cjk: k.cjk };
}
