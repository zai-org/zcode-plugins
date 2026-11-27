import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { decodeImage, type Raster } from "../src/kit/raster.ts";
import { parsePosition, place, textSize, tiles } from "../src/layout.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** 区域内和原图差异的平均值 */
function diff(a: Raster, b: Raster, x0: number, y0: number, x1: number, y1: number) {
  let d = 0, n = 0;
  for (let y = Math.round(y0 * a.height); y < Math.round(y1 * a.height); y++) for (let x = Math.round(x0 * a.width); x < Math.round(x1 * a.width); x++) {
    const i = (y * a.width + x) * 4;
    d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    n++;
  }
  return d / n / 3;
}

describe("layout", () => {
  it("places, tiles and parses positions", () => {
    expect(place({ w: 1000, h: 500 }, { w: 100, h: 50 }, "bottom-right", 2)).toEqual({ x: 890, y: 440 });
    expect(place({ w: 1000, h: 500 }, { w: 100, h: 50 }, "top-left", 2, 2, -1)).toEqual({ x: 20, y: 5 });
    expect(place({ w: 1000, h: 500 }, { w: 100, h: 50 }, "center", 0)).toEqual({ x: 450, y: 225 });
    expect(parsePosition("右下", "center")).toBe("bottom-right");
    expect(parsePosition("左上角", "center")).toBe("top-left");
    expect(parsePosition("平铺", "center")).toBe("tile");
    expect(parsePosition("", "top")).toBe("top");
    expect(textSize({ w: 1200, h: 800 }, 4)).toBe(32);
    const t = tiles({ w: 400, h: 300 }, { w: 100, h: 40 }, 10);
    expect(t.length).toBeGreaterThan(8);
    expect(t[0]).toEqual({ x: -50, y: -20 });
  });
});

describe("tools", () => {
  it("watermarks a folder with text, logo, nudges and tiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "wm-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("watermark_open", { inputs: ["photos"], project: "w" });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => [r.file, r.size])).toEqual([["photos/mountain.jpg", "1000×1250"], ["photos/product.png", "900×600"], ["photos/湖边日落.jpg", "1200×800"]]);
    expect(r0.data.summary).toContain("(logo: photos/logo.png)");
    expect(String(r0.data.preview)).toContain("data:image/jpeg;base64,");
    await c.call("watermark_edit", { project: "w", settings: { mode: "both", text: "© 2026 Sample Studio", opacity: 0.8 }, set: [{ row: 0, values: { 位置: "top-left", dx: 2 } }, { row: 1, values: { position: "tile", scale: 60 } }] });
    const r = await c.call("watermark_export", { project: "w" });
    expect(r.text).toContain("watermarked/photos/product.png");
    const out = join(root, "image-watermark", "w", "watermarked");
    const load = async (p: string) => decodeImage(new Uint8Array(await readFile(p)));
    const sunsetA = await load(join(root, "photos/湖边日落.jpg")), sunsetB = await load(join(out, "photos/湖边日落.jpg"));
    expect(diff(sunsetA, sunsetB, 0.55, 0.85, 0.97, 0.97)).toBeGreaterThan(8);
    expect(diff(sunsetA, sunsetB, 0, 0, 0.4, 0.4)).toBeLessThan(2);
    const mA = await load(join(root, "photos/mountain.jpg")), mB = await load(join(out, "photos/mountain.jpg"));
    expect(diff(mA, mB, 0.03, 0.02, 0.4, 0.1)).toBeGreaterThan(8);
    expect(diff(mA, mB, 0.5, 0.85, 1, 1)).toBeLessThan(2);
    // 平铺：四个角都有水印
    const pA = await load(join(root, "photos/product.png")), pB = await load(join(out, "photos/product.png"));
    for (const [x, y] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) expect(diff(pA, pB, x, y, x + 0.5, y + 0.5)).toBeGreaterThan(0.3);
    const csv = String(await readFile(join(root, "image-watermark", "w", "watermark-report.csv")));
    expect(csv).toMatch(/photos\/product\.png,watermarked\/photos\/product\.png,tile,\d{2,},900x600/);
    expect(csv).toContain("photos/mountain.jpg,watermarked/photos/mountain.jpg,top-left,1,1000x1250");
  }, 60_000);
});
