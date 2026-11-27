import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { build, parseExcludes, parseOptions, parseValue } from "../src/variants.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("options", () => {
  it("reads values with codes, price changes and stock", () => {
    expect(parseValue("XL(+10)")).toMatchObject({ value: "XL", code: "", delta: 10, pct: 0 });
    expect(parseValue("黑色=BK")).toMatchObject({ value: "黑色", code: "BK", delta: 0 });
    expect(parseValue("大号=L（+5%）[20]")).toMatchObject({ value: "大号", code: "L", pct: 5, stock: 20 });
    expect(parseValue("S/M")).toMatchObject({ value: "S/M" });
    expect(parseOptions("颜色: 黑, 黑").error).toMatch(/twice/);
    expect(parseOptions("a: 1; b: 2; c: 3; d: 4").error).toMatch(/at most 3/);
    expect(parseOptions("颜色 黑").error).toBeTruthy();
  });
  it("expands every combination with SKUs, prices, stock and exclusions", () => {
    const { options } = parseOptions("Colour: Black=BK, White=WH[5]\nSize: S, XL(+10), XXL(+10%)");
    const v = build(options, { base: "tee", pattern: "{base}-{1}-{Size}", price: 100, stock: 8, upper: true, excludes: parseExcludes("White+XXL") });
    expect(v.map((x) => [x.sku, x.price, x.stock, x.excluded])).toEqual([
      ["TEE-BK-S", 100, 8, false], ["TEE-BK-XL", 110, 8, false], ["TEE-BK-XXL", 110, 8, false],
      ["TEE-WH-S", 100, 5, false], ["TEE-WH-XL", 110, 5, false], ["TEE-WH-XXL", 110, 5, true],
    ]);
    expect(build(options, { base: "T", pattern: "{base}{n}", price: 1, stock: 0, upper: false, excludes: [] }).map((x) => x.sku).slice(0, 2)).toEqual(["T001", "T002"]);
    expect(build(parseOptions("色: 红, 蓝").options, { base: "A", pattern: "{base}-{1}", price: 1, stock: 0, upper: true, excludes: [] })[0].sku).toBe("A-红");
  });
});

describe("tools", () => {
  it("builds variants from the options sheet and keeps manual edits across rule changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "variants-"));
    await cp(join(HERE, "samples"), join(root, "款式"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("variants_open", { inputs: ["款式/options.xlsx"], project: "tee", settings: { product: "有机棉 T 恤", base: "TEE01", price: 99, stock: 10, exclude: "白色+XXL" } });
    expect(o.data.stats).toEqual({ combinations: 15, variants: 14, minPrice: 99, maxPrice: 119, stock: 5 * 10 + 4 * 10 + 5 * 30 });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[3]).toMatchObject({ sku: "TEE01-BK-XL", price: 109, opt1: "黑色", opt2: "XL", name: "有机棉 T 恤 黑色 XL" });
    expect(rows[9]).toMatchObject({ sku: "TEE01-WH-XXL", enabled: false });
    // 手动改价、改 SKU，再改规则：手动的保留，其余跟着变
    await c.call("variants_edit", { project: "tee", set: [{ row: 0, values: { 价格: 89 } }, { row: 1, values: { sku: "TEE01-BLACK-M" } }] });
    const r = await c.call("variants_edit", { project: "tee", settings: { pattern: "{base}{1}{2}", price: 109 } });
    const rr = r.data.rows as Record<string, unknown>[];
    expect(rr[0]).toMatchObject({ sku: "TEE01BKS", price: 89 });
    expect(rr[1]).toMatchObject({ sku: "TEE01-BLACK-M", price: 109 });
    expect(rr[3].price).toBe(119);
    const d = await c.call("variants_edit", { project: "tee", set: [{ row: 2, values: { sku: "TEE01-BLACK-M" } }] });
    expect(d.data.issues.some((i: { row?: number; level: string; message: string }) => i.row === 2 && i.level === "error" && /same as row 1/.test(i.message))).toBe(true);
    await c.call("variants_edit", { project: "tee", set: [{ row: 2, values: { sku: "TEE01BKL" } }] });
    await c.call("variants_export", { project: "tee" });
    const out = join(root, "variant-sku-builder", "tee");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "variants.xlsx"));
    const ws = wb.getWorksheet("变体 Variants")!;
    expect(ws.rowCount).toBe(15);
    expect(ws.getRow(1).values).toEqual([undefined, "SKU", "商品 Product", "颜色", "尺码", "变体名称 Name", "价格 Price", "库存 Stock", "条码 Barcode", "重量 Weight"]);
    const csv = String(await readFile(join(out, "variants.csv")));
    expect(csv).toContain("TEE01-BLACK-M");
    expect(csv).not.toContain("TEE01WHXXL");
  }, 60_000);
  it("starts from an example when there is no file", async () => {
    const root = await mkdtemp(join(tmpdir(), "variants-"));
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("variants_open", { inputs: [], project: "demo" });
    expect(o.data.stats.combinations).toBe(15);
  });
});
