import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { classify, DEFAULT_RULES, parseRules, UNCATEGORIZED } from "../src/categorize.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("parses alternatives, arrows and comments; reports bad lines", () => {
    const { rules, bad } = parseRules("# c\n咖啡|coffee => 餐饮\nuber -> 交通\nnonsense line");
    expect(rules.map((r) => `${r.keyword}:${r.category}`)).toEqual(["咖啡:餐饮", "coffee:餐饮", "uber:交通"]);
    expect(bad).toEqual(["nonsense line"]);
  });
  it("manual category beats rules; first rule wins; unknown is uncategorised", () => {
    const c = classify([
      { date: "2026-11-01", description: "STARBUCKS 12", amount: "-5", category: "", source: "a" },
      { date: "2026/11/02", description: "STARBUCKS 12", amount: "-5", category: "Work", source: "a" },
      { date: "2026年11月3日", description: "???", amount: "(3.50)", category: "", source: "a" },
    ], DEFAULT_RULES);
    expect(c.rows.map((r) => [r.date, r.amount, r.category])).toEqual([["2026-11-01", -5, "餐饮 Dining"], ["2026-11-02", -5, "Work"], ["2026-11-03", -3.5, UNCATEGORIZED]]);
  });
});

describe("statement tools on real-format samples", () => {
  it("reads a bank CSV with a preamble and an Alipay-style export, categorises, exports", async () => {
    const ws = await mkdtemp(join(tmpdir(), "stmt-"));
    await cp(join(HERE, "samples"), join(ws, "账单"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("statement_open", { inputs: ["账单/bank-2026-10.csv", "账单/支付宝-2026-11.csv"], project: "2026-秋" });
    expect(r.data.totalRows).toBe(26);
    const rows = r.data.rows;
    const ali = rows.find((x: any) => x.description.startsWith("京东商城"));
    expect(ali.amount).toBe(-1299);
    expect(ali.category).toBe("购物 Shopping");
    expect(rows.find((x: any) => x.description.startsWith("张三")).amount).toBe(500);
    expect(rows.find((x: any) => x.description === "TRANSFER TO SAVINGS").category).toBe("储蓄 Savings");
    const unc = r.data.issues.filter((i: any) => i.key === "category").map((i: any) => rows[i.row].description);
    expect(unc).toEqual(["UNKNOWN MERCHANT 8831", "某某小店 · 未知"]);
    expect(r.data.summary).toContain("income 8,900.00");
    // 用户把未知商户手动归类，再加一条规则
    const e = await call("statement_edit", { project: "2026-秋", set: [{ row: 10, values: { category: "餐饮 Dining" } }], settings: { rules: DEFAULT_RULES + "\n小店 => 购物 Shopping" } });
    expect(e.data.issues.filter((i: any) => i.key === "category")).toEqual([]);
    const out = await call("statement_export", { project: "2026-秋" });
    const xlsxPath = out.data.exported.find((f: string) => f.endsWith(".xlsx"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await readFile(join(ws, xlsxPath))) as never);
    const summary = book.getWorksheet("Summary")!;
    const housing = summary.getRows(2, summary.rowCount - 1)!.find((row) => row.getCell(1).value === "住房 Housing")!;
    expect(housing.getCell(2).value).toBe(-1650);
    expect(await readFile(join(ws, out.data.exported.find((f: string) => f.endsWith("rules.txt"))), "utf8")).toContain("小店 => 购物 Shopping");
  });
  it("flags the same transaction in two files and positive-as-spending card statements", async () => {
    const ws = await mkdtemp(join(tmpdir(), "stmt-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(ws, "a.csv"), "Date,Description,Debit,Credit\n2026-11-01,CHIPOTLE,12.80,\n2026-11-02,REFUND,,5\n");
    await writeFile(join(ws, "b.csv"), "日期,摘要,金额\n2026-11-01,chipotle,-12.80\n2026-11-04,咖啡,x\n");
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("statement_open", { inputs: ["a.csv", "b.csv"] });
    expect(r.data.rows.map((x: any) => x.amount)).toEqual([-12.8, 5, -12.8, "x"]);
    expect(r.data.issues.some((i: any) => i.row === 2 && /twice|重复/.test(i.message))).toBe(true);
    expect(r.data.issues.some((i: any) => i.row === 3 && i.level === "error")).toBe(true);
    const card = await call("statement_edit", { project: "a", settings: { sign: "positive" } });
    expect(card.data.rows[0].amount).toBe(-12.8);
    expect(card.data.rows[2].amount).toBe(12.8);
  });
});
