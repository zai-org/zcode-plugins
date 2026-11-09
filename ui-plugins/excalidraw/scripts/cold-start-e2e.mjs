import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const artifacts = process.env.EXCALIDRAW_E2E_ARTIFACTS || join(tmpdir(), "excalidraw-e2e");
await mkdir(artifacts, { recursive: true });
const launchOptions = process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : { channel: "chrome" };
let browser;
let page;
const checks = [];
const errors = [];
const scene = async (id) =>
  JSON.parse(
    (await fixture.client.readResource({ uri: `excalidraw://document/${id}` })).contents[0].text,
  );
const documentReads = () =>
  fixture.resourceReads.filter((uri) => uri.startsWith("excalidraw://document/"));
async function boot(state) {
  await browser?.close();
  await fixture.restart();
  fixture.setBootstrap(state);
  browser = await chromium.launch({ ...launchOptions, timeout: 15000 });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(fixture.url);
  await page.waitForFunction(() => window.__excalidrawPanel);
}
async function opened(id) {
  await page.waitForFunction((id) => {
    const s = window.__excalidrawPanel?.state();
    return s?.document?.id === id && !s.dirty && !s.saving && !s.error;
  }, id);
  await page.evaluate(() => window.__excalidrawPanel.flush());
}

try {
  const initial = await fixture.call("read_scene", { id: "demo" });
  await boot({ toolOutput: initial });
  await opened("demo");
  // 真实指针编辑并等待保存 ACK，随后彻底关闭浏览器和 MCP，不能靠热页面或 widgetState 过关。
  const point = await page.evaluate(() => {
    const api = window.__excalidrawPanel.api;
    const el = api.getSceneElements().find((e) => e.id === "box");
    const s = api.getAppState();
    return {
      x: (el.x + el.width / 2 + s.scrollX) * s.zoom.value + s.offsetLeft,
      y: (el.y + el.height / 2 + s.scrollY) * s.zoom.value + s.offsetTop,
      originalX: el.x,
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (x) => window.__excalidrawPanel.api.getSceneElements().find((e) => e.id === "box").x !== x,
    point.originalX,
  );
  await opened("demo");
  let before = await scene("demo");
  const args = { id: "demo", expectedRevision: before.revision, path: "cold.excalidraw" };
  const exported = await fixture.call("export_diagram", args);
  const legacy = { path: exported.path, revision: exported.revision };
  const unchanged = async () => assert.deepEqual(await scene("demo"), before);

  for (const [name, path] of [
    ["legacy-relative", args.path],
    ["legacy-absolute", exported.path],
  ]) {
    const start = documentReads().length;
    await boot({ toolInput: { ...args, path }, toolOutput: legacy });
    await opened("demo");
    assert.equal(
      await page.evaluate(
        () => window.__excalidrawPanel.api.getSceneElements().find((e) => e.id === "box").x,
      ),
      before.scene.elements.find((e) => e.id === "box").x,
    );
    assert.equal(documentReads().length - start, 1);
    await unchanged();
    checks.push(name);
  }
  // 新结果本身就足以恢复，不依赖可能已变更的输入。
  assert.equal(exported.document?.id, "demo");
  await boot({ toolInput: { id: "unrelated" }, toolOutput: exported });
  await opened("demo");
  await unchanged();
  checks.push("new-export-reference");
  const reads = documentReads().length;
  await page.evaluate(async (output) => {
    for (let i = 0; i < 20; i++) window.__publish(output);
    await new Promise(requestAnimationFrame);
  }, exported);
  assert.equal(documentReads().length, reads);
  checks.push("duplicate-notifications");
  await page.screenshot({ path: join(artifacts, "cold-restored.png") });

  // 导出之后用户继续编辑，冷启动必须读取 SQLite 新版本，不能恢复导出时的旧内容。
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("ControlOrMeta+a");
  const previousX = before.scene.elements.find((e) => e.id === "box").x;
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (x) => window.__excalidrawPanel.api.getSceneElements().find((e) => e.id === "box").x !== x,
    previousX,
  );
  await opened("demo");
  before = await scene("demo");
  assert.ok(before.revision > exported.revision);
  await boot({ toolInput: args, toolOutput: legacy });
  await opened("demo");
  assert.equal(
    await page.evaluate(() => window.__excalidrawPanel.state().document.revision),
    before.revision,
  );
  await unchanged();
  checks.push("manual-edit-after-export");

  const other = await fixture.call("create_diagram", {
    id: "other",
    title: "另一张图",
    elements: [],
  });
  const beforeInputReads = documentReads().length;
  await page.evaluate(
    async ({ output, input }) => {
      window.__publish(output, input);
      await new Promise(requestAnimationFrame);
    },
    { output: legacy, input: { ...args, id: "other" } },
  );
  assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document.id), "demo");
  assert.equal(documentReads().length, beforeInputReads);
  checks.push("new-input-does-not-retarget-legacy-result");
  // 相同工具结果下的用户选择通过内存快照恢复，不能被冷启动兼容分支覆盖。
  for (const [name, output] of [
    ["new", exported],
    ["legacy", legacy],
  ]) {
    await boot({
      toolInput: args,
      toolOutput: output,
      widgetState: { documentId: "other", lastToolRef: `demo:${exported.revision}` },
    });
    await opened("other");
    await page.evaluate((output) => window.__publish(output), output);
    assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document.id), "other");
    await page.evaluate(
      (output) => window.__publish(output),
      await fixture.call("read_scene", { id: "demo" }),
    );
    await opened("demo");
    checks.push(`${name}-saved-selection-and-new-reference`);
  }

  const svg = await fixture.call("save_image", {
    ...args,
    expectedRevision: before.revision,
    path: "cold.svg",
    data: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    format: "svg",
  });
  assert.equal(svg.document.id, "demo");
  assert.equal(svg.document.revision, before.revision);
  checks.push("image-export-reference");

  for (const [name, state] of [
    ["input-only", { toolInput: args }],
    ["error", { toolInput: args, toolOutput: { error: { code: "revision_conflict" } } }],
    [
      "revision-mismatch",
      { toolInput: { ...args, expectedRevision: args.expectedRevision + 1 }, toolOutput: legacy },
    ],
    ["path-mismatch", { toolInput: { ...args, path: "other.excalidraw" }, toolOutput: legacy }],
    ["cancelled", { toolInput: args, toolOutput: legacy, toolCancelled: { reason: "cancelled" } }],
  ]) {
    const start = documentReads().length;
    await boot(state);
    // list_diagrams 完成说明初始 refresh 已执行；无需 sleep 猜测加载进度。
    await page.locator('.document-list button[title="另一张图"]').waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => window.__excalidrawPanel.state().document), null);
    assert.equal(documentReads().length, start);
    await unchanged();
    checks.push(name);
  }
  // 已保存引用指向不存在的文档时可见失败，不创建空文档替代，也不影响其他数据。
  const count = (await fixture.call("list_diagrams")).documents.length;
  await boot({ toolOutput: { document: { ...other.document, id: "missing" } } });
  await page.waitForFunction(() => document.body.innerText.includes("Diagram not found"));
  assert.equal((await fixture.call("list_diagrams")).documents.length, count);
  await unchanged();
  checks.push("missing-document-no-creation");
  assert.equal(
    JSON.parse(await readFile(join(fixture.workspace, "cold.excalidraw"), "utf8")).elements.length,
    before.scene.elements.length,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, "cold-start-results.json"),
    JSON.stringify({ checks, errors, revision: before.revision }, null, 2),
  );
  console.log(
    `PASS: ${checks.length} cold-start checks; fresh browser + MCP processes, persisted SQLite. Artifacts: ${artifacts}`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "cold-failure.png") });
  throw error;
} finally {
  await browser?.close();
  await fixture.close();
}
