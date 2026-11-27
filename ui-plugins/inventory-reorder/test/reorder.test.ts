import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { dailyDemand, plan } from "../src/reorder.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("plan", () => {
  const o = { safetyDays: 7, coverDays: 30 };
  it("reorders below the reorder point, rounds to cases and MOQ", () => {
    // 日均 4，交期 10，安全 7 → 再订货点 68；目标 4×47=188；库存 46 → 142 → 箱规 12 → 144
    expect(plan({ sku: "a", onHand: 46, onOrder: 0, lead: 10, moq: 24, pack: 12, daily: 4 }, o)).toMatchObject({ rop: 68, target: 188, suggest: 144, daysLeft: 11.5, runsOutBeforeArrival: false });
    // 起订量大于需求：补 2 件也要按 MOQ 50（箱规 50）
    expect(plan({ sku: "b", onHand: 33, onOrder: 0, lead: 5, moq: 50, pack: 50, daily: 1 }, o).suggest).toBe(0);
    expect(plan({ sku: "b", onHand: 12, onOrder: 0, lead: 5, moq: 50, pack: 50, daily: 1 }, o).suggest).toBe(50);
    // 在途计入库存位置；不到再订货点就不补
    expect(plan({ sku: "c", onHand: 40, onOrder: 40, lead: 10, moq: 0, pack: 1, daily: 4 }, o).suggest).toBe(0);
    // 单品自己的安全天数优先
    expect(plan({ sku: "d", onHand: 30, onOrder: 0, lead: 5, moq: 0, pack: 1, daily: 2, safetyDays: 0 }, o)).toMatchObject({ rop: 10, suggest: 0 });
    // 到货前会断货
    expect(plan({ sku: "e", onHand: 9, onOrder: 0, lead: 21, moq: 0, pack: 1, daily: 1.2 }, o).runsOutBeforeArrival).toBe(true);
    expect(plan({ sku: "f", onHand: 0, onOrder: 0, lead: 5, moq: 0, pack: 1, daily: 0 }, o).suggest).toBe(0);
  });
  it("averages sales over the lookback window ending at the last sale", () => {
    const d = dailyDemand([{ date: "2026-11-01", sku: "a", qty: 100 }, { date: "2026-11-21", sku: "a", qty: 10 }, { date: "2026-11-30", sku: "a", qty: 20 }, { date: "2026-11-30", sku: "b", qty: 5 }], 10);
    expect(d).toMatchObject({ from: "2026-11-21", to: "2026-11-30", days: 10 });
    expect(d.daily.get("a")).toBe(3);
    expect(d.daily.get("b")).toBe(0.5);
    expect(dailyDemand([{ date: "2026-11-29", sku: "a", qty: 4 }, { date: "2026-11-30", sku: "a", qty: 2 }], 30).days).toBe(2);
  });
});

describe("tools", () => {
  it("plans from stock + sales, overrides, exports POs and the workbook", async () => {
    const root = await mkdtemp(join(tmpdir(), "reorder-"));
    await cp(join(HERE, "samples"), join(root, "仓库"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("reorder_open", { inputs: ["仓库/stock.xlsx", "仓库/sales.xlsx"], project: "nov", settings: { buyer: "Penova 茶铺", date: "2026-11-15" } });
    const rows = o.data.rows as Record<string, unknown>[];
    const by = (sku: string) => rows.find((r) => r.sku === sku)!;
    expect(o.data.issues.map((i: { message: string }) => i.message).join("\n")).toMatch(/GIFT-OLD/);
    expect(o.data.issues.some((i: { row?: number; message: string }) => i.row === 4 && /run out before/.test(i.message))).toBe(true);
    expect(by("GIFT-CARD")).toMatchObject({ daily: 0, _suggest: 0 });
    expect(by("TEA-LJ-250")._suggest).toBe(180);
    expect((by("TEA-LJ-250")._suggest as number) % 12).toBe(0);
    expect(o.data.stats).toMatchObject({ items: 12, reorder: 5, suppliers: 4, total: 29832, atRisk: 3 });
    const e = await c.call("reorder_edit", { project: "nov", set: [{ row: 0, values: { 订货数量: 30 } }] });
    expect(e.data.issues.some((i: { row?: number; message: string }) => i.row === 0 && /whole number of cases/.test(i.message))).toBe(true);
    await c.call("reorder_edit", { project: "nov", set: [{ row: 0, values: { order: 120 } }] });
    const x = await c.call("reorder_export", { project: "nov" });
    expect(x.text).toMatch(/PO-20261115-01/);
    const out = join(root, "inventory-reorder", "nov");
    const all = await PDFDocument.load(await readFile(join(out, "all-purchase-orders.pdf")));
    expect(all.getPageCount()).toBe(4);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "reorder-plan.xlsx"));
    expect(wb.worksheets.length).toBe(5);
    expect(wb.getWorksheet("补货计划 Plan")!.getRow(2).getCell(11).value).toBe(120);
    // 改统计天数会重读销量，但保留手动订货数量
    const r = await c.call("reorder_edit", { project: "nov", settings: { lookback: 14 } });
    expect(r.data.rows[0].order).toBe(120);
  }, 60_000);
});
