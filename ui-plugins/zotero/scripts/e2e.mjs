import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFakeZotero } from "../test/fake-zotero.mjs";
import { startHarness } from "./harness.mjs";

/**
 * 端到端：真实打包的 server 与面板（ZCode 的 CSP），连接模拟的 Zotero 本地 API。
 * 脚本既扮演用户（点击、选择文字）也扮演 Agent（调用工具并把结果推给页面）。
 */
const artifacts = resolve(process.env.ZOTERO_E2E_ARTIFACTS || join(tmpdir(), "zotero-e2e"));
await mkdir(artifacts, { recursive: true });
const fake = await startFakeZotero({ authorize: "always" });
const workspace = await mkdtemp(join(tmpdir(), "zotero-e2e-ws-"));
const harness = await startHarness({ workspace, env: { ZOTERO_URL: fake.url, ZCODE_PLUGIN_DATA: join(workspace, ".data") } });
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`) });
const step = (name) => process.stdout.write(`• ${name}\n`);

try {
  // ---------------------------------------------------------------- 库视图
  step("library lists items");
  let { outer, frame } = await harness.open("?theme=light&locale=en-US");
  const rows = frame.locator(".item-row");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3);
  assert.match(await frame.locator(".bar").first().innerText(), /My Library[\s\S]*3 items/);
  await frame.locator(".item-row", { hasText: "Second-Class Values Revisited" }).locator(".pdf-chip").waitFor();
  await shot(outer, "01-library");

  step("collection picker filters");
  await frame.locator(".scope-btn").click();
  await frame.locator(".twisty[aria-label='PL']").click();
  await frame.locator(".menu-pick", { hasText: "Type Systems" }).click();
  await frame.locator(".scope-btn", { hasText: "Type Systems" }).waitFor();
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 1);
  await frame.locator(".scope-btn").click();
  await frame.locator(".menu-pick", { hasText: "All items" }).click();
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 3);

  step("search");
  await frame.locator(".search input[type=search]").fill("pierce");
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 1);
  assert.match(await rows.first().innerText(), /Types and Programming Languages/);
  await frame.locator(".search input[type=search]").fill("region inference");
  await frame.locator(".empty", { hasText: "Nothing matches" }).waitFor();
  await frame.locator(".toggle input").check();
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 1);
  await frame.locator(".toggle input").uncheck();
  await frame.locator(".search input[type=search]").fill("");
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 3);

  step("select items, add them to the chat, ask about them");
  await rows.nth(0).locator(".check").click();
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await frame.locator(".selection-row .count", { hasText: "3 selected" }).waitFor();
  await rows.nth(1).locator(".check").click();
  await frame.locator(".selection-row .count", { hasText: "2 selected" }).waitFor();
  await frame.locator(".selection-row button", { hasText: "Add to chat" }).click();
  await frame.locator(".toast", { hasText: "Added 2 items" }).waitFor();
  const context = await outer.evaluate(() => window.__context.at(-1));
  assert.match(context.content[0].text, /The user selected 2 Zotero item\(s\) in the Zotero panel:/);
  assert.equal(context.structuredContent.zotero.selection.length, 2);
  await frame.locator(".selection-row button", { hasText: "Ask" }).click();
  await frame.locator(".selection-bar textarea").fill("Compare these two.");
  await shot(outer, "02-ask-items");
  await frame.locator(".selection-bar textarea").press("Enter");
  await outer.waitForFunction(() => window.__messages.length === 1);
  const message = await outer.evaluate(() => window.__messages[0]);
  assert.match(message, /^Compare these two\.\n\nZotero items:\n- \[[A-Z0-9]{8}\] /);
  await frame.locator(".selection-bar").waitFor({ state: "detached" });

  // ---------------------------------------------------------------- 条目
  step("item details with notes and annotations");
  await frame.locator(".item-main", { hasText: "Second-Class Values Revisited" }).click();
  await frame.locator(".detail-title", { hasText: "Second-Class Values Revisited" }).waitFor();
  await frame.locator(".annotation .comment", { hasText: "Key contribution" }).waitFor();
  assert.match(await frame.locator(".note-body").innerText(), /Reading note: compare with region inference/);
  assert.match(await frame.locator(".detail").innerText(), /Journal of Stack Studies · 2022/);
  await frame.locator("button[aria-label='Show in Zotero']").click();
  await outer.waitForFunction(() => window.__links.some((link) => link === "zotero://select/library/items/PAPERAAA"));
  await shot(outer, "03-item");

  step("reader renders pages, text layer and the user's annotation");
  await frame.locator("button", { hasText: "Open PDF" }).click();
  await frame.locator(".page canvas:not(.pending)").first().waitFor({ timeout: 30_000 });
  await frame.waitForFunction(() => document.querySelectorAll(".page").length === 3);
  await frame.locator(".mark.highlight").first().waitFor();
  await frame.waitForFunction(() => document.querySelector(".page[data-page='1'] .textLayer span"));
  const textLayer = await frame.locator(".page[data-page='1'] .textLayer").innerText();
  assert.match(textLayer, /pop the stack/);
  assert.match(await frame.locator(".pager").innerText(), /\/ 3/);
  await frame.locator(".mark.highlight").first().click({ force: true });
  await frame.locator(".popover .comment", { hasText: "Key contribution" }).waitFor();
  await frame.locator(".popover button[aria-label='Close']").click();

  step("select text and quote it into the chat");
  await frame.evaluate(() => {
    const spans = [...document.querySelectorAll(".page[data-page='1'] .textLayer span")];
    const span = spans.find((element) => element.textContent?.includes("type system"));
    const range = document.createRange();
    range.selectNodeContents(span.firstChild ?? span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await frame.locator(".float-tools button", { hasText: "Quote in chat" }).click();
  await frame.locator(".toast", { hasText: "Added the passage" }).waitFor();
  const quote = await outer.evaluate(() => window.__context.at(-1));
  assert.match(quote.content[0].text, /> Abstract\. We design a type system that tracks storage modes\.\n\n— “Second-Class Values Revisited”, page 2 \(printed 1\) \(Zotero item PAPERAAA, PDF PDFATTAA\)/);
  assert.equal(quote.structuredContent.zotero.page, 2);

  // ---------------------------------------------------------------- Agent
  step("agent highlight opens the reader at the passage");
  await harness.agent(outer, "highlight", { key: "PAPERAAA", quote: "Execution time improves between 10% and 25%", comment: "Main result" });
  await frame.locator(".mark.agent.focused").first().waitFor();
  await frame.waitForTimeout(400);
  await shot(outer, "04-agent-highlight");
  await frame.locator(".mark.agent").first().click({ force: true });
  await frame.locator(".popover .comment", { hasText: "Main result" }).waitFor();
  await frame.locator(".popover button", { hasText: "Save to Zotero" }).click();
  await frame.locator(".popover", { hasText: "Saved in Zotero" }).waitFor();
  const saved = [...fake.state.items.values()].filter((item) => item.data.itemType === "annotation" && item.data.annotationComment === "Main result");
  assert.equal(saved.length, 1);
  // 保存后它也作为 Zotero 注释显示（新的 .mark.highlight）。
  await frame.waitForFunction(() => document.querySelectorAll(".mark.highlight").length >= 2);

  step("sidebar lists annotations and agent highlights");
  await frame.locator("button[aria-label='Annotations']").click();
  await frame.locator(".sidebar .annotation", { hasText: "Main result" }).waitFor();
  // 已保存的 Agent 高亮显示为 Zotero 注释，不重复列出。
  assert.equal(await frame.locator(".sidebar .annotation").count(), 2);
  assert.equal(await frame.locator(".sidebar .annotation.agent").count(), 0);
  await shot(outer, "05-sidebar");
  await frame.locator(".sidebar .annotation", { hasText: "Key contribution" }).click();
  await frame.locator("button[aria-label='Annotations']").click();

  step("remove an agent highlight from the popover");
  await harness.agent(outer, "highlight", { key: "PAPERAAA", quote: "reduces GC pressure" });
  await frame.locator(".mark.agent").first().waitFor();
  await frame.locator(".mark.agent").first().click({ force: true });
  await frame.locator(".popover button", { hasText: "Remove" }).click();
  await frame.waitForFunction(() => document.querySelectorAll(".mark.agent").length === 0);

  step("agent shows a list of items; back returns");
  await harness.agent(outer, "show_items", { keys: ["TAPLBKAA", "PREPRAAA"], title: "Background reading" });
  await frame.locator(".bar-title", { hasText: "Background reading" }).waitFor();
  await frame.waitForFunction(() => document.querySelectorAll(".item-row").length === 2);
  await frame.locator("button[aria-label='Back']").click();
  await frame.locator(".pager").waitFor();

  step("panel state survives a reload (widget state)");
  // 宿主异步保存 widget state；等返回后的状态存好再重新加载。
  await outer.waitForFunction(() => JSON.parse(sessionStorage.getItem("widgetState") ?? "{}").stack?.at(-1)?.kind === "reader");
  await outer.reload();
  await outer.waitForFunction(() => window.__initializations === 1);
  frame = outer.frames().find((item) => item !== outer.mainFrame());
  await frame.locator(".pager").waitFor({ timeout: 30_000 });

  step("library changes in Zotero show up in the panel");
  await frame.locator("button[aria-label='Back']").click();
  await frame.locator(".detail-title").waitFor();
  fake.touch("PAPERAAA", { title: "Second-Class Values, Revised in Zotero" });
  await frame.locator(".detail-title", { hasText: "Revised in Zotero" }).waitFor({ timeout: 10_000 });
  fake.touch("PAPERAAA", { title: "Second-Class Values Revisited" });

  step("setup page when Zotero's API is off, and recovery");
  fake.state.apiEnabled = false;
  await frame.locator(".setup h1", { hasText: "Turn on Zotero's local API" }).waitFor({ timeout: 10_000 });
  await shot(outer, "06-api-disabled");
  fake.state.apiEnabled = true;
  // 设置页每隔几秒自动重新检查，不需要点击。
  await frame.locator(".detail-title").waitFor({ timeout: 10_000 });
  await outer.context().close();

  // ---------------------------------------------------------------- 主题、语言、尺寸
  step("dark theme, Chinese, narrow panel");
  ({ outer, frame } = await harness.open("?theme=dark&locale=zh-CN", { width: 380, height: 760 }));
  // 新打开的面板先显示 Agent 最近请求的视图。
  await frame.locator(".bar-title", { hasText: "Background reading" }).waitFor();
  await frame.locator("button[aria-label='返回']").click();
  await frame.locator(".item-row").first().waitFor();
  assert.match(await frame.locator(".scope-btn").innerText(), /我的文库/);
  assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), "dark");
  await shot(outer, "07-dark-zh-narrow");
  await harness.agent(outer, "open_item", { key: "PAPERAAA", page: 2 });
  await frame.locator(".page canvas:not(.pending)").first().waitFor({ timeout: 30_000 });
  await frame.waitForTimeout(500);
  await shot(outer, "08-dark-reader-narrow");
  const overflow = await frame.evaluate(() => document.querySelector(".bar").scrollWidth - document.querySelector(".bar").clientWidth);
  assert.ok(overflow <= 1, `toolbar overflows by ${overflow}px at 380px`);
  await outer.context().close();

  step("inline card in the conversation");
  ({ outer, frame } = await harness.open("?theme=light&mode=inline", { width: 560, height: 120 }));
  await frame.locator(".inline-card .sub", { hasText: "Connected" }).waitFor();
  await frame.locator(".inline-card button", { hasText: "Open" }).waitFor();
  await shot(outer, "09-inline");
  await outer.context().close();

  step("no page errors or CSP violations");
  assert.deepEqual(harness.errors, []);
  process.stdout.write(`E2E passed. Screenshots: ${artifacts}\n`);
} catch (error) {
  for (const context of harness.contexts()) for (const page of context.pages()) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => undefined);
  process.stderr.write(`${harness.stderr.join("").slice(-3000)}\n`);
  process.stderr.write(`page errors: ${JSON.stringify(harness.errors)}\n`);
  throw error;
} finally {
  await harness.close();
  await fake.close();
}
