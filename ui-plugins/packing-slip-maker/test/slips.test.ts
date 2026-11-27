import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { code128 } from "../src/code128.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { groupOrders, maskPhone, pickList } from "../src/slips.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("orders", () => {
  it("groups lines, merges repeated SKUs, flags problems", () => {
    const { orders, issues } = groupOrders([
      { order: "A1", customer: "林", address: "杭州", sku: "X", item: "茶", variant: "罐", qty: "2", location: "A-1" },
      { order: "A1", customer: "林", address: "杭州", sku: "X", item: "茶", variant: "罐", qty: 1, location: "A-1" },
      { order: "A1", customer: "林", address: "上海", sku: "Y", item: "杯", variant: "", qty: 1, location: "B-1" },
      { order: "B2", customer: "", address: "", sku: "Y", item: "杯", variant: "", qty: "x", location: "" },
      { order: "", sku: "Z", qty: 1 },
    ]);
    expect(orders.map((o) => [o.number, o.lines.map((l) => `${l.sku}×${l.qty}`).join(",")])).toEqual([["A1", "X×3,Y×1"], ["B2", "Y×0"]]);
    expect(orders[0].address).toBe("杭州");
    const msg = issues.map((i) => `${i.level}:${i.row ?? "-"}:${i.message}`).join("\n");
    expect(msg).toMatch(/info:1:Order A1: X appears twice/);
    expect(msg).toMatch(/warn:2:Order A1: address differs/);
    expect(msg).toMatch(/error:3:Quantity “x”/);
    expect(msg).toMatch(/error:4:No order number/);
    expect(msg).toMatch(/warn:3:Order B2: no shipping address/);
  });
  it("totals the picking list by SKU and sorts by bin", () => {
    const { orders } = groupOrders([
      { order: "1", sku: "B", item: "b", qty: 2, location: "B-01" },
      { order: "2", sku: "A", item: "a", qty: 1, location: "A-02" },
      { order: "2", sku: "B", item: "b", qty: 3, location: "B-01" },
      { order: "3", sku: "C", item: "c", qty: 1, location: "" },
    ]);
    expect(pickList(orders).map((x) => [x.location, x.sku, x.qty, x.orders.join("+")])).toEqual([["A-02", "A", 1, "2"], ["B-01", "B", 5, "1+2"], ["", "C", 1, "3"]]);
  });
  it("masks phones and encodes Code 128", () => {
    expect(maskPhone("13812345678")).toBe("138****5678");
    expect(maskPhone("+1 415 555 0142")).toBe("+1 41* *** 0142");
    expect(maskPhone("110")).toBe("110");
    const w = code128("DD20261120001");
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 * 15 + 13); // 起始 + 13 个字符 + 校验 = 15 个符号，加上 13 模块的终止符
  });
});

describe("tools", () => {
  it("opens the sample orders and exports slips and the picking list", async () => {
    const root = await mkdtemp(join(tmpdir(), "slips-"));
    await cp(join(HERE, "samples"), join(root, "发货"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("slips_open", { inputs: ["发货/orders.csv"], project: "1122", settings: { shop: "Penova 茶铺" } });
    expect(o.data.stats).toEqual({ orders: 6, items: 20, skus: 10, gifts: 2 });
    const lv = o.data.issues.map((i: { level: string; row?: number }) => `${i.level}@${i.row}`);
    expect(lv).toEqual(["info@7", "warn@8"]);
    expect(o.data.preview).toContain("138****5678");
    await c.call("slips_edit", { project: "1122", set: [{ row: 8, values: { 收货地址: "成都市武侯区人民南路四段 1 号" } }] });
    const st = await c.call("slips_status", { project: "1122" });
    expect(st.data.issues.filter((i: { level: string }) => i.level === "warn")).toEqual([]);
    await c.call("slips_export", { project: "1122" });
    const out = join(root, "packing-slip-maker", "1122");
    const pdf = await PDFDocument.load(await readFile(join(out, "packing-slips.pdf")));
    expect(pdf.getPageCount()).toBe(6);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "picking-list.xlsx"));
    const pick = wb.getWorksheet("拣货 Pick")!;
    expect(pick.getRow(2).values).toEqual(expect.arrayContaining(["A-01-03", "TEA-LJ-250", 4]));
    expect(String(await readFile(join(out, "picking-list.csv")))).toContain("TEA-LJ-250");
  }, 60_000);
});
