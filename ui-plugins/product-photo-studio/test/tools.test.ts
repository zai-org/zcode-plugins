import { mkdtemp, readFile, writeFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeImage } from "../src/kit/raster.ts";
import { createServer } from "../src/server.ts";
import { cutoutPng, gradientProduct } from "./fixtures.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "photostudio-"));
  await mkdir(join(workspace, "photos"));
  await writeFile(join(workspace, "photos/red-bottle.jpg"), gradientProduct());
  await writeFile(join(workspace, "photos/blue-ball.png"), cutoutPng());
  for (const f of ["headphones-cc0.jpg", "perfume.jpg"]) await copyFile(join(import.meta.dirname, "fixtures", f), join(workspace, "photos", f));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

function alphaBox(png: { width: number; height: number; data: ArrayLike<number> }) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 128) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
  return { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

describe("product-photo-studio", () => {
  it("opens a folder and reports each photo", async () => {
    const result = await call("photos_open", { folder: "photos" });
    expect(result.isError).toBeFalsy();
    const items = result.structuredContent.items;
    expect(items.length).toBe(4);
    const red = items.find((i: any) => i.path.endsWith("red-bottle.jpg"));
    expect(red.report.warnings).toEqual([]);
    expect(red.report.removed).toBeGreaterThan(0.7);
    // 主体 300×440 左右（去背后裁到商品本身）。
    expect(Math.abs(red.subject.width - 299)).toBeLessThan(6);
    expect(Math.abs(red.subject.height - 439)).toBeLessThan(6);
    const ball = items.find((i: any) => i.path.endsWith("blue-ball.png"));
    expect(ball.report.hadAlpha).toBe(true);
  });

  it("exports white and transparent sizes with consistent product size", async () => {
    const project = {
      images: [{ path: "photos/red-bottle.jpg" }, { path: "photos/blue-ball.png" }, { path: "photos/headphones-cc0.jpg" }, { path: "photos/perfume.jpg", overrides: { fill: 0.7 } }],
      settings: { fill: 0.8, shadow: "ground" },
      presets: ["white-800", "transparent-png", "custom-1200x900"],
      customPresets: [{ id: "custom-1200x900", width: 1200, height: 900, format: "jpg" }],
      outputDir: "out",
    };
    const saved = await call("project_save", { path: "batch.photostudio.json", project });
    expect(saved.isError).toBeFalsy();
    const result = await call("photos_export", { project: "batch.photostudio.json" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.files.length).toBe(12);
    expect((await readdir(join(workspace, "out/white-800"))).sort()).toEqual(["blue-ball.jpg", "headphones-cc0.jpg", "perfume.jpg", "red-bottle.jpg"]);

    // 白底图：四角纯白。
    const white = decodeImage(await readFile(join(workspace, "out/white-800/red-bottle.jpg")));
    expect([white.width, white.height]).toEqual([800, 800]);
    for (const [x, y] of [[2, 2], [797, 2], [2, 797], [797, 797]]) {
      const i = (y * 800 + x) * 4;
      expect(Math.min(white.data[i], white.data[i + 1], white.data[i + 2])).toBeGreaterThanOrEqual(250);
    }
    // 透明图：主体长边 = 80% 画布，居中，背景透明。
    for (const name of ["red-bottle", "blue-ball"]) {
      const png = decodeImage(await readFile(join(workspace, `out/transparent-png/${name}.png`)));
      expect(png.data[3]).toBe(0);
      const box = alphaBox(png);
      expect(Math.abs(Math.max(box.w, box.h) / 1600 - 0.8)).toBeLessThan(0.02);
      expect(Math.abs(box.cx - 800)).toBeLessThan(10);
      expect(Math.abs(box.cy - 800)).toBeLessThan(10);
    }
    // 单张覆盖设置：perfume 占 70%。
    const perfume = alphaBox(decodeImage(await readFile(join(workspace, "out/transparent-png/perfume.png"))));
    expect(Math.abs(perfume.h / 1600 - 0.7)).toBeLessThan(0.02);
    const custom = decodeImage(await readFile(join(workspace, "out/custom-1200x900/headphones-cc0.jpg")));
    expect([custom.width, custom.height]).toEqual([1200, 900]);
  });

  it("renders previews and rejects bad input", async () => {
    const preview = await call("photos_preview", { project: { images: ["photos/red-bottle.jpg"], presets: ["white-800"] }, index: 0, size: 200 });
    expect(preview.isError).toBeFalsy();
    expect(decodeImage(Buffer.from(preview.structuredContent.image, "base64")).width).toBe(200);
    expect((await call("photos_open", { paths: ["../outside.jpg"] })).content[0].text).toMatch(/outside_workspace/);
    expect((await call("photos_export", { project: { images: ["photos/red-bottle.jpg"], presets: ["nope"] } })).content[0].text).toMatch(/no_preset/);
  });
});
