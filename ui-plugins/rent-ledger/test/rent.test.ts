import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { allocate, rmbUpper, schedule } from "../src/rent.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("schedules rent with a pro-rata last period", () => {
    const c = schedule({ unit: "A", tenant: "x", rent: 3100, start: "2026-10-01", end: "2026-12-15", dueDay: 1, cycle: 1, settledTo: "" }, "2026-12-31");
    expect(c.map((x) => [x.period, x.due, x.amount])).toEqual([["2026-10", "2026-10-01", 3100], ["2026-11", "2026-11-01", 3100], ["2026-12", "2026-12-01", 1500]]);
    const q = schedule({ unit: "B", tenant: "y", rent: 2800, start: "2026-01-01", end: "2026-12-31", dueDay: 1, cycle: 3, settledTo: "2026-06" }, "2026-11-27");
    expect(q.map((x) => [x.label, x.amount])).toEqual([["2026年7月起 3 个月房租", 8400], ["2026年10月起 3 个月房租", 8400]]);
  });
  it("applies payments to the oldest rent first", () => {
    const c = schedule({ unit: "A", tenant: "x", rent: 1000, start: "2026-09-01", end: "2027-08-31", dueDay: 5, cycle: 1, settledTo: "" }, "2026-11-27");
    const { credit } = allocate(c, [{ i: 0, date: "2026-09-02", amount: 1500 }, { i: 1, date: "2026-11-01", amount: 1700 }]);
    expect(c.map((x) => x.paid)).toEqual([1000, 1000, 1000]);
    expect(credit).toBe(200);
  });
  it("writes amounts in capitals", () => {
    expect(rmbUpper(2600)).toBe("贰仟陆佰元整");
    expect(rmbUpper(10005.5)).toBe("壹万零伍元伍角");
    expect(rmbUpper(1600.08)).toBe("壹仟陆佰元零捌分");
  });
});

describe("tools", () => {
  it("finds overdue rent, fixes a typo and prints receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "rl-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("rent_open", { inputs: ["房租"], project: "home", settings: { asOf: "2026-11-27", landlord: "周阿姨" } });
    expect(o.text).toMatch(/5 tenant\(s\), 13 payment\(s\) as of 2026-11-27/);
    expect(o.text).toMatch(/no tenant in unit “3O2” — did you mean 302 \(陈静\)\?/);
    expect(o.text).toMatch(/looks like a duplicate of payment #15/);
    expect(o.text).toMatch(/201 王芳 owes 3,200.00 overdue: 2026年11月房租 due 2026-11-10, 17 days/);
    expect(o.text).toMatch(/302 陈静 owes 1,000.00 overdue/);
    expect(o.text).toMatch(/201 王芳: 2026年10月房租 was paid 5 days late/);
    expect(o.text).toMatch(/102 李强: lease ends 2026-12-15 \(18 days\)/);
    expect(o.text).toMatch(/102 李强 has 3,000.00 paid in advance/);
    await c.call("rent_edit", { project: "home", set: [{ row: 18, values: { unit: "302" } }, { row: 16, values: { include: false } }] });
    const st = await c.call("rent_status", { project: "home" });
    expect(st.text).not.toMatch(/3O2|duplicate|302 陈静 owes|李强 has/);
    expect(st.text).toMatch(/overdue: 201 王芳 3,200.00/);
    await c.call("rent_edit", { project: "home", add: [{ kind: "pay", date: "2026-11-27", unit: "201", amount: 3200, method: "支付宝" }] });
    const s2 = await c.call("rent_status", { project: "home" });
    expect(s2.text).toMatch(/nothing overdue/);
    expect((s2.data.rows as Record<string, string>[]).at(-1)!._status).toMatch(/^SJ2026-0014：2026年11月房租 3,200.00$/);
    await c.call("rent_edit", { project: "home", set: [{ row: 19, values: { include: false } }] });
    await c.call("rent_export", { project: "home" });
    expect((await readdir(join(root, "rent-ledger/home"))).sort()).toEqual(["ledger.xlsx", "receipts.pdf", "reminders.md"]);
    expect(await readFile(join(root, "rent-ledger/home/reminders.md"), "utf8")).toMatch(/王芳您好，2026年11月房租 3,200.00 元，应在 2026-11-10 前支付/);
  }, 120_000);
});
