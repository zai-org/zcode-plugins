import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num, parseDate } from "./kit/columns.ts";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { dailyDemand, plan, type Plan } from "./reorder.ts";

export const NAME = "inventory-reorder";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const n0 = (v: unknown, d = 0) => { const x = num(v); return Number.isFinite(x) ? x : d; };
const NO_SUPPLIER = "未指定供应商 No supplier";
const STOCK = {
  sku: ["sku", "货号", "商品编码", "编码", "料号", "item code", "code", "product code"],
  name: ["品名", "商品名称", "名称", "产品", "name", "product", "description", "item"],
  supplier: ["供应商", "厂家", "supplier", "vendor"],
  onHand: ["现有库存", "库存", "当前库存", "在库", "on hand", "stock", "qty on hand", "inventory"],
  onOrder: ["在途", "已下单", "在途数量", "on order", "incoming", "in transit"],
  daily: ["日均销量", "日均", "avg daily sales", "daily sales", "daily"],
  sold30: ["近30天销量", "30天销量", "月销量", "sales 30d", "last 30 days", "monthly sales"],
  lead: ["交货期", "交期", "到货天数", "lead time", "lead days", "lead"],
  moq: ["起订量", "最小起订量", "moq", "min order"],
  pack: ["箱规", "每箱", "包装数", "pack size", "case qty", "case", "pack"],
  cost: ["进价", "采购价", "成本", "单价", "unit cost", "cost", "price"],
  safety: ["安全天数", "安全库存天数", "safety days", "safety"],
};
const SALES = { date: ["日期", "销售日期", "date", "day"], sku: STOCK.sku, qty: ["数量", "销量", "销售数量", "qty", "quantity", "units", "sold"] };

async function loadAll(ws: Parameters<AppDef["load"]>[0]["ws"], files: string[], lookback: number) {
  const tables = await Promise.all(files.map((f) => readTable(ws, f)));
  const isStock = (cols: string[]) => !!mapHeaders(cols, { onHand: STOCK.onHand }).onHand;
  const si = tables.findIndex((t) => isStock(t.columns));
  if (si < 0) throw new KitError("no_stock", `None of the files has a stock column (库存/on hand). Columns: ${tables.map((t) => t.columns.join(", ")).join(" | ")}`);
  const stock = tables[si];
  const m = mapHeaders(stock.columns, STOCK);
  if (!m.sku) throw new KitError("no_sku", `The stock sheet needs a SKU column (货号/sku). Columns: ${stock.columns.join(", ")}`);
  let demand: ReturnType<typeof dailyDemand> | undefined;
  const salesTable = tables.find((_, i) => i !== si);
  const unknownSkus: string[] = [];
  if (salesTable) {
    const sm = mapHeaders(salesTable.columns, SALES);
    if (!sm.sku || !sm.qty || !sm.date) throw new KitError("bad_sales", `The sales sheet needs date, SKU and quantity columns (日期, 货号, 数量). Columns: ${salesTable.columns.join(", ")}`);
    const lines = salesTable.rows.map((r) => ({ date: parseDate(r[sm.date!]), sku: s(r[sm.sku!]), qty: n0(r[sm.qty!]) })).filter((l) => l.sku);
    demand = dailyDemand(lines, lookback);
    const known = new Set(stock.rows.map((r) => s(r[m.sku!])));
    for (const k of demand.daily.keys()) if (!known.has(k)) unknownSkus.push(k);
  }
  const rows: Row[] = stock.rows.filter((r) => s(r[m.sku!])).map((r) => {
    const sku = s(r[m.sku!]);
    const daily = demand ? demand.daily.get(sku) ?? 0 : m.daily ? n0(r[m.daily]) : m.sold30 ? n0(r[m.sold30]) / 30 : 0;
    return {
      sku, name: m.name ? s(r[m.name]) : "", supplier: m.supplier ? s(r[m.supplier]) : "", onHand: n0(r[m.onHand!]), onOrder: m.onOrder ? n0(r[m.onOrder]) : 0,
      daily: Math.round(daily * 100) / 100, lead: m.lead ? n0(r[m.lead], 7) : 7, moq: m.moq ? n0(r[m.moq]) : 0, pack: m.pack ? n0(r[m.pack], 1) : 1,
      cost: m.cost ? n0(r[m.cost]) : 0, safety: m.safety ? s(r[m.safety]) : "", order: "",
    };
  });
  return { rows, meta: { demand: demand ? { from: demand.from, to: demand.to, days: demand.days } : null, unknownSkus, hasDemand: !!(demand || m.daily || m.sold30) } };
}

interface Line { row: number; r: Row; p: Plan; qty: number; amount: number }
export function analyse(p: Project) {
  const safetyDays = n0(p.settings.safetyDays, 7), coverDays = n0(p.settings.coverDays, 30);
  const issues: Issue[] = [];
  const lines: Line[] = p.rows.map((r, row) => {
    const daily = n0(r.daily);
    const safety = s(r.safety) === "" ? undefined : n0(r.safety, safetyDays);
    const pl = plan({ sku: s(r.sku), onHand: n0(r.onHand), onOrder: n0(r.onOrder), lead: n0(r.lead, 7), moq: n0(r.moq), pack: n0(r.pack, 1), safetyDays: safety, daily }, { safetyDays, coverDays });
    const override = s(r.order);
    const qty = override === "" ? pl.suggest : Math.max(0, Math.round(n0(override)));
    if (override !== "" && !Number.isFinite(num(override))) issues.push({ level: "error", row, key: "order", message: `Order quantity “${override}” is not a number / 订货数量不是数字` });
    if (qty > 0 && n0(r.moq) > 0 && qty < n0(r.moq)) issues.push({ level: "warn", row, key: "order", message: `${s(r.sku)}: ${qty} is below the supplier's minimum order ${n0(r.moq)} / 低于起订量` });
    if (qty > 0 && n0(r.pack, 1) > 1 && qty % n0(r.pack, 1)) issues.push({ level: "warn", row, key: "order", message: `${s(r.sku)}: ${qty} is not a whole number of cases (${n0(r.pack)} per case) / 不是整箱` });
    if (n0(r.onHand) < 0) issues.push({ level: "warn", row, key: "onHand", message: `${s(r.sku)}: stock is negative (${n0(r.onHand)}) — check the count / 库存为负` });
    if (pl.runsOutBeforeArrival) issues.push({ level: "warn", row, message: `${s(r.sku)} ${s(r.name)}: about ${Math.floor((n0(r.onHand) + n0(r.onOrder)) / daily)} day(s) of stock but ${n0(r.lead)} day(s) lead time — it will run out before a new order arrives / 到货前会断货` });
    if (qty > 0 && !s(r.supplier)) issues.push({ level: "warn", row, key: "supplier", message: `${s(r.sku)}: no supplier — goes on the “${NO_SUPPLIER}” order / 没有供应商` });
    return { row, r, p: pl, qty, amount: Math.round(qty * n0(r.cost) * 100) / 100 };
  });
  const meta = p.meta as { unknownSkus?: string[]; hasDemand?: boolean; demand?: { from: string; to: string; days: number } | null };
  if (meta.unknownSkus?.length) issues.push({ level: "warn", message: `${meta.unknownSkus.length} SKU(s) in the sales sheet are not in the stock sheet: ${meta.unknownSkus.slice(0, 8).join(", ")}${meta.unknownSkus.length > 8 ? "…" : ""} / 销量表里有库存表没有的货号` });
  if (!meta.hasDemand) issues.push({ level: "info", message: "No sales data — add a sales sheet or fill 日均销量 (daily sales) to get suggestions / 没有销量数据" });
  const suppliers = new Map<string, Line[]>();
  for (const l of lines.filter((x) => x.qty > 0)) { const k = s(l.r.supplier) || NO_SUPPLIER; suppliers.set(k, [...(suppliers.get(k) ?? []), l]); }
  return { lines, suppliers, issues, safetyDays, coverDays, demand: meta.demand ?? null };
}

const money = (n: number, cur: string) => `${cur}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const poDate = (p: Project) => parseDate(p.settings.date) || new Date().toISOString().slice(0, 10);
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const poNumber = (p: Project, i: number) => `${s(p.settings.prefix) || "PO-"}${poDate(p).replace(/-/g, "")}-${String(i + 1).padStart(2, "0")}`;

function previewHtml(a: ReturnType<typeof analyse>, p: Project) {
  const cur = s(p.settings.currency) || "¥";
  const cards = [...a.suppliers].map(([sup, ls], i) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between"><b>${esc(sup)}</b><span class="muted">${esc(poNumber(p, i))}</span></div><table class="data" style="margin-top:4px"><tbody>${ls.map((l) => `<tr><td>${esc(s(l.r.sku))}</td><td>${esc(s(l.r.name))}</td><td class="num">${l.qty}</td><td class="num">${esc(money(l.amount, cur))}</td></tr>`).join("")}</tbody></table><div style="text-align:right;margin-top:4px"><b>${esc(money(ls.reduce((x, l) => x + l.amount, 0), cur))}</b></div></div>`).join("");
  const risk = a.lines.filter((l) => l.p.runsOutBeforeArrival).length;
  const window = a.demand ? `<p class="muted">日均销量按 ${esc(a.demand.from)} – ${esc(a.demand.to)}（${a.demand.days} 天）计算 · Daily sales from ${a.demand.days} day(s)</p>` : "";
  return `<div style="font-size:13px">${window}<p>安全天数 ${a.safetyDays} · 补货覆盖 ${a.coverDays} 天${risk ? ` · <b style="color:#dc2626">${risk} 个商品到货前会断货</b>` : ""}</p>${cards || "<p>现在不需要补货 / Nothing to reorder right now.</p>"}</div>`;
}

function drawPo(k: PdfKit, p: Project, sup: string, ls: Line[], number: string) {
  const cur = s(p.settings.currency) || "¥";
  const [W, H] = PAGE.A4;
  const m = 18 * MM;
  const accent = hexRgb(s(p.settings.accent) || "#1d4ed8");
  let page = k.doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
  let y = H - m;
  k.text(page, s(p.settings.buyer), m, y - 2, { size: 14, bold: true, maxWidth: W / 2 });
  let yy = y - 18;
  for (const line of s(p.settings.buyerInfo).split(/\r?\n/).filter(Boolean).slice(0, 4)) { k.text(page, line, m, yy, { size: 8.5, color: "#6b7280", maxWidth: W / 2 }); yy -= 11; }
  k.text(page, "采购单 PURCHASE ORDER", W - m, y - 2, { size: 16, bold: true, align: "right", color: s(p.settings.accent) || "#1d4ed8" });
  const date = poDate(p);
  const eta = addDays(date, Math.max(...ls.map((l) => n0(l.r.lead, 7))));
  k.text(page, `编号 No. ${number}`, W - m, y - 22, { size: 9.5, align: "right" });
  k.text(page, `日期 Date ${date}`, W - m, y - 35, { size: 9, align: "right", color: "#374151" });
  k.text(page, `要求到货 Deliver by ${eta}`, W - m, y - 47, { size: 9, align: "right", color: "#374151" });
  y = Math.min(yy, y - 58) - 14;
  k.text(page, "供应商 Supplier", m, y, { size: 8.5, color: "#6b7280" });
  k.text(page, sup, m, y - 14, { size: 12, bold: true, maxWidth: W / 2 - m });
  const deliver = s(p.settings.deliverTo);
  if (deliver) {
    k.text(page, "收货地址 Deliver to", W / 2, y, { size: 8.5, color: "#6b7280" });
    k.wrap(deliver, 9, W / 2 - m).slice(0, 3).forEach((l, i) => k.text(page, l, W / 2, y - 14 - i * 11, { size: 9 }));
  }
  y -= 44;
  const X = { no: m + 4, sku: m + 24, name: m + 110, qty: W - m - 190, pack: W - m - 135, cost: W - m - 70, amt: W - m - 4 };
  const header = () => {
    page.drawRectangle({ x: m, y: y - 5, width: W - 2 * m, height: 18, color: hexRgb("#f3f4f6") });
    k.text(page, "#", X.no, y, { size: 8.5, bold: true });
    k.text(page, "货号 SKU", X.sku, y, { size: 8.5, bold: true });
    k.text(page, "品名 Item", X.name, y, { size: 8.5, bold: true });
    k.text(page, "数量 Qty", X.qty, y, { size: 8.5, bold: true, align: "right" });
    k.text(page, "箱数 Cases", X.pack, y, { size: 8.5, bold: true, align: "right" });
    k.text(page, "单价 Unit", X.cost, y, { size: 8.5, bold: true, align: "right" });
    k.text(page, "金额 Amount", X.amt, y, { size: 8.5, bold: true, align: "right" });
    y -= 20;
  };
  header();
  ls.forEach((l, i) => {
    if (y < 120) { page = k.doc.addPage([W, H]); y = H - m; header(); }
    const pack = n0(l.r.pack, 1);
    k.text(page, String(i + 1), X.no, y, { size: 9 });
    k.text(page, s(l.r.sku), X.sku, y, { size: 9, maxWidth: X.name - X.sku - 6 });
    k.text(page, s(l.r.name), X.name, y, { size: 9, maxWidth: X.qty - X.name - 40 });
    k.text(page, l.qty.toLocaleString("en-US"), X.qty, y, { size: 9, align: "right" });
    k.text(page, pack > 1 ? `${Math.round((l.qty / pack) * 100) / 100} × ${pack}` : "—", X.pack, y, { size: 9, align: "right", color: "#4b5563" });
    k.text(page, money(n0(l.r.cost), cur), X.cost, y, { size: 9, align: "right" });
    k.text(page, money(l.amount, cur), X.amt, y, { size: 9, align: "right" });
    y -= 13;
    page.drawLine({ start: { x: m, y: y + 8 }, end: { x: W - m, y: y + 8 }, thickness: 0.3, color: hexRgb("#e5e7eb") });
  });
  y -= 8;
  const total = ls.reduce((x, l) => x + l.amount, 0);
  page.drawRectangle({ x: W - m - 180, y: y - 8, width: 180, height: 22, color: accent });
  k.text(page, `合计 Total（${ls.reduce((x, l) => x + l.qty, 0).toLocaleString("en-US")} 件）`, W - m - 172, y - 1, { size: 9.5, bold: true, color: "#ffffff" });
  k.text(page, money(total, cur), W - m - 6, y - 1, { size: 10.5, bold: true, color: "#ffffff", align: "right" });
  y -= 40;
  const note = s(p.settings.note);
  if (note) { k.wrap(note, 8.5, W - 2 * m).slice(0, 5).forEach((l, i) => k.text(page, l, m, y - i * 11, { size: 8.5, color: "#4b5563" })); y -= 66; }
  k.text(page, "采购签字 Buyer: ________________        供应商确认 Supplier: ________________", m, Math.max(y, 60), { size: 9, color: "#374151" });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "reorder",
  title: ["库存补货计划", "Reorder Planner"],
  openDescription:
    "Plan what to reorder: pass a stock sheet (.xlsx/.csv; 货号/sku, 品名/name, 供应商/supplier, 库存/on hand, 在途/on order, 交货期/lead time days, 起订量/MOQ, 箱规/pack size, 进价/cost) and optionally a sales sheet (日期/date, 货号/sku, 数量/qty) for daily demand over the last lookbackDays — or give 日均销量/daily or 30-day sales in the stock sheet. Reorder point = daily × (lead + safety days); below it the suggestion tops up to cover coverDays more, rounded up to whole cases and at least the MOQ. Set the order column to override. Flags items that will run out before a new order arrives. Exports purchase orders per supplier.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 2, label: ["选择库存表（可再选销量明细表）", "Pick the stock sheet (and optionally the sales sheet)"] },
  settings: [
    { key: "buyer", label: ["采购方（公司名）", "Buyer (your company)"], type: "text", default: "" },
    { key: "buyerInfo", label: ["采购方信息（地址、电话）", "Buyer details (address, phone)"], type: "textarea", default: "" },
    { key: "deliverTo", label: ["收货地址", "Deliver to"], type: "textarea", default: "" },
    { key: "safetyDays", label: ["安全库存天数", "Safety stock (days)"], type: "number", default: 7, min: 0, max: 365 },
    { key: "coverDays", label: ["补货覆盖天数", "Order covers (days)"], type: "number", default: 30, min: 1, max: 365, help: ["每次补货要够卖多少天", "How many days each order should last"] },
    { key: "lookback", label: ["销量统计天数", "Sales lookback (days)"], type: "number", default: 30, min: 1, max: 365, reload: true },
    { key: "date", label: ["采购日期", "PO date"], type: "date", default: new Date().toISOString().slice(0, 10) },
    { key: "prefix", label: ["采购单号前缀", "PO number prefix"], type: "text", default: "PO-" },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#1d4ed8" },
    { key: "note", label: ["采购单备注", "PO notes"], type: "textarea", default: "" },
  ],
  columns: () => [
    { key: "sku", label: ["货号", "SKU"] },
    { key: "name", label: ["品名", "Item"], wide: true },
    { key: "supplier", label: ["供应商", "Supplier"] },
    { key: "onHand", label: ["库存", "On hand"], type: "number" },
    { key: "onOrder", label: ["在途", "On order"], type: "number" },
    { key: "daily", label: ["日均销量", "Daily sales"], type: "number" },
    { key: "lead", label: ["交货期（天）", "Lead (days)"], type: "number" },
    { key: "moq", label: ["起订量", "MOQ"], type: "number" },
    { key: "pack", label: ["箱规", "Pack"], type: "number" },
    { key: "cost", label: ["进价", "Unit cost"], type: "number" },
    { key: "safety", label: ["安全天数", "Safety days"], type: "number" },
    { key: "_daysLeft", label: ["可卖天数", "Days left"], type: "number", readOnly: true },
    { key: "_rop", label: ["再订货点", "Reorder at"], type: "number", readOnly: true },
    { key: "_suggest", label: ["建议补货", "Suggested"], type: "number", readOnly: true },
    { key: "order", label: ["订货数量", "Order qty"], type: "number" },
    { key: "_amount", label: ["金额", "Amount"], type: "number", readOnly: true },
  ],
  newRow: () => ({ sku: "", name: "", supplier: "", onHand: 0, onOrder: 0, daily: 0, lead: 7, moq: 0, pack: 1, cost: 0, safety: "", order: "" }),
  async load({ ws, files, settings, previous }) {
    const r = await loadAll(ws, files, n0(settings.lookback, 30));
    if (previous) { const ov = new Map(previous.map((x) => [s(x.sku), x.order])); for (const row of r.rows) if (ov.has(s(row.sku))) row.order = ov.get(s(row.sku)) ?? ""; }
    return r;
  },
  compute(p): Computed {
    const a = analyse(p);
    const cur = s(p.settings.currency) || "¥";
    const rows = p.rows.map((r, i) => { const l = a.lines[i]; return { ...r, _daysLeft: Number.isFinite(l.p.daysLeft) ? Math.round(l.p.daysLeft * 10) / 10 : "", _rop: Math.ceil(l.p.rop), _suggest: l.p.suggest, _amount: l.amount }; });
    const total = [...a.suppliers.values()].flat().reduce((x, l) => x + l.amount, 0);
    const items = [...a.suppliers.values()].flat().length;
    return {
      rows,
      issues: a.issues,
      summary: `${items} of ${p.rows.length} item(s) to reorder from ${a.suppliers.size} supplier(s), ${money(total, cur)}. 需补货 ${items} 个商品，${a.suppliers.size} 个供应商，合计 ${money(total, cur)}。`,
      stats: { items: p.rows.length, reorder: items, suppliers: a.suppliers.size, total: Math.round(total * 100) / 100, atRisk: a.lines.filter((l) => l.p.runsOutBeforeArrival).length },
      preview: previewHtml(a, p),
    };
  },
  exports: [
    {
      id: "pdf", label: ["采购单 PDF", "Purchase orders (PDF)"], description: "po/<supplier>.pdf for each supplier plus all-purchase-orders.pdf",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const a = analyse(project);
        if (!a.suppliers.size) throw new KitError("nothing", "Nothing to reorder — no purchase orders to write.");
        const files: string[] = [];
        let cjk = true;
        const all = await newPdf();
        let i = 0;
        for (const [sup, ls] of a.suppliers) {
          const k = await newPdf();
          cjk &&= k.cjk;
          const no = poNumber(project, i++);
          drawPo(k, project, sup, ls, no);
          drawPo(all, project, sup, ls, no);
          files.push(await write(`po/${safeFileName(`${no} ${sup}`, "supplier")}.pdf`, await k.doc.save()));
        }
        files.push(await write("all-purchase-orders.pdf", await all.doc.save()));
        return { files, note: cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "xlsx", label: ["补货计划 Excel", "Reorder plan (Excel)"], description: "reorder-plan.xlsx — every item with days left, reorder point and quantity, plus one sheet per supplier",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project);
        const marks: { row: number; col: number; color: string }[] = [];
        const planRows = a.lines.map((l, i) => { if (l.p.runsOutBeforeArrival) marks.push({ row: i, col: 7, color: "#FCA5A5" }, { row: i, col: 13, color: "#FCA5A5" }); if (l.qty > 0) marks.push({ row: i, col: 10, color: "#BFDBFE" }); return [s(l.r.sku), s(l.r.name), s(l.r.supplier), n0(l.r.onHand), n0(l.r.onOrder), n0(l.r.daily), n0(l.r.lead, 7), Number.isFinite(l.p.daysLeft) ? Math.round(l.p.daysLeft * 10) / 10 : "", Math.ceil(l.p.rop), l.p.suggest, l.qty, n0(l.r.cost), l.amount, l.p.runsOutBeforeArrival ? "到货前会断货" : ""]; });
        const sheets = [
          { name: "补货计划 Plan", headers: ["货号", "品名", "供应商", "库存", "在途", "日均销量", "交货期", "可卖天数", "再订货点", "建议补货", "订货数量", "进价", "金额", "提示"], rows: planRows, marks, numberFormat: { 11: "#,##0.00", 12: "#,##0.00" } },
          ...[...a.suppliers].map(([sup, ls], i) => ({ name: `${poNumber(project, i).slice(-2)} ${sup}`.slice(0, 30), headers: ["货号", "品名", "数量", "箱规", "进价", "金额"], rows: [...ls.map((l) => [s(l.r.sku), s(l.r.name), l.qty, n0(l.r.pack, 1), n0(l.r.cost), l.amount]), ["", "合计 Total", ls.reduce((x, l) => x + l.qty, 0), "", "", Math.round(ls.reduce((x, l) => x + l.amount, 0) * 100) / 100]], numberFormat: { 4: "#,##0.00", 5: "#,##0.00" } })),
        ];
        return [await write("reorder-plan.xlsx", await writeXlsx(sheets))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.sku)} ${s(r.name)} [${s(r.supplier)}] on hand ${s(r.onHand)} + on order ${s(r.onOrder)}, daily ${s(r.daily)}, lead ${s(r.lead)}d → days left ${s(r._daysLeft)}, suggest ${s(r._suggest)}${s(r.order) ? `, order ${s(r.order)}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
