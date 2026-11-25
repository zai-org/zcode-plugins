import { createApp, htmlPage, htmlTable, toCsv, type AppDef, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { buildInvoices, invoiceTooLong, money, previewHtml, renderPdf, type Line, type Settings } from "./invoice.ts";

export const NAME = "invoice-maker";
export const VERSION = "0.1.0";

const ALIASES = {
  invoice: ["发票号", "发票编号", "单号", "invoice no", "invoice number", "number", "no"],
  client: ["客户", "客户名称", "购买方", "公司", "customer", "bill to", "company", "name"],
  address: ["客户地址", "地址", "address", "billing address"],
  item: ["项目", "品名", "服务内容", "描述", "说明", "商品", "description", "service", "product"],
  qty: ["数量", "quantity", "hours", "工时"],
  price: ["单价", "价格", "unit price", "rate", "price"],
  tax: ["税率", "tax rate", "vat", "tax %", "tax"],
};

const settingsOf = (p: { settings: Record<string, unknown> }) => p.settings as unknown as Settings;
const lines = (rows: Row[]) => rows as unknown as Line[];

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "invoice",
  title: ["批量开发票", "Invoice Maker"],
  openDescription:
    "Read a sheet of invoice line items (.xlsx/.csv; one row per line; columns like invoice no., client, address, item, qty, price, tax % in Chinese or English are matched automatically). Rows with the same invoice number — or, without one, the same client — become one invoice; missing numbers are assigned from prefix+start. Calculates line amounts, tax and totals and flags bad numbers, missing clients and clashing invoice numbers.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择明细表（每行一个项目）", "Pick the line-item sheet (one row per item)"] },
  settings: [
    { key: "seller", label: ["开票方名称", "Your business name"], type: "text", default: "" },
    { key: "sellerInfo", label: ["开票方信息（地址、税号、银行）", "Your details (address, tax ID, bank)"], type: "textarea", default: "" },
    { key: "currency", label: ["币种", "Currency"], type: "select", default: "CNY", options: ["CNY", "USD", "EUR", "GBP", "JPY", "HKD", "TWD", "SGD", "AUD", "CAD"].map((c) => ({ value: c, label: [c, c] as [string, string] })) },
    { key: "taxRate", label: ["默认税率 %", "Default tax %"], type: "number", default: 0, min: 0, max: 100, help: ["明细里没有税率时使用", "Used when a line has no tax rate"] },
    { key: "prefix", label: ["编号前缀", "Number prefix"], type: "text", default: "INV-" },
    { key: "start", label: ["起始编号", "First number"], type: "number", default: 1, min: 0 },
    { key: "date", label: ["开票日期", "Invoice date"], type: "date", default: new Date().toISOString().slice(0, 10) },
    { key: "dueDays", label: ["付款期限（天）", "Payment terms (days)"], type: "number", default: 30, min: 0, max: 365 },
    { key: "lang", label: ["语言", "Language"], type: "select", default: "both", options: [{ value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }, { value: "both", label: ["中英双语", "Bilingual"] }] },
    { key: "paper", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#2563eb" },
    { key: "notes", label: ["备注（付款方式等）", "Notes (payment instructions…)"], type: "textarea", default: "" },
  ],
  columns: () => [
    { key: "invoice", label: ["发票号", "Invoice no."] },
    { key: "client", label: ["客户", "Client"], wide: true },
    { key: "address", label: ["客户地址", "Client address"], wide: true },
    { key: "item", label: ["项目", "Item"], wide: true },
    { key: "qty", label: ["数量", "Qty"], type: "number" },
    { key: "price", label: ["单价", "Price"], type: "number" },
    { key: "tax", label: ["税率 %", "Tax %"], type: "number" },
    { key: "_number", label: ["归入发票", "On invoice"], readOnly: true },
    { key: "_amount", label: ["金额", "Amount"], type: "number", readOnly: true },
  ],
  newRow: () => ({ invoice: "", client: "", address: "", item: "", qty: 1, price: 0, tax: "" }),
  async load({ ws, files }) {
    const table = await readTable(ws, files[0]);
    const map = mapHeaders(table.columns, ALIASES);
    const missing = ["client", "item", "price"].filter((k) => !map[k]);
    if (missing.length) throw new KitError("columns_not_found", `Could not find column(s) for ${missing.join(", ")}. Columns in the file: ${table.columns.join(", ")}. Rename them (e.g. 客户 / client, 项目 / item, 单价 / price) and open again.`);
    const rows = table.rows.map((r) => Object.fromEntries(Object.keys(ALIASES).map((k) => [k, map[k] ? r[map[k]!] ?? "" : k === "qty" ? 1 : ""])));
    return { rows, meta: { columns: map, sheet: table.sheet } };
  },
  compute(project) {
    const s = settingsOf(project);
    const { invoices, issues } = buildInvoices(lines(project.rows), s);
    const numberOf = new Map<number, { n: string; a: number }>();
    for (const inv of invoices) for (const l of inv.lines) numberOf.set(l.index, { n: inv.number, a: l.amount });
    for (const inv of invoices) if (invoiceTooLong(inv)) issues.push({ level: "warn", row: inv.lines[0].index, message: `Invoice ${inv.number} has ${inv.lines.length} lines; v0.1 fits about 20 lines on one page / 行数过多可能放不下一页` });
    const total = invoices.reduce((a, i) => a + i.total, 0);
    return {
      rows: project.rows.map((r, i) => ({ ...r, _number: numberOf.get(i)?.n ?? "", _amount: numberOf.get(i)?.a ?? 0 })),
      issues,
      summary: `${invoices.length} invoice(s) from ${project.rows.length} line(s); grand total ${money(total, s.currency)} (incl. tax). 共 ${invoices.length} 张发票，含税合计 ${money(total, s.currency)}。`,
      stats: { invoices: invoices.length, lines: project.rows.length, total: money(total, s.currency) },
      preview: previewHtml(invoices[0], s, invoices.length),
    };
  },
  exports: [
    {
      id: "pdf",
      label: ["PDF 发票", "PDF invoices"],
      description: "one PDF per invoice plus all-invoices.pdf",
      async run(ctx) {
        const s = settingsOf(ctx.project);
        const { invoices, issues } = buildInvoices(lines(ctx.project.rows), s);
        if (issues.some((i) => i.level === "error")) throw new KitError("has_errors", `Fix ${issues.filter((i) => i.level === "error").length} error(s) first (see the issue list).`);
        const files: string[] = [];
        let cjk = true;
        for (const inv of invoices) {
          const r = await renderPdf([inv], s);
          cjk &&= r.cjk;
          files.push(await ctx.write(`${safeFileName(inv.number)}-${safeFileName(inv.client, "client").slice(0, 40)}.pdf`, r.bytes));
        }
        files.push(await ctx.write("all-invoices.pdf", (await renderPdf(invoices, s)).bytes));
        return { files, note: cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "ledger",
      label: ["开票台账 Excel", "Ledger (Excel)"],
      description: "invoices.xlsx with an invoice summary sheet and a line-item sheet",
      async run(ctx) {
        const s = settingsOf(ctx.project);
        const { invoices } = buildInvoices(lines(ctx.project.rows), s);
        const xlsx = await writeXlsx([
          { name: "Invoices", headers: ["Invoice", "Client", "Date", "Due", "Subtotal", "Tax", "Total", "Currency"], rows: invoices.map((i) => [i.number, i.client, i.date, i.due, i.subtotal, i.tax, i.total, s.currency]), numberFormat: { 4: "#,##0.00", 5: "#,##0.00", 6: "#,##0.00" } },
          { name: "Lines", headers: ["Invoice", "Client", "Item", "Qty", "Price", "Tax %", "Amount", "Tax"], rows: invoices.flatMap((i) => i.lines.map((l) => [i.number, i.client, l.item, l.q, l.p, l.t, l.amount, l.taxAmount])) },
        ]);
        const csv = toCsv(["Invoice", "Client", "Date", "Due", "Subtotal", "Tax", "Total", "Currency"], invoices.map((i) => [i.number, i.client, i.date, i.due, i.subtotal, i.tax, i.total, s.currency]));
        const html = htmlPage("Invoices", `<h1>${s.seller || "Invoices"}</h1>` + htmlTable(["Invoice", "Client", "Date", "Due", "Total"], invoices.map((i) => [i.number, i.client, i.date, i.due, money(i.total, s.currency)])));
        return [await ctx.write("invoices.xlsx", xlsx), await ctx.write("invoices.csv", csv), await ctx.write("invoices.html", html)];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${r._number} · ${r.client} · ${r.item} · ${r.qty} × ${r.price} (tax ${r.tax === "" ? "default" : r.tax + "%"}) = ${r._amount}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
