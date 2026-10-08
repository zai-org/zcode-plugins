// 浏览器 e2e：真实 Chrome + 真实 dist/server.mjs（stdio）+ 假宿主桥。
// 页面里预注入 window.__pluginClient（client.ts 会复用它，不建第二条连接），
// readResource/callTool 经 /rpc 代理到真实 MCP 客户端。
// 覆盖：打开文档→IR 渲染→打字→自动保存落盘→Agent patch→通知→页面实时刷新→数学/mermaid 离线渲染。
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const { url, call, client, workspace } = fixture;

// 初始文档：含数学与 mermaid，验证离线渲染链路。
const initial = await call("new_document", {
  path: "docs/e2e.md",
  content: "# E2E 标题\n\n$$E=mc^2$$\n\n```mermaid\ngraph TD; A-->B;\n```\n\n正文段落。",
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
await context.route("**/*", (route) => {
  const target = route.request().url();
  if (target.startsWith(url)) return route.continue();
  return route.abort();
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") failures.push(`console[${msg.type()}]: ${msg.text()}`);
});
page.on("requestfailed", (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
await page.goto(url);
// 初始工具结果在 bootstrap 之前发布（宿主语义：首结果可能早于页面加载完成）。
await page.evaluate((output) => window.__publish(output), initial);

// 1. 编辑器起来 + 初始内容渲染（IR 模式）
try {
  await page.waitForSelector(".vditor-ir", { timeout: 30000 });
} catch (error) {
  console.log("DIAG root html:", (await page.evaluate(() => document.body.innerHTML)).slice(0, 600));
  console.log("DIAG failures:", JSON.stringify(failures.slice(0, 10), null, 1));
  throw error;
}
await page.waitForFunction(() => document.querySelector(".vditor-ir h1"), null, { timeout: 15000 });
const rendered = {
  h1: await page
    .waitForFunction(() => document.querySelector(".vditor-ir h1")?.textContent?.includes("E2E 标题"), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false),
  katex: await page
    .waitForFunction(() => Boolean(document.querySelector(".katex")), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false),
  mermaid: await page
    .waitForFunction(() => Boolean(document.querySelector(".vditor-ir svg[id^='mermaid'], .vditor-ir .mermaid svg")), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false),
};
console.log("render:", JSON.stringify(rendered));

// 视觉健康：工具栏存在且有尺寸、图标收敛、无横向溢出（对应“样式完全不对”的回归防线）
const visualHealth = await page.evaluate(() => {
  const toolbar = document.querySelector(".vditor-toolbar");
  const items = document.querySelectorAll(".vditor-toolbar .vditor-toolbar__item");
  const button = toolbar?.getBoundingClientRect();
  const giant = [...document.querySelectorAll(".vditor button, .vditor-toolbar button")]
    .filter((el) => el.getBoundingClientRect().height > 60).length;
  return {
    toolbar: Boolean(toolbar),
    toolbarHeight: Math.round(button?.height ?? 0),
    toolbarItems: items.length,
    oversizedButtons: giant,
    horizontalOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log("visual health:", JSON.stringify(visualHealth));
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
// 暗色对比度结论在下方块作用域内产出，供末尾 ok 汇总使用。
let darkContrastOk = false;
await import("node:fs/promises").then((fs) => fs.mkdir(artifacts, { recursive: true }));
await page.screenshot({ path: join(artifacts, "01-editor-light.png"), fullPage: false });
{
  const darkPage = await context.newPage();
  await darkPage.goto(`${url}/?doc=${initial.document.id}&theme=dark`);
  await darkPage
    .waitForFunction(() => document.querySelector(".vditor-ir h1"), null, { timeout: 20000 })
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const darkProbe = await darkPage.evaluate(() => {
    // 暗色可见性回归探针：文字与背景同色是本插件踩过的真实缺陷。
    const first = (selector) => document.querySelector(selector);
    return {
      resetColor: getComputedStyle(first(".vditor-reset")).color,
      h1Color: getComputedStyle(first(".vditor-ir h1"))?.color ?? null,
      pColor: getComputedStyle(first(".vditor-ir p"))?.color ?? null,
      resetBg: getComputedStyle(first(".vditor-reset")).backgroundColor,
    };
  });
  console.log("dark probe:", JSON.stringify(darkProbe));
  darkContrastOk =
    darkProbe.h1Color !== darkProbe.resetBg && darkProbe.pColor !== darkProbe.resetBg;
  {
    const clip = await darkPage.evaluate(() => {
      const el = document.querySelector(".vditor-ir");
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 600) } : null;
    });
    if (clip)
      await darkPage.screenshot({ path: join(artifacts, "05-dark-content-clip.png"), clip });
  }
  await darkPage.screenshot({ path: join(artifacts, "04-editor-dark.png") });
  await darkPage.close();
}

// 2. 打字 → 自动保存（直接 focus 编辑区，轮询磁盘文件确认落盘）
await page.evaluate(() => {
  const editable = document.querySelector(".vditor-ir [contenteditable=true]");
  if (!editable) return;
  editable.focus();
  // IR 标题带标记 span，默认光标可能落在标记中间；显式移到内容末尾再输入。
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
});
await page.keyboard.type("人工输入。");
await page.keyboard.press("Escape");
let typedSaved = false;
for (let attempt = 0; attempt < 30 && !typedSaved; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  typedSaved = (await readFile(join(workspace, "docs/e2e.md"), "utf8").catch(() => "")).includes(
    "人工输入。",
  );
}
console.log("autosave to disk:", typedSaved, "| revision:", await page.evaluate(() => window.__mdDebug?.getState?.().revision));

// 3. Agent patch → 通知 → 页面实时刷新
let notified = 0;
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
  if (notification.params?.uri === `ui://markdown/document/${initial.document.id}`) notified += 1;
});
// 诊断：node 侧直接订阅，隔离页面订阅链路
await client.request({ method: "resources/subscribe", params: { uri: `ui://markdown/document/${initial.document.id}` } }, (await import("@modelcontextprotocol/sdk/types.js")).EmptyResultSchema);
await call("patch_document", {
  path: "docs/e2e.md",
  ops: [{ find: "正文段落。", replace: "Agent 改过的段落。" }],
});
await new Promise((resolve) => setTimeout(resolve, 300));
console.log("server notifications:", notified);
await page.evaluate(
  (params) => window.__fireNotification("notifications/resources/updated", params),
  { uri: `ui://markdown/document/${initial.document.id}` },
);
await page.waitForFunction(
  () => window.__mdDebug?.getValue().includes("Agent 改过的段落。"),
  null,
  { timeout: 8000 },
);
console.log("agent patch refreshed page: true");

// 3b. 引用选区 → updateModelContext
await page.evaluate(() => {
  const editable = document.querySelector(".vditor-ir [contenteditable=true]");
  if (!editable) return;
  editable.focus();
  const selection = window.getSelection();
  const heading = editable.querySelector("h1");
  if (heading) {
    const range = document.createRange();
    range.selectNodeContents(heading);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
});
const referenceInitiallyDisabled = await page.evaluate(
  () => document.getElementById("reference").disabled === true,
);
await page.click("#reference");
const referenced = await page.evaluate(
  () => window.__contexts.filter((item) => item.structuredContent?.document?.path === "docs/e2e.md").length >= 1,
);
console.log("reference (add to chat):", referenced, "| initially disabled:", referenceInitiallyDisabled);
const referenceOk = referenced;

// 3c. 文档菜单：打开第二份文档 → 菜单展示（含最近/全部）→ 过滤 → 切换回来
const second = await call("new_document", { path: "docs/second.md", content: "# 第二份文档\n\nB 文档内容。" });
await page.evaluate((output) => window.__publish(output), second);
await page.waitForFunction(() => window.__mdDebug?.getValue().includes("B 文档内容。"), null, { timeout: 15000 });
await page.click("#switch");
await page.waitForSelector("#docs:not([hidden])", { timeout: 8000 });
await page.waitForFunction(
  () => [...document.querySelectorAll("#all-list button")].some((item) => item.dataset.path === "docs/e2e.md"),
  null,
  { timeout: 8000 },
);
const menuState = await page.evaluate(() => ({
  recentShown: !document.getElementById("recent-section").hidden,
  recentPaths: [...document.querySelectorAll("#recent-list button")].map((item) => item.dataset.path),
  allPaths: [...document.querySelectorAll("#all-list button")].map((item) => item.dataset.path),
  currentMarked: [...document.querySelectorAll("#all-list button.current")].map((item) => item.dataset.path),
}));
console.log("docs menu:", JSON.stringify(menuState));
// 过滤：输入 second 后只剩第二份文档
await page.fill("#doc-filter", "second");
await page.waitForFunction(
  () => {
    const paths = [...document.querySelectorAll("#all-list button")].map((item) => item.dataset.path);
    return paths.length === 1 && paths[0] === "docs/second.md";
  },
  null,
  { timeout: 5000 },
).then(() => {}).catch(() => {});
const filtered = await page.evaluate(() => [
  ...document.querySelectorAll("#recent-list button, #all-list button"),
].map((item) => item.dataset.path));
console.log("filter result:", JSON.stringify(filtered));
await page.screenshot({ path: join(artifacts, "03-doc-menu-open.png") });
// 清空过滤，点 docs/e2e.md 切回
await page.fill("#doc-filter", "");
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
const switchedBack = await page.evaluate(async (targetPath) => {
  const item = [...document.querySelectorAll("#all-list button")].find(
    (button) => button.dataset.path === targetPath,
  );
  item?.click();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return window.__mdDebug?.getValue().includes("E2E 标题");
}, "docs/e2e.md");
console.log("doc switcher roundtrip:", switchedBack);
const menuChecks =
  menuState.allPaths.includes("docs/e2e.md") &&
  menuState.recentPaths.includes("docs/second.md") &&
  filtered.length === 1 &&
  filtered[0] === "docs/second.md";

// 3d. 拖放：模拟拖入一个 .md 文件 → 打开
const dropped = await page.evaluate(async () => {
  const file = new File(["# 拖入的文档\n\n拖放内容。"], "dropped.md", { type: "text/markdown" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  document.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 1800));
  return window.__mdDebug?.getValue().includes("拖放内容。");
});
console.log("drag & drop opened:", dropped);

// 3f. 用户反馈场景：空面板（无初始文档）→ 菜单 → 新建 → 布局必须正常
const blank = await context.newPage();
blank.on("pageerror", (error) => failures.push(`blank pageerror: ${error.message}`));
await blank.goto(url);
await blank.waitForSelector(".vditor-toolbar", { timeout: 25000, state: "attached" });
const blankState = await blank.evaluate(() => ({
  emptyOverlay: !document.getElementById("empty").hidden,
  toolbarHeight: Math.round(
    document.querySelector(".vditor-toolbar")?.getBoundingClientRect().height ?? 0,
  ),
}));
await blank.click("#switch");
await blank.waitForSelector("#docs:not([hidden])", { timeout: 8000 });
await blank.waitForFunction(
  () => document.querySelectorAll("#all-list button").length > 0,
  null,
  { timeout: 8000 },
);
await blank.click("#show-new");
await blank.click("#new-doc");
const newDocOk = await blank
  .waitForFunction(
    () => {
      return Boolean(window.__mdDebug?.getState?.().id) && document.getElementById("empty").hidden;
    },
    null,
    { timeout: 15000 },
  )
  .then(() => true)
  .catch(() => false);
const newDocVisual = await blank.evaluate(() => ({
  toolbarHeight: Math.round(
    document.querySelector(".vditor-toolbar")?.getBoundingClientRect().height ?? 0,
  ),
  emptyHidden: document.getElementById("empty").hidden,
  oversizedButtons: [...document.querySelectorAll(".vditor-toolbar button")]
    .filter((el) => el.getBoundingClientRect().height > 60).length,
  horizontalOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
}));
await blank.screenshot({ path: join(artifacts, "02-new-doc-from-blank.png") });
await blank.close();
console.log("blank panel:", JSON.stringify(blankState));
console.log("new doc from menu:", newDocOk, JSON.stringify(newDocVisual));
const newDocChecks =
  blankState.emptyOverlay &&
  blankState.toolbarHeight === 0 &&
  newDocOk &&
  newDocVisual.emptyHidden &&
  newDocVisual.toolbarHeight === 0 &&
  newDocVisual.oversizedButtons === 0 &&
  newDocVisual.horizontalOverflow <= 2;

// 3e. 冷恢复：带 widgetState 重建页面（无工具结果），应自动恢复当前文档
const cold = await context.newPage();
const coldErrors = [];
cold.on("pageerror", (error) => {
  coldErrors.push(`pageerror: ${error.message}`);
  failures.push(`cold pageerror: ${error.message}`);
});
cold.on("console", (msg) => {
  if (msg.type() === "error") coldErrors.push(`console: ${msg.text()}`);
});
cold.on("requestfailed", (request) => coldErrors.push(`requestfailed: ${request.url()}`));
await cold.goto(`${url}/?doc=${initial.document.id}`);
const coldRestored = await cold
  .waitForFunction(() => window.__mdDebug?.getValue().includes("Agent 改过的段落。"), null, { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
const coldReferenceDisabled = coldRestored
  ? await cold.evaluate(() => document.getElementById("reference").disabled === true)
  : false;
if (!coldRestored) {
  console.log("cold diag errors:", JSON.stringify(coldErrors.slice(0, 6)));
  try {
    console.log(
      "cold diag state:",
      JSON.stringify(
        await cold.evaluate(() => ({
          widgetState: window.__pluginClient?.widgetState ?? null,
          mdState: window.__mdDebug?.getState?.() ?? null,
          valueHead: (window.__mdDebug?.getValue?.() ?? "").slice(0, 60),
          hasVditor: Boolean(document.querySelector(".vditor-ir")),
          emptyHidden: document.getElementById("empty")?.hidden,
        })),
      ),
    );
  } catch (error) {
    console.log("cold diag evaluate failed:", String(error).slice(0, 200));
  }
}
await cold.close();
console.log("cold start restored:", coldRestored, "| reference disabled without selection:", coldReferenceDisabled);

// 4. 外部修改 → 状态推进（页面非 dirty 时静默刷新）
await writeFile(join(workspace, "docs/e2e.md"), "# 外部改写\n\n新内容。");
await new Promise((resolve) => setTimeout(resolve, 800));
const externalStatus = await call("get_status", { id: initial.document.id });
console.log("external detected by server:", externalStatus.documents[0].externalChange);

// 5. 页面内存：编辑器 + 数学 + mermaid 全链路加载后的 JS 堆
const heapMb = await page.evaluate(() => {
  const memory = performance.memory;
  return memory ? memory.usedJSHeapSize / 1048576 : -1;
});
console.log("page JS heap:", heapMb.toFixed(1), "MB");
const heapOk = heapMb < 0 || heapMb < 220;

await browser.close();
await fixture.close();

const ok =
  rendered.h1 === true &&
  rendered.katex === true &&
  rendered.mermaid === true &&
  typedSaved &&
  notified >= 1 &&
  referenceOk &&
  switchedBack &&
  menuChecks &&
  dropped &&
  coldRestored &&
  coldReferenceDisabled &&
  visualHealth.toolbar &&
  visualHealth.toolbarHeight === 0 &&
  visualHealth.toolbarItems >= 5 &&
  visualHealth.oversizedButtons === 0 &&
  visualHealth.horizontalOverflow <= 2 &&
  newDocChecks &&
  heapOk &&
  darkContrastOk &&
  failures.length === 0;
console.log(failures.length ? `failures(${failures.length}): ${failures.slice(0, 5).join(" | ")}` : "no page failures");
console.log(ok ? "E2E OK" : "E2E FAILED");
process.exit(ok ? 0 : 1);
