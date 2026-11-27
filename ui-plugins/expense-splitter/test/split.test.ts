import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { balances, money, parsePayers, parseShares, settle } from "../src/split.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe("parsing", () => {
  it("reads amounts", () => {
    expect(money("1,240")).toBe(1240);
    expect(money("¥96.5")).toBe(96.5);
    expect(money("1.2万")).toBe(12000);
    expect(money("abc")).toBeNaN();
  });
  it("reads one or several payers and checks the total", () => {
    expect(obj(parsePayers("小王", 12.5).paid)).toEqual({ 小王: 1250 });
    expect(obj(parsePayers("小李:900; 阿珍:500", 1400).paid)).toEqual({ 小李: 90000, 阿珍: 50000 });
    expect(obj(parsePayers("Ann Lee", 10).paid)).toEqual({ "Ann Lee": 1000 });
    expect(parsePayers("A:100, B:200", 400).error).toMatch(/add up to 300.00/);
    expect(parsePayers("", 1).error).toMatch(/no payer/);
  });
  it("splits equally with leftover cents, exclusions, weights and fixed amounts", () => {
    const ppl = ["A", "B", "C"];
    expect(obj(parseShares("全部", 1000, ppl).owed)).toEqual({ A: 334, B: 333, C: 333 });
    expect(obj(parseShares("all, -C", 1001, ppl).owed)).toEqual({ A: 501, B: 500 });
    expect(obj(parseShares("A*2, B", 900, ppl).owed)).toEqual({ A: 600, B: 300 });
    expect(obj(parseShares("C:80, 全部", 23000, ppl).owed)).toEqual({ C: 8000, A: 7500, B: 7500 });
    expect(obj(parseShares("C+80, 全部", 23000, ppl).owed)).toEqual({ C: 13000, A: 5000, B: 5000 });
    expect(parseShares("A:300", 200, ppl).error).toMatch(/more than the amount/);
    expect(parseShares("全部, -A, -B, -C", 100, ppl).error).toMatch(/nobody/);
    expect(parseShares("全部, -Z", 300, ppl).warn).toMatch(/Z/);
  });
});

describe("settle", () => {
  it("uses the fewest transfers by finding groups that cancel out", () => {
    const bal = new Map([["A", 1000], ["B", 700], ["C", -1000], ["D", -400], ["E", -300]]);
    const t = settle(bal);
    expect(t.length).toBe(3);
    const net = new Map([...bal.keys()].map((k) => [k, 0]));
    for (const x of t) { net.set(x.from, net.get(x.from)! - x.amount); net.set(x.to, net.get(x.to)! + x.amount); }
    expect(obj(net)).toEqual(obj(bal));
    expect(t).toContainEqual({ from: "C", to: "A", amount: 1000 });
    const greedyTrap = new Map([["a", 600], ["b", 400], ["c", -500], ["d", -500], ["e", 300], ["f", -300]]);
    expect(settle(greedyTrap).length).toBe(4);
    expect(settle(new Map([["x", 0]]))).toEqual([]);
  });
});

describe("tools", () => {
  it("opens the sample, edits and exports a workbook and PNG", async () => {
    const root = await mkdtemp(join(tmpdir(), "split-"));
    await cp(join(HERE, "samples"), join(root, "trip"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("split_open", { inputs: ["trip/expenses.csv"], project: "dali" });
    expect(o.data.issues).toEqual([]);
    expect(o.data.stats).toMatchObject({ people: 4, expenses: 8, total: 3884.5 });
    const rows = o.data.rows as Record<string, string>[];
    expect(rows[3]._each).toBe("小王 53.34 · 小李 53.33 · 阿珍 53.33");
    expect(rows[6]._each).toBe("小王 37.50 · 小李 37.50 · 阿珍 37.50 · Tom 117.50");
    expect(o.data.stats.transfers).toBeLessThanOrEqual(3);
    const e = await c.call("split_edit", { project: "dali", set: [{ row: 0, values: { 付款人: "小王:1000, Tom:200" } }] });
    expect(e.data.issues[0].message).toMatch(/add up to 1200.00, not 1240.00/);
    await c.call("split_edit", { project: "dali", set: [{ row: 0, values: { payer: "小王" } }], add: [{ item: "门票", payer: "tom", amount: 75, participants: "全部" }] });
    const st = await c.call("split_status", { project: "dali" });
    expect(st.data.issues.some((i: { message: string }) => /same person/.test(i.message))).toBe(true);
    await c.call("split_edit", { project: "dali", remove: [8] });
    const x = await c.call("split_export", { project: "dali" });
    const files: string[] = JSON.stringify(x.data).match(/[^"]*settlement\.(xlsx|png)/g) ?? [];
    expect(files.length).toBeGreaterThanOrEqual(2);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "expense-splitter", "dali", "settlement.xlsx"));
    const bal = wb.getWorksheet("余额 Balances")!;
    let sum = 0; bal.eachRow((r, i) => { if (i > 1) sum += Number(r.getCell(4).value); });
    expect(Math.abs(sum)).toBeLessThan(1e-9);
    const png = await readFile(join(root, "expense-splitter", "dali", "settlement.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);
});
