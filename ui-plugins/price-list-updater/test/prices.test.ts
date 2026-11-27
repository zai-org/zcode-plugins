import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { applyAction, charm, matchRule, parseAction, parseRules } from "../src/pricing.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules and rounding", () => {
  it("reads price changes", () => {
    expect(parseAction("+5%")).toEqual({ kind: "pct", value: 5 });
    expect(parseAction("降 10%")).toEqual({ kind: "pct", value: -10 });
    expect(parseAction("-1.5")).toEqual({ kind: "add", value: -1.5 });
    expect(parseAction("＝１２.９")).toEqual({ kind: "set", value: 12.9 });
    expect(parseAction("x1.1")).toEqual({ kind: "mul", value: 1.1 });
    expect(parseAction("成本+40%")).toEqual({ kind: "markup", value: 40 });
    expect(parseAction("cost 40%")).toEqual({ kind: "markup", value: 40 });
    expect(parseAction("贵一点")).toBeUndefined();
    expect(applyAction({ kind: "markup", value: 50 }, 99, 10)).toBe(15);
  });
  it("parses rule lines, first match wins", () => {
    const { rules, errors } = parseRules("分类=饮料，零食: +5%\n# 注释\nSKU=A1: =9.9\n名称=有机: x1.1\n全部: +3%\n颜色=红: +1\n分类: +1\n全部 +2");
    expect(rules.map((r) => [r.field, r.values])).toEqual([["category", ["饮料", "零食"]], ["sku", ["A1"]], ["name", ["有机"]], ["all", []]]);
    expect(errors).toHaveLength(3);
    const item = { sku: "A1", name: "有机菠菜", category: "零食", supplier: "", cost: 1, price: 5 };
    expect(matchRule(rules, item)?.line).toBe(1);
    expect(matchRule(rules, { ...item, category: "生鲜" })?.line).toBe(3);
    expect(matchRule(rules, { ...item, category: "生鲜", sku: "B" })?.line).toBe(4);
  });
  it("rounds to charm prices", () => {
    expect(charm(12.6, "0.9")).toBe(12.9);
    expect(charm(12.9, "0.9")).toBe(12.9);
    expect(charm(12.95, "0.9")).toBe(13.9);
    expect(charm(12.95, "0.9", "nearest")).toBe(12.9);
    expect(charm(23, "9")).toBe(29);
    expect(charm(23, "9", "nearest")).toBe(19);
    expect(charm(10.01, "0.99")).toBe(10.99);
    expect(charm(10.01, "0.99", "down")).toBe(9.99);
    expect(charm(0.5, "0.99", "down")).toBe(0.99);
    expect(charm(12.3, "0.5")).toBe(12.5);
    expect(charm(12.346, "none")).toBe(12.35);
    expect(charm(7.725, "1", "down")).toBe(7);
  });
});

describe("tools", () => {
  it("updates the price list, keeps overrides and writes the files", async () => {
    const root = await mkdtemp(join(tmpdir(), "prices-"));
    await cp(join(HERE, "samples"), join(root, "价目"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("prices_open", { inputs: ["价目/prices.xlsx"], project: "q4" });
    expect(o.data.stats).toMatchObject({ items: 12, changed: 12, up: 12, oldTotal: 174.4, newTotal: 186.8 });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.new)).toEqual([12.9, 5.9, 16.9, 9.9, 33.9, 20.9, 10.9, 19.9, 14.9, 14.9, 7.9, 17.9]);
    expect(rows[3]).toMatchObject({ rule: "#2 供应商=绿源: +1", margin: "55.6%" });
    // 手动改价后换规则，手动的保留
    const e = await c.call("prices_edit", { project: "q4", set: [{ row: 9, values: { 新价: 8 } }] });
    expect(e.data.stats.manual).toBe(1);
    expect((e.data.rows as Record<string, unknown>[])[9].rule).toBe("✎ 手动 / manual");
    expect(e.data.issues.some((i: { row?: number; message: string }) => i.row === 9 && /below cost/.test(i.message))).toBe(true);
    const r = await c.call("prices_edit", { project: "q4", settings: { rules: "分类=生鲜: 成本+50%\n供应商=不存在: +1\n全部: +0%", direction: "nearest" } });
    const rr = r.data.rows as Record<string, unknown>[];
    expect(rr[9]).toMatchObject({ new: 8, rule: "✎ 手动 / manual" });
    expect(rr[10].new).toBe(5.9);
    expect(rr[11].new).toBe(15.9);
    expect(rr[0]).toMatchObject({ new: 11.9, change: "-0.10 (-0.8%)" });
    expect(r.data.issues.some((i: { message: string }) => /Rule #2 .* matched no item/.test(i.message))).toBe(true);
    await c.call("prices_edit", { project: "q4", set: [{ row: 9, values: { new: 14.8 } }] });
    await c.call("prices_export", { project: "q4" });
    const out = join(root, "price-list-updater", "q4");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "updated-prices.xlsx"));
    const ws = wb.getWorksheet("价目表 Prices")!;
    expect(ws.getRow(1).values).toEqual([undefined, "SKU", "商品名称", "分类", "供应商", "进价", "售价", "库存", "备注"]);
    expect(ws.getCell("F2").value).toBe(11.9);
    expect(ws.getCell("F2").note).toBeTruthy();
    expect(ws.getCell("G2").value).toBe(120);
    expect(ws.getCell("H4").value).toBe("进口");
    expect(ws.getCell("F11").value).toBe(14.8);
    const chg = wb.getWorksheet("改价对照 Changes")!;
    expect(chg.rowCount).toBe(13);
    const csv = String(await readFile(join(out, "price-changes.csv")));
    expect(csv.trim().split(/\r?\n/)[0]).toBe("sku,name,category,supplier,old_price,new_price,change,change_pct,rule");
    expect(csv).toMatch(/F001,.*,14\.8,.*manual/);
  }, 60_000);
  it("explains a missing price column", async () => {
    const root = await mkdtemp(join(tmpdir(), "prices-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "x.csv"), "名称,数量\n苹果,3\n");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("prices_open", { inputs: ["x.csv"], project: "x" }).catch((e: Error) => ({ error: String(e) }));
    expect(JSON.stringify(o)).toMatch(/No price column/);
  });
});
