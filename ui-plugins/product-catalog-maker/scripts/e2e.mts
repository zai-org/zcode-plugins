// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
// 可用 E2E_CATALOG 指向一个含 products.csv 和 images/ 的文件夹（真实商品）。
import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "product-catalog-maker-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "catalog-e2e-"));
if (process.env.E2E_CATALOG) await cp(process.env.E2E_CATALOG, join(workspace, "货品"), { recursive: true });
else {
  await mkdir(join(workspace, "货品/images"), { recursive: true });
  const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;
  await copyFile(join(fixtures, "headphones-cc0.jpg"), join(workspace, "货品/images/headphones-cc0.jpg"));
  await copyFile(join(fixtures, "perfume.jpg"), join(workspace, "货品/images/perfume.jpg"));
  await writeFile(join(workspace, "货品/products.csv"), "编号,名称,规格,价格,图片,分类\nPN-1,头戴耳机,黑色,299,headphones-cc0.jpg,数码\nPN-2,淡香水,50ml,199,perfume.jpg,美妆\nPN-3,杯垫,圆形,15,,杯具\n");
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 1000 });
  step("empty panel offers the table picker");
  await frame.locator("option", { hasText: "货品/products.csv" }).waitFor({ state: "attached" });

  step("agent opens the table");
  await harness.agent(outer, "catalog_open", { table: "货品/products.csv", style: { title: "青禾生活 2026 秋季目录", subtitle: "杯具 · 箱包 · 鞋履 · 数码", footer: "订购热线 400-000-0000" } });
  await frame.locator("#pages canvas").nth(2).waitFor({ timeout: 180_000 });
  await frame.waitForTimeout(3000);
  await outer.screenshot({ path: join(shots, "01-preview.png") });

  step("switch to 3×3 and a new colour; preview rebuilds");
  await frame.locator(".side select").nth(1).selectOption("3x3");
  await frame.locator(".side input[type=color]").evaluate((el: HTMLInputElement) => {
    el.value = "#b45309";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.waitForTimeout(8000);
  await outer.screenshot({ path: join(shots, "02-style.png") });

  step("build, change a price, rebuild → change list");
  await frame.locator("button", { hasText: "生成目录" }).click();
  await frame.locator("h2", { hasText: "已生成" }).waitFor({ timeout: 300_000 });
  const csv = await readFile(join(workspace, "货品/products.csv"), "utf8");
  const lines = csv.split("\n");
  const cells = lines[1].split(",");
  cells[3] = "1";
  lines[1] = cells.join(",");
  await writeFile(join(workspace, "货品/products.csv"), lines.join("\n"));
  await frame.locator("button", { hasText: "生成目录" }).click();
  await frame.locator("div", { hasText: /变更：新增 0，下架 0，修改 1/ }).first().waitFor({ timeout: 300_000 });
  const md = await readFile(join(workspace, "catalog/changes.md"), "utf8");
  assert.match(md, /价格 .* → 1/);
  await frame.waitForTimeout(4000);
  await outer.screenshot({ path: join(shots, "03-built.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
