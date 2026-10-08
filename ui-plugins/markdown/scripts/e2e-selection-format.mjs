// 选区工具条必须修改原选中文字，并保留正常保存、撤销和键盘操作。
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
await mkdir(artifacts, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = "# Writing\n\nSelect these words.\n\nLeave this paragraph alone.\n";
  let currentPath = "";
  const select = async () => {
    await page.locator(".vditor-ir p").filter({ hasText: "Select these words." }).click();
    await page.keyboard.press("ControlOrMeta+ArrowLeft");
    await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
    await page.locator("#selection-actions").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => getSelection().toString()), "Select these words.");
  };
  const saved = async (expected) => {
    // Vditor 的 input 回调有防抖；不能把旧的 Saved 状态当作本次编辑已落盘。
    const deadline = Date.now() + 8000;
    while (!(await readFile(join(fixture.workspace, currentPath), "utf8")).includes(expected)) {
      assert(Date.now() < deadline, `save timed out: ${expected}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await page.waitForFunction((value) => {
      const state = window.__mdDebug.getState();
      return (
        !state.dirty &&
        document.querySelector("#status").dataset.phase === "saved" &&
        window.__mdDebug.getValue().includes(value)
      );
    }, expected);
  };
  for (const [type, markdown] of [
    ["bold", "**Select these words.**"],
    ["italic", "*Select these words.*"],
    ["strike", "~~Select these words.~~"],
    ["inline-code", "`Select these words.`"],
    ["link", "[Select these words.]"],
  ]) {
    const path = `docs/${type}.md`;
    currentPath = path;
    const doc = await fixture.call("new_document", { path, content: source });
    await page.goto(`${fixture.url}/?doc=${doc.document.id}`);
    await page.waitForSelector(".vditor-ir h1");
    await select();
    const button = page.locator(`[data-selection-format="${type}"]`);
    if (type === "italic") {
      await button.focus();
      await page.keyboard.press("Enter");
    } else await button.click();
    await saved(markdown);
    const disk = await readFile(join(fixture.workspace, path), "utf8");
    assert(disk.includes(markdown), disk);
    assert(disk.includes("\n\nLeave this paragraph alone.\n"), disk);
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction(() =>
      window.__mdDebug.getValue().includes("\n\nSelect these words.\n"),
    );
    console.log(`PASS ${type}: exact selection, autosave and undo`);
  }
  await select();
  await page.locator('[data-selection-format="bold"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.selectionFormat), "italic");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.id), "reference");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__contexts.length === 1);
  assert.equal(
    await page.evaluate(() => window.__contexts[0].structuredContent.selection),
    "Select these words.",
  );
  await page.click("#source");
  const line = page
    .locator('.vditor-sv span[data-type="text"]')
    .filter({ hasText: /^\s*Select these words\.\s*$/ })
    .first();
  await line.click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.keyboard.press("ControlOrMeta+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
  await page.locator('[data-selection-format="bold"]').click();
  await saved("**Select these words.**");
  await page.click("#source");
  await page.locator(".vditor-ir strong").waitFor();
  await page.screenshot({ path: join(artifacts, "18-selection-format-result.png") });
  assert.deepEqual(errors, []);
  console.log("PASS keyboard navigation, exact chat context and source-mode formatting");
} finally {
  await browser.close();
  await fixture.close();
}
