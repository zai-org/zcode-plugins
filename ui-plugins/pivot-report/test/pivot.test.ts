import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { dateKey, pivot } from "../src/pivot.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("pivot", () => {
  it("groups dates and aggregates", () => {
    expect([dateKey("2026-11-25", "month"), dateKey("2026-11-25", "quarter"), dateKey("2026-11-25", "year"), dateKey("2026-01-01", "week"), dateKey("2026-11-25", "week")]).toEqual(["2026-11", "2026-Q4", "2026", "2026-W01", "2026-W48"]);
    const d = [["A", "x", "10"], ["A", "y", "5"], ["B", "x", "7"], ["A", "x", "¥1,000"]];
    const p = pivot(d, { rows: [0], col: 1, value: 2, agg: "sum", dateGroup: "none", dateCols: new Set(), topN: 0, sort: "value" });
    expect(p).toMatchObject({ rowKeys: [["A"], ["B"]], colKeys: ["x", "y"], cells: [[1010, 5], [7, 0]], rowTotals: [1015, 7], colTotals: [1017, 5], total: 1022 });
    expect(pivot(d, { rows: [1], col: -1, value: 0, agg: "distinct", dateGroup: "none", dateCols: new Set(), topN: 1, sort: "value" })).toMatchObject({ rowKeys: [["x"]], rowTotals: [2], others: 1 });
  });
});

describe("pivot tools", () => {
  it("suggests fields, pivots by month and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "pivot-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("pivot_open", { inputs: ["订单明细-2026.xlsx"], project: "q" });
    expect(o.data.settings).toMatchObject({ rows: "品类", value: "金额", agg: "sum" });
    const sum = o.data.rows.reduce((s: number, r: { c5: string }) => s + Number(r.c5), 0);
    expect(o.data.stats).toMatchObject({ groups: 3, total: sum, source: 120 });
    const e = await c.call("pivot_edit", { project: "q", settings: { rows: "门店", col: "订单日期", dateGroup: "month", percent: "row" } });
    expect(e.data.stats).toMatchObject({ groups: 4, columns: 4, total: sum });
    const bad = await c.call("pivot_edit", { project: "q", settings: { rows: "城市" } });
    expect(bad.data.issues[0]).toMatchObject({ level: "error", key: "rows" });
    await c.call("pivot_edit", { project: "q", settings: { rows: "门店, 品类" } });
    await c.call("pivot_export", { project: "q" });
    const b = new ExcelJS.Workbook();
    await b.xlsx.load((await readFile(join(root, "pivot-report/q/pivot.xlsx"))) as never);
    const ws = b.getWorksheet("pivot")!;
    expect(ws.getRow(1).values).toEqual([, "门店", "品类", "2026-08", "2026-09", "2026-10", "2026-11", "总计"]);
    expect(ws.getCell(ws.rowCount, 7).value).toBe(sum);
    expect(b.worksheets.map((w) => w.name)).toEqual(["pivot", "percent", "data"]);
    expect(await readFile(join(root, "pivot-report/q/pivot.html"), "utf8")).toMatch(/<svg/);
  });
});
