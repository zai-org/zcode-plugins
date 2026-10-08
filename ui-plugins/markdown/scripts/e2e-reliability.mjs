// 真实 MCP + Vditor：覆盖容易丢稿的请求时序与 360px 菜单交互。
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";
const fixture = await startFixture();
const { url, call, workspace } = fixture;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
await mkdir(artifacts, { recursive: true });
const errors = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const a = await call("new_document", { path: "a.md", content: "# 文档 A\n\n原文。\n" });
  const b = await call("new_document", { path: "b.md", content: "# 文档 B\n\n第二份文档。\n" });
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/?doc=${a.document.id}`);
  await page.waitForSelector(".vditor-ir h1");
  const type = async (text) => {
    await page.locator(".vditor-ir [contenteditable]").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(text);
  };
  let saving = false;
  let delayNext = true;
  await page.route("**/rpc", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "callTool" && body.args.name === "commit_draft" && delayNext) {
      delayNext = false;
      const response = await route.fetch();
      saving = true;
      await page.evaluate(
        (id) =>
          window.__fireNotification("notifications/resources/updated", {
            uri: `ui://markdown/document/${id}`,
          }),
        a.document.id,
      );
      await wait(1600);
      await route.fulfill({ response });
    } else await route.continue();
  });
  await type("第一段输入。");
  for (let i = 0; i < 100 && !saving; i++) await wait(50);
  assert(saving, "first save must be in flight");
  await type("保存途中追加。");
  await page.waitForFunction(() => !window.__mdDebug.getState().dirty, null, { timeout: 10000 });
  assert.match(await readFile(join(workspace, "a.md"), "utf8"), /保存途中追加/);
  assert.equal(await page.locator("#conflict").getAttribute("data-visible"), "false");
  console.log("PASS slow save drains newer input and ignores own notification");

  await type("切换前最后一句。");
  await page.evaluate((output) => window.__publish(output), b);
  await page.waitForFunction((id) => window.__mdDebug.getState().id === id, b.document.id);
  assert.match(await readFile(join(workspace, "a.md"), "utf8"), /切换前最后一句/);
  assert(!(await readFile(join(workspace, "b.md"), "utf8")).includes("切换前"));
  console.log("PASS fast switch flushes the previous document only");

  await type("本地未保存草稿。");
  const base = await page.evaluate(() => window.__mdDebug.getState().revision);
  const patch = await call("patch_document", {
    path: "b.md",
    ops: [{ find: "第二份文档。", replace: "外部新内容。" }],
  });
  await page.evaluate((output) => window.__publish(output), patch);
  await page.waitForSelector('#conflict[data-visible="true"]');
  assert.equal(await page.evaluate(() => window.__mdDebug.getState().revision), base);
  assert.match(await page.evaluate(() => window.__mdDebug.getValue()), /本地未保存草稿/);
  await page.screenshot({ path: join(artifacts, "08-conflict-draft.png") });
  let failResolve = true;
  await page.route("**/rpc", async (route) => {
    const body = route.request().postDataJSON();
    if (body.args?.name === "resolve_conflict" && failResolve) {
      failResolve = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "simulated offline" }),
      });
    } else await route.fallback();
  });
  await page.click("#overwrite");
  await page.waitForSelector('#status[data-phase="error"]');
  assert.equal(await page.locator("#conflict").getAttribute("data-visible"), "true");
  assert.equal(await page.evaluate(() => window.__mdDebug.getState().dirty), true);
  await page.click("#overwrite");
  await page.waitForSelector('#conflict[data-visible="false"]', { state: "attached" });
  assert.match(await readFile(join(workspace, "b.md"), "utf8"), /本地未保存草稿/);
  assert(
    (await page.evaluate(() => window.__widgetWrites)) <= 3,
    "host widget-state notifications must not replay output",
  );
  console.log("PASS conflict keeps draft/base revision and failed resolution is retryable");

  // 同名导入：必须保留导入内容，也不能覆盖已有 b.md。
  const beforeDrop = await readFile(join(workspace, "b.md"), "utf8");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# 同名导入副本"], "b.md", { type: "text/markdown" }));
    document
      .querySelector(".vditor-ir [contenteditable]")
      .dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
  });
  await page.waitForFunction(() => window.__mdDebug.getValue().includes("同名导入副本"));
  assert.match(await readFile(join(workspace, "b-1.md"), "utf8"), /同名导入副本/);
  assert.equal(await readFile(join(workspace, "b.md"), "utf8"), beforeDrop);
  console.log("PASS duplicate-name drop imports a copy without replacing the original");

  // 模拟服务注册表丢失：按 widgetState.path 恢复不依赖旧 id 仍有效。
  await call("close_document", { id: a.document.id });
  const cold = await browser.newPage();
  await cold.goto(`${url}/?doc=${a.document.id}&path=a.md`);
  await cold.waitForSelector(".vditor-ir h1");
  assert.match(await cold.evaluate(() => window.__mdDebug.getValue()), /切换前最后一句/);
  await cold.close();
  console.log("PASS cold recovery reopens by path after registry reset");

  for (const width of [360, 520, 760, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    // 点击已有标题，验证标题内也能再次打开菜单修改级别。
    await page
      .locator(".vditor-ir")
      .getByRole("heading", { name: /同名导入副本/ })
      .click();
    if ((await page.locator("#format").getAttribute("aria-expanded")) !== "true")
      await page.click("#format");
    await page.click('[data-type="headings"]');
    const heading = page.getByRole("button", { name: "三级标题", exact: false });
    await heading.waitFor({ state: "visible", timeout: 3000 }).catch(async (error) => {
      await page.screenshot({ path: join(artifacts, `heading-failure-${width}.png`) });
      console.error(`Heading menu failed at ${width}px; screenshot saved.`);
      throw error;
    });
    const reachable = await heading.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(top) && r.left >= 0 && r.right <= innerWidth;
    });
    assert(reachable, `${width}px heading menu must not be clipped`);
    await page.screenshot({ path: join(artifacts, `09-heading-menu-${width}.png`) });
    await heading.click();
    await heading.waitFor({ state: "hidden" });
    await page
      .locator(".vditor-ir h3")
      .filter({ hasText: "同名导入副本" })
      .waitFor({ state: "visible" });
    const layout = await page.evaluate(() => ({
      overflow: document.body.scrollWidth - innerWidth,
      status: document.getElementById("status").getBoundingClientRect().height,
      footer: document.querySelector("footer").getBoundingClientRect().bottom,
    }));
    assert(layout.overflow <= 2 && layout.status > 0 && layout.footer <= 721, `${width}px layout`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS 360/520/760/1280px formatting menus, status and overflow");
} finally {
  await browser.close();
  await fixture.close();
}
