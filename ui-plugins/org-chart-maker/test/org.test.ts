import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { buildTree, layout, type Person } from "../src/tree.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (i: number, name: string, manager = "", collapsed = false): Person => ({ i, name, title: "", dept: "", manager, collapsed });

describe("tree", () => {
  it("builds the hierarchy and reports problems", () => {
    const t = buildTree([P(0, "A"), P(1, "B", "A"), P(2, "C", "B"), P(3, "D", "X"), P(4, "E", "F"), P(5, "F", "E"), P(6, "B", "A")]);
    expect(t.roots.map((r) => r.p.name).sort()).toEqual(["A", "D", "E"]);
    expect(t.unknown).toEqual([3]);
    expect(t.cycles.length).toBe(1);
    expect(t.dup).toEqual([6]);
  });
  it("lays out without overlaps and collapses branches", () => {
    const people = [P(0, "A"), ...["B", "C", "D"].map((n, k) => P(k + 1, n, "A")), ...Array.from({ length: 6 }, (_, k) => P(10 + k, `b${k}`, "B")), P(20, "c1", "C"), P(21, "c2", "C")];
    const t = buildTree(people);
    const o = { boxW: 100, boxH: 40, gapX: 10, gapY: 30, maxDepth: 99, stackOver: 4 };
    const boxes = layout(t.roots, o);
    expect(boxes.length).toBe(12);
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(Math.abs(a.x - b.x) >= o.boxW || Math.abs(a.y - b.y) >= o.boxH).toBe(true);
    people[1].collapsed = true;
    const t2 = buildTree(people);
    const b2 = layout(t2.roots, o);
    expect(b2.length).toBe(6);
    expect(t2.roots[0].kids[0].hidden).toBe(6);
  });
});

describe("tools", () => {
  it("draws the chart, fixes a manager and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "org-"));
    await cp(join(HERE, "samples"), join(root, "co"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("orgchart_open", { inputs: ["co/staff.csv"], project: "co" });
    expect(o.data.stats).toMatchObject({ people: 18, levels: 4, tops: 2 });
    expect(o.data.issues[0].message).toMatch(/陈总经理/);
    const e = await c.call("orgchart_edit", { project: "co", set: [{ row: 17, values: { 上级: "陈总" } }, { row: 3, values: { collapsed: true } }] });
    expect(e.data.stats.tops).toBe(1);
    expect((e.data.rows as Record<string, number>[])[0]._team).toBe(17);
    await c.call("orgchart_export", { project: "co" });
    const svg = await readFile(join(root, "org-chart-maker/co/org-chart.svg"), "utf8");
    expect(svg).toContain("+5");
    expect(svg).not.toContain("何欢");
    expect((await readFile(join(root, "org-chart-maker/co/org-chart.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
