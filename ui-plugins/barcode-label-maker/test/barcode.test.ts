import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { C128, code128, eanCheck, encode, totalModules } from "../src/barcode.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer, duplicateBarcodes } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("encoders", () => {
  it("has the full Code 128 table and correct checksums", () => {
    expect(C128).toHaveLength(107);
    expect(C128.every((p, i) => [...p].reduce((a, b) => a + Number(b), 0) === (i === 106 ? 13 : 11))).toBe(true);
    // “PJJ123C” 的校验值（参考实现）：总宽 = 11×(起始+7+校验) + 13
    expect(code128("PJJ123C").reduce((a, b) => a + b, 0)).toBe(11 * 9 + 13);
    expect(code128("12345678").reduce((a, b) => a + b, 0)).toBe(11 * 6 + 13); // C 字符集：起始 + 4 对 + 校验
  });
  it("EAN-13 / UPC-A", () => {
    expect(eanCheck("690123456789")).toBe("2");
    const e = encode("6901234567892");
    expect(e.kind).toBe("ean13");
    expect(totalModules(e)).toBe(95);
    expect(encode("012345678905").kind).toBe("upca");
    expect(encode("690123456789")).toMatchObject({ kind: "ean13", human: "6901234567892", warn: expect.any(String) });
    expect(encode("6901234567891")).toMatchObject({ kind: "code128", warn: expect.stringContaining("2") });
    expect(() => encode("6901234567891", "ean13")).toThrow(/check digit/);
    expect(() => encode("茶叶")).toThrow(/ASCII/);
  });
});

describe("label tools", () => {
  it("opens the product sheet, explains barcode fixes, exports a label PDF", async () => {
    const ws = await mkdtemp(join(tmpdir(), "lbl-"));
    await cp(join(HERE, "samples"), join(ws, "店铺"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("labels_open", { inputs: ["店铺/products.xlsx"] });
    expect(r.data.rows.map((x: any) => x._type)).toEqual(["EAN13", "UPCA", "CODE128", "EAN13", "CODE128", "CODE128"]);
    expect(r.data.stats.labels).toBe(13);
    // 第 3 行是 12 位数字，补上校验位后正好和第 0 行的 EAN-13 一样，两行都要提示重复
    expect(r.data.issues.filter((i: any) => i.level === "warn").map((i: any) => i.row)).toEqual([3, 4, 0, 3]);
    expect(r.data.issues.find((i: any) => i.row === 3 && /same as row/.test(i.message)).message).toMatch(/after adding check digit/);
    const e = await call("labels_edit", { project: "products", settings: { sheet: "a4-4x10", skip: 30 } });
    expect(e.data.stats.sheets).toBe(2);
    const out = await call("labels_export", { project: "products" });
    const pdf = await PDFDocument.load(await readFile(join(ws, out.data.exported[0])));
    expect(pdf.getPageCount()).toBe(2);
    expect(out.data.exported).toContain("barcode-label-maker/products/svg/TEA-001.svg");
  });
});

// 回归测试：补上校验位后和另一行条码重复时要警告（FIX-QUEUE-100）
describe("duplicate barcodes", () => {
  it("warns when a computed check digit makes two items share a barcode", () => {
    const rows = [
      { sku: "A-1", name: "Tea", barcode: "590123412345", price: "", qty: 1 },
      { sku: "B-2", name: "Cup", barcode: "5901234123457", price: "", qty: 1 },
      { sku: "C-3", name: "Pot", barcode: "4006381333931", price: "", qty: 1 },
      { sku: "", name: "UPC", barcode: "036000291452", price: "", qty: 1 },
      { sku: "", name: "EAN of UPC", barcode: "0036000291452", price: "", qty: 1 },
    ];
    const w = duplicateBarcodes(rows, "auto");
    expect(w.map((x) => x.row)).toEqual([0, 1, 3, 4]);
    expect(w[0].message).toContain("after adding check digit 7");
    expect(w[0].message).toContain("#1 B-2");
    expect(w[1].message).not.toContain("after adding");
    expect(duplicateBarcodes(rows.slice(1, 3), "auto")).toEqual([]);
  });
});
