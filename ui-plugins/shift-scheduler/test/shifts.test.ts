import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { availableShifts, buildRota, parseShifts } from "../src/rota.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rota", () => {
  const sh = parseShifts("早班 08:00-16:00 ×2; 晚班 16:00-24:00 x1；夜班 22-6 2人");
  it("parses shifts and availability", () => {
    expect(sh).toEqual([{ name: "早班", start: 480, end: 960, need: 2 }, { name: "晚班", start: 960, end: 0, need: 1 }, { name: "夜班", start: 1320, end: 360, need: 2 }]);
    expect([...availableShifts("", sh)]).toEqual([0, 1, 2]);
    expect([...availableShifts("休", sh)]).toEqual([]);
    expect([...availableShifts("早, 夜班", sh)]).toEqual([0, 2]);
    expect([...availableShifts("15-24", sh)]).toEqual([1]);
  });
  it("shares shifts fairly within limits and rest", () => {
    const two = parseShifts("早 08-16 ×1; 晚 16-24 ×1");
    const staff = ["A", "B", "C"].map((name, i) => ({ i, name, max: 40, avail: Array(7).fill("") }));
    const r = buildRota(staff, two, { seed: "s", restHours: 10, maxShiftsPerDay: 1 });
    expect(r.short).toEqual([]);
    expect(Math.max(...r.hours) - Math.min(...r.hours)).toBeLessThanOrEqual(8);
    // 晚班后第二天不能接早班（休息不足 10 小时）
    for (let d = 0; d < 6; d++) for (const i of r.grid[d][1]) expect(r.grid[d + 1][0]).not.toContain(i);
    const tight = buildRota([{ i: 0, name: "A", max: 8, avail: Array(7).fill("") }], two, { seed: "", restHours: 0, maxShiftsPerDay: 1 });
    expect(tight.hours[0]).toBe(8);
    expect(tight.short.length).toBe(13);
  });
});

describe("tools", () => {
  it("builds the week, edits availability and exports calendars", async () => {
    const root = await mkdtemp(join(tmpdir(), "shifts-"));
    await cp(join(HERE, "samples"), join(root, "shop"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("shifts_open", { inputs: ["shop/staff.csv"], project: "w49", settings: { weekStart: "2026-11-30" } });
    expect(o.data.stats).toMatchObject({ staff: 7, slots: 28 });
    const rows = o.data.rows as Record<string, unknown>[];
    for (const r of rows) expect(r.hours as number).toBeLessThanOrEqual(r.maxHours as number);
    expect(String(rows[2].shiftsList)).not.toMatch(/周一|周四/);
    expect(o.data.issues.some((i: { message: string }) => /下午.*matches no shift/.test(i.message))).toBe(true);
    await c.call("shifts_edit", { project: "w49", set: [{ row: 6, values: { 周日: "晚班" } }] });
    const x = await c.call("shifts_export", { project: "w49" });
    expect(x.text).toMatch(/rota\.xlsx/);
    const ics = await readdir(join(root, "shift-scheduler/w49/ics"));
    expect(ics.length).toBe(7);
    const tom = await readFile(join(root, "shift-scheduler/w49/ics/Tom.ics"), "utf8");
    expect(tom).toMatch(/DTSTART:20261201T160000/);
    expect(tom).not.toMatch(/DTSTART:20261130/);
  }, 60_000);
});
