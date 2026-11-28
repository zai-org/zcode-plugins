import { cp, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { parseSlots, solve } from "../src/solve.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const G = { days: 5, periods: 7, lunchAfter: 4 };

describe("rules", () => {
  it("parses slot text", () => {
    expect(parseSlots("周一1, 周三2-3", G).slots).toEqual([0, 15, 16]);
    expect(parseSlots("周五下午", G).slots).toEqual([32, 33, 34]);
    expect(parseSlots("周八3", G).bad).toEqual(["周八3"]);
  });
  it("never double-books", () => {
    const reqs = ["A", "B"].flatMap((c, k) => [{ id: k * 2, cls: c, subject: "数学", teacher: "T", hours: 5, room: "", fixed: [], double: false }, { id: k * 2 + 1, cls: c, subject: "体育", teacher: `P${k}`, hours: 3, room: "场", fixed: [], double: false }]);
    const r = solve(reqs, { days: 5, periods: 3, lunchAfter: 2 }, { avoid: new Map(), rooms: new Map([["场", 1]]), morning: new Set() });
    expect(r.unplaced).toEqual([]);
    const key = (f: (x: { req: number; slot: number }) => string) => new Set(r.placed.map(f)).size;
    expect(key((x) => `${reqs[x.req].teacher}@${x.slot}`)).toBe(r.placed.length);
    expect(key((x) => `${reqs[x.req].cls}@${x.slot}`)).toBe(r.placed.length);
    expect(new Set(r.placed.filter((x) => reqs[x.req].room).map((x) => x.slot)).size).toBe(6);
  });
});

describe("tools", () => {
  it("builds the grade 7 timetables", async () => {
    const root = await mkdtemp(join(tmpdir(), "tt-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("timetable_open", { inputs: ["排课/课程需求.xlsx"], project: "g7" });
    expect(o.text).toMatch(/3 class\(es\), 13 teacher\(s\), 36 subject row\(s\); 5 days × 7 periods\. Placed 93 of 93 periods — no clashes/);
    expect(o.text).toMatch(/七2 英语（孙丽）: fixed 周一第1节 is taken \(teacher busy by 七1 英语（孙丽）\)\. That period was put somewhere else/);
    expect(o.text).toMatch(/Can't read “周八3” \(七3 音乐 fixed\)/);
    expect(o.text).toMatch(/七3 道法 has no teacher/);
    const st = await c.call("timetable_status", { project: "g7" });
    const rows = st.data.rows as Record<string, string>[];
    const at = (cl: string, sub: string) => rows.findIndex((r) => r.cls === cl && r.subject === sub);
    expect(rows[at("七1", "班会")]._slots).toBe("五7");
    expect(rows[at("七1", "信息")]._slots).toMatch(/^(.)(\d) \1(\d)$/);
    expect(rows[at("七1", "数学")]._slots).not.toMatch(/三[567]/);
    await c.call("timetable_edit", { project: "g7", set: [{ row: at("七2", "英语"), values: { fixed: "周一2" } }, { row: at("七3", "音乐"), values: { fixed: "" } }, { row: at("七3", "道法"), values: { teacher: "冯军" } }] });
    const st2 = await c.call("timetable_status", { project: "g7" });
    expect(st2.text).toMatch(/Placed 93 of 93 periods — no clashes/);
    const rows2 = st2.data.rows as Record<string, string>[];
    const all = rows2.flatMap((r) => r._slots.split(" ").filter(Boolean).map((sl) => ({ t: r.teacher, c: r.cls, sl, room: r.room })));
    expect(new Set(all.map((x) => `${x.t}@${x.sl}`)).size).toBe(all.length);
    expect(new Set(all.map((x) => `${x.c}@${x.sl}`)).size).toBe(all.length);
    expect(all.filter((x) => x.t === "何伟").some((x) => /^一[12]$|^五[567]$/.test(x.sl))).toBe(false);
    expect(new Set(all.filter((x) => x.room === "机房").map((x) => x.sl)).size).toBe(6);
    await c.call("timetable_export", { project: "g7" });
    expect((await readdir(join(root, "timetable-builder/g7"))).sort()).toEqual(["timetables.pdf", "timetables.xlsx"]);
  }, 120_000);
});
