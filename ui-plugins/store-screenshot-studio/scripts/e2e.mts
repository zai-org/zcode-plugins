// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
// 可用 E2E_SCREENS 指向一个装有真实 App 截图的文件夹（按文件名排序，最多取 4 张）。
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "store-screenshot-studio-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "storeshots-e2e-"));
await mkdir(join(workspace, "截图"));
const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;
for (const f of ["01-menu.png", "02-orders.png", "ipad-menu.png"]) await copyFile(join(fixtures, f), join(workspace, "截图", f));
const extra = process.env.E2E_SCREENS ? (await readdir(process.env.E2E_SCREENS)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().slice(0, 4) : [];
for (const [i, f] of extra.entries()) await copyFile(join(process.env.E2E_SCREENS!, f), join(workspace, "截图", `1${i}-${f}`));
const paths = ["截图/01-menu.png", "截图/02-orders.png", ...extra.map((f, i) => `截图/1${i}-${f}`)];

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 1000 });
  step("empty panel lists workspace screenshots");
  await frame.locator("label", { hasText: "01-menu.png" }).waitFor();

  step("agent opens the screenshots with copy in two languages");
  const zh = ["一键点单", "订单实时追踪", "随时随地查百科", "图文并茂一读就懂", "热门新闻一手掌握", "开放地图精准导航"];
  const en = ["Order in one tap", "Track every order", "Knowledge to go", "Rich articles", "Top stories", "Open maps"];
  const texts = paths.map((_, i) => ({ "zh-Hans": { title: zh[i] ?? "精彩功能", ...(i === 0 ? { subtitle: "常喝的咖啡，三秒下单" } : {}) }, "en-US": { title: en[i] ?? "Great features" } }));
  await harness.agent(outer, "shots_open", { paths, locales: ["zh-Hans", "en-US"], texts, presets: ["ios-6.9", "ipad-13", "play-phone"], theme: { background: "#ecfdf5", background2: "#a7f3d0" } });
  await frame.locator(".strip .thumb img").nth(paths.length - 1).waitFor({ timeout: 180_000 });
  await frame.waitForFunction(() => !!(document.getElementById("large") as HTMLImageElement)?.src, null, { timeout: 60_000 });
  await outer.screenshot({ path: join(shots, "01-slides.png") });

  step("switch style: dark gradient, android frame, text at bottom");
  await frame.locator(".side select").first().selectOption("android");
  await frame.locator(".side select").nth(1).selectOption("bottom");
  await frame.locator(".side input[type=color]").first().evaluate((el: HTMLInputElement) => {
    el.value = "#0f172a";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.waitForTimeout(6000);
  await outer.screenshot({ path: join(shots, "02-style.png") });

  step("edit the English headline of slide 2");
  await frame.locator(".tabs button", { hasText: "en-US" }).click();
  await frame.locator(".strip .thumb").nth(1).click();
  await frame.locator(".detail textarea").first().fill("See where your coffee is");
  await frame.waitForTimeout(2500);
  await outer.screenshot({ path: join(shots, "03-english.png") });

  step("iPad size with a tablet screenshot");
  await frame.locator(".toolbar select").selectOption("ipad-13");
  await frame.locator(".strip .thumb").first().click();
  await frame.locator(".detail select").first().selectOption("截图/ipad-menu.png");
  await frame.waitForTimeout(4000);
  await outer.screenshot({ path: join(shots, "04-ipad.png") });

  step("export all");
  await frame.locator("button", { hasText: "导出全部" }).click();
  await frame.locator("h2", { hasText: "已导出" }).waitFor({ timeout: 600_000 });
  for (const locale of ["zh-Hans", "en-US"]) for (const size of ["ios-6.9", "ipad-13", "play-phone"]) assert.equal((await readdir(join(workspace, "store-screenshots", locale, size))).length, paths.length);
  await copyFile(join(workspace, "store-screenshots/en-US/ios-6.9/02-02-orders.png"), join(shots, "export-en-ios-02.png"));
  await copyFile(join(workspace, "store-screenshots/zh-Hans/ipad-13/01-01-menu.png"), join(shots, "export-zh-ipad-01.png"));
  await outer.screenshot({ path: join(shots, "05-exported.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — ${paths.length} slides, screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
