import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { drawGroups, drawRaffle, parsePrizes, rng, type Entrant } from "../src/draw.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const people = (n: number, tags = ["A", "B"]): Entrant[] => Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, weight: 1, fixed: "", tag: tags[i % tags.length] }));

describe("draw", () => {
  it("parses prizes", () => {
    expect(parsePrizes("一等奖×1, 二等奖 3，三等奖*5名\n参与奖")).toEqual([{ name: "一等奖", count: 1 }, { name: "二等奖", count: 3 }, { name: "三等奖", count: 5 }, { name: "参与奖", count: 1 }]);
  });
  it("is reproducible and roughly uniform", () => {
    expect(rng("abc", 0)).toBe(rng("abc", 0));
    expect(rng("abc", 0)).not.toBe(rng("abd", 0));
    const xs = Array.from({ length: 4000 }, (_, i) => rng("u", i));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeGreaterThan(0.47);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeLessThan(0.53);
  });
  it("respects weights, locks and no repeats", () => {
    const e = people(10);
    e[3].fixed = "一等奖";
    e[5].weight = 0;
    const r = drawRaffle(e, [{ name: "一等奖", count: 1 }, { name: "二等奖", count: 8 }], "s1", { weighted: true, repeat: false });
    expect(r.result.get(3)).toEqual(["一等奖"]);
    expect(r.result.has(5)).toBe(false);
    expect(r.steps).toHaveLength(8);
    expect(r.short).toEqual([]);
    const r2 = drawRaffle(e, [{ name: "X", count: 20 }], "s1", { weighted: true, repeat: false });
    expect(r2.short).toEqual([{ prize: "X", missing: 12 }]);
    // 权重：大量抽签中权重 3 的人中奖次数约为权重 1 的 3 倍
    const w = [{ id: 0, name: "a", weight: 3, fixed: "", tag: "" }, { id: 1, name: "b", weight: 1, fixed: "", tag: "" }];
    let a = 0;
    for (let i = 0; i < 2000; i++) if (drawRaffle(w, [{ name: "p", count: 1 }], `w${i}`, { weighted: true, repeat: false }).result.has(0)) a++;
    expect(a / 2000).toBeGreaterThan(0.71);
    expect(a / 2000).toBeLessThan(0.79);
  });
  it("balances groups", () => {
    const e = people(22, ["研发", "研发", "市场", "设计"]);
    const g = drawGroups(e, 4, "g", true);
    expect(g.sizes.sort()).toEqual([5, 5, 6, 6]);
    for (const tag of ["研发", "市场", "设计"]) {
      const per = [0, 1, 2, 3].map((k) => e.filter((x) => x.tag === tag && g.group.get(x.id) === k).length);
      expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
    }
  });
});

describe("raffle tools", () => {
  it("draws, locks, re-draws and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "raffle-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("raffle_open", { inputs: ["participants.csv"], project: "r", settings: { seed: "2026-annual", title: "2026 年会抽奖" } });
    expect(o.data.stats).toMatchObject({ participants: 38, winners: 9, prizes: 9 });
    expect(o.text).toContain("9 winners from 38 people");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.filter((r) => r.include === false)).toHaveLength(2);
    const first = rows.findIndex((r) => r.result === "一等奖");
    expect(first).toBeGreaterThanOrEqual(0);
    // 同一种子再开一次，结果一样
    const o2 = await c.call("raffle_open", { inputs: ["participants.csv"], project: "r2", settings: { seed: "2026-annual" } });
    expect((o2.data.rows as Record<string, unknown>[]).map((r) => r.result)).toEqual(rows.map((r) => r.result));
    // 锁定一等奖，换种子重抽
    const e = await c.call("raffle_edit", { project: "r", settings: { seed: "redraw-1" }, set: [{ row: first, values: { fixed: "一等奖" } }] });
    const after = e.data.rows as Record<string, unknown>[];
    expect(after[first].result).toBe("一等奖");
    expect(after.filter((r) => String(r.result).includes("一等奖"))).toHaveLength(1);
    expect(after.map((r) => r.result)).not.toEqual(rows.map((r) => r.result));
    await c.call("raffle_export", { project: "r" });
    const audit = JSON.parse(await readFile(join(root, "raffle-draw/r/audit.json"), "utf8"));
    expect(audit.seed).toBe("redraw-1");
    expect(audit.steps).toHaveLength(8);
    expect(audit.result["一等奖"]).toEqual([after[first].name]);
    expect(audit.input.sha256).toMatch(/^[0-9a-f]{64}$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "raffle-draw/r/result.xlsx"));
    expect(wb.getWorksheet(1)!.rowCount).toBe(10);
    // 分组模式
    const g = await c.call("raffle_edit", { project: "r", settings: { mode: "groups", groups: 4 } });
    expect(g.data.stats).toMatchObject({ groups: 4 });
    expect(g.text).toContain("38 people in 4 groups");
  });
});
