import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { amountOf, compute, parseSpecial, parseTiers, specialFor, tierCommission } from "../src/commission.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("reads tiers in several spellings", () => {
    expect(parseTiers("0-50000:3%; 50000-100000:5%; 100000+:8%").tiers).toEqual([{ from: 0, to: 50000, rate: 0.03 }, { from: 50000, to: 100000, rate: 0.05 }, { from: 100000, to: Infinity, rate: 0.08 }]);
    expect(parseTiers("5万:3%；10万:5%；以上:8%").tiers.map((t) => [t.from, t.to, t.rate])).toEqual([[0, 50000, 0.03], [50000, 100000, 0.05], [100000, Infinity, 0.08]]);
    expect(parseTiers("0-20k:2").tiers).toEqual([{ from: 0, to: 20000, rate: 0.02 }, { from: 20000, to: Infinity, rate: 0.02 }]);
    expect(parseTiers("0-5万:3%; 6万-10万:5%").error).toMatch(/start at 50000/);
    expect(parseTiers("lots:3%").error).toBeTruthy();
    expect(parseSpecial("配件:10%; 服务:15").rates).toEqual([{ match: "配件", rate: 0.1 }, { match: "服务", rate: 0.15 }]);
    expect(specialFor({ category: "整机", product: "服务器 R750" }, parseSpecial("服务:12%").rates)).toBeUndefined();
    expect(specialFor({ category: "", product: "上门安装服务" }, parseSpecial("服务:12%").rates)?.rate).toBe(0.12);
    expect(amountOf("(1,200)")).toBe(-1200);
    expect(amountOf("3.5万")).toBe(35000);
  });
  it("progressive vs whole tiers", () => {
    const { tiers } = parseTiers("0-50000:3%; 50000-100000:5%; 100000+:8%");
    expect(tierCommission(122000, tiers, "progressive").commission).toBeCloseTo(5760, 6);
    expect(tierCommission(122000, tiers, "whole").commission).toBeCloseTo(9760, 6);
    expect(tierCommission(50000, tiers, "whole").topRate).toBe(0.05);
    expect(tierCommission(-1000, tiers, "progressive").commission).toBeCloseTo(-30, 6);
  });
  it("claws back refunds at the period's effective rate and keeps cents exact", () => {
    const { tiers } = parseTiers("0-100:10%; 100+:20%");
    const sale = (row: number, amount: number, refund = false, category = "") => ({ row, date: "", person: "A", order: "", product: "", category, amount, refund });
    const { results, lines } = compute([sale(0, 100), sale(1, 100), sale(2, 50, true), sale(3, 33.33, false, "配件")], tiers, [{ match: "配件", rate: 0.1 }], "progressive");
    // 阶梯净额 150 → 10 + 10 = 20；有效费率 13.333%；退货 -6.67，两笔销售共 26.67
    expect(results[0]).toMatchObject({ tierBase: 150, tierCommission: 26.67, specialCommission: 3.33, clawback: -6.67, total: 23.33 });
    expect([0, 1].map((r) => lines.get(r)!.commission).reduce((a, b) => a + b, 0)).toBeCloseTo(26.67, 9);
  });
});

describe("tools", () => {
  it("opens the sample, explains the October statements and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "comm-"));
    await cp(join(HERE, "samples"), join(root, "销售"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("commission_open", { inputs: ["销售/sales.xlsx"], project: "oct", settings: { period: "2026-10", special: "配件:8%; 服务:12%" } });
    expect(o.data.issues.filter((i: { level: string }) => i.level !== "info")).toEqual([]);
    expect(o.data.stats).toMatchObject({ people: 3, lines: 19, payable: 11309.6, clawback: -1074.76 });
    const st = (await c.call("commission_status", { project: "oct" })).text;
    expect(st).toMatch(/11,309\.60/);
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[0]._type).toMatch(/skipped/);
    expect(rows[15]).toMatchObject({ _type: "退货 refund", _commission: -878.16 });
    const w = await c.call("commission_edit", { project: "oct", settings: { mode: "whole" } });
    expect(w.data.stats.payable).toBeCloseTo(9760 + 720 + 692 + (59960 * 0.05 + 288 + 319.2) + (21800 * 0.03 + 318.4 + 344 + 216), 2);
    await c.call("commission_edit", { project: "oct", settings: { mode: "progressive" }, set: [{ row: 3, values: { 销售: "王 强" } }] });
    const dup = await c.call("commission_status", { project: "oct" });
    expect(dup.data.issues.some((i: { message: string }) => /same person/.test(i.message))).toBe(true);
    await c.call("commission_edit", { project: "oct", set: [{ row: 3, values: { person: "王强" } }] });
    await c.call("commission_export", { project: "oct" });
    const out = join(root, "sales-commission", "oct");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "commission.xlsx"));
    const sum = wb.getWorksheet("汇总 Summary")!;
    expect(sum.getRow(2).values).toEqual(expect.arrayContaining(["陈晨", 7172]));
    const pdf = await PDFDocument.load(await readFile(join(out, "statements", "陈晨.pdf")));
    expect(pdf.getPageCount()).toBe(1);
    const all = await PDFDocument.load(await readFile(join(out, "all-statements.pdf")));
    expect(all.getPageCount()).toBe(3);
  }, 60_000);
});
