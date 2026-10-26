import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const artifacts = resolve(process.env.EXCALIDRAW_E2E_ARTIFACTS || join(tmpdir(), "excalidraw-e2e"));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const field = (id, key) =>
  page.evaluate(
    ([id, key]) =>
      window.__excalidrawPanel.api.getSceneElements().find((el) => el.id === id)?.[key],
    [id, key],
  );
const saved = async () => {
  await page.waitForFunction(() => {
    const state = window.__excalidrawPanel?.state();
    return state?.document && !state.dirty && !state.saving && !state.error;
  });
  await page.evaluate(() => window.__excalidrawPanel.flush());
};
const center = (id) =>
  page.evaluate((id) => {
    const api = window.__excalidrawPanel.api;
    const el = api.getSceneElements().find((el) => el.id === id);
    const state = api.getAppState();
    return {
      x: (el.x + el.width / 2 + state.scrollX) * state.zoom.value + state.offsetLeft,
      y: (el.y + el.height / 2 + state.scrollY) * state.zoom.value + state.offsetTop,
    };
  }, id);
const key = async (value) => {
  await page.locator(".excalidraw").focus();
  await page.keyboard.press(value);
  await saved();
};
try {
  await page.goto(fixture.url);
  await saved();
  await page.waitForFunction(() => window.__latestContext?.structuredContent.documentId === "demo");
  assert.equal(await page.getByRole("tab").count(), 1);
  assert.equal(
    await page
      .getByRole("tab", { name: "应用启动流程", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.ok(
    !(await fixture.client.listTools()).tools.some(
      (tool) => tool.name === "restore_last_agent_edit",
    ),
  );
  // 真正的指针拖动产生本地历史，而不是测试代码替代编辑器实现。
  const originalX = await field("box", "x");
  const point = await center("box");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (x) => window.__excalidrawPanel.api.getSceneElements().find((el) => el.id === "box").x !== x,
    originalX,
  );
  await saved();
  const movedX = await field("box", "x");
  const view = await page.evaluate(() => {
    const { zoom, scrollX, scrollY } = window.__excalidrawPanel.api.getAppState();
    return { zoom, scrollX, scrollY };
  });
  const before = await fixture.call("read_scene", { id: "demo" });
  const changed = await fixture.call("apply_operations", {
    id: "demo",
    expectedRevision: before.document.revision,
    operationId: "tool-color",
    operations: [{ type: "update", id: "box", changes: { backgroundColor: "#ffc9c9" } }],
  });
  await page.evaluate((result) => window.__publish(result), changed);
  await page.waitForFunction(
    () =>
      window.__excalidrawPanel.api.getSceneElements().find((el) => el.id === "box")
        .backgroundColor === "#ffc9c9",
  );
  await saved();
  assert.deepEqual(
    await page.evaluate(() => {
      const { zoom, scrollX, scrollY } = window.__excalidrawPanel.api.getAppState();
      return { zoom, scrollX, scrollY };
    }),
    view,
  );
  // 重复通知不形成额外历史；连续撤销、重做跨越两种编辑来源。
  await page.evaluate((result) => window.__publish(result), changed);
  const thirdX = await field("third", "x");
  const third = await center("third");
  await page.mouse.move(third.x, third.y);
  await page.mouse.down();
  await page.mouse.move(third.x + 30, third.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    (x) => window.__excalidrawPanel.api.getSceneElements().find((el) => el.id === "third").x !== x,
    thirdX,
  );
  await saved();
  const movedThirdX = await field("third", "x");
  await key("ControlOrMeta+z");
  assert.equal(await field("third", "x"), thirdX);
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  await key("ControlOrMeta+z");
  assert.equal(await field("box", "backgroundColor"), "#a5d8ff");
  assert.equal(await field("box", "x"), movedX);
  await key("ControlOrMeta+z");
  assert.equal(await field("box", "x"), originalX);
  await key("ControlOrMeta+Shift+z");
  assert.equal(await field("box", "x"), movedX);
  await key("ControlOrMeta+Shift+z");
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  await key("ControlOrMeta+Shift+z");
  assert.equal(await field("third", "x"), movedThirdX);
  assert.equal(
    (await fixture.call("read_scene", { id: "demo" })).elements.find((el) => el.id === "box")
      .backgroundColor,
    "#ffc9c9",
  );
  // 右键未选中元素时引用新命中选区；点击不会修改画板或自动发送消息。
  const other = await center("second");
  await page.mouse.click(other.x, other.y, { button: "right" });
  await page.locator("#reference-context-menu").click();
  await page.waitForFunction(() => window.__contexts.length === 1);
  assert.ok(
    (await page.evaluate(() => window.__contexts[0].structuredContent.elementIds)).includes(
      "second",
    ),
  );
  await page.getByRole("button", { name: "关闭提示" }).click();
  // 原生右键动作依然存在；Tab 可到达新增项，底部菜单不会溢出。
  await page.mouse.click(other.x, other.y, { button: "right" });
  assert.ok(await page.locator('[data-testid="deleteSelectedElements"]').isVisible());
  await page.keyboard.press("Escape");
  // 多选保留上下文；原生菜单的 Tab 焦点循环包含新增项。
  await page.mouse.click(other.x, other.y);
  const thirdPoint = await center("third");
  await page.keyboard.down("Shift");
  await page.mouse.click(thirdPoint.x, thirdPoint.y);
  await page.keyboard.up("Shift");
  await page.mouse.click(other.x, other.y, { button: "right" });
  await page.locator("#reference-context-menu").waitFor();
  await page.locator(".context-menu").locator("..").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "reference-context-menu");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__contexts.length === 2);
  const referenced = await page.evaluate(() => window.__contexts[1].structuredContent.elementIds);
  assert.ok(referenced.includes("second") && referenced.includes("third"));
  await page.getByRole("button", { name: "关闭提示" }).click();
  await key("Escape");
  // 文档菜单、导出对话框和覆盖错误。
  await page.locator("#open-export").click();
  await page.locator("#export-path").fill("diagram.excalidraw");
  await page.locator("#export-button").click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  assert.ok(
    JSON.parse(await readFile(join(fixture.workspace, "diagram.excalidraw"), "utf8")).elements
      .length > 0,
  );
  await page.locator("#open-export").click();
  await page.locator("#export-path").fill("diagram.excalidraw");
  await page.locator("#export-button").click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /同名文件已存在/);
  assert.ok(await page.locator("dialog[open]").isVisible());
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "open-export");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-export");
  for (const format of ["png", "svg"]) {
    await page.locator("#open-export").click();
    await page.locator("#export-format").selectOption(format);
    await page.locator("#export-path").fill(`diagram.${format}`);
    await page.locator("#export-button").click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    assert.ok((await readFile(join(fixture.workspace, `diagram.${format}`))).length > 100);
  }
  await page.getByRole("button", { name: "关闭提示" }).click();
  await key("Escape");
  await page.mouse.click(1000, 660);
  await page.waitForFunction(
    () =>
      !Object.values(window.__excalidrawPanel.api.getAppState().selectedElementIds).some(Boolean),
  );
  await page.screenshot({ path: join(artifacts, "wide-light.png") });
  await page.evaluate(() => {
    window.__pluginClient.theme = "dark";
    window.dispatchEvent(new Event("plugin:change"));
  });
  await page.locator(".diagram-app.dark").waitFor();
  await page.screenshot({ path: join(artifacts, "wide-dark.png") });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.locator(".document-menu summary").click();
  await page.screenshot({ path: join(artifacts, "narrow-menu.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press("Escape");
  await page.mouse.click(370, 590, { button: "right" });
  await page.locator("#reference-context-menu").waitFor();
  const bounds = await page.locator(".context-menu").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  const popover = await page.locator(".context-menu").locator("..").boundingBox();
  assert.ok(popover.y >= 40 && popover.y + popover.height <= 700);
  await page.screenshot({ path: join(artifacts, "narrow-context.png") });
  assert.match(await page.locator("#reference-context-menu").textContent(), /引用整图/);
  await page.locator("#reference-context-menu").click();
  await page.waitForFunction(() => window.__contexts.length === 3);
  assert.ok(
    (await page.evaluate(() => window.__contexts[2].structuredContent.elementIds)).includes("box"),
  );
  // 创建/切换文档会重置历史，不能把另一张画板撤销进来。
  await page.locator(".document-menu summary").click();
  await page.locator("#new-document").click();
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id !== "demo");
  await saved();
  const blankId = await page.evaluate(() => window.__excalidrawPanel.state().document.id);
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.api.getAppState().zoom.value), 1);
  await page.waitForFunction(
    (id) => window.__latestContext?.structuredContent.documentId === id,
    blankId,
  );
  assert.equal(
    await page.evaluate(() => window.__latestContext.structuredContent.elementIds),
    undefined,
  );
  // 双击当前标签重命名；取消、空名称及保存都通过真实表单交互。
  await page.getByRole("tab", { name: "未命名画板", exact: true }).dblclick();
  await page.locator("#rename-input").fill("Discard this name");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("tab", { name: "未命名画板", exact: true }).count(), 1);
  await page.getByRole("tab", { name: "未命名画板", exact: true }).dblclick();
  await page.locator("#rename-input").fill("   ");
  assert.equal(await page.locator("#rename-button").isDisabled(), true);
  await page.locator("#rename-input").fill("我的新画板");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await saved();
  assert.equal((await fixture.call("read_scene", { id: blankId })).document.title, "我的新画板");
  await page.waitForFunction(
    () => window.__latestContext?.structuredContent.title === "我的新画板",
  );
  await key("ControlOrMeta+z");
  assert.equal(
    await page.evaluate(() => window.__excalidrawPanel.api.getSceneElements().length),
    0,
  );
  await page.getByRole("tab", { name: "应用启动流程", exact: true }).click();
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id === "demo");
  await saved();
  await page.waitForFunction(() => window.__latestContext?.structuredContent.documentId === "demo");
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  await page.getByRole("tab", { name: "我的新画板", exact: true }).click();
  await page.waitForFunction((id) => window.__excalidrawPanel.state().document?.id === id, blankId);
  await saved();
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.api.getAppState().zoom.value), 1);
  await page.getByRole("tab", { name: "我的新画板", exact: true }).dblclick();
  await page.locator("#rename-input").fill("重命名后的画板");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await saved();
  // 快捷新建在菜单外可直接使用；原有画板可通过 tab 返回。
  await page.locator("#new-document-shortcut").click();
  await page.waitForFunction((id) => window.__excalidrawPanel.state().document?.id !== id, blankId);
  await saved();
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.api.getAppState().zoom.value), 1);
  const widgetState = await page.evaluate(() => window.__pluginClient.widgetState);
  fixture.setBootstrap({ toolOutput: changed, widgetState });
  await page.reload();
  await saved();
  assert.equal(
    await page.evaluate(() => window.__excalidrawPanel.state().document.id),
    widgetState.documentId,
  );
  await page.getByRole("tab", { name: "重命名后的画板", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // A regular vertical wheel scrolls overflowing tabs without moving the canvas;
  // native horizontal trackpad gestures still work.
  const tabs = page.getByRole("tablist");
  const canvasView = await page.evaluate(() => {
    const { scrollX, scrollY, zoom } = window.__excalidrawPanel.api.getAppState();
    return { scrollX, scrollY, zoom };
  });
  await tabs.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await tabs.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => document.querySelector(".document-tabs").scrollLeft > 0);
  await page.mouse.wheel(0, -1200);
  await page.waitForFunction(() => document.querySelector(".document-tabs").scrollLeft === 0);
  await page.mouse.wheel(120, 0);
  await page.waitForFunction(() => document.querySelector(".document-tabs").scrollLeft > 0);
  assert.deepEqual(
    await page.evaluate(() => {
      const { scrollX, scrollY, zoom } = window.__excalidrawPanel.api.getAppState();
      return { scrollX, scrollY, zoom };
    }),
    canvasView,
  );
  await page.getByRole("tab", { name: "未命名画板", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, "narrow-tabs.png") });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole("tab", { name: "应用启动流程", exact: true }).click();
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id === "demo");
  await saved();
  await page.screenshot({ path: join(artifacts, "wide-tabs.png") });
  const exportData = await readFile(join(fixture.workspace, "diagram.excalidraw"));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "import.excalidraw", mimeType: "application/json", buffer: exportData });
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id !== "demo");
  await saved();
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  // Closing tabs preserves documents, the active canvas, and the restored tab list.
  const importedId = await page.evaluate(() => window.__excalidrawPanel.state().document.id);
  const diagramIds = (await fixture.call("list_diagrams")).documents.map((doc) => doc.id).sort();
  await page.getByRole("button", { name: "关闭标签 应用启动流程", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("diagram-tab-demo"));
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document.id), importedId);
  await page.waitForFunction(() => !document.getElementById("new-document-shortcut").disabled);
  fixture.setBootstrap({
    toolOutput: changed,
    widgetState: await page.evaluate(() => window.__pluginClient.widgetState),
  });
  await page.reload();
  await saved();
  assert.equal(await page.getByRole("tab", { name: "应用启动流程", exact: true }).count(), 0);
  await page.locator(".document-menu summary").click();
  await page.locator(".document-list button").filter({ hasText: "应用启动流程" }).click();
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id === "demo");
  await saved();
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  await page.getByRole("button", { name: "关闭标签 应用启动流程", exact: true }).click();
  await page.waitForFunction(
    (id) => window.__excalidrawPanel.state().document?.id === id,
    importedId,
  );
  await page.waitForFunction(
    (id) => window.__latestContext?.structuredContent.documentId === id,
    importedId,
  );
  while (await page.locator(".document-tab-close").count()) {
    await page.locator(".document-tab-close").first().click();
    await page.waitForFunction(() => !document.getElementById("new-document-shortcut").disabled);
  }
  await page.waitForFunction(() => window.__latestContext?.structuredContent.documentId === null);
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document), null);
  assert.equal(
    await page.evaluate(() => window.__excalidrawPanel.api.getSceneElements().length),
    0,
  );
  assert.deepEqual(
    (await fixture.call("list_diagrams")).documents.map((doc) => doc.id).sort(),
    diagramIds,
  );
  const closedState = await page.evaluate(() => window.__pluginClient.widgetState);
  assert.equal(closedState.documentId, null);
  assert.deepEqual(closedState.recentDocumentIds, []);
  fixture.setBootstrap({ toolOutput: changed, widgetState: closedState });
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document), null);
  assert.equal(await page.getByRole("tab").count(), 0);
  await page.screenshot({ path: join(artifacts, "closed-tabs.png") });
  await page.locator(".document-menu summary").click();
  await page.locator(".document-list button").filter({ hasText: "应用启动流程" }).click();
  await page.waitForFunction(() => window.__excalidrawPanel.state().document?.id === "demo");
  await saved();
  assert.equal(await field("box", "backgroundColor"), "#ffc9c9");
  assert.deepEqual(errors, []);
  console.log(
    `PASS: mixed undo/redo + persistence, context menu, document switch, all exports, themes and narrow layout. Screenshots: ${artifacts}`,
  );
} catch (error) {
  console.error(error);
  await page.screenshot({ path: join(artifacts, "failure.png") });
  console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
