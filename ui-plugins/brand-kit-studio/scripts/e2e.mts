// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "brand-kit-studio-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "brandkit-e2e-"));
await mkdir(join(workspace, "logo"));
const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;
for (const f of ["qinghe-logo.svg", "qinghe-mark.svg", "nordlys-logo.jpg", "pixelo-wordmark.png"]) await copyFile(join(fixtures, f), join(workspace, "logo", f));

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 1000 });
  step("empty panel offers the brand form with workspace logos");
  await frame.locator("option", { hasText: "logo/qinghe-logo.svg" }).first().waitFor({ state: "attached" });
  await outer.screenshot({ path: join(shots, "01-start.png") });

  step("agent opens the brand");
  await harness.agent(outer, "brand_open", { name: "青禾咖啡", tagline: "每一杯都来自云南高山的新鲜烘焙", logo: "logo/qinghe-logo.svg", mark: "logo/qinghe-mark.svg" });
  await frame.locator(".thumb img").nth(12).waitFor({ timeout: 120_000 });
  await frame.waitForFunction(() => !!(document.getElementById("large") as HTMLImageElement)?.src, null, { timeout: 60_000 });
  await outer.screenshot({ path: join(shots, "02-kit.png") });

  step("change the primary colour; every preview refreshes");
  const before = await frame.locator(".thumb[data-id='og-image'] img").getAttribute("src");
  await frame.locator(".colors input[type=color]").first().evaluate((el: HTMLInputElement) => {
    el.value = "#7a3e1f";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.waitForFunction((src) => document.querySelector(".thumb[data-id='og-image'] img")?.getAttribute("src") !== src, before, { timeout: 60_000 });
  await frame.waitForTimeout(3000);
  await outer.screenshot({ path: join(shots, "03-colour.png") });

  step("edit one asset: layout + title");
  await frame.locator(".thumb[data-id='xiaohongshu']").click();
  await frame.locator(".detail select").first().selectOption("hero");
  await frame.locator(".detail input[type=text]").first().fill("秋季新豆上市");
  await frame.waitForTimeout(2500);
  await outer.screenshot({ path: join(shots, "04-asset.png") });

  step("untick YouTube and export");
  await frame.locator(".thumb[data-id='youtube-banner'] input[type=checkbox]").uncheck();
  await frame.locator("button", { hasText: "导出全部" }).click();
  await frame.locator("h2", { hasText: "已导出" }).waitFor({ timeout: 300_000 });
  const covers = await readdir(join(workspace, "brand-kit/covers"));
  assert.ok(!covers.some((f) => f.startsWith("youtube")));
  assert.ok((await readdir(join(workspace, "brand-kit/favicon"))).includes("favicon.ico"));
  const saved = JSON.parse(await readFile(join(workspace, "brand-kit/brand.json"), "utf8"));
  assert.equal(saved.brand.colors.primary, "#7a3e1f");
  assert.equal(saved.assets.xiaohongshu.title, "秋季新豆上市");
  await copyFile(join(workspace, "brand-kit/social/xiaohongshu-1080x1440.png"), join(shots, "xiaohongshu-export.png"));
  await outer.screenshot({ path: join(shots, "05-exported.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
