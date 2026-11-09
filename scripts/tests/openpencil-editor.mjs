import assert from "node:assert/strict";

// 使用真实 UI 和 MCP 往返验证，避免只挂载 SDK 的空壳也通过验收。
export async function checkOpenPencilEditor({ page, frame, client, initial }) {
  const detached = await client.callTool({
    name: "new_design",
    arguments: { path: "save-as.fig", open: false },
  });
  assert.ok(!detached.isError, JSON.stringify(detached));
  assert.equal(
    await frame.evaluate(() => window.__openpencilPanel.documents.current.value.id),
    initial.structuredContent.document.id,
  );
  for (const id of [
    "editor-root",
    "layers-panel",
    "properties-panel",
    "toolbar",
    "properties-tab-code",
    "properties-tab-ai",
  ]) {
    assert.ok(await frame.locator(`[data-test-id="${id}"]`).isVisible(), id);
  }
  assert.ok(await frame.getByText("Assets", { exact: true }).isVisible());
  const selection = await client.callTool({ name: "get_selection", arguments: {} });
  assert.ok(!selection.isError, JSON.stringify(selection));
  const drawn = await frame.evaluate(() => {
    const { editor, state } = window.__openpencilPanel;
    return editor.graph
      .getChildren(state.currentPageId)
      .map(({ id, name, width }) => ({ id, name, width }));
  });
  assert.equal(drawn.length, 1);
  await frame
    .locator('[data-test-id="design-panel-single"]')
    .getByText("120", { exact: true })
    .click();
  const width = frame.getByRole("spinbutton", { name: "Width", exact: true });
  await width.fill("180");
  await width.press("Enter");
  const details = await client.callTool({ name: "get_node", arguments: { id: drawn[0].id } });
  assert.ok(!details.isError, JSON.stringify(details));
  assert.match(JSON.stringify(details), /180/);
  const created = await client.callTool({
    name: "create_shape",
    arguments: { type: "ELLIPSE", x: 250, y: 150, width: 80, height: 80, name: "MCP circle" },
  });
  assert.ok(!created.isError, JSON.stringify(created));
  const circleId = await frame.evaluate(() => {
    const { editor, state } = window.__openpencilPanel;
    return editor.graph.getChildren(state.currentPageId).find((node) => node.name === "MCP circle")
      .id;
  });
  const fill = await client.callTool({
    name: "set_fill",
    arguments: { id: circleId, color: "#3478f6" },
  });
  assert.ok(!fill.isError, JSON.stringify(fill));
  await frame
    .locator('[data-test-id="layers-tree"]')
    .getByText("MCP circle", { exact: true })
    .waitFor();
  await frame.evaluate(() => window.__openpencilPanel.flush());
  await frame.getByTestId("op-menu-add-context").click();
  await page.waitForFunction(() => Boolean(window.modelContext));
  assert.match(
    JSON.stringify(await page.evaluate(() => window.modelContext)),
    new RegExp(initial.structuredContent.document.id),
  );
  await frame.locator('[data-test-id="properties-tab-ai"]').click();
  assert.ok(await frame.getByTestId("op-ask-zcode-input").isVisible());
  await frame.getByTestId("op-ask-zcode-input").fill("Change the selected rectangle to blue");
  await frame.getByRole("button", { name: "Ask ZCode to edit", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.followUp));
  assert.match(
    JSON.stringify(await page.evaluate(() => window.followUp)),
    /Change the selected rectangle to blue/,
  );
  await frame.locator('[data-test-id="properties-tab-design"]').click();
  await frame.evaluate(() =>
    window.__openpencilPanel.documents.load(window.__openpencilPanel.documents.current.value),
  );
  assert.equal(
    await frame.evaluate(
      () =>
        window.__openpencilPanel.editor.graph.getChildren(
          window.__openpencilPanel.state.currentPageId,
        ).length,
    ),
    2,
  );
  const second = await client.callTool({ name: "new_design", arguments: { path: "second.fig" } });
  assert.ok(!second.isError, JSON.stringify(second));
  await frame.waitForFunction(
    (id) => window.__openpencilPanel.documents.current.value?.id === id,
    second.structuredContent.document.id,
  );
  assert.equal(await frame.locator('[data-test-id="tabbar-tab"]').count(), 2);
  const background = await client.callTool({
    name: "set_fill",
    arguments: {
      document_id: initial.structuredContent.document.id,
      id: circleId,
      color: "#6366f1",
    },
  });
  assert.ok(!background.isError, JSON.stringify(background));
  assert.equal(
    await frame.evaluate(
      () =>
        window.__openpencilPanel.editor.graph.getChildren(
          window.__openpencilPanel.state.currentPageId,
        ).length,
    ),
    0,
  );
  await frame.evaluate(() => window.__openpencilPanel.openPath("page.fig"));
  const viewport = await frame.evaluate(() => {
    const { editor, state } = window.__openpencilPanel;
    editor.zoomToFit();
    const nodes = editor.graph.getChildren(state.currentPageId);
    const left = Math.min(...nodes.map((node) => node.x));
    const right = Math.max(...nodes.map((node) => node.x + node.width));
    const canvas = document.querySelector('[data-test-id="canvas-area"]').getBoundingClientRect();
    return { center: ((left + right) / 2) * state.zoom + state.panX, width: canvas.width };
  });
  assert.ok(Math.abs(viewport.center - viewport.width / 2) < 2, JSON.stringify(viewport));
  assert.equal(
    await frame.evaluate(() => window.__openpencilPanel.documents.current.value.id),
    initial.structuredContent.document.id,
  );
  assert.equal(
    await frame.evaluate(
      () =>
        window.__openpencilPanel.editor.graph.getChildren(
          window.__openpencilPanel.state.currentPageId,
        ).length,
    ),
    2,
  );
  await page.screenshot({ path: "/tmp/openpencil-full-ui-dark.png" });
  await page.evaluate(() => window.bridge.setHostContext({ theme: "light", locale: "zh-CN" }));
  await frame.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.screenshot({ path: "/tmp/openpencil-full-ui-light.png" });
  await page.setViewportSize({ width: 500, height: 800 });
  await frame.locator('[data-test-id="mobile-toolbar"]').waitFor({ state: "visible" });
  await page.evaluate(() => {
    window.modelContext = null;
  });
  await frame.getByTestId("op-mobile-add-context").click();
  await page.waitForFunction(() => Boolean(window.modelContext));
  await page.setViewportSize({ width: 1100, height: 800 });
  await frame.locator('[data-test-id="toolbar"]').waitFor({ state: "visible" });
  console.log(
    "PASS complete OpenPencil UI, ZCode context/AI, saved reload, document isolation, theme and mobile layout",
  );
}
