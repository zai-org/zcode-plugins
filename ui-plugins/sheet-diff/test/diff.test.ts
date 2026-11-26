import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { autoKey, diff } from "../src/diff.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("diff", () => {
  it("matches by key, ignores order and tolerates numbers", () => {
    const a = { headers: ["id", "v"], rows: [["1", "10"], ["2", "x"], ["3", "a b"]] };
    const b = { headers: ["id", "v", "new"], rows: [["3", "a  b"], ["1", "10.0"], ["4", "y", "!"]] };
    expect(autoKey(a, b)).toEqual(["id"]);
    const r = diff(a, b, { keys: ["id"], ignoreCase: false, ignoreSpace: true, tolerance: 0 });
    expect(r.changes.map((c) => [c.kind, c.key])).toEqual([["removed", "2"], ["added", "4"]]);
    expect(r).toMatchObject({ addedCols: ["new"], same: 2 });
    expect(diff(a, b, { keys: [], ignoreCase: false, ignoreSpace: false, tolerance: 0 }).changes.filter((c) => c.kind === "changed")).toHaveLength(6);
  });
});

describe("sheetdiff tools", () => {
  it("compares two price lists", async () => {
    const root = await mkdtemp(join(tmpdir(), "sheetdiff-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("sheetdiff_open", { inputs: ["价目表-10月.xlsx", "价目表-11月.xlsx"], project: "price" });
    expect(o.data.stats).toEqual({ added: 1, removed: 1, changedRows: 2, changedCells: 3, unchanged: 2 });
    expect(o.data.rows.find((r: { column: string }) => r.column === "单价")).toMatchObject({ key: "TEA-001", old: "179", new: "199" });
    const n = await c.call("sheetdiff_edit", { project: "price", set: [{ row: 0, values: { note: "涨价已通知" } }] });
    expect(n.data.rows[0].note).toBe("涨价已通知");
    const w = await c.call("sheetdiff_edit", { project: "price", settings: { tolerance: 25 } });
    expect(w.data.stats.changedCells).toBe(1);
    expect(w.data.rows.find((r: { note: string }) => r.note === "涨价已通知")).toBeTruthy();
    await c.call("sheetdiff_edit", { project: "price", settings: { tolerance: 0 } });
    await c.call("sheetdiff_export", { project: "price" });
    const b = new ExcelJS.Workbook();
    await b.xlsx.load((await readFile(join(root, "sheet-diff/price/diff.xlsx"))) as never);
    const ws = b.getWorksheet("new version")!;
    expect(ws.getCell("D2").value).toBe(199);
    expect(String(ws.getCell("D2").note)).toMatch(/179/);
    expect(b.getWorksheet("removed rows")!.getCell("A2").value).toBe("SET-020");
    expect(await readFile(join(root, "sheet-diff/price/changes.csv"), "utf8")).toMatch(/added,TEA-004/);
  });
});
