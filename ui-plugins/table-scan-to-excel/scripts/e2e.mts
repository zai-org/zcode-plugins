// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
// 测试里由脚本扮演 Agent，提交的是对样图的手工转写（真实使用时由 Agent 看图转写）。
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "table-scan-to-excel-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "tablescan-e2e-"));
const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;
await mkdir(join(workspace, "单据"), { recursive: true });
await copyFile(join(fixtures, "purchase-photo.jpg"), join(workspace, "单据/采购单.jpg"));
await copyFile(join(fixtures, "census-india-1911.jpg"), join(workspace, "单据/census-1911.jpg"));
const purchase = JSON.parse(await readFile(join(fixtures, "purchase.transcription.json"), "utf8"));
const census = JSON.parse(await readFile(join(fixtures, "census.transcription.json"), "utf8"));

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1400, height: 900 });
  step("empty panel lists the images");
  await frame.locator("option", { hasText: "单据/采购单.jpg" }).waitFor({ state: "attached" });

  step("agent opens the photo and submits its transcription");
  await harness.agent(outer, "table_scan_open", { image: "单据/采购单.jpg" });
  await frame.locator("text=这张图还没识别").waitFor();
  await harness.agent(outer, "table_submit", { image: "单据/采购单.jpg", tables: purchase });
  await frame.locator("td.total_mismatch").waitFor();
  assert.equal(await frame.locator("td.uncertain").count(), 1);
  await frame.locator(".issues li").first().click();
  await frame.waitForTimeout(600);
  await outer.screenshot({ path: join(shots, "01-review.png") });

  step("confirm the doubtful cell, correct the wrong total");
  await frame.locator("button", { hasText: "确认无误" }).click();
  await frame.locator(".issues li", { hasText: "F11" }).click();
  await frame.waitForTimeout(400);
  await outer.screenshot({ path: join(shots, "02-total.png") });
  const f11 = frame.locator('td[data-k="10:5"] input');
  await f11.fill("1,626.50");
  await f11.press("Tab");
  await frame.locator(".badge.ok", { hasText: "全部核对完" }).waitFor();

  step("export Excel");
  await frame.locator("button", { hasText: "导出 Excel" }).click();
  await frame.locator(".card", { hasText: "tables/采购单.xlsx" }).waitFor();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await readFile(join(workspace, "tables/采购单.xlsx"))) as any);
  const sheet = book.getWorksheet("采购明细")!;
  assert.equal(sheet.getCell("F11").value, 1626.5);
  assert.equal(sheet.getCell("F3").value, 216);
  assert.equal(sheet.getCell("F11").note, undefined);
  await frame.waitForTimeout(400);
  await outer.screenshot({ path: join(shots, "03-exported.png") });

  step("a real 1912 census scan");
  await harness.agent(outer, "table_scan_open", { image: "单据/census-1911.jpg" });
  await harness.agent(outer, "table_submit", { image: "单据/census-1911.jpg", tables: census });
  await frame.locator("td.uncertain").nth(1).waitFor();
  await frame.locator('td[data-k="7:2"] input').click();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "04-census.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
