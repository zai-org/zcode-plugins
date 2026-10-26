import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

/**
 * 端到端：真实打包的 server 与面板（ZCode 的 CSP），使用本机安装的 typst。
 * 脚本既扮演用户（滚动、选择文字、点击）也扮演 Agent（改文件、调用工具并把结果推给页面）。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.TYPST_E2E_ARTIFACTS || join(tmpdir(), "typst-e2e"));
await mkdir(artifacts, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "typst-e2e-ws-"));
await cp(join(root, "test/fixtures/paper"), workspace, { recursive: true });
const mainPath = join(workspace, "main.typ");
const original = await readFile(mainPath, "utf8");
const harness = await startHarness({ workspace, env: { ZCODE_PLUGIN_DATA: join(workspace, ".data") } });
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`) });
const step = (name) => process.stdout.write(`• ${name}\n`);
const timings = {};

/** 页面上第 index 页的文字层是否包含 text。 */
const pageHasText = (frame, index, text, timeout = 10_000) =>
  frame.waitForFunction(
    ([page, needle]) => document.querySelector(`.page[data-page="${page}"] .textLayer`)?.textContent?.includes(needle),
    [index, text],
    { timeout },
  );

try {
  const toolchain = await harness.client.callTool({ name: "status", arguments: {} });
  assert.ok(!toolchain.isError, `Typst must be installed for the e2e test: ${toolchain.content[0].text}`);

  // ---------------------------------------------------------------- 预览
  step("the panel previews the main file");
  let { outer, frame } = await harness.open("?theme=light&locale=en-US");
  await frame.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  await pageHasText(frame, 0, "Second-Class Values in Typst");
  assert.match(await frame.locator(".main-picker select").inputValue(), /^main\.typ$/);
  await frame.locator(".pill.ok").waitFor();
  assert.equal(await frame.locator(".pager .muted").innerText(), "/ 2");
  const firstTop = await frame.locator(".page").first().evaluate((element) => element.getBoundingClientRect().top - element.parentElement.parentElement.getBoundingClientRect().top);
  assert.ok(firstTop > 4, `the first page starts below the toolbar gap (${firstTop}px)`);
  await shot(outer, "01-preview");

  step("an edit on disk shows up without flicker, at the same scroll position");
  // 记录页面画布是否在更新中被清空（应始终保留旧画布直到新画布画好）。
  await frame.evaluate(() => {
    window.__blank = 0;
    const holder = document.querySelector('.page[data-page="0"] .canvas-holder');
    new MutationObserver(() => {
      if (!holder.querySelector("canvas")) window.__blank++;
    }).observe(holder, { childList: true });
  });
  await frame.locator(".pages").evaluate((element) => (element.scrollTop = 300));
  await frame.waitForTimeout(300);
  const scrollBefore = await frame.locator(".pages").evaluate((element) => element.scrollTop);
  let started = Date.now();
  await writeFile(mainPath, original.replace("Second-Class Values in Typst", "Live Values in Typst"));
  await pageHasText(frame, 0, "Live Values in Typst");
  timings.editToPreview = Date.now() - started;
  assert.equal(await frame.evaluate(() => window.__blank), 0, "the page was blank during the update");
  const scrollAfter = await frame.locator(".pages").evaluate((element) => element.scrollTop);
  assert.ok(Math.abs(scrollAfter - scrollBefore) <= 2, `scroll moved from ${scrollBefore} to ${scrollAfter}`);
  // 再测几次，取中位数。
  const samples = [];
  for (let round = 0; round < 5; round++) {
    started = Date.now();
    await writeFile(mainPath, original.replace("Second-Class Values in Typst", `Values, round ${round}`));
    await pageHasText(frame, 0, `Values, round ${round}`);
    samples.push(Date.now() - started);
  }
  timings.editToPreviewMedian = samples.sort((a, b) => a - b)[2];
  await writeFile(mainPath, original);
  await pageHasText(frame, 0, "Second-Class Values in Typst");

  step("check waits for the latest edit");
  await writeFile(mainPath, original.replace("= Conclusion", "= Conclusions"));
  started = Date.now();
  const checked = await harness.agent(outer, "check", {});
  timings.check = Date.now() - started;
  assert.match(checked.content[0].text, /compiled successfully/);
  assert.equal(checked.structuredContent.pages, 2);

  // ---------------------------------------------------------------- 错误
  step("errors: problems panel, last good preview stays, fix with agent");
  await writeFile(mainPath, `${original}\n#let broken = (1, 2\n`);
  await frame.locator(".pill.bad", { hasText: "1 error" }).waitFor({ timeout: 10_000 });
  await frame.locator(".problem .problem-message", { hasText: "unclosed delimiter" }).waitFor();
  assert.match(await frame.locator(".problem-location").first().innerText(), /^main\.typ:\d+:\d+$/);
  assert.match(await frame.locator(".problem .excerpt").first().innerText(), /#let broken/);
  await frame.locator(".page-stack.outdated").waitFor();
  assert.ok(await frame.locator(".page canvas").first().isVisible());
  await shot(outer, "02-error");
  await frame.locator(".problems button", { hasText: "Fix with agent" }).click();
  await outer.waitForFunction(() => window.__messages.length === 1);
  const fix = await outer.evaluate(() => window.__messages[0]);
  assert.match(fix, /Fix the Typst problems in main\.typ/);
  assert.match(fix, /unclosed delimiter[\s\S]*at main\.typ:\d+:\d+[\s\S]*\| #let broken/);
  const failed = await harness.agent(outer, "check", {});
  assert.match(failed.content[0].text, /failed to compile: 1 error[\s\S]*last successful version/);
  await writeFile(mainPath, original);
  await frame.locator(".pill.ok").waitFor({ timeout: 10_000 });
  await frame.locator(".problems").waitFor({ state: "detached" });
  await frame.locator(".page-stack.outdated").waitFor({ state: "detached" });

  // ---------------------------------------------------------------- 选择与源码
  step("selected text goes to the chat with its source location");
  const selectText = (needle) =>
    frame.evaluate((text) => {
      const walker = document.createTreeWalker(document.querySelector(".page-stack"), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes(text));
      const span = node.parentElement;
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, needle);
  await frame.locator(".pages").evaluate((element) => (element.scrollTop = element.scrollHeight));
  await pageHasText(frame, 1, "quick brown fox").catch(() => pageHasText(frame, 0, "quick brown fox"));
  await selectText("quick brown fox");
  await frame.locator(".float-tools .source-chip", { hasText: "sections/body.typ:" }).waitFor({ timeout: 10_000 });
  const chip = await frame.locator(".float-tools .source-chip").innerText();
  const bodySource = await readFile(join(workspace, "sections/body.typ"), "utf8");
  const foxLine = bodySource.split("\n").findIndex((line) => line.includes("quick brown fox")) + 1;
  assert.match(chip, new RegExp(`sections/body\\.typ:${foxLine}\\b`));
  await shot(outer, "03-selection");
  await frame.locator(".float-tools button", { hasText: "Add to chat" }).click();
  await outer.waitForFunction(() => window.__context.length === 1);
  const context = await outer.evaluate(() => window.__context[0]);
  assert.match(context.content[0].text, /> quick brown fox/);
  assert.match(context.content[0].text, new RegExp(`Source \\(sections/body\\.typ:${foxLine}\\)`));
  assert.equal(context.structuredContent.typst.file, "sections/body.typ");

  step("⌘-click finds the source of a line");
  await frame.evaluate(() => {
    const span = [...document.querySelectorAll(".textLayer span:not(.markedContent)")].find((element) => element.textContent.includes("compiler keeps track"));
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true, ctrlKey: true, clientX: span.getBoundingClientRect().left + 4, clientY: span.getBoundingClientRect().top + 4 }));
  });
  await frame.locator(".float-tools.source-pop .source-chip", { hasText: `sections/body.typ:${foxLine}` }).waitFor({ timeout: 10_000 });
  assert.match(await frame.locator(".float-tools.source-pop .excerpt").innerText(), /quick brown fox/);
  await shot(outer, "04-source");
  await frame.locator(".float-tools.source-pop button[aria-label='Close']").click();

  // ---------------------------------------------------------------- Agent 指向
  step("the agent highlights source lines and the highlight follows edits");
  const shown = await harness.agent(outer, "show", { file: "main.typ", line: 12, comment: "The introduction's first sentence." });
  assert.match(shown.content[0].text, /Highlighted h1 on page 1: “Typst is a markup-based typesetting system/);
  await frame.locator(".mark.focused").first().waitFor({ timeout: 10_000 });
  await shot(outer, "05-highlight");
  // 在高亮之前插入一段：重新编译后高亮仍在同一句上。
  await writeFile(mainPath, original.replace("= Introduction\n", "= Introduction\nAn inserted opening sentence moves everything down a little.\n\n"));
  await pageHasText(frame, 0, "An inserted opening sentence");
  await frame.waitForFunction(() => document.querySelectorAll(".mark").length > 0, null, { timeout: 10_000 });
  const markBox = await frame.locator(".mark").first().boundingBox();
  await frame.locator(".mark").first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.closest(".page").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
  });
  await frame.locator(".popover .comment", { hasText: "The introduction's first sentence." }).waitFor();
  assert.match(await frame.locator(".popover .source-chip").innerText(), /main\.typ:12/);
  assert.ok(markBox.height > 4);
  await frame.locator(".popover button", { hasText: "Remove" }).click();
  await frame.waitForFunction(() => document.querySelectorAll(".mark").length === 0);
  await writeFile(mainPath, original);
  await pageHasText(frame, 0, "Typst is a markup-based");

  step("the agent scrolls to a page and quotes rendered text");
  await harness.agent(outer, "show", { page: 2 });
  await frame.waitForFunction(() => document.querySelector(".pager input").value === "2");
  const quoted = await harness.agent(outer, "show", { quote: "Latency of one edit" });
  assert.match(quoted.content[0].text, /on page 1/);
  await frame.waitForFunction(() => document.querySelector(".pager input").value === "1");
  await harness.agent(outer, "clear_highlights", {});

  // ---------------------------------------------------------------- 大纲、缩放、主文件
  step("outline jumps to headings");
  await frame.locator("button[aria-label='Outline']").click();
  await frame.locator(".outline-item", { hasText: "Discussion" }).waitFor();
  assert.deepEqual(
    (await frame.locator(".outline-item .grow").allInnerTexts()).slice(0, 5),
    ["1. Introduction", "2. Method", "2.1. Results", "3. Discussion", "4. Conclusion"],
  );
  await frame.locator(".outline-item", { hasText: "Conclusion" }).click();
  await frame.waitForFunction(() => document.querySelector(".pager input").value === "2");
  await shot(outer, "06-outline");
  await frame.locator("button[aria-label='Outline']").click();

  step("zoom: fit page, and the preference survives a reload");
  await frame.locator(".zoom").click();
  await frame.waitForFunction(() => {
    const page = document.querySelector(".page");
    return page && page.getBoundingClientRect().height <= document.querySelector(".pages").clientHeight;
  });
  await outer.waitForFunction(() => JSON.parse(sessionStorage.getItem("widgetState") ?? "{}").prefs?.zoom === "page");
  await outer.reload();
  await outer.waitForFunction(() => window.__initializations === 1);
  frame = outer.frames().find((item) => item !== outer.mainFrame());
  await frame.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  await frame.waitForFunction(() => {
    const page = document.querySelector(".page");
    return page && page.getBoundingClientRect().height <= document.querySelector(".pages").clientHeight;
  });
  await frame.locator(".zoom").click();

  step("switching the main file");
  await frame.locator(".main-picker select").selectOption("sections/body.typ");
  await frame.waitForFunction(
    () => {
      const text = document.querySelector('.page[data-page="0"] .textLayer')?.textContent ?? "";
      return text.startsWith("1 Method") || (text.includes("We compile the document") && !text.includes("Second-Class Values"));
    },
    null,
    { timeout: 20_000 },
  );
  await frame.locator(".main-picker select").selectOption("main.typ");
  await pageHasText(frame, 0, "Second-Class Values in Typst", 20_000);
  await outer.context().close();

  // ---------------------------------------------------------------- 主题、语言、尺寸
  step("dark theme, Chinese, narrow panel");
  ({ outer, frame } = await harness.open("?theme=dark&locale=zh-CN", { width: 380, height: 760 }));
  await frame.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), "dark");
  await writeFile(mainPath, `${original}\n#nope\n`);
  await frame.locator(".pill.bad", { hasText: "1 个错误" }).waitFor({ timeout: 10_000 });
  await frame.locator(".problems button", { hasText: "让 Agent 修复" }).waitFor();
  await shot(outer, "07-dark-zh-narrow");
  const overflow = await frame.evaluate(() => document.querySelector(".bar").scrollWidth - document.querySelector(".bar").clientWidth);
  assert.ok(overflow <= 1, `toolbar overflows by ${overflow}px at 380px`);
  await writeFile(mainPath, original);
  await frame.locator(".pill.ok").waitFor({ timeout: 10_000 });
  await outer.context().close();

  step("inline card in the conversation");
  ({ outer, frame } = await harness.open("?theme=light&mode=inline", { width: 560, height: 120 }));
  await frame.locator(".inline-card .sub", { hasText: "main.typ · Previewing · 2 pages" }).waitFor();
  await shot(outer, "08-inline");
  await outer.context().close();

  step("render_pages and export_pdf");
  const rendered = await harness.client.callTool({ name: "render_pages", arguments: { pages: "1-2", ppi: 40 } });
  assert.ok(!rendered.isError, rendered.content[0].text);
  assert.deepEqual(
    rendered.content.filter((part) => part.type === "image").map((part) => part.mimeType),
    ["image/png", "image/png"],
  );
  const exported = await harness.client.callTool({ name: "export_pdf", arguments: { path: "out/paper.pdf" } });
  assert.match(exported.content[0].text, /Wrote out\/paper\.pdf \(2 pages/);
  assert.equal((await readFile(join(workspace, "out/paper.pdf"))).subarray(0, 5).toString(), "%PDF-");

  step("no page errors or CSP violations");
  assert.deepEqual(harness.errors, []);
  process.stdout.write(`E2E passed. Timings (ms): ${JSON.stringify(timings)}. Screenshots: ${artifacts}\n`);
} catch (error) {
  for (const context of harness.contexts()) for (const page of context.pages()) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => undefined);
  process.stderr.write(`${harness.stderr.join("").slice(-3000)}\n`);
  process.stderr.write(`page errors: ${JSON.stringify(harness.errors)}\n`);
  throw error;
} finally {
  await harness.close();
}

// ---------------------------------------------------------------- 没有主文件、Typst 无法运行
const second = await mkdtemp(join(tmpdir(), "typst-e2e-choose-"));
await writeFile(join(second, "a.typ"), "= Alpha\nFirst document.\n");
await writeFile(join(second, "b.typ"), "= Beta\nSecond document.\n");
const choose = await startHarness({ workspace: second, env: { ZCODE_PLUGIN_DATA: join(second, ".data") } });
try {
  step("several .typ files: the user chooses the main file");
  const { outer, frame } = await choose.open("?theme=light&locale=en-US");
  await frame.locator(".status-screen h2", { hasText: "Choose the main file" }).waitFor({ timeout: 15_000 });
  await shot(outer, "09-choose");
  await frame.locator(".file-row", { hasText: "b.typ" }).click();
  await pageHasText(frame, 0, "Second document", 20_000);
  assert.deepEqual(choose.errors, []);
} finally {
  await choose.close();
}
const broken = await startHarness({ workspace: second, env: { ZCODE_PLUGIN_DATA: join(second, ".data2"), TYPST_WORKBENCH_TYPST: join(second, "no-such-typst") } });
try {
  step("an unusable Typst path explains itself");
  const { outer, frame } = await broken.open("?theme=light&locale=en-US");
  await frame.locator(".setup h1", { hasText: "Typst cannot run" }).waitFor({ timeout: 15_000 });
  assert.match(await frame.locator(".error-box").innerText(), /not an executable file/);
  await shot(outer, "10-typst-error");
  const status = await broken.client.callTool({ name: "check", arguments: {} });
  assert.ok(status.isError);
  assert.match(status.content[0].text, /^\[typst_error\]/);
  assert.deepEqual(broken.errors, []);
} finally {
  await broken.close();
}
process.stdout.write("All e2e scenarios passed.\n");
