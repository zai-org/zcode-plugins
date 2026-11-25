// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
// 可用 E2E_PHOTOS 指向一个装有真实商品照的文件夹。
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";
import { cutoutPng, gradientProduct } from "../test/fixtures.ts";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "product-photo-studio-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "photostudio-e2e-"));
await mkdir(join(workspace, "商品图"));
await writeFile(join(workspace, "商品图/red-bottle.jpg"), gradientProduct());
await writeFile(join(workspace, "商品图/blue-ball.png"), cutoutPng());
const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;
for (const f of ["headphones-cc0.jpg", "perfume.jpg"]) await copyFile(join(fixtures, f), join(workspace, "商品图", f));
if (process.env.E2E_PHOTOS) for (const f of await readdir(process.env.E2E_PHOTOS)) await copyFile(join(process.env.E2E_PHOTOS, f), join(workspace, "商品图", f));
const count = (await readdir(join(workspace, "商品图"))).length;

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 1000 });
  step("empty panel lists workspace images");
  await frame.locator("label", { hasText: "red-bottle.jpg" }).waitFor();

  step("agent opens the folder");
  await harness.agent(outer, "photos_open", { folder: "商品图", presets: ["white-800", "transparent-png"] });
  await frame.locator(".thumb img").nth(count - 1).waitFor({ timeout: 120_000 });
  await frame.waitForFunction(() => !!(document.getElementById("large") as HTMLImageElement)?.src, null, { timeout: 60_000 });
  await outer.screenshot({ path: join(shots, "01-batch.png") });

  step("change global size and shadow, previews refresh");
  const fill = frame.locator(".side .slider", { hasText: "主体占比" }).locator("input");
  await fill.fill("0.7");
  await frame.locator(".side select").nth(1).selectOption("drop");
  await frame.waitForTimeout(2500);
  await outer.screenshot({ path: join(shots, "02-global-settings.png") });

  step("adjust one photo only");
  await frame.locator(".thumb", { hasText: "perfume" }).click();
  await frame.locator(".detail .slider", { hasText: "上下位置" }).locator("input").fill("0.1");
  await frame.waitForTimeout(1500);
  await frame.locator(".thumb", { hasText: "✎" }).waitFor({ state: "attached" }).catch(() => undefined);
  await outer.screenshot({ path: join(shots, "03-single-photo.png") });

  step("transparent preview");
  await frame.locator(".main select").first().selectOption("transparent-png");
  await frame.waitForTimeout(2500);
  await outer.screenshot({ path: join(shots, "04-transparent.png") });

  step("export all");
  await frame.locator("button", { hasText: "全部导出" }).click();
  await frame.locator("h2", { hasText: "已导出" }).waitFor({ timeout: 300_000 });
  const white = await readdir(join(workspace, "product-photos-output/white-800"));
  const png = await readdir(join(workspace, "product-photos-output/transparent-png"));
  assert.equal(white.length, count);
  assert.equal(png.length, count);
  await outer.screenshot({ path: join(shots, "05-exported.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — ${count} photos, screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
