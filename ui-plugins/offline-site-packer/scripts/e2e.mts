// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板；
// 然后用 Chrome 直接以 file:// 打开离线包，验证样式、图片、页面跳转和离线搜索。需要 Chrome。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "offline-site-packer-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "osp-e2e-"));
execFileSync(process.execPath, [process.env.SITE_SAMPLE ?? "/workspace/zcode-new-plugins/samples/site/make-site.mjs", join(workspace, "lumen-docs/public")]);
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
try {
  const { outer, frame, context } = await harness.open("?locale=zh-CN", { width: 1400, height: 950 });
  step("user picks the site folder, enters the public URL and checks it");
  await frame.locator("select.dir").selectOption("lumen-docs/public");
  await frame.locator("input.base").fill("https://docs.lumen-example.com/");
  await frame.locator("button", { hasText: "只检查" }).click();
  await frame.locator(".stat.bad b", { hasText: "2" }).waitFor({ timeout: 30_000 });
  await frame.locator("tr.brk", { hasText: "/guide/firmware" }).waitFor();
  await frame.locator(".muted", { hasText: "仅检查，未写入文件" }).waitFor();
  step("user packs it");
  await frame.locator("button", { hasText: "生成离线包" }).click();
  await frame.locator(".done", { hasText: "lumen-docs-offline/" }).waitFor({ timeout: 60_000 });
  await frame.locator(".ext", { hasText: "https://shop.lumen-example.com/" }).waitFor();
  await outer.screenshot({ path: join(shots, "01-report.png") });
  assert.ok((await stat(join(workspace, "lumen-docs-offline.zip"))).size > 10_000);

  step("open the offline copy straight from disk (file://)");
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(pathToFileURL(join(workspace, "lumen-docs-offline/index.html")).href);
  assert.equal(await page.locator("h1").evaluate((e) => getComputedStyle(e).color), "rgb(124, 45, 18)", "@import'ed theme.css applied");
  assert.ok(await page.locator("main img").evaluate((i) => (i as HTMLImageElement).naturalWidth > 0), "srcset image loaded");
  assert.match(await page.locator("header").evaluate((e) => getComputedStyle(e).backgroundImage), /header-bg\.png/);
  await page.locator("nav.side a", { hasText: "Install" }).click();
  await page.waitForURL(/guide\/install\.html$/);
  assert.ok(await page.locator("main img").evaluate((i) => (i as HTMLImageElement).naturalWidth > 0));
  await page.locator("a", { hasText: "pairing" }).first().click();
  await page.waitForURL(/guide\/pairing\.html$/);
  step("offline search: Ctrl+K → “colour temperature” → Scenes");
  await page.keyboard.press("Control+k");
  await page.locator("#osp input").fill("colour temperature");
  await page.locator("#osp li a").first().waitFor();
  await page.screenshot({ path: join(shots, "02-offline-search.png") });
  await page.locator("#osp li a", { hasText: "Scenes" }).first().click();
  await page.waitForURL(/guide\/scenes\/index\.html$/);
  await page.locator("h1", { hasText: "Scenes" }).waitFor();
  await page.screenshot({ path: join(shots, "03-offline-page.png") });
  const real = pageErrors.filter((e) => !/missing-diagram\.png|ERR_FILE_NOT_FOUND|favicon/.test(e));
  assert.deepEqual(real, [], "no script errors on file:// pages");
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
