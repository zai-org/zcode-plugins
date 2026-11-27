import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { addMonths, annuity, parsePrepays, schedule, type Plan } from "../src/loan.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const plan = (o: Partial<Plan> = {}): Plan => ({ name: "p", principal: 1000000, rate: 3.1, months: 360, method: "annuity", start: "2027-01", prepays: [], rates: [], ...o });

describe("loan maths", () => {
  it("annuity matches the formula", () => {
    const r = schedule(plan());
    const expected = annuity(1000000, 3.1 / 1200, 360);
    expect(r.firstPayment).toBeCloseTo(expected, 2);
    expect(r.months).toBe(360);
    expect(r.schedule[359].balance).toBe(0);
    expect(r.totalInterest).toBeCloseTo(expected * 360 - 1000000, 0);
    expect(r.payoff).toBe("2056-12");
  });
  it("equal principal decreases", () => {
    const r = schedule(plan({ method: "principal" }));
    expect(r.schedule[0].principal).toBeCloseTo(1000000 / 360, 2);
    expect(r.schedule[0].interest).toBeCloseTo(2583.33, 2);
    expect(r.schedule[1].payment).toBeLessThan(r.schedule[0].payment);
    expect(r.totalInterest).toBeCloseTo((1000000 * 3.1) / 1200 * 361 / 2, 0);
  });
  it("prepayments shorten the term or lower the payment", () => {
    const base = schedule(plan());
    const short = schedule(plan({ prepays: [{ month: "2029-01", amount: 200000, mode: "shorten" }] }));
    const reduce = schedule(plan({ prepays: [{ month: "2029-01", amount: 200000, mode: "reduce" }] }));
    expect(short.months).toBeLessThan(300);
    expect(reduce.months).toBe(360);
    expect(reduce.schedule[30].payment).toBeLessThan(base.schedule[30].payment);
    expect(Math.abs(short.schedule[30].payment - base.schedule[30].payment) / base.schedule[30].payment).toBeLessThan(0.01); // 月供基本不变
    expect(short.totalInterest).toBeLessThan(reduce.totalInterest);
    expect(reduce.totalInterest).toBeLessThan(base.totalInterest);
  });
  it("rate change applies from its month", () => {
    const r = schedule(plan({ rates: [{ month: "2028-01", rate: 2.9 }] }));
    expect(r.schedule[11].rate).toBe(3.1);
    expect(r.schedule[12].rate).toBe(2.9);
    expect(r.schedule[12].payment).toBeLessThan(r.schedule[11].payment);
  });
  it("parses prepayment text", () => {
    expect(parsePrepays("2029-01:200000 缩短期限; 第36期:5万 减少月供", "2027-01")).toEqual([{ month: "2029-01", amount: 200000, mode: "shorten" }, { month: addMonths("2027-01", 35), amount: 50000, mode: "reduce" }]);
    expect(parsePrepays("明年还一点", "2027-01")).toBeNull();
  });
});

describe("loan tools", () => {
  it("compares plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "loan-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("loan_open", { inputs: ["plans.csv"], project: "h", settings: { title: "首套房贷款方案" } });
    expect(o.data.stats).toMatchObject({ plans: 3 });
    expect(o.text).toContain("least interest: 等额本息 + 提前还款");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[1]).toMatchObject({ method: "等额本金", principal: 1000000, rate: 3.1, years: 30, start: "2027-01" });
    const bad = await c.call("loan_edit", { project: "h", set: [{ row: 2, values: { prepay: "明年还一点" } }] });
    expect(JSON.stringify(bad.data.issues)).toContain("aren't understood");
    await c.call("loan_edit", { project: "h", set: [{ row: 2, values: { prepay: "2029-01:20万 缩短期限" } }] });
    await c.call("loan_export", { project: "h" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "loan-calculator/h/loan-schedule.xlsx"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["对比 Compare", "等额本息 30 年", "等额本金 30 年", "等额本息 + 提前还款"]);
    expect(wb.getWorksheet(2)!.rowCount).toBe(361);
    const cmp = wb.getWorksheet(1)!;
    expect(Number(cmp.getRow(4).getCell(12).value)).toBeGreaterThan(100000);
    const html = await readFile(join(root, "loan-calculator/h/loan-report.html"), "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("首套房贷款方案");
    // 不选文件也能开
    const blank = await c.call("loan_open", { inputs: [], project: "b" });
    expect(blank.data.stats).toMatchObject({ plans: 2 });
  });
});
