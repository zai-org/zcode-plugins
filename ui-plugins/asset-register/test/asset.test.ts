import { cp, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { byCalendarYear, monthly, monthsElapsed } from "../src/depr.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const year = (m: number[], k: number) => Math.round(m.slice(k * 12, k * 12 + 12).reduce((a, b) => a + b, 0) * 100) / 100;

describe("depreciation", () => {
  it("straight-line, double-declining and sum-of-years", () => {
    const sl = monthly(6000, 300, 3, "straight");
    expect(sl.length).toBe(36);
    expect(Math.round(sl[0] * 100) / 100).toBe(158.33);
    const ddb = monthly(10000, 500, 5, "ddb");
    expect([0, 1, 2, 3, 4].map((k) => year(ddb, k))).toEqual([4000, 2400, 1440, 830, 830]);
    const syd = monthly(15000, 0, 5, "syd");
    expect([0, 4].map((k) => year(syd, k))).toEqual([5000, 1000]);
    expect(monthsElapsed("2024-03-15", "2026-11-30")).toBe(32);
    const cal = byCalendarYear("2024-11-05", monthly(1200, 0, 1, "straight"));
    expect([...cal.entries()]).toEqual([[2024, 100], [2025, 1100]]);
  });
});

describe("tools", () => {
  it("checks the register, fixes it and exports tags and schedules", async () => {
    const root = await mkdtemp(join(tmpdir(), "as-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("asset_open", { inputs: ["资产"], project: "fa", settings: { asOf: "2026-11-30", company: "青禾科技" } });
    expect(o.text).toMatch(/13 asset\(s\) as of 2026-11-30/);
    expect(o.text).toMatch(/ZC-007 is used twice/);
    expect(o.text).toMatch(/serial number CN-0K2H7T is the same as #2/);
    expect(o.text).toMatch(/can't read the purchase date “2025-13-02”/);
    expect(o.text).toMatch(/category “相机” has no default/);
    expect(o.text).toMatch(/ZC-002 ThinkPad X1 Carbon was due back 2026-11-10 \(20 days overdue\)/);
    expect(o.text).toMatch(/ZC-007 Epson CB-FH52 投影仪 is checked out but nobody is named/);
    expect(o.text).toMatch(/residual 1500.00 isn't less than the cost 1200.00/);
    expect(o.text).toMatch(/ZC-013 MacBook Air 13 寸 is fully depreciated/);
    expect(o.text).toContain("SN CN-0K2H7T");
    let rows = (await c.call("asset_status", { project: "fa" })).data.rows as Record<string, string>[];
    expect(rows[0]._acc).toBe("12665.82");
    expect(rows[0]._nbv).toBe("2333.18");
    await c.call("asset_edit", { project: "fa", set: [
      { row: 7, values: { id: "ZC-008" } }, { row: 3, values: { serial: "CN-0K2H9W" } }, { row: 9, values: { bought: "2025-12-02", life: 5 } },
      { row: 11, values: { residual: "5%" } }, { row: 6, values: { holder: "市场部 李娜" } },
    ] });
    const st = await c.call("asset_status", { project: "fa" });
    expect(st.text).not.toMatch(/used twice|same as|can't read|no default|nobody|isn't less/);
    rows = st.data.rows as Record<string, string>[];
    expect(rows[5]._acc).not.toBe("");
    await c.call("asset_export", { project: "fa" });
    expect((await readdir(join(root, "asset-register/fa"))).sort()).toEqual(["asset-tags.pdf", "depreciation.xlsx", "stocktake.pdf"]);
  }, 120_000);
});
