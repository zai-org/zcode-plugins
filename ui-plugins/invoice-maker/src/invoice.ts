import type { PDFPage } from "pdf-lib";
import { num, round2 } from "./kit/columns.ts";
import { esc } from "./kit/app.ts";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface Line { invoice: string; client: string; address: string; item: string; qty: unknown; price: unknown; tax: unknown }
export interface Settings {
  seller: string; sellerInfo: string; currency: string; taxRate: number; prefix: string; start: number; date: string; dueDays: number;
  notes: string; accent: string; paper: "A4" | "Letter"; lang: "zh" | "en" | "both";
}
export interface Invoice { number: string; client: string; address: string; lines: (Line & { index: number; q: number; p: number; t: number; amount: number; taxAmount: number })[]; subtotal: number; tax: number; total: number; date: string; due: string }

export const SYMBOL: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$", TWD: "NT$", SGD: "S$", AUD: "A$", CAD: "C$" };
export const money = (n: number, cur: string) => `${SYMBOL[cur] ?? cur + " "}${(cur === "JPY" ? Math.round(n) : n).toLocaleString("en-US", { minimumFractionDigits: cur === "JPY" ? 0 : 2, maximumFractionDigits: cur === "JPY" ? 0 : 2 })}`;

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
export const qtyOf = (v: unknown) => { const s = String(v ?? "").trim(); return s in CN_NUM ? CN_NUM[s] : num(v === "" ? 1 : v); };

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 按发票号（或客户）分组，算每行金额、税额与合计；没有发票号的按客户依次编号。 */
export function buildInvoices(lines: Line[], s: Settings) {
  const issues: { level: "error" | "warn"; message: string; row?: number; key?: string }[] = [];
  const groups = new Map<string, Invoice>();
  let next = s.start;
  const autoNumbers = new Map<string, string>();
  lines.forEach((line, index) => {
    const q = qtyOf(line.qty), p = num(line.price);
    const t = line.tax === "" || line.tax === undefined || line.tax === null ? s.taxRate : num(line.tax);
    if (!String(line.client ?? "").trim()) issues.push({ level: "error", row: index, key: "client", message: "Missing client / 缺少客户" });
    if (!String(line.item ?? "").trim()) issues.push({ level: "warn", row: index, key: "item", message: "Empty item description / 项目说明为空" });
    if (!Number.isFinite(q)) issues.push({ level: "error", row: index, key: "qty", message: `Quantity is not a number: "${line.qty}" / 数量不是数字` });
    if (!Number.isFinite(p)) issues.push({ level: "error", row: index, key: "price", message: `Price is not a number: "${line.price}" / 单价不是数字` });
    if (!Number.isFinite(t) || t < 0 || t > 100) issues.push({ level: "error", row: index, key: "tax", message: `Tax rate must be 0–100: "${line.tax}" / 税率应在 0–100` });
    const client = String(line.client ?? "").trim();
    let key: string;
    if (String(line.invoice ?? "").trim()) key = String(line.invoice).trim();
    else {
      if (!autoNumbers.has(client)) autoNumbers.set(client, `${s.prefix}${String(next++).padStart(4, "0")}`);
      key = autoNumbers.get(client)!;
    }
    let inv = groups.get(key!);
    if (!inv) {
      inv = { number: key!, client, address: String(line.address ?? "").trim(), lines: [], subtotal: 0, tax: 0, total: 0, date: s.date, due: addDays(s.date, s.dueDays) };
      groups.set(key!, inv);
    } else if (client && inv.client && client !== inv.client) issues.push({ level: "error", row: index, key: "invoice", message: `Invoice ${key} already belongs to "${inv.client}" / 同一发票号对应了不同客户` });
    if (!inv.address && line.address) inv.address = String(line.address).trim();
    const qq = Number.isFinite(q) ? q : 0, pp = Number.isFinite(p) ? p : 0, tt = Number.isFinite(t) ? t : 0;
    const amount = round2(qq * pp), taxAmount = round2((amount * tt) / 100);
    inv.lines.push({ ...line, index, q: qq, p: pp, t: tt, amount, taxAmount });
  });
  for (const inv of groups.values()) {
    inv.subtotal = round2(inv.lines.reduce((a, l) => a + l.amount, 0));
    inv.tax = round2(inv.lines.reduce((a, l) => a + l.taxAmount, 0));
    inv.total = round2(inv.subtotal + inv.tax);
    if (inv.total <= 0) issues.push({ level: "warn", row: inv.lines[0].index, message: `Invoice ${inv.number} total is ${inv.total} / 发票合计不大于 0` });
    if (!inv.address) issues.push({ level: "warn", row: inv.lines[0].index, key: "address", message: `Invoice ${inv.number}: no client address / 没有客户地址` });
  }
  if (!s.seller.trim()) issues.push({ level: "warn", message: "Set your business name in settings (seller) / 请在设置里填写开票方名称" });
  return { invoices: [...groups.values()], issues };
}

const L = (s: Settings, zh: string, en: string) => (s.lang === "zh" ? zh : s.lang === "en" ? en : `${zh} ${en}`);

export function previewHtml(inv: Invoice | undefined, s: Settings, count: number) {
  if (!inv) return "";
  const rows = inv.lines.map((l) => `<tr><td>${esc(l.item)}</td><td class="num">${l.q}</td><td class="num">${esc(money(l.p, s.currency))}</td><td class="num">${l.t}%</td><td class="num">${esc(money(l.amount, s.currency))}</td></tr>`).join("");
  return `<div class="inv-prev" style="font-size:12px"><div style="display:flex;justify-content:space-between;border-bottom:3px solid ${esc(s.accent)};padding-bottom:6px"><div><b style="font-size:15px">${esc(s.seller || "—")}</b><div class="muted" style="white-space:pre-line">${esc(s.sellerInfo)}</div></div><div style="text-align:right"><b style="font-size:16px;color:${esc(s.accent)}">${esc(L(s, "发票", "INVOICE"))}</b><div>${esc(inv.number)}</div><div class="muted">${esc(inv.date)} → ${esc(inv.due)}</div></div></div>
<p><b>${esc(L(s, "客户", "Bill to"))}:</b> ${esc(inv.client)}<br><span class="muted">${esc(inv.address)}</span></p>
<table class="data"><thead><tr><th>${esc(L(s, "项目", "Item"))}</th><th>${esc(L(s, "数量", "Qty"))}</th><th>${esc(L(s, "单价", "Price"))}</th><th>${esc(L(s, "税率", "Tax"))}</th><th>${esc(L(s, "金额", "Amount"))}</th></tr></thead><tbody>${rows}</tbody></table>
<p style="text-align:right">${esc(L(s, "小计", "Subtotal"))} ${esc(money(inv.subtotal, s.currency))} · ${esc(L(s, "税额", "Tax"))} ${esc(money(inv.tax, s.currency))}<br><b style="font-size:14px">${esc(L(s, "合计", "Total"))} ${esc(money(inv.total, s.currency))}</b></p>
${count > 1 ? `<p class="muted">1 / ${count}</p>` : ""}</div>`;
}

function drawInvoice(k: PdfKit, page: PDFPage, inv: Invoice, s: Settings) {
  const size = page.getSize();
  const w = size.width, h = size.height;
  const m = 18 * MM;
  const accent = hexRgb(s.accent, "#2563eb");
  page.drawRectangle({ x: 0, y: h - 6, width: w, height: 6, color: accent });
  let y = h - m;
  k.text(page, s.seller || "", m, y - 4, { size: 15, bold: true, maxWidth: w / 2 });
  let yy = y - 20;
  for (const line of s.sellerInfo.split(/\r?\n/).filter(Boolean).slice(0, 5)) { k.text(page, line, m, yy, { size: 9, color: "#6b7280", maxWidth: w / 2 }); yy -= 12; }
  k.text(page, L(s, "发票", "INVOICE"), w - m, y - 4, { size: 20, bold: true, color: s.accent, align: "right" });
  k.text(page, `${L(s, "编号", "No.")} ${inv.number}`, w - m, y - 24, { size: 10, align: "right" });
  k.text(page, `${L(s, "开票日期", "Date")} ${inv.date}`, w - m, y - 37, { size: 9, align: "right", color: "#374151" });
  k.text(page, `${L(s, "付款期限", "Due")} ${inv.due}`, w - m, y - 49, { size: 9, align: "right", color: "#374151" });
  y = Math.min(yy, y - 60) - 16;
  k.text(page, L(s, "客户", "Bill to"), m, y, { size: 9, color: "#6b7280" });
  k.text(page, inv.client, m, y - 14, { size: 12, bold: true, maxWidth: w - 2 * m });
  let ay = y - 28;
  for (const line of k.wrap(inv.address, 9, w / 2).slice(0, 3)) { k.text(page, line, m, ay, { size: 9, color: "#374151" }); ay -= 12; }
  y = ay - 14;
  const cols = [m, w - m - 300, w - m - 230, w - m - 140, w - m - 70];
  const header = [L(s, "项目", "Item"), L(s, "数量", "Qty"), L(s, "单价", "Price"), L(s, "税率", "Tax"), L(s, "金额", "Amount")];
  page.drawRectangle({ x: m, y: y - 6, width: w - 2 * m, height: 20, color: hexRgb("#f3f4f6") });
  header.forEach((t, i) => k.text(page, t, i === 0 ? cols[0] + 4 : i === 4 ? w - m - 4 : cols[i] + 60, y, { size: 9, bold: true, align: i === 0 ? "left" : "right" }));
  y -= 22;
  for (const l of inv.lines) {
    const desc = k.wrap(String(l.item ?? ""), 9.5, cols[1] - cols[0] - 10);
    if (y - desc.length * 12 < 120) break; // v0.1：单页发票，超出的行在问题列表里提示
    desc.forEach((d, i) => k.text(page, d, cols[0] + 4, y - i * 12, { size: 9.5 }));
    k.text(page, String(l.q), cols[1] + 60, y, { size: 9.5, align: "right" });
    k.text(page, money(l.p, s.currency), cols[2] + 60, y, { size: 9.5, align: "right" });
    k.text(page, `${l.t}%`, cols[3] + 60, y, { size: 9.5, align: "right" });
    k.text(page, money(l.amount, s.currency), w - m - 4, y, { size: 9.5, align: "right" });
    y -= desc.length * 12 + 6;
    page.drawLine({ start: { x: m, y: y + 11 }, end: { x: w - m, y: y + 11 }, thickness: 0.4, color: hexRgb("#e5e7eb") });
  }
  y -= 8;
  const tot = [[L(s, "小计", "Subtotal"), money(inv.subtotal, s.currency)], [L(s, "税额", "Tax"), money(inv.tax, s.currency)]];
  for (const [a, b] of tot) { k.text(page, a, w - m - 150, y, { size: 10, color: "#374151" }); k.text(page, b, w - m - 4, y, { size: 10, align: "right" }); y -= 15; }
  page.drawRectangle({ x: w - m - 160, y: y - 8, width: 160, height: 22, color: accent });
  k.text(page, L(s, "合计", "Total"), w - m - 150, y - 1, { size: 11, bold: true, color: "#ffffff" });
  k.text(page, money(inv.total, s.currency), w - m - 6, y - 1, { size: 11, bold: true, color: "#ffffff", align: "right" });
  if (s.notes.trim()) {
    let ny = 100;
    for (const line of k.wrap(s.notes, 9, w - 2 * m).slice(0, 5)) { k.text(page, line, m, ny, { size: 9, color: "#4b5563" }); ny -= 12; }
  }
}

export function invoiceTooLong(inv: Invoice) {
  return inv.lines.length > 22;
}

export async function renderPdf(invoices: Invoice[], s: Settings, fontPath?: string) {
  const k = await newPdf(fontPath);
  for (const inv of invoices) drawInvoice(k, k.doc.addPage(PAGE[s.paper] ?? PAGE.A4), inv, s);
  return { bytes: await k.doc.save(), cjk: k.cjk };
}
