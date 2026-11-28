import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { cells, cropBox, mosaic } from "../src/layout.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const box = { x: 0, y: 0, w: 1000, h: 1000 };

describe("layout", () => {
  it("builds grids, heroes and mosaics", () => {
    const g = cells("grid-3x3", box, 9, 10, []);
    expect(g).toHaveLength(9);
    expect(g[4].x).toBeCloseTo(336.67, 1);
    const a = cells("auto", box, 5, 0, []);
    expect(a.map((c) => Math.round(c.w))).toEqual([333, 333, 333, 500, 500]);
    expect(cells("auto", box, 7, 0, []).map((c) => Math.round(c.w))).toEqual([333, 333, 333, 500, 500, 500, 500]);
    const h = cells("hero-4", box, 5, 0, []);
    expect(h[0]).toMatchObject({ x: 0, w: 500, h: 1000 });
    const m = mosaic(box, [1.5, 1.5, 0.75, 1], 0);
    for (const c of m) expect(c.x + c.w).toBeLessThanOrEqual(1000.5);
    expect(cropBox(1600, 1200, 1, "left")).toEqual({ x: 0, y: 0, w: 1200, h: 1200 });
    expect(cropBox(1200, 1600, 1, "top")).toEqual({ x: 0, y: 0, w: 1200, h: 1200 });
  });
});

describe("tools", () => {
  it("lays out a 3x3 grid, flags problems and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "collage-"));
    await cp(join(HERE, "samples"), join(root, "shop"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("collage_open", { inputs: ["shop/新品茶具"], project: "new", settings: { template: "grid-3x3", title: "新品茶具 · 秋季上新" } });
    expect(o.text).toMatch(/09-建盏\.webp: .*only PNG and JPEG/);
    expect(o.text).toMatch(/9 slots but only 8 photo/);
    expect(o.text).toMatch(/08-茶巾\.jpg \(500×400\) is small/);
    await c.call("collage_edit", { project: "new", set: [{ row: 7, values: { include: false } }, { row: 0, values: { 说明: "青瓷茶壶 ¥268" } }], settings: { template: "hero-3" } });
    const st = await c.call("collage_status", { project: "new" });
    expect(st.text).toMatch(/4 slots; 3 included photo/);
    await c.call("collage_edit", { project: "new", settings: { template: "auto", footer: "Penova 茶铺" } });
    const s2 = await c.call("collage_status", { project: "new" });
    expect(s2.text).not.toMatch(/slots/);
    expect(s2.data.stats).toMatchObject({ photos: 7, width: 2048 });
    await c.call("collage_export", { project: "new" });
    const png = await readFile(join(root, "photo-grid-collage/new/新品茶具_·_秋季上新.png"));
    expect(png.readUInt32BE(16)).toBe(2048);
    const jpg = await readFile(join(root, "photo-grid-collage/new/新品茶具_·_秋季上新.jpg"));
    expect(jpg[0]).toBe(0xff);
  }, 120_000);
});
