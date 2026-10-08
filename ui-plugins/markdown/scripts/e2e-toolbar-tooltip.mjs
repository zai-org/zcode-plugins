// 首尾按钮与换行按钮的真实 hover/focus 边界，避免只校验 z-index 而漏掉裁剪。
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";
const fixture = await startFixture();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
await mkdir(artifacts, { recursive: true });
try {
  const initial = await fixture.call("new_document", {
    path: "docs/tooltip.md",
    content:
      "# 工具提示\n\n鼠标悬停或键盘聚焦，提示都应完整显示。\n\n" + "正文内容。\n\n".repeat(30),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["light", "dark"]) {
    await page.goto(`${fixture.url}/?doc=${initial.document.id}&theme=${theme}`);
    await page.waitForSelector(".vditor-ir h1");
    await page.click("#format");
    const tip = page.locator("#format-tooltip");
    for (const width of [320, 360, 520, 760, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 280 : 540 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.mouse.move(width - 20, 200);
      console.log(`Checking tooltips ${theme} ${width}px`);
      for (const button of await page
        .locator(".vditor-toolbar__item > button[aria-label]:visible")
        .all()) {
        await button.hover();
        await tip.waitFor({ state: "visible" });
        assert.equal(await tip.textContent(), await button.getAttribute("aria-label"));
        assert(
          await tip.evaluate((el) => {
            const b = el.getBoundingClientRect();
            const root = document.body.getBoundingClientRect();
            return (
              b.left >= 8 && b.right <= root.right - 8 && b.top >= 8 && b.bottom <= innerHeight - 8
            );
          }),
          `tooltip must stay inside ${width}px ${theme} viewport`,
        );
        assert.equal(
          await button.evaluate((el) => getComputedStyle(el, "::after").display),
          "none",
        );
      }
      await page.locator('[data-type="undo"]').hover();
      await page.screenshot({ path: join(artifacts, `23-tooltip-${theme}-${width}.png`) });
    }
    await page.mouse.move(700, 300);
    await tip.waitFor({ state: "hidden" });
    await page.locator("#format").focus();
    await page.keyboard.press("Tab"); // 大纲
    await page.keyboard.press("Tab"); // 撤销
    await tip.waitFor({ state: "visible" });
    assert.match(await tip.textContent(), /撤销/);
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "hidden" });
    await page.locator('[data-type="bold"]').hover();
    await tip.waitFor({ state: "visible" });
    await page.setViewportSize({ width: 500, height: 400 });
    await tip.waitFor({ state: "hidden" });
    await page.locator('[data-type="undo"]').hover();
    await page.click("#format");
    await tip.waitFor({ state: "hidden" });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS every toolbar tooltip at 320–1280px, light/dark, keyboard focus, Escape, resize and collapse",
  );
} finally {
  await browser.close();
  await fixture.close();
}
