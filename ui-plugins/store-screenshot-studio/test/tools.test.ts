import { mkdtemp, readFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const pixel = (png: PNG, x: number, y: number) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
const near = (a: number[], b: number[], tol = 14) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "storeshots-"));
  await mkdir(join(workspace, "screens"));
  for (const f of ["01-menu.png", "02-orders.png", "03-lowres.png", "ipad-menu.png"]) await copyFile(join(import.meta.dirname, "fixtures", f), join(workspace, "screens", f));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

const texts = [
  { "zh-Hans": { title: "一键点单", subtitle: "常喝的咖啡，三秒下单" }, "en-US": { title: "Order in one tap", subtitle: "Your usual coffee in three seconds" } },
  { "zh-Hans": { title: "订单实时追踪" }, "en-US": { title: "Track every order live" } },
  { "zh-Hans": { title: "会员积分随时查看，积分可以兑换咖啡、甜点和周边，每月还有专属优惠券和生日礼遇等你来领" } },
];

describe("store-screenshot-studio", () => {
  it("opens screenshots with texts and flags long titles, missing translations and low resolution", async () => {
    const result = await call("shots_open", { paths: ["screens/01-menu.png", "screens/02-orders.png", "screens/03-lowres.png"], locales: ["zh-Hans", "en-US"], texts, presets: ["ios-6.9", "play-phone"] });
    expect(result.isError).toBeFalsy();
    const problems: string[] = result.structuredContent.problems;
    expect(problems.some((p) => p.startsWith("#3") && p.includes("[en-US]") && p.includes("no text for this language"))).toBe(true);
    expect(problems.some((p) => p.startsWith("#3") && p.includes("[zh-Hans]") && p.includes("headline is too long"))).toBe(true);
    expect(problems.some((p) => p.startsWith("#3") && p.includes("blurry"))).toBe(true);
    expect(problems.some((p) => p.startsWith("#1"))).toBe(false);
  });

  it("exports exact store sizes as opaque PNGs per language and size", async () => {
    const opened = await call("shots_open", { paths: ["screens/01-menu.png", "screens/02-orders.png"], locales: ["zh-Hans", "en-US"], texts, presets: ["ios-6.9", "ios-6.5", "play-phone"], theme: { background: "#1f7a4d", background2: "", frame: "iphone" } });
    const exported = await call("shots_export", { project: opened.structuredContent.project });
    expect(exported.isError).toBeFalsy();
    const files: string[] = exported.structuredContent.files;
    expect(files.length).toBe(2 * 3 * 2);
    expect(files).toContain("store-screenshots/zh-Hans/ios-6.9/01-01-menu.png");
    expect(files).toContain("store-screenshots/en-US/play-phone/02-02-orders.png");
    const sizes: Record<string, [number, number]> = { "ios-6.9": [1320, 2868], "ios-6.5": [1284, 2778], "play-phone": [1080, 1920] };
    for (const [id, [w, hgt]] of Object.entries(sizes)) {
      const buf = await readFile(join(workspace, `store-screenshots/en-US/${id}/01-01-menu.png`));
      expect(buf[25]).toBe(2); // PNG colour type 2 = RGB，没有 alpha
      const png = PNG.sync.read(buf);
      expect([png.width, png.height]).toEqual([w, hgt]);
      expect(near(pixel(png, 10, 10), [0x1f, 0x7a, 0x4d])).toBe(true);
    }
    // 中文标题区域有白色文字。
    const zh = PNG.sync.read(await readFile(join(workspace, "store-screenshots/zh-Hans/ios-6.9/01-01-menu.png")));
    let white = 0;
    for (let x = 200; x < 1120; x += 2) for (let y = 120; y < 420; y += 2) if (near(pixel(zh, x, y), [255, 255, 255], 30)) white++;
    expect(white).toBeGreaterThan(800);
    // 截图内容出现在设备屏幕里（绿色标题栏）。
    let green = 0;
    for (let y = 600; y < 1400; y += 4) if (near(pixel(zh, 660, y), [31, 122, 77], 20)) green++;
    expect(green).toBeGreaterThan(5);
  });

  it("uses the tablet screenshot for iPad sizes and warns when only a phone screenshot is given", async () => {
    const base = { locales: ["en-US"], presets: ["ipad-13"], slides: [{ image: "screens/01-menu.png", text: { "en-US": { title: "Menu" } } }] };
    const phoneOnly = await call("shots_open", { paths: ["screens/01-menu.png"], presets: ["ipad-13"], locales: ["en-US"] });
    expect(phoneOnly.structuredContent.problems.join("\n")).toContain("tablet size uses a phone screenshot");
    const withTablet = { ...base, slides: [{ ...base.slides[0], tabletImage: "screens/ipad-menu.png" }] };
    const preview = await call("shots_preview", { project: withTablet, index: 0, width: 516 });
    expect(preview.structuredContent.codes).toEqual([]);
    const png = PNG.sync.read(Buffer.from(preview.structuredContent.image, "base64"));
    expect(png.width).toBe(516);
    expect(png.height).toBe(688);
  });

  it("saves, reloads, filters the export and rejects outside paths and >10 slides", async () => {
    const opened = await call("shots_open", { folder: "screens", locales: ["en-US"], presets: ["play-phone"] });
    const project = opened.structuredContent.project;
    expect(project.slides.map((s: any) => s.image)).toEqual(["screens/01-menu.png", "screens/02-orders.png", "screens/03-lowres.png", "screens/ipad-menu.png"]);
    project.theme.textPosition = "bottom";
    project.theme.bleed = true;
    project.slides[0].text["en-US"] = { title: "Hello" };
    const saved = await call("project_save", { path: "listing", project });
    expect(saved.structuredContent.path).toBe("listing.storeshots.json");
    const reopened = await call("shots_open", { project: "listing.storeshots.json" });
    expect(reopened.structuredContent.project.theme.textPosition).toBe("bottom");
    const only = await call("shots_export", { project: "listing.storeshots.json", indices: [0], outputDir: "x" });
    expect(only.structuredContent.files).toEqual(["store-screenshots/en-US/play-phone/01-01-menu.png"]);
    const bad = await call("shots_open", { paths: ["../secret.png"] });
    expect(bad.structuredContent.error.code).toBe("outside_workspace");
    const many = await call("shots_open", { paths: Array.from({ length: 11 }, () => "screens/01-menu.png").map((p, i) => `${p}?${i}`) });
    expect(many.isError).toBe(true);
    expect((await readdir(join(workspace, "store-screenshots/en-US/play-phone"))).length).toBeGreaterThan(0);
  });
});
