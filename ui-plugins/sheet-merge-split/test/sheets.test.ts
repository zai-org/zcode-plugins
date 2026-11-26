import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { aligner } from "../src/headers.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const book = async (p: string) => { const b = new ExcelJS.Workbook(); await b.xlsx.load((await readFile(p)) as never); return b; };

describe("headers", () => {
  it("aligns synonyms and user rules", () => {
    const a = aligner("营收=Revenue");
    expect(["金额", "Amount (元)", "amount", "Date", "日期", "营收", "Revenue", "其他"].map(a)).toEqual(["金额", "金额", "金额", "Date", "Date", "营收", "营收", "其他"]);
  });
});

describe("sheets tools", () => {
  it("merges files and sheets, then splits", async () => {
    const root = await mkdtemp(join(tmpdir(), "sheets-"));
    await cp(join(HERE, "samples"), join(root, "销售"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("sheets_open", { inputs: ["销售/门店销售-2026Q4.xlsx", "销售/线上订单-11月.csv"], project: "q4" });
    expect(o.data.stats).toEqual({ rows: 7, sources: 3, columns: 6 });
    expect(o.data.issues.some((i: { message: string }) => /Amount \(元\)→金额/.test(i.message))).toBe(true);
    expect(o.data.rows[5]).toMatchObject({ _src: "线上订单-11月.csv", c0: "2026-11-11", c1: "天猫旗舰店", c4: "2148" });
    await c.call("sheets_export", { project: "q4" });
    const m = await book(join(root, "sheet-merge-split/q4/merged.xlsx"));
    expect(m.getWorksheet("merged")!.getRow(1).values).toEqual([, "来源", "日期", "门店", "商品", "数量", "金额", "备注"]);
    expect(m.getWorksheet("merged")!.getCell("F7").value).toBe(2148);
    const s = await c.call("sheets_open", { inputs: ["销售/门店销售-2026Q4.xlsx"], project: "split", settings: { mode: "split" } });
    expect(s.data.stats).toEqual({ rows: 5, parts: 3 });
    await c.call("sheets_edit", { project: "split", settings: { splitBy: "商品", format: "csv" } });
    const x = await c.call("sheets_export", { project: "split" });
    expect(x.text).toMatch(/split\.zip/);
    expect((await readdir(join(root, "sheet-merge-split/split/split"))).sort()).toEqual(["白茶饼.csv", "茶具套装.csv", "龙井 250g.csv"].sort());
    const b = await book(join(root, "sheet-merge-split/split/by-商品.xlsx"));
    expect(b.worksheets.map((w) => w.name).sort()).toEqual(["白茶饼", "茶具套装", "龙井 250g"].sort());
    const bad = await c.call("sheets_edit", { project: "split", settings: { splitBy: "城市" } });
    expect(bad.data.issues[0].message).toMatch(/not found/);
  });
});
