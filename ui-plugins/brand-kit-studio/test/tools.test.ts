import { mkdtemp, readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeImage } from "../src/kit/raster.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const pixel = (png: PNG, x: number, y: number) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
};
const near = (a: number[], b: number[], tol = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "brandkit-"));
  await mkdir(join(workspace, "assets"));
  for (const f of ["qinghe-logo.svg", "qinghe-mark.svg", "nordlys-logo.jpg", "pixelo-wordmark.png"]) await copyFile(join(import.meta.dirname, "fixtures", f), join(workspace, "assets", f));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe("brand-kit-studio", () => {
  it("suggests colours from an SVG logo and exports the whole kit", async () => {
    const opened = await call("brand_open", { name: "青禾咖啡", tagline: "每一杯都来自云南高山的新鲜烘焙", logo: "assets/qinghe-logo.svg", mark: "assets/qinghe-mark.svg" });
    expect(opened.isError).toBeFalsy();
    const project = opened.structuredContent.project;
    expect(project.brand.colors.primary).toBe("#1f7a4d");
    expect(opened.content[0].text).toContain("suggested from the logo");

    const exported = await call("brand_export", { project });
    expect(exported.isError).toBeFalsy();
    const files: string[] = exported.structuredContent.files;
    for (const f of ["favicon/favicon.ico", "favicon/favicon-16x16.png", "favicon/apple-touch-icon.png", "favicon/site.webmanifest", "favicon/head-snippet.html", "social/og-image-1200x630.png", "covers/youtube-banner-2560x1440.png", "templates/og-image.svg", "index.html", "brand.json"])
      expect(files).toContain(`brand-kit/${f}`);

    // ICO：3 个 PNG 尺寸。
    const ico = await readFile(join(workspace, "brand-kit/favicon/favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
    // 每个 PNG 的尺寸正确。
    const og = PNG.sync.read(await readFile(join(workspace, "brand-kit/social/og-image-1200x630.png")));
    expect([og.width, og.height]).toEqual([1200, 630]);
    const yt = PNG.sync.read(await readFile(join(workspace, "brand-kit/covers/youtube-banner-2560x1440.png")));
    expect([yt.width, yt.height]).toEqual([2560, 1440]);
    // 标志颜色和品牌色接近，安卓图标改用白底并保留绿色标志。
    const android = PNG.sync.read(await readFile(join(workspace, "brand-kit/favicon/android-chrome-512x512.png")));
    expect(near(pixel(android, 256, 30), [0x1f, 0x7a, 0x4d], 30)).toBe(true);
    const manifest = JSON.parse(await readFile(join(workspace, "brand-kit/favicon/site.webmanifest"), "utf8"));
    expect(manifest.theme_color).toBe("#1f7a4d");
    expect(manifest.icons.some((i: any) => i.purpose === "maskable")).toBe(true);
    const svg = await readFile(join(workspace, "brand-kit/templates/og-image.svg"), "utf8");
    expect(svg).toContain("<svg");
    // SVG logo 内联（文字用插件字体渲染）。
    expect(svg).not.toContain("data:image/svg+xml");
  });

  it("uses a letter mark without a logo, and flags a tagline that does not fit", async () => {
    const opened = await call("brand_open", { name: "morning tea 晨茶", tagline: "一段很长很长的标语".repeat(30), colors: { primary: "#f59e0b" } });
    expect(opened.isError).toBeFalsy();
    expect(opened.structuredContent.warnings.some((w: string) => w.includes("subtitle"))).toBe(true);
    const preview = await call("brand_preview", { project: opened.structuredContent.project, asset: "avatar", width: 200 });
    const png = PNG.sync.read(Buffer.from(preview.structuredContent.image, "base64"));
    expect(png.width).toBe(200);
    expect(near(pixel(png, 6, 6), [0xf5, 0x9e, 0x0b])).toBe(true);
    // 中间是深色字母。
    let dark = 0;
    for (let x = 60; x < 140; x++) for (let y = 60; y < 140; y++) if (pixel(png, x, y)[0] < 80) dark++;
    expect(dark).toBeGreaterThan(400);
  });

  it("puts an opaque JPG logo on a white badge and turns a one-colour PNG logo white on brand colour", async () => {
    const jpg = await call("brand_open", { name: "Nordlys", logo: "assets/nordlys-logo.jpg" });
    expect(jpg.structuredContent.project.brand.colors.primary).toMatch(/^#e[0-9a-f]5[0-9a-f]2[0-9a-f]$/);
    const split = await call("brand_preview", { project: jpg.structuredContent.project, asset: "x-post", width: 1200 });
    const a = PNG.sync.read(Buffer.from(split.structuredContent.image, "base64"));
    // 右侧品牌色面板中心附近是白色底卡。
    expect(near(pixel(a, 1000, 337), [255, 255, 255], 20) || near(pixel(a, 960, 300), [255, 255, 255], 20)).toBe(true);

    const png = await call("brand_open", { name: "Pixelo", logo: "assets/pixelo-wordmark.png" });
    const project = png.structuredContent.project;
    const hero = await call("brand_preview", { project, asset: "og-image", width: 1200 });
    const b = PNG.sync.read(Buffer.from(hero.structuredContent.image, "base64"));
    let white = 0;
    for (let x = 300; x < 900; x += 3) for (let y = 150; y < 330; y += 3) if (near(pixel(b, x, y), [255, 255, 255], 10)) white++;
    expect(white).toBeGreaterThan(300);
  });

  it("saves and reloads a project, keeps per-asset overrides, and rejects paths outside the workspace", async () => {
    const opened = await call("brand_open", { name: "Pixelo", tagline: "Design together", logo: "assets/pixelo-wordmark.png" });
    const project = opened.structuredContent.project;
    project.assets["og-image"] = { layout: "minimal", title: "Launch week" };
    project.assets["youtube-banner"] = { enabled: false };
    const saved = await call("project_save", { path: "pixelo", project });
    expect(saved.structuredContent.path).toBe("pixelo.brandkit.json");
    const reopened = await call("brand_open", { project: "pixelo.brandkit.json" });
    expect(reopened.structuredContent.project.assets["og-image"]).toEqual({ layout: "minimal", title: "Launch week" });
    const exported = await call("brand_export", { project: "pixelo.brandkit.json" });
    expect(exported.structuredContent.files).not.toContain("brand-kit/covers/youtube-banner-2560x1440.png");
    const only = await call("brand_export", { project: "pixelo.brandkit.json", assets: ["avatar"] });
    expect(only.structuredContent.files.filter((f: string) => f.endsWith(".png"))).toEqual(["brand-kit/social/avatar-400x400.png"]);
    const bad = await call("brand_open", { name: "x", logo: "../../etc/passwd.png" });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.error.code).toBe("outside_workspace");
    expect((await readdir(join(workspace, "brand-kit/templates"))).length).toBeGreaterThan(5);
  });

  it("reports an empty or corrupt logo as an invalid PNG/JPEG, not a WebP/HEIC hint", async () => {
    await writeFile(join(workspace, "assets/empty.png"), Buffer.alloc(0));
    expect(() => decodeImage(Buffer.alloc(0), "assets/empty.png")).toThrow(/not a valid PNG or JPEG/);
    expect(() => decodeImage(Buffer.from("RIFF....WEBP"), "logo.webp")).toThrow(/convert WebP\/HEIC first/);
    const bad = await call("brand_open", { name: "Broken", logo: "assets/empty.png" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/not a valid PNG or JPEG/);
    expect(bad.content[0].text).not.toMatch(/WebP\/HEIC/);
  });
});
