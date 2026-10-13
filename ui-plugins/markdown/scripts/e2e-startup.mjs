// Real MCP resources with controlled network gates: inspect first paint, not just final DOM.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
    path: "docs/startup.md",
    content: "# 首次打开\n\n正文已经排版。\n\n**重点**与列表：\n\n- 第一项\n",
  });
  for (let i = 0; i < 35; i++)
    await writeFile(join(fixture.workspace, `docs/menu-${i}.md`), `# 文件 ${i}\n`);
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Hold the bundle, then Lute, then the content stylesheet independently.
    const blocked = new Map();
    await page.route("**/rpc", async (route) => {
      const uri = route.request().postDataJSON().args?.uri ?? "";
      const phase = uri.includes("bundle-0")
        ? "bundle"
        : uri.includes("lute.min")
          ? "editor"
          : uri.includes("content-theme/")
            ? "style"
            : null;
      if (phase) {
        await new Promise((resolve) => blocked.set(phase, resolve));
        blocked.delete(phase);
      }
      await route.continue();
    });
    await page.goto(`${fixture.url}/?doc=${initial.document.id}&theme=${theme}`);
    for (const phase of ["bundle", "editor", "style"]) {
      // Wait for the blocked request via a bounded promise, without timing-dependent sleeps.
      await page.waitForFunction(() => document.body.dataset.boot === "loading");
      const deadline = Date.now() + 10000;
      while (!blocked.has(phase) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert(blocked.has(phase), `${phase} requested`);
      assert.equal(await page.locator("#boot").isVisible(), true);
      assert.equal(await page.locator("header").isVisible(), false);
      assert.equal(await page.locator("#editor").isVisible(), false);
      assert.equal(await page.locator("#empty").isVisible(), false);
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
      assert.equal(
        await page.locator("body").evaluate((el) => getComputedStyle(el).display),
        "flex",
      );
      await page.screenshot({ path: join(artifacts, `26-startup-${theme}-${phase}.png`) });
      blocked.get(phase)();
    }
    await page.waitForSelector("body:not([data-boot])");
    assert.match(await page.locator(".vditor-ir h1").innerText(), /^(# )?首次打开$/);
    assert(
      await page
        .locator(".vditor-ir h1")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 24),
    );
    assert.equal(await page.locator("#status").innerText(), "所有更改已保存");
    assert.equal(await page.locator("#boot").isVisible(), false);
    await page.unroute("**/rpc");
    for (const [width, height] of [
      [320, 280],
      [520, 720],
      [1000, 800],
    ]) {
      await page.setViewportSize({ width, height });
      await page.click("#switch");
      // Reopening shows cached rows before the async refresh replaces them.
      await page.waitForFunction(() => document.getElementById("docs-feedback").textContent === "");
      await page.locator("#all-list button").last().waitFor({ state: "attached" });
      const before = await page.locator("#doc-filter").boundingBox();
      await page.locator("#all-list button").last().scrollIntoViewIfNeeded();
      assert.deepEqual(await page.locator("#doc-filter").boundingBox(), before);
      const geometry = await page.locator("#docs").evaluate((el) => {
        const box = el.getBoundingClientRect();
        const css = getComputedStyle(el);
        const button = getComputedStyle(document.getElementById("switch"));
        const input = getComputedStyle(document.getElementById("doc-filter"));
        return {
          inside: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
          radius: parseFloat(button.borderRadius),
          padding: [button.paddingLeft, button.paddingRight],
          shadow: css.boxShadow,
          focusOutline: input.outlineWidth,
          overflow: document.body.scrollWidth - innerWidth,
        };
      });
      assert(geometry.inside);
      assert(geometry.radius > 0);
      assert.equal(geometry.padding[0], geometry.padding[1]);
      assert.notEqual(geometry.shadow, "none");
      assert.equal(geometry.focusOutline, "0px");
      assert.equal(geometry.overflow, 0);
      await page.screenshot({ path: join(artifacts, `27-files-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${theme}: delayed bundle/editor/styles, cold restore, menu at 320/520/1000`);
  }
  const page = await browser.newPage();
  // Initial HTML itself has styled layout even while bridge initialization is pending.
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace("ready: async () => {}", "ready: () => new Promise(() => {})"),
    });
  });
  await page.goto(`${fixture.url}/`);
  assert.equal(await page.locator("body").getAttribute("data-boot"), "connecting");
  assert.equal(await page.locator("header").isVisible(), false);
  assert.equal(
    await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  await page.unroute("**/");
  await page.route("**/rpc", async (route) => {
    if (route.request().postDataJSON().args?.uri?.endsWith("assets.json"))
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test resource unavailable" }),
      });
    else await route.continue();
  });
  await page.reload();
  await page.waitForSelector('body[data-boot="error"]');
  assert.match(await page.locator("#boot-message").innerText(), /Test resource unavailable/);
  await page.unroute("**/rpc");
  await page.click("#boot-retry");
  await page.waitForSelector("body:not([data-boot])");
  assert.equal(await page.locator("#empty-title").innerText(), "从一个想法开始");
  assert.equal(await page.locator("#editor").isVisible(), false);
  await page.close();
  console.log("PASS pending bridge, failed bootstrap, retry and empty startup");
} finally {
  await browser.close();
  await fixture.close();
}
