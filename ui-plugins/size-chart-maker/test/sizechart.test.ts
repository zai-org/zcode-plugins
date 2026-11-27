import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { fmtCell, parseCell } from "../src/chart.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("cells", () => {
  it("parses numbers and ranges and converts units", () => {
    expect(parseCell("88-92")).toEqual([88, 92]);
    expect(parseCell("98cm")).toEqual([98]);
    expect(parseCell("7O")).toBeNull();
    expect(fmtCell("100", "胸围", "cm", "in", 1)).toBe("39.4");
    expect(fmtCell("100", "胸围", "cm", "both", 1)).toBe("100 / 39.4");
    expect(fmtCell("38-40", "Chest", "in", "cm", 1)).toBe("96.5-101.6");
    expect(fmtCell("90-110斤", "建议体重", "cm", "in", 1)).toBe("90-110斤");
  });
});

describe("tools", () => {
  it("finds typos, fixes them and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "sc-"));
    await cp(join(HERE, "samples"), join(root, "shop"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("sizechart_open", { inputs: ["shop/sizes.csv"], project: "tee", settings: { title: "纯棉T恤尺码表", unit: "both", lang: "both" } });
    expect(o.data.stats).toMatchObject({ sizes: 5, measures: 5 });
    expect(o.text).toMatch(/衣长 “7O” is not a number/);
    expect(o.text).toMatch(/肩宽 gets smaller from L \(46\) to XL \(45\)/);
    const e = await c.call("sizechart_edit", { project: "tee", set: [{ row: 2, values: { 衣长: "70", highlight: true } }, { row: 3, values: { 肩宽: "48" } }] });
    expect(e.text).not.toMatch(/not a number|gets smaller/);
    await c.call("sizechart_export", { project: "tee" });
    const dir = join(root, "size-chart-maker/tee");
    const svg = await readFile(join(dir, "size-chart.svg"), "utf8");
    expect(svg).toContain("胸围 Chest");
    expect(svg).toContain("104 / 40.9");
    expect(svg).toContain("125-140斤");
    expect(await readFile(join(dir, "size-chart.html"), "utf8")).toContain("<th");
    expect((await readFile(join(dir, "size-chart.png"))).subarray(1, 4).toString()).toBe("PNG");
    expect((await readFile(join(dir, "size-chart.xlsx"))).subarray(0, 2).toString()).toBe("PK");
  }, 60_000);
});
