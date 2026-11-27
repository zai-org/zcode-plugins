import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { assign, normSeat, type Person } from "../src/seat.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (i: number, group: string, extra: Partial<Person> = {}): Person => ({ i, name: `P${i}`, group, front: false, apart: [], together: [], fixed: "", ...extra });

describe("assign", () => {
  it("normalises seat names", () => {
    expect(normSeat("r2c3")).toBe("R2C3");
    expect(normSeat("第2排第3列")).toBe("R2C3");
    expect(normSeat("3桌4号")).toBe("T3-4");
    expect(normSeat("T1-10", "tables")).toBe("T1-10");
  });
  it("keeps groups apart on a checkerboard when possible", () => {
    const people = Array.from({ length: 16 }, (_, i) => P(i, i % 2 ? "A" : "B"));
    const r = assign(people, { kind: "grid", rows: 4, cols: 4 }, { seed: "x", separateGroups: true, groupTables: false });
    expect(r.seat.size).toBe(16);
    expect(r.conflicts).toEqual([]);
  });
  it("honours fixed seats, front, apart and together", () => {
    const people = [P(0, "A", { fixed: "R3C3" }), P(1, "A", { front: true }), P(2, "B", { apart: ["P3"] }), P(3, "B"), P(4, "C", { together: ["P5"] }), P(5, "D")];
    const r = assign(people, { kind: "grid", rows: 3, cols: 3 }, { seed: "s", separateGroups: false, groupTables: false });
    expect(r.seat.get(0)).toBe("R3C3");
    expect(r.seat.get(1)!.startsWith("R1")).toBe(true);
    expect(r.conflicts.filter((c) => c.why === "keep apart" || c.why === "should sit together")).toEqual([]);
    const full = assign([P(0, "", { fixed: "R9C9" }), P(1, "", { fixed: "R1C1" }), P(2, "", { fixed: "R1C1" })], { kind: "grid", rows: 1, cols: 2 }, { seed: "", separateGroups: false, groupTables: false });
    expect(full.badFixed.map((b) => b.why)).toEqual(["no such seat", "already taken by P1"]);
  });
  it("fills banquet tables by group", () => {
    const people = Array.from({ length: 20 }, (_, i) => P(i, ["新郎亲友", "新娘亲友"][i % 2]));
    const r = assign(people, { kind: "tables", tables: 2, size: 10 }, { seed: "w", separateGroups: false, groupTables: true });
    const t1 = people.filter((p) => r.seat.get(p.i)!.startsWith("T1-")).map((p) => p.group);
    expect(new Set(t1).size).toBe(1);
  });
});

describe("tools", () => {
  it("seats the class, locks a seat and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "seats-"));
    await cp(join(HERE, "samples"), join(root, "exam"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("seats_open", { inputs: ["exam/students.csv"], project: "mid" });
    expect(o.data.stats).toMatchObject({ people: 40, seats: 48, seated: 40 });
    const rows = o.data.rows as Record<string, string>[];
    expect(rows[20].seat).toBe("R1C1");
    expect(rows[0].seat.startsWith("R1")).toBe(true);
    const e = await c.call("seats_edit", { project: "mid", set: [{ row: 1, values: { 座位: "R6C8" } }] });
    expect((e.data.rows as Record<string, string>[])[1].seat).toBe("R6C8");
    const small = await c.call("seats_edit", { project: "mid", settings: { rows: 4 } });
    expect(small.data.issues[0]).toMatchObject({ level: "error" });
    await c.call("seats_edit", { project: "mid", settings: { rows: 6 } });
    await c.call("seats_export", { project: "mid" });
    const pdf = await readFile(join(root, "seating-planner/mid/seating-chart.pdf"));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const t = await c.call("seats_edit", { project: "mid", settings: { layout: "tables", tables: 4, tableSize: 10, groupTables: true } });
    expect(t.data.stats.seated).toBe(40);
  }, 60_000);
});

describe("together", () => {
  it("seats a one-way 'sit with' pair side by side even when placed late", () => {
    const people = Array.from({ length: 30 }, (_, i) => P(i, ["A", "B", "C"][i % 3]));
    people[3].together = ["P29"];
    const r = assign(people, { kind: "grid", rows: 5, cols: 6 }, { seed: "late", separateGroups: true, groupTables: false });
    expect(r.conflicts.filter((c) => c.why === "should sit together")).toEqual([]);
  });
});
