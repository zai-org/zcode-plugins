// 交互回归：鼠标/键盘选区、浮层边界、短窗口、源码往返与保存状态独立。
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";
const fixture = await startFixture();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
await mkdir(artifacts, { recursive: true });
const content =
  "# 安静地写作\n\nSelection for chat.\n\n## 今日计划\n\n- [ ] 完成初稿\n\n> 好的工具，让人专注于内容。\n\n```js\nconst longLine = '" +
  "x".repeat(200) +
  "';\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 自动保存 | 可用 |\n";
const path = "docs/这是一份用于检查很长文件名与窄侧栏显示的写作记录.md";
try {
  const initial = await fixture.call("new_document", { path, content });
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  page.setDefaultTimeout(8000);
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${fixture.url}/?doc=${initial.document.id}`);
  await page.waitForSelector(".vditor-ir h1");
  assert.equal(await page.locator("header #reference").count(), 0);
  assert.equal(await page.locator("#format-tools").isVisible(), false);
  assert.equal(await page.locator("#status").innerText(), "所有更改已保存");
  assert(!(await page.locator("#status").getAttribute("title")).includes("r1"));
  const paragraph = page.locator(".vditor-ir p").filter({ hasText: "Selection for chat." });
  const selectKeyboard = async () => {
    await paragraph.click();
    await settle();
    await page.keyboard.press("ControlOrMeta+ArrowLeft");
    await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
    await page
      .locator("#selection-actions")
      .waitFor({ state: "visible" })
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            selection: getSelection().toString(),
            collapsed: getSelection().isCollapsed,
            active: document.activeElement.outerHTML.slice(0, 180),
          })),
        );
        await page.screenshot({ path: join(artifacts, "writing-failure.png") });
        throw error;
      });
  };
  const onScreen = async (selector) => {
    assert(
      await page.locator(selector).evaluate((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return (
          b.left >= 0 &&
          b.right <= innerWidth &&
          b.top >= 0 &&
          b.bottom <= innerHeight &&
          el.contains(hit)
        );
      }),
      `${selector} must be reachable inside viewport`,
    );
  };
  // 鼠标拖选，弹出按钮应靠近释放点，不能跑回标题栏。
  const bounds = await paragraph.boundingBox();
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 140, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  await onScreen("#selection-actions");
  const popup = await page.locator("#selection-actions").boundingBox();
  assert(Math.abs(popup.y - (bounds.y + bounds.height / 2)) < 80);
  const expectedSelection = await page.evaluate(() => getSelection().toString());
  await page.click("#reference");
  await page.waitForFunction(() => window.__contexts.length === 1);
  assert.equal(
    await page.evaluate(() => window.__contexts[0].structuredContent.selection),
    expectedSelection,
  );
  assert.equal(await page.locator("#status").innerText(), "所有更改已保存");
  await page.locator("#selection-actions").waitFor({ state: "hidden" });
  console.log(
    "PASS mouse selection, pointer-adjacent action, exact context and independent save feedback",
  );

  for (const [width, height] of [
    [320, 280],
    [360, 480],
    [520, 720],
    [760, 540],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await settle();
    console.log(`Checking ${width}x${height}`);
    await selectKeyboard();
    await onScreen("#selection-actions");
    await page.keyboard.press("ControlOrMeta+a");
    await settle();
    await onScreen("#selection-actions");
    await page.keyboard.press("Escape");
    await page.locator("#selection-actions").waitFor({ state: "hidden" });
    await page.click("#format");
    await onScreen("#format-tools");
    const toolbarLayout = await page.evaluate(() => ({
      bottom: document.querySelector("#format-tools").getBoundingClientRect().bottom,
      contentTop: document.querySelector(".vditor-content").getBoundingClientRect().top,
      height: document.querySelector("#format-tools").getBoundingClientRect().height,
    }));
    assert(toolbarLayout.bottom <= toolbarLayout.contentTop + 1);
    assert(toolbarLayout.height <= 74, "narrow toolbar should use at most two compact rows");
    await page.click('[data-type="headings"]');
    await onScreen('.vditor-hint button[data-tag="h3"]');
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#format-tools").isVisible(), true);
    await page.click("#switch");
    await onScreen("#docs");
    await page.keyboard.press("Escape");
    const layout = await page.evaluate(() => ({
      overflow: document.body.scrollWidth - innerWidth,
      header: document.querySelector("header").getBoundingClientRect().height,
      footer: document.querySelector("footer").getBoundingClientRect().bottom,
    }));
    assert(layout.overflow <= 1 && layout.header <= 48 && layout.footer <= height + 1);
    await page.screenshot({ path: join(artifacts, `12-writing-${width}.png`) });
    await page.click("#format");
    await page.locator("#format-tools").waitFor({ state: "hidden" });
  }
  console.log("PASS 320–1280px and short-window popovers, long filenames, Escape and layout");

  await page.setViewportSize({ width: 520, height: 400 });
  await settle();
  await selectKeyboard();
  await page.mouse.wheel(0, 180);
  await page.locator("#selection-actions").waitFor({ state: "hidden" });
  await page.click("#format");
  await page.setViewportSize({ width: 360, height: 480 });
  await page.locator("#format-tools").waitFor({ state: "visible" });
  await page.click("#outline");
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await onScreen("#outline-panel");
  await page.click("#outline");
  await page.click("#source");
  assert.equal(await page.locator("#source").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#outline").isEnabled(), false);
  await page.locator(".vditor-sv").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\nSource edit preserved.");
  await page.waitForFunction(() => !window.__mdDebug.getState().dirty);
  assert.equal(await page.locator("#outline").isEnabled(), false);
  await page.click("#source");
  await page.locator(".vditor-ir").waitFor({ state: "visible" });
  assert.match(await readFile(join(fixture.workspace, path), "utf8"), /Source edit preserved/);
  assert.equal(await page.locator("#format-tools").isVisible(), true);
  console.log(
    "PASS scroll/resize dismissal, narrow outline and source edits saved across mode switch",
  );

  // 失败提示提供真实可用的重试，不展示内部 revision。
  let fail = true;
  await page.route("**/rpc", async (route) => {
    if (route.request().postDataJSON().args?.name === "commit_draft" && fail)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"simulated offline"}',
      });
    else await route.continue();
  });
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" Retry preserved.");
  await page.locator('#status[data-phase="error"]').waitFor();
  await page.locator("#save").waitFor({ state: "visible" });
  fail = false;
  await page.click("#save");
  await page.locator('#status[data-phase="saved"]').waitFor();
  await page.locator("#save").waitFor({ state: "hidden" });
  assert.match(await readFile(join(fixture.workspace, path), "utf8"), /Retry preserved/);
  await page.click("#switch");
  await page.click("#show-new");
  await page.fill("#doc-name", "toolbar-stays-open.md");
  await page.click("#new-doc");
  await page.waitForFunction(
    () => document.querySelector("#path").textContent === "toolbar-stays-open.md",
  );
  assert.equal(await page.locator("#format-tools").isVisible(), true);
  await page.click("#format");
  await page.locator("#format-tools").waitFor({ state: "hidden" });
  console.log(
    "PASS toolbar stays expanded through editing, resize, mode/file changes; explicit collapse works",
  );
  await page.goto(`${fixture.url}/?doc=${initial.document.id}&theme=dark`);
  await page.waitForSelector(".vditor-ir h1");
  await selectKeyboard();
  const contrast = await page
    .locator(".vditor-ir td")
    .first()
    .evaluate((cell) => {
      const luminance = (color) => {
        const rgb = color
          .match(/\d+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(cell).color);
      const background = luminance(getComputedStyle(cell.closest("tr")).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  assert(contrast >= 4.5, `dark table contrast: ${contrast}`);
  await page.screenshot({ path: join(artifacts, "13-selection-dark.png") });
  assert.deepEqual(errors, []);
  console.log("PASS save retry, dark selection UI and no runtime errors");
} finally {
  await browser.close();
  await fixture.close();
}
