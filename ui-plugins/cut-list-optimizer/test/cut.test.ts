import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { edgeOf, pack } from "../src/pack.ts";
import { createServer, parseStock } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("packing", () => {
  it("packs without overlaps and respects grain", () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ id: i, w: 600 + (i % 3) * 100, h: 400, canRotate: i % 2 === 0 }));
    const { sheets, failed } = pack(parts, 2420, 1200, 3);
    expect(failed).toEqual([]);
    const all = sheets.flatMap((s) => s.placed.map((p) => ({ ...p, s })));
    for (const a of all) { expect(a.x + a.w).toBeLessThanOrEqual(2420); expect(a.y + a.h).toBeLessThanOrEqual(1200); if (a.id % 2) expect(a.rotated).toBe(false); }
    for (const sh of sheets) for (const a of sh.placed) for (const b of sh.placed) if (a !== b) expect(a.x + a.w + 3 <= b.x + 1e-9 || b.x + b.w + 3 <= a.x + 1e-9 || a.y + a.h + 3 <= b.y + 1e-9 || b.y + b.h + 3 <= a.y + 1e-9).toBe(true);
  });
  it("reads edge banding and stock", () => {
    expect(edgeOf("2长1短")).toEqual({ l: 2, w: 1 });
    expect(edgeOf("L2W1")).toEqual({ l: 2, w: 1 });
    expect(edgeOf("四边")).toEqual({ l: 2, w: 2 });
    expect(edgeOf("五边")).toBeNull();
    expect(parseStock("18mm 颗粒板=2440x1220@168")).toEqual([{ name: "18mm 颗粒板", L: 2440, W: 1220, price: 168 }]);
  });
});

describe("tools", () => {
  it("lays out a wardrobe", async () => {
    const root = await mkdtemp(join(tmpdir(), "cut-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("cut_open", { inputs: ["衣柜"], project: "wr" });
    expect(o.text).toMatch(/#1 顶板: 2500×580 is bigger than the usable 18mm 颗粒板 board/);
    expect(o.text).toMatch(/#9 背板: no stock board for material “9mm 背扳” — did you mean “9mm 背板”\?/);
    await c.call("cut_edit", { project: "wr", set: [{ row: 1, values: { length: 1200 } }, { row: 9, values: { material: "9mm 背板" } }], settings: { title: "主卧衣柜" } });
    const st = await c.call("cut_status", { project: "wr" });
    expect(st.text).not.toMatch(/bigger than|no stock board/);
    console.log(st.text.split("\n").slice(0, 8).join("\n"));
    expect(st.text).toMatch(/19 part\(s\) on \d board\(s\)/);
    await c.call("cut_export", { project: "wr" });
    expect((await readdir(join(root, "cut-list-optimizer/wr"))).sort()).toEqual(["cut-list.xlsx", "cutting-diagrams.pdf", "cutting-diagrams.svg"]);
    expect(await readFile(join(root, "cut-list-optimizer/wr/cutting-diagrams.svg"), "utf8")).toMatch(/门板/);
  }, 120_000);
});
