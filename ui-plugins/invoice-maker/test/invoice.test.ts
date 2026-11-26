import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildInvoices, detectCurrency, money, qtyOf } from "../src/invoice.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const base = { seller: "Penova", sellerInfo: "", currency: "CNY", taxRate: 6, prefix: "INV-", start: 7, date: "2026-11-25", dueDays: 30, notes: "", accent: "#2563eb", paper: "A4" as const, lang: "both" as const };

describe("buildInvoices", () => {
  it("groups by client when there is no number, numbers from start, applies default tax", () => {
    const { invoices, issues } = buildInvoices([
      { invoice: "", client: "A", address: "x", item: "a", qty: 2, price: "¥1,000", tax: "" },
      { invoice: "", client: "B", address: "y", item: "b", qty: "一", price: 50, tax: 0 },
      { invoice: "", client: "A", address: "", item: "c", qty: 1, price: 0.1, tax: 13 },
    ], base);
    expect(issues).toEqual([]);
    expect(invoices.map((i) => [i.number, i.client, i.subtotal, i.tax, i.total, i.due])).toEqual([
      ["INV-0007", "A", 2000.1, 120.01, 2120.11, "2026-12-25"],
      ["INV-0008", "B", 50, 0, 50, "2026-12-25"],
    ]);
  });
  it("flags bad numbers, missing clients and a number reused for another client", () => {
    const { issues } = buildInvoices([
      { invoice: "X1", client: "A", address: "a", item: "a", qty: "abc", price: 1, tax: "" },
      { invoice: "X1", client: "B", address: "b", item: "b", qty: 1, price: "n/a", tax: 120 },
      { invoice: "", client: "", address: "c", item: "c", qty: 1, price: 1, tax: "" },
    ], base);
    const keys = issues.filter((i) => i.level === "error").map((i) => `${i.row}:${i.key}`);
    expect(keys).toEqual(expect.arrayContaining(["0:qty", "1:price", "1:tax", "1:invoice", "2:client"]));
  });
  it("formats money and Chinese quantities", () => {
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(1234.5, "JPY")).toBe("¥1,235");
    expect(qtyOf("三")).toBe(3);
    expect(qtyOf("")).toBe(1);
  });
});

describe("invoice tools on the sample sheet", () => {
  it("opens, edits, exports PDFs and the ledger", async () => {
    const ws = await mkdtemp(join(tmpdir(), "inv-"));
    await cp(join(HERE, "samples"), join(ws, "billing"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const opened = await call("invoice_open", { inputs: ["billing/invoices-2026-11.xlsx"], settings: { seller: "Penova Labs", taxRate: "6", date: "2026-11-25" } });
    expect(opened.data.stats.invoices).toBe(3);
    expect(opened.text).toContain("INV-0001");
    const totals = opened.data.rows.map((r: any) => r._amount);
    expect(totals).toEqual([18000, 7500, 320, 427.5, 26000, 1200, 800]);
    expect(opened.data.issues.some((i: any) => i.key === "address" && i.row === 0)).toBe(false);
    // 客户 B 的服务器迁移行没有地址，但同一张发票已有地址 → 不报
    expect(opened.data.issues.filter((i: any) => i.level === "error")).toEqual([]);
    const edited = await call("invoice_edit", { project: "invoices-2026-11", set: [{ row: 3, values: { qty: "5" } }], settings: { currency: "USD", lang: "en" } });
    expect(edited.data.rows[3]._amount).toBe(475);
    expect(edited.data.summary).toContain("$");
    const exported = await call("invoice_export", { project: "invoices-2026-11" });
    const files: string[] = exported.data.exported;
    expect(files.filter((f) => f.endsWith(".pdf"))).toHaveLength(4);
    const all = await PDFDocument.load(await readFile(join(ws, files.find((f) => f.endsWith("all-invoices.pdf"))!)));
    expect(all.getPageCount()).toBe(3);
    const csv = await readFile(join(ws, files.find((f) => f.endsWith(".csv"))!), "utf8");
    expect(csv).toContain("INV-0002,Northwind Studio LLC,2026-11-25,2026-12-25,795,0,795,USD");
    // 引入错误后 PDF 导出被拒绝
    await call("invoice_edit", { project: "invoices-2026-11", set: [{ row: 0, values: { price: "abc" } }] });
    await expect(call("invoice_export", { project: "invoices-2026-11", formats: ["pdf"] })).rejects.toMatchObject({ code: "has_errors" });
  });
  it("explains missing columns", async () => {
    const ws = await mkdtemp(join(tmpdir(), "inv-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(ws, "x.csv"), "foo,bar\n1,2\n");
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    await expect(call("invoice_open", { inputs: ["x.csv"] })).rejects.toMatchObject({ code: "columns_not_found" });
    await expect(call("invoice_open", { inputs: ["../x.csv"] })).rejects.toMatchObject({ code: "outside_workspace" });
  });
});

// 回归测试：$320.00 不能被当成人民币（FIX-QUEUE-100）
describe("currency from the sheet", () => {
  it("detects codes, prefixed and bare symbols", () => {
    expect(detectCurrency("$320.00")).toBe("USD");
    expect(detectCurrency("US$ 5")).toBe("USD");
    expect(detectCurrency("HK$1,200")).toBe("HKD");
    expect(detectCurrency("320 EUR")).toBe("EUR");
    expect(detectCurrency("£9.99")).toBe("GBP");
    expect(detectCurrency("RMB 100")).toBe("CNY");
    expect(detectCurrency("100港元")).toBe("HKD");
    expect(detectCurrency("¥500")).toBe("CNY");
    expect(detectCurrency("¥500", "JPY")).toBe("JPY");
    expect(detectCurrency("单价 (USD)")).toBe("USD");
    expect(detectCurrency(320)).toBeUndefined();
    expect(detectCurrency("320")).toBeUndefined();
  });
  it("bills $320.00 in USD even when the default is CNY", () => {
    const { invoices, issues } = buildInvoices([
      { invoice: "", client: "Acme", address: "x", item: "Design", qty: 1, price: "$320.00", tax: 0 },
      { invoice: "", client: "Acme", address: "x", item: "Hosting", qty: 2, price: "15", tax: 0 },
      { invoice: "", client: "李", address: "y", item: "咨询", qty: 1, price: "¥1,000", tax: 0 },
    ], { ...base, taxRate: 0 });
    expect(invoices.map((i) => [i.client, i.currency, i.total])).toEqual([["Acme", "USD", 350], ["李", "CNY", 1000]]);
    expect(money(invoices[0].total, invoices[0].currency)).toBe("$350.00");
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.some((i) => i.level === "info" && i.message.includes("USD"))).toBe(true);
  });
  it("uses a currency column and flags mixed or unknown currencies", () => {
    const { invoices, issues } = buildInvoices([
      { invoice: "A1", client: "A", address: "x", item: "a", qty: 1, price: 10, tax: 0, currency: "eur" },
      { invoice: "A2", client: "B", address: "x", item: "b", qty: 1, price: "$5", tax: 0 },
      { invoice: "A2", client: "B", address: "x", item: "c", qty: 1, price: "€5", tax: 0 },
      { invoice: "A3", client: "C", address: "x", item: "d", qty: 1, price: 1, tax: 0, currency: "doubloons" },
    ], base);
    expect(invoices[0].currency).toBe("EUR");
    expect(issues.filter((i) => i.level === "error").map((i) => i.row)).toEqual([2, 3]);
  });
});
