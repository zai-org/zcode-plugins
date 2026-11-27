import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { changedRegion, parseRects, parseSteps } from "../src/guide.ts";
import { createRaster } from "../src/kit/raster.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parsing", () => {
  it("reads steps, annotations and rects", () => {
    const g = parseSteps("# 标题\n\n## 第一步\n说明一\n框: 1,2,3,4\n2. 第二步\n打码：5,5,10,10; 20,20,5,5\n");
    expect(g.title).toBe("标题");
    expect(g.steps).toEqual([{ title: "第一步", text: "说明一", box: "1,2,3,4" }, { title: "第二步", text: "", blur: "5,5,10,10; 20,20,5,5" }]);
    expect(parseRects("1,2,3")).toBeUndefined();
    expect(parseRects("")).toEqual([]);
  });
  it("finds the changed region", () => {
    const a = createRaster(400, 300, [255, 255, 255, 255]), b = createRaster(400, 300, [255, 255, 255, 255]);
    for (let y = 150; y < 200; y++) for (let x = 200; x < 300; x++) b.data.set([0, 0, 0, 255], (y * 400 + x) * 4);
    const r = changedRegion(a, b).rect!;
    expect(r[0]).toBeGreaterThan(45); expect(r[0]).toBeLessThan(50);
    expect(r[1]).toBeGreaterThan(45); expect(r[2]).toBeGreaterThan(25); expect(r[2]).toBeLessThan(32);
    const c = createRaster(400, 300, [0, 0, 0, 255]);
    expect(changedRegion(a, c).rect).toBeUndefined();
  });
});

describe("tools", () => {
  it("builds the guide from screenshots and steps", async () => {
    const root = await mkdtemp(join(tmpdir(), "steps-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("steps_open", { inputs: ["优惠券教程"], project: "coupon" });
    expect(o.text).toMatch(/5 step\(s\) but there are 6 screenshot\(s\)/);
    expect(o.text).toMatch(/05-完成 copy\.png is identical to step 5/);
    expect(o.text).toMatch(/Step 5: box placed automatically/);
    expect(o.text).toMatch(/怎么新建一张优惠券/);
    await c.call("steps_edit", { project: "coupon", set: [{ row: 5, values: { include: false } }, { row: 3, values: { box: "30.5,16,39,70" } }] });
    const st = await c.call("steps_status", { project: "coupon" });
    expect(st.data.stats).toMatchObject({ steps: 5, boxes: 4 });
    expect(st.text).not.toMatch(/identical/);
    expect(st.text).not.toMatch(/looks like a login screen/);
    await c.call("steps_export", { project: "coupon" });
    const dir = join(root, "step-guide-maker/coupon");
    expect((await readdir(dir)).sort()).toEqual(["guide.html", "guide.md", "guide.pdf", "images"]);
    expect((await readdir(join(dir, "images"))).length).toBe(5);
    const md = await readFile(join(dir, "guide.md"), "utf8");
    expect(md).toMatch(/## 3\. 点「新建优惠券」\n\n右上角的绿色按钮。\n\n!\[.*\]\(images\/step-03\.png\)/);
    const html = await readFile(join(dir, "guide.html"), "utf8");
    expect((html.match(/data:image\/png;base64/g) ?? []).length).toBe(5);
    expect((await readFile(join(dir, "guide.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);
});
