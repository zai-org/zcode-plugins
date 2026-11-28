import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { knockout, roundRobin, seedOrder, standings } from "../src/bracket.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("round robin meets everyone once", () => {
    const ms = roundRobin(["A", "B", "C", "D", "E"]);
    expect(ms.length).toBe(10);
    const pairs = new Set(ms.map((m) => [m.home, m.away].sort().join()));
    expect(pairs.size).toBe(10);
    for (let r = 1; r <= 5; r++) { const t = ms.filter((m) => m.round === r).flatMap((m) => [m.home, m.away]); expect(new Set(t).size).toBe(t.length); }
  });
  it("seeds and byes", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const ms = knockout(["A", "B", "C", "D", "E", "F"].map((n, i) => ({ name: n, seed: i + 1 })), true);
    expect(ms.filter((m) => m.round === 1).map((m) => [m.home, m.away])).toEqual([["A", ""], ["D", "E"], ["B", ""], ["C", "F"]]);
    expect(ms.at(-1)).toMatchObject({ home: "L:M5", away: "L:M6" });
  });
  it("breaks ties head-to-head", () => {
    const st = standings(["A", "B", "C"], [{ home: "A", away: "B", hg: 1, ag: 0 }, { home: "B", away: "C", hg: 5, ag: 0 }, { home: "C", away: "A", hg: 1, ag: 0 }], [3, 1, 0]);
    expect(st.lines.map((l) => l.team)).toEqual(["B", "A", "C"]);
  });
});

describe("tools", () => {
  it("round robin with imported results, then knockout", async () => {
    const root = await mkdtemp(join(tmpdir(), "bk-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("bracket_open", { inputs: ["羽毛球赛"], project: "bm" });
    expect(o.text).toMatch(/7 teams, round robin, 21 matches \(4 played, 17 to play\)/);
    expect(o.text).toMatch(/“市场部” is listed twice/);
    expect(o.text).toMatch(/Result “市场部 vs 技朮部 21:15” doesn't match any fixture/);
    expect(o.text).toMatch(/Standings: 1\. 人事部 6, 2\. 市场部 3/);
    const st = await c.call("bracket_status", { project: "bm" });
    const rows = st.data.rows as Record<string, string>[];
    expect(rows.find((r) => r._home === "人事部" && r._away === "销售一部" || r._home === "销售一部" && r._away === "人事部")!.score).toMatch(/^(21:23|23:21)$/);
    const mt = rows.findIndex((r) => [r._home, r._away].sort().join() === ["市场部", "技术部"].sort().join());
    const bad = rows.findIndex((r, i) => i !== mt && !r.score);
    await c.call("bracket_edit", { project: "bm", set: [{ row: mt, values: { score: rows[mt]._home === "市场部" ? "21:15" : "15:21" } }, { row: bad, values: { score: "21 15" } }], settings: { title: "2026 部门羽毛球赛", start: "2026-12-05" } });
    const st2 = await c.call("bracket_status", { project: "bm" });
    expect(st2.text).toMatch(/can't read score “21 15”/);
    expect(st2.text).toMatch(/Standings: 1\. 市场部 6/);
    expect(st2.text).toMatch(/2026-12-05/);
    await c.call("bracket_export", { project: "bm" });
    expect((await readdir(join(root, "tournament-bracket/bm"))).sort()).toEqual(["bracket.png", "bracket.svg", "schedule.pdf", "standings.xlsx"]);
    expect(await readFile(join(root, "tournament-bracket/bm/bracket.svg"), "utf8")).toMatch(/市场部/);

    await c.call("bracket_edit", { project: "bm", settings: { format: "knockout" } });
    const k = await c.call("bracket_status", { project: "bm" });
    expect(k.text).toMatch(/7 teams, knockout, 8 matches/);
    const kr = k.data.rows as Record<string, string>[];
    expect(kr[0]._winner).toBe("市场部（轮空晋级）");
    expect(kr.find((r) => r.id === "M5")!._home).toBe("市场部");
    const m2 = kr.findIndex((r) => r.id === "M2");
    await c.call("bracket_edit", { project: "bm", set: [{ row: m2, values: { score: "21:21" } }, { row: kr.findIndex((r) => r.id === "M7"), values: { score: "21:10" } }] });
    const k2 = await c.call("bracket_status", { project: "bm" });
    expect(k2.text).toMatch(/M2 .* is a draw \(21:21\) but a knockout needs a winner/);
    expect(k2.text).toMatch(/M7 has a score but its teams aren't decided yet/);
    await c.call("bracket_export", { project: "bm" });
  }, 120_000);
});
