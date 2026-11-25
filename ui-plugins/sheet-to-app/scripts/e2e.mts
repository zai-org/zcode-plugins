// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板；
// 然后用 Chrome 以 file:// 打开生成的单文件应用：搜索、筛选、排序、新增/编辑校验、刷新后数据保留、CSV 导出、表格更新提示。需要 Chrome。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "sheet-to-app-shots");
mkdirSync(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "sta-e2e-"));
const local = join(import.meta.dirname, "../node_modules/.sheet-sample.mjs");
copyFileSync(process.env.SHEET_SAMPLE ?? "/workspace/zcode-new-plugins/samples/sheet/make-sheets.mjs", local);
mkdirSync(join(workspace, "data"));
execFileSync(process.execPath, [local, join(workspace, "data")]);
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
try {
  const { outer, frame, context } = await harness.open("?locale=zh-CN", { width: 1440, height: 950 });
  step("user picks the inventory sheet and makes the app");
  await frame.locator("select.src").selectOption("data/库存表.csv");
  await frame.locator("button.make").click();
  await frame.locator(".done", { hasText: "index.html" }).waitFor({ timeout: 30_000 });
  await frame.locator(".issue", { hasText: "不是数字" }).waitFor();
  assert.equal(await frame.locator("tr[data-col='库存'] select.ty").inputValue(), "number");
  assert.equal(await frame.locator("tr[data-col='在售'] select.ty").inputValue(), "boolean");
  await outer.screenshot({ path: join(shots, "01-mapping.png") });

  step("user renames the app, hides 供应商 and adds a low-stock highlight");
  await frame.locator("input.title").fill("门店物料库存");
  await frame.locator("tr[data-col='供应商'] input[data-k='hidden']").check();
  await frame.locator("select.hlcol").selectOption("库存");
  await frame.locator("select.hlop").selectOption("<=");
  await frame.locator("input.hlval").fill("5");
  await frame.locator("input.hllab").fill("库存不足");
  await frame.locator("button.apply").click();
  await frame.locator(".done", { hasText: "已生成" }).waitFor();
  await frame.frameLocator("iframe.pv").locator(".tag", { hasText: "库存不足" }).first().waitFor({ timeout: 15_000 });
  await outer.screenshot({ path: join(shots, "02-settings-preview.png") });
  const id = (await harness.agent(outer, "app_list", {})).structuredContent.apps[0].id;
  const appFile = join(workspace, `apps/${id}/index.html`);

  step("open the generated app from disk (file://)");
  const page = await context.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("dialog", (d) => void d.accept());
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(pathToFileURL(appFile).href);
  await page.locator("h1", { hasText: "门店物料库存" }).waitFor();
  await page.locator("#count", { hasText: "共 15 条" }).waitFor();
  assert.equal(await page.locator("th", { hasText: "供应商" }).count(), 0, "hidden column not shown");
  assert.ok((await page.locator("tr.hl").count()) >= 3, "low-stock rows highlighted");
  await page.locator("td.bad", { hasText: "十" }).waitFor();

  step("search, filter and sort");
  await page.locator("#q").fill("滤");
  await page.locator("#count", { hasText: "共 2 条" }).waitFor();
  await page.locator("#q").fill("");
  await page.locator("select[data-f]").first().selectOption("器具");
  await page.locator("#count", { hasText: "共 4 条" }).waitFor();
  await page.locator("th[data-k]", { hasText: "库存" }).click();
  const firstStock = await page.locator("tbody tr").first().locator("td").nth(3).textContent();
  assert.equal(firstStock?.trim(), "2", "sorted by stock ascending");
  await page.locator("select[data-f]").first().selectOption("");
  await page.locator("#count", { hasText: "共 15 条" }).waitFor();

  step("add a record: required + duplicate-key validation, then save");
  await page.locator("#add").click();
  await page.locator("#f_sku").fill("HB-001");
  await page.locator("#frm button[type=submit]").click();
  await page.locator(".fld .err", { hasText: "必填" }).first().waitFor();
  await page.locator(".fld .err", { hasText: "已存在相同的SKU" }).waitFor();
  await page.screenshot({ path: join(shots, "03-form-validation.png") });
  await page.locator("#f_sku").fill("HB-040");
  await page.locator("#f_f2").fill("冷萃滤袋 20只");
  await page.locator("#f_f3").selectOption("耗材");
  await page.locator("#f_f4").fill("3");
  await page.locator("#f_f5").fill("32.5");
  await page.locator("#f_f7").fill("2026-11-24");
  await page.locator("#frm button[type=submit]").click();
  await page.locator("#count", { hasText: "共 16 条" }).waitFor();
  await page.locator("tbody tr.hl", { hasText: "HB-040" }).waitFor();

  step("edit the bad row (十 → 10) and check it persists after reload");
  await page.locator("tbody tr", { hasText: "HB-022" }).click();
  await page.locator("#f_f4").fill("10");
  await page.locator("#frm button[type=submit]").click();
  await page.reload();
  await page.locator("#count", { hasText: "共 16 条" }).waitFor();
  assert.equal(await page.locator("td.bad", { hasText: "十" }).count(), 0);
  await page.locator("tbody tr", { hasText: "HB-022" }).locator("td", { hasText: /^10$/ }).waitFor();
  await page.screenshot({ path: join(shots, "04-app.png") });

  step("export CSV");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#exp").click()]);
  const csv = await readFile((await dl.path())!, "utf8");
  assert.ok(csv.startsWith("\uFEFFSKU,商品名称"), "BOM + Chinese headers");
  assert.match(csv, /HB-040,冷萃滤袋 20只,耗材,3,32.5,2026-11-24,否/);

  step("delete a record");
  await page.locator("tbody tr", { hasText: "HB-040" }).click();
  await page.locator("#del").click();
  await page.locator("#count", { hasText: "共 15 条" }).waitFor();

  step("sheet updated → app_refresh → open copy shows the banner and loads the new data");
  await rename(join(workspace, "data/库存表-更新.csv"), join(workspace, "data/库存表.csv"));
  const r = await harness.agent(outer, "app_refresh", { id });
  assert.match(r.content[0].text, /new columns: 货架位置/);
  await page.reload();
  await page.locator(".banner", { hasText: "表格已更新" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shots, "05-sheet-updated.png") });
  await page.locator("#loadNew").click();
  await page.locator("#count", { hasText: "共 16 条" }).waitFor();
  await page.locator("tbody tr", { hasText: "HB-032" }).waitFor();
  assert.deepEqual(errs, [], "no script errors in the generated app");
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
