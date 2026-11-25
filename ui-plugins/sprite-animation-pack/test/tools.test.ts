import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createRaster, decodeImage, encodePng, type Raster } from "../src/kit/raster.ts";
import { groupFiles, normalizeProject, opaqueBox } from "../src/sprites.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const fill = (img: Raster, x: number, y: number, w: number, h: number, c: [number, number, number, number]) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) img.data.set(c, (j * img.width + i) * 4);
};
/** 小人：头 + 身体 + 两只脚，脚的位置随帧变化；trimmed = 裁到内容。 */
function dude(frame: number, lift = 0) {
  const img = createRaster(20, 30);
  fill(img, 7, 2 - lift + 4, 6, 6, [240, 200, 160, 255]);
  fill(img, 6, 12 - lift, 8, 10, [30, 90, 200, 255]);
  fill(img, 6 + (frame % 2), 22 - lift, 2, 6, [40, 40, 40, 255]);
  fill(img, 12 - (frame % 2), 22 - lift, 2, 6, [40, 40, 40, 255]);
  return img;
}
function trim(img: Raster) {
  const b = opaqueBox(img)!;
  const out = createRaster(b.x1 - b.x0, b.y1 - b.y0);
  for (let y = b.y0; y < b.y1; y++) out.data.set(img.data.subarray((y * img.width + b.x0) * 4, (y * img.width + b.x1) * 4), (y - b.y0) * out.width * 4);
  return out;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "sprites-"));
  await mkdir(join(workspace, "hero"));
  for (let i = 0; i < 4; i++) await writeFile(join(workspace, `hero/hero_run_${i + 1}.png`), encodePng(trim(dude(i))));
  for (let i = 0; i < 2; i++) await writeFile(join(workspace, `hero/hero_idle_${i + 1}.png`), encodePng(trim(dude(0, i))));
  // 品红底的精灵图：3 列 × 2 行，第二行只有 2 帧（跳跃，保持原位）
  const sheet = createRaster(60, 60, [255, 0, 255, 255]);
  const put = (img: Raster, cx: number, cy: number) => { for (let y = 0; y < 30; y++) for (let x = 0; x < 20; x++) { const s = (y * 20 + x) * 4; if (img.data[s + 3]) sheet.data.set(img.data.subarray(s, s + 4), ((cy + y) * 60 + cx + x) * 4); } };
  for (let i = 0; i < 3; i++) put(dude(i), i * 20, 0);
  put(dude(0, 0), 0, 30);
  put(dude(0, 4), 20, 30);
  await writeFile(join(workspace, "sheet.png"), encodePng(sheet));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("grouping and normalising", () => {
  it("groups frames by name or sub-folder", () => {
    const g = groupFiles(["a/hero_run_10.png", "a/hero_run_2.png", "a/hero_idle-1.png", "a/hero_run_1.png"], 12);
    expect(g.map((x) => [x.name, x.frames.map((f) => f.source.split("/")[1])])).toEqual([["idle", ["hero_idle-1.png"]], ["run", ["hero_run_1.png", "hero_run_2.png", "hero_run_10.png"]]]);
    expect(g[0].frames[0].duration).toBe(83);
    expect(groupFiles(["x/walk/1.png", "x/walk/2.png", "x/jump/1.png"], 10).map((a) => a.name)).toEqual(["jump", "walk"]);
  });
  it("normalises names, durations and settings", () => {
    const { project, warnings } = normalizeProject({ name: "My Hero!", actions: [{ name: "Run Fast", fps: 8, frames: [{ source: "a.png" }] }, { name: "run fast", frames: [{ source: "b.png", duration: 5 }] }, { name: "x", frames: [] }], scale: 20 });
    expect(project.name).toBe("my_hero");
    expect(project.actions.map((a) => [a.name, a.frames[0].duration])).toEqual([["run_fast", 125], ["run_fast_2", 10]]);
    expect(project.scale).toBe(8);
    expect(warnings[0]).toMatch(/"x" has no frames/);
  });
});

describe("tools", () => {
  it("aligns trimmed frames on the feet and exports every format", async () => {
    const r = await call("sprite_open", { frames: "hero", fps: 12 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/idle 2f 12fps loop anchor=feet \(auto\); run 4f 12fps loop anchor=feet/);
    const p = r.structuredContent.project;
    p.actions[0].loop = false;
    const x = await call("sprite_export", { project: { ...p, scale: 2 } });
    expect(x.structuredContent.files).toEqual(["sprites/hero/hero.png", "sprites/hero/hero.json", "sprites/hero/hero.tres", "sprites/hero/hero.unity.md", "sprites/hero/hero.phaser.js", "sprites/hero/hero.sprites.json"]);
    const [cw, ch] = x.structuredContent.cell;
    const atlas = decodeImage(await readFile(join(workspace, "sprites/hero/hero.png")));
    expect([atlas.width, atlas.height]).toEqual([4 * cw * 2, 2 * ch * 2]);
    // 每帧最低的不透明像素都在同一条地面线上
    const [px, py] = x.structuredContent.pivot;
    for (let i = 0; i < 4; i++) {
      const cell = createRaster(cw * 2, ch * 2);
      for (let y = 0; y < ch * 2; y++) cell.data.set(atlas.data.subarray(((ch * 2 + y) * atlas.width + i * cw * 2) * 4, ((ch * 2 + y) * atlas.width + (i + 1) * cw * 2) * 4), y * cw * 2 * 4);
      expect(opaqueBox(cell)!.y1).toBe(py * 2);
    }
    expect(px * 2).toBe(cw);
    const json = JSON.parse(await readFile(join(workspace, "sprites/hero/hero.json"), "utf8"));
    expect(json.meta.frameTags).toEqual([{ name: "idle", from: 0, to: 1, direction: "forward", repeat: "1" }, { name: "run", from: 2, to: 5, direction: "forward" }]);
    expect(json.frames.run_02.frame).toEqual({ x: cw * 2, y: ch * 2, w: cw * 2, h: ch * 2 });
    expect(json.frames.run_02.duration).toBe(83);
    const tres = await readFile(join(workspace, "sprites/hero/hero.tres"), "utf8");
    expect(tres).toMatch(/^\[gd_resource type="SpriteFrames" load_steps=8 format=3\]/);
    expect(tres).toContain('[ext_resource type="Texture2D" path="hero.png" id="1_atlas"]');
    expect(tres).toContain(`region = Rect2(${cw * 2}, ${ch * 2}, ${cw * 2}, ${ch * 2})`);
    expect(tres).toMatch(/"loop": false,\n"name": &"idle",\n"speed": 12\.048/);
    const unity = await readFile(join(workspace, "sprites/hero/hero.unity.md"), "utf8");
    expect(unity).toContain(`Pixel Size **${cw * 2} × ${ch * 2}**`);
    expect(unity).toContain(`run_01 (0, 0, ${cw * 2}, ${ch * 2})`);
    expect(await readFile(join(workspace, "sprites/hero/hero.phaser.js"), "utf8")).toContain('this.anims.createFromAseprite("hero");');
  });
  it("slices a sheet, keys out the background and keeps pre-aligned jumps", async () => {
    const r = await call("sprite_open", { sheet: "sheet.png", grid: { width: 20, height: 30 }, actions: ["walk", "jump"] });
    expect(r.content[0].text).toMatch(/Sliced sheet\.png into 3×2 cells of 20×30 px[\s\S]*walk 3f .* anchor=keep \(auto\); jump 2f .* anchor=keep/);
    const prev = await call("atlas_preview", { project: r.structuredContent.project });
    const img = decodeImage(Buffer.from(prev.structuredContent.data, "base64"));
    expect(img.data[3]).toBe(0); // 品红底已去掉
    const [cw, ch] = prev.structuredContent.cell;
    const jumpFrames = prev.structuredContent.frames.filter((f: any) => f.action === "jump");
    const box = (f: any) => { const c = createRaster(cw, ch); for (let y = 0; y < ch; y++) c.data.set(img.data.subarray(((f.y + y) * img.width + f.x) * 4, ((f.y + y) * img.width + f.x + cw) * 4), y * cw * 4); return opaqueBox(c)!; };
    expect(box(jumpFrames[0]).y1 - box(jumpFrames[1]).y1).toBe(4); // 跳起 4px 保留
    const feet = await call("atlas_preview", { project: { ...r.structuredContent.project, actions: r.structuredContent.project.actions.map((a: any) => ({ ...a, anchor: "feet" })) } });
    const img2 = decodeImage(Buffer.from(feet.structuredContent.data, "base64"));
    const box2 = (f: any) => { const [w, hh] = feet.structuredContent.cell; const c = createRaster(w, hh); for (let y = 0; y < hh; y++) c.data.set(img2.data.subarray(((f.y + y) * img2.width + f.x) * 4, ((f.y + y) * img2.width + f.x + w) * 4), y * w * 4); return opaqueBox(c)!; };
    const jf = feet.structuredContent.frames.filter((f: any) => f.action === "jump");
    expect(box2(jf[0]).y1).toBe(box2(jf[1]).y1);
  });
  it("applies nudges and explains errors", async () => {
    const r = await call("sprite_open", { frames: "hero" });
    const p = r.structuredContent.project;
    const before = (await call("atlas_preview", { project: p })).structuredContent;
    p.actions[1].frames[0].dy = -3;
    const after = (await call("atlas_preview", { project: p })).structuredContent;
    expect(after.cell[1]).toBe(before.cell[1] + 3);
    expect((await call("sprite_open", { sheet: "sheet.png" })).content[0].text).toMatch(/sheet\.png is 60×60\. Pass grid/);
    expect((await call("sprite_open", { frames: "nope" })).isError).toBe(true);
    expect((await call("sprite_save", { project: { actions: [{ name: "a", frames: [{ source: "x.jpg" }] }] } })).content[0].text).toMatch(/must be PNG/);
  });
});
