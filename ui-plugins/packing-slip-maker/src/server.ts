import { createApp, esc, toCsv, type AppDef, type Computed, type ExportCtx, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { groupOrders, maskPhone, pickList, renderSlips, type SlipSettings } from "./slips.ts";

export const NAME = "packing-slip-maker";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const ALIASES = {
  order: ["订单号", "订单编号", "单号", "order", "order no", "order number", "order id", "name"],
  date: ["下单日期", "日期", "下单时间", "date", "order date", "created at"],
  customer: ["收件人", "收货人", "客户", "买家", "recipient", "ship to", "shipping name", "customer"],
  phone: ["电话", "手机", "联系电话", "phone", "shipping phone", "mobile"],
  address: ["收货地址", "地址", "详细地址", "address", "shipping address", "shipping address1"],
  sku: ["货号", "sku", "商品编码", "lineitem sku", "item code"],
  item: ["商品名称", "商品", "品名", "宝贝标题", "item", "product", "lineitem name", "title"],
  variant: ["规格", "颜色尺码", "sku属性", "variant", "option", "size"],
  qty: ["数量", "件数", "qty", "quantity", "lineitem quantity"],
  location: ["库位", "货位", "仓位", "bin", "location", "shelf"],
  price: ["单价", "价格", "price", "lineitem price", "unit price"],
  gift: ["礼品留言", "赠言", "留言", "贺卡", "gift message", "gift note", "gift"],
  method: ["配送方式", "快递", "物流", "shipping method", "carrier", "shipping"],
  note: ["备注", "卖家备注", "note", "notes"],
};
const settingsOf = (p: Project): SlipSettings => ({
  shop: s(p.settings.shop), shopInfo: s(p.settings.shopInfo), footer: s(p.settings.footer), paper: p.settings.paper === "A5" ? "A5" : "A4",
  maskPhone: p.settings.maskPhone !== false, showPrices: p.settings.showPrices === true, currency: s(p.settings.currency) || "¥", accent: s(p.settings.accent) || "#111827", barcode: p.settings.barcode !== false,
});

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "slips",
  title: ["发货单拣货单", "Packing Slips"],
  openDescription:
    "Turn an orders sheet (.csv/.xlsx export from a shop; one row per order line; columns like 订单号/order, 收件人/recipient, 电话/phone, 收货地址/address, 货号/sku, 商品名称/item, 规格/variant, 数量/qty, 库位/bin, 礼品留言/gift message, 配送方式/shipping) into packing slips (one per order, with a Code 128 barcode of the order number, tick boxes, gift message box, phone masked by default) and a picking list totalled by SKU and sorted by bin. Rows with the same order number form one order; repeated SKUs in an order are merged.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择订单表（每行一个商品）", "Pick the orders sheet (one row per item)"] },
  settings: [
    { key: "shop", label: ["店铺名称", "Shop name"], type: "text", default: "" },
    { key: "shopInfo", label: ["退货地址 / 联系方式", "Return address / contact"], type: "textarea", default: "" },
    { key: "footer", label: ["页脚感谢语", "Thank-you line"], type: "text", default: "感谢您的购买！Thank you for your order!" },
    { key: "paper", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "A5", label: ["A5（半张 A4）", "A5 (half A4)"] }] },
    { key: "maskPhone", label: ["电话打码", "Mask phone numbers"], type: "bool", default: true },
    { key: "barcode", label: ["打印订单号条码", "Print order barcode"], type: "bool", default: true },
    { key: "showPrices", label: ["显示金额", "Show prices"], type: "bool", default: false },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#111827" },
  ],
  columns: () => [
    { key: "order", label: ["订单号", "Order"] },
    { key: "date", label: ["日期", "Date"], type: "date" },
    { key: "customer", label: ["收件人", "Recipient"] },
    { key: "phone", label: ["电话", "Phone"] },
    { key: "address", label: ["收货地址", "Address"], wide: true },
    { key: "sku", label: ["货号", "SKU"] },
    { key: "item", label: ["商品", "Item"], wide: true },
    { key: "variant", label: ["规格", "Variant"] },
    { key: "qty", label: ["数量", "Qty"], type: "number" },
    { key: "location", label: ["库位", "Bin"] },
    { key: "gift", label: ["礼品留言", "Gift message"], wide: true },
    { key: "method", label: ["配送", "Shipping"] },
    { key: "note", label: ["备注", "Note"] },
    { key: "price", label: ["单价", "Price"], type: "number" },
  ],
  newRow: () => ({ order: "", date: new Date().toISOString().slice(0, 10), customer: "", phone: "", address: "", sku: "", item: "", variant: "", qty: 1, location: "", gift: "", method: "", note: "", price: "" }),
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, ALIASES);
    const miss = ["order", "qty"].filter((k) => !m[k]);
    if (!m.sku && !m.item) miss.push("sku or item");
    if (miss.length) throw new KitError("columns_not_found", `Couldn't find ${miss.join(", ")} (订单号/order, 数量/qty, 货号/sku 或 商品名称/item). Columns: ${t.columns.join(", ")}`);
    // 订单导出里，同一订单的后续行常常只填商品列：沿用上一行的订单号
    let last = "";
    const rows: Row[] = t.rows.map((r) => {
      const o = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, m[k] ? s(r[m[k]!]) : ""])) as Row;
      if (!o.order && last && (o.sku || o.item)) o.order = last;
      last = s(o.order) || last;
      if (o.date) o.date = parseDate(o.date) || o.date;
      return o;
    }).filter((r) => s(r.order) || s(r.sku) || s(r.item));
    return { rows };
  },
  compute(p): Computed {
    const { orders, issues } = groupOrders(p.rows);
    const st = settingsOf(p);
    const pick = pickList(orders);
    const totalQty = orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
    const first = orders[0];
    const preview = first ? `<div style="font-size:12px"><div style="display:flex;gap:12px;flex-wrap:wrap"><div style="flex:1;min-width:240px;border:1px solid #e5e7eb;border-radius:8px;padding:10px"><div style="display:flex;justify-content:space-between"><b>${esc(st.shop || "发货单")}</b><b>${esc(first.number)}</b></div><p style="margin:6px 0"><b>${esc(first.customer)}</b> ${esc(st.maskPhone ? maskPhone(first.phone) : first.phone)}<br><span class="muted">${esc(first.address)}</span></p><table class="data"><tbody>${first.lines.map((l) => `<tr><td>☐</td><td>${esc(l.sku)}</td><td>${esc(l.item)}</td><td>${esc(l.variant)}</td><td class="num"><b>${l.qty}</b></td></tr>`).join("")}</tbody></table>${first.gift ? `<p style="border:1px dashed #9ca3af;padding:6px;margin-top:6px">🎁 ${esc(first.gift)}</p>` : ""}</div><div style="flex:1;min-width:220px"><b>拣货单 Picking list</b><table class="data" style="margin-top:4px"><thead><tr><th>库位</th><th>货号</th><th>商品</th><th>数量</th></tr></thead><tbody>${pick.map((x) => `<tr><td>${esc(x.location)}</td><td>${esc(x.sku)}</td><td>${esc(x.item)} ${esc(x.variant)}</td><td class="num"><b>${x.qty}</b></td></tr>`).join("")}</tbody></table></div></div></div>` : "";
    return {
      rows: p.rows,
      issues,
      summary: `${orders.length} order(s), ${totalQty} item(s), ${pick.length} SKU(s) to pick; ${orders.filter((o) => o.gift).length} with a gift message. 共 ${orders.length} 个订单 ${totalQty} 件，拣货 ${pick.length} 种。`,
      stats: { orders: orders.length, items: totalQty, skus: pick.length, gifts: orders.filter((o) => o.gift).length },
      preview,
    };
  },
  exports: [
    {
      id: "pdf", label: ["发货单 PDF", "Packing slips (PDF)"], description: "packing-slips.pdf — one slip per order",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const { orders } = groupOrders(project.rows);
        const r = await renderSlips(orders, settingsOf(project));
        return { files: [await write("packing-slips.pdf", r.bytes)], note: r.cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "xlsx", label: ["拣货单 Excel", "Picking list (Excel)"], description: "picking-list.xlsx — totals by SKU sorted by bin, plus an order checklist; picking-list.csv",
      async run({ project, write }: ExportCtx) {
        const { orders } = groupOrders(project.rows);
        const pick = pickList(orders);
        const st = settingsOf(project);
        const xlsx = await writeXlsx([
          { name: "拣货 Pick", headers: ["库位 Bin", "货号 SKU", "商品 Item", "规格 Variant", "数量 Qty", "订单数 Orders", "订单号 Order numbers", "已拣 ✓"], rows: [...pick.map((x) => [x.location, x.sku, x.item, x.variant, x.qty, x.orders.length, x.orders.join(", "), ""]), ["", "", "合计 Total", "", pick.reduce((a, x) => a + x.qty, 0), orders.length, "", ""]], widths: [10, 14, 26, 12, 9, 9, 40, 8] },
          { name: "订单 Orders", headers: ["订单号", "日期", "收件人", "电话", "地址", "配送", "件数", "礼品留言", "已打包 ✓"], rows: orders.map((o) => [o.number, o.date, o.customer, st.maskPhone ? maskPhone(o.phone) : o.phone, o.address, o.method, o.lines.reduce((a, l) => a + l.qty, 0), o.gift, ""]), widths: [16, 11, 12, 15, 40, 10, 6, 30, 9] },
        ]);
        const csv = toCsv(["bin", "sku", "item", "variant", "qty", "orders"], pick.map((x) => [x.location, x.sku, x.item, x.variant, x.qty, x.orders.join(" ")]));
        return [await write("picking-list.xlsx", xlsx), await write("picking-list.csv", csv)];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.order)} ${s(r.customer)} · ${s(r.sku)} ${s(r.item)} ${s(r.variant)} × ${s(r.qty)}${s(r.location) ? ` @${s(r.location)}` : ""}${s(r.gift) ? " 🎁" : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
