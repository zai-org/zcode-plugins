import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { cal, schedule, type Task } from "../src/plan.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const T = (id: string, dur: number, deps: string[] = [], start = ""): Task => ({ i: Number(id), id, name: `t${id}`, start, dur, deps, progress: 0, owner: "" });

describe("schedule", () => {
  it("counts workdays and skips holidays", () => {
    const c = cal(new Set(["2026-12-02"]), false);
    expect(c.nth("2026-12-01", 3)).toBe("2026-12-04");
    expect(c.nth("2026-12-04", 2)).toBe("2026-12-07");
    expect(c.after("2026-12-04")).toBe("2026-12-07");
    expect(c.between("2026-12-01", "2026-12-07")).toBe(4);
  });
  it("chains dependencies and finds the critical path", () => {
    const r = schedule([T("1", 3, [], "2026-11-30"), T("2", 2, ["1"]), T("3", 5, ["1"]), T("4", 1, ["2", "3"]), T("5", 0, ["4"])], { projectStart: "2026-11-30", holidays: new Set(), weekends: false });
    expect(r.s.get("2")!).toMatchObject({ start: "2026-12-03", end: "2026-12-04", slack: 3, critical: false });
    expect(r.s.get("3")!).toMatchObject({ start: "2026-12-03", end: "2026-12-09", critical: true });
    expect(r.s.get("4")!.start).toBe("2026-12-10");
    expect(r.s.get("5")!).toMatchObject({ start: "2026-12-10", end: "2026-12-10", critical: true });
    expect(r.workdays).toBe(9);
  });
  it("reports cycles and unknown ids", () => {
    const r = schedule([T("1", 1, ["2"]), T("2", 1, ["1"]), T("3", 1, ["9"])], { projectStart: "2026-12-01", holidays: new Set(), weekends: false });
    expect(r.errors.map((e) => e.msg)).toEqual(expect.arrayContaining([expect.stringMatching(/circular/), "depends on unknown task “9”"]));
  });
});

describe("tools", () => {
  it("plans the sample, edits a duration and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "gantt-"));
    await cp(join(HERE, "samples"), join(root, "proj"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("gantt_open", { inputs: ["proj/tasks.csv"], project: "app" });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[6]._start).toBe("2026-12-23");
    expect(o.data.summary).toMatch(/critical path 1 → 3 → 4 → 6 → 7/);
    expect(o.data.issues.some((i: { message: string }) => /starts 2026-12-10/.test(i.message))).toBe(true);
    const e = await c.call("gantt_edit", { project: "app", settings: { holidays: "2026-12-14" }, set: [{ row: 4, values: { 工期: 12 } }] });
    expect(e.data.summary).toMatch(/critical path 1 → 2 → 5 → 6 → 7/);
    await c.call("gantt_export", { project: "app" });
    const svg = await readFile(join(root, "gantt-planner/app/gantt.svg"), "utf8");
    expect(svg).toContain("联调测试");
    expect((await readFile(join(root, "gantt-planner/app/gantt.png"))).subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);
});
