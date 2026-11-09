import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { ensureJupyterPython } from "./jupyter-env.mjs";

/**
 * 真实打包 server + 真实 Jupyter Server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
 * 测试脚本同时扮演 Agent：经同一个 MCP 连接调用工具，并像宿主一样把结果推给页面。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.JUPYTER_NOTEBOOK_E2E_ARTIFACTS || join(tmpdir(), "jupyter-notebook-e2e"));
await mkdir(artifacts, { recursive: true });
const python = await ensureJupyterPython();
const workspace = await mkdtemp(join(tmpdir(), "jupyter-nb-e2e-"));

const client = new Client({ name: "jupyter-notebook-e2e", version: "1" });
const sseClients = new Set();
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
  for (const response of sseClients) response.write(`data: ${JSON.stringify(notification.params)}\n\n`);
});
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist/server.mjs")],
    cwd: workspace,
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace, JUPYTER_NOTEBOOK_PYTHON: python },
    stderr: "pipe",
  }),
);
const html = await readFile(join(root, "dist/ui/panel.html"), "utf8");
const hostJs = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
const rpc = async (method, args) => {
  const response = await fetch('/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args})});
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const params = new URLSearchParams(location.search);
const context = { theme: params.get('theme') || 'light', locale: params.get('locale') || 'zh-CN', displayMode: params.get('mode') || 'fullscreen' };
const bridge = new AppBridge(null, {name:'jupyter-e2e',version:'1'}, {
  serverTools:{}, serverResources:{ listChanged: true }, message:{text:{}}, updateModelContext:{text:{}, structuredContent:{}},
  experimental: { "zcode/resourceSubscribe": {} },
}, {hostContext:context});
window.__messages = [];
window.__context = [];
window.__initializations = 0;
bridge.oncalltool = (args) => rpc('callTool', args);
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.onmessage = async (params) => { window.__messages.push(params.content[0].text); return {}; };
bridge.onupdatemodelcontext = async (params) => { window.__context.push(params); return {}; };
bridge.setRequestHandler('resources/subscribe', async (request) => { await rpc('subscribe', { uri: request.params.uri }); return {}; });
bridge.setRequestHandler('resources/unsubscribe', async () => ({}));
bridge.oninitialized = () => { window.__initializations++; };
window.__sendToolResult = (result) => bridge.sendToolResult(result);
new EventSource('/events').onmessage = (event) => {
  bridge.notification({ method: 'notifications/resources/updated', params: JSON.parse(event.data) });
};
const frame = document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/panel';
`,
    resolveDir: root,
    sourcefile: "browser-host.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe></iframe><script type="module" src="/host.js"></script>',
      );
    } else if (url.pathname === "/host.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(hostJs.outputFiles[0].text);
    } else if (url.pathname === "/panel") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } else if (url.pathname === "/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write(": connected\n\n");
      sseClients.add(response);
      request.on("close", () => sseClients.delete(response));
    } else if (request.method === "POST" && url.pathname === "/rpc") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { method, args } = JSON.parse(body);
      const result =
        method === "readResource"
          ? await client.readResource(args)
          : method === "subscribe"
            ? await client.subscribeResource(args)
            : await client.callTool(args, undefined, { timeout: 240_000 });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result ?? {}));
    } else if (url.pathname === "/favicon.ico") response.writeHead(204).end();
    else response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
const errors = [];
const open = async (query = "", viewport = { width: 760, height: 900 }) => {
  const outer = await browser.newPage({ viewport });
  outer.on("pageerror", (error) => errors.push(String(error)));
  outer.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await outer.goto(`${base}/${query}`);
  await outer.waitForFunction(() => window.__initializations === 1);
  const frame = outer.frames().find((item) => item !== outer.mainFrame());
  assert.ok(frame, "official App iframe exists");
  return { outer, frame };
};
/** 扮演 Agent：调用工具，再像宿主一样把结果推给页面。 */
const agent = async (outer, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  await outer.evaluate((value) => window.__sendToolResult(value), result);
  return result;
};
const cells = (frame) => frame.locator(".cell");
const cellAt = (frame, index) => frame.locator(`.cell[data-index="${index}"]`);
const typeInto = async (frame, index, text) => {
  await cellAt(frame, index).locator(".cm-content").click();
  await frame.page().keyboard.type(text);
};
const nbDoc = async () => {
  const state = JSON.parse((await client.readResource({ uri: "ui://jupyter-notebook/state.json" })).contents[0].text);
  const id = state.current;
  return JSON.parse((await client.readResource({ uri: `ui://jupyter-notebook/notebooks/${id}.json` })).contents[0].text);
};

try {
  // 1. 中文浅色侧栏：没有 server → 启动 → 新建 notebook。
  const { outer, frame } = await open();
  const page = outer;
  await frame.getByText("连接 Jupyter Server").waitFor();
  await frame.getByText("为当前工作区启动 server").waitFor();
  await frame.getByRole("button", { name: "启动", exact: true }).click();
  await frame.getByText("打开 notebook").waitFor({ timeout: 90_000 });
  await frame.getByRole("button", { name: "新建 notebook" }).click();
  await frame.getByPlaceholder("untitled.ipynb").fill("e2e/demo");
  await frame.getByRole("button", { name: "新建", exact: true }).click();
  await frame.getByText("这个 notebook 还是空的").waitFor();
  await frame.locator(".hdr .title").getByText("demo.ipynb").waitFor();

  // 2. 新建代码 cell，输入并 Shift+Enter 运行；最后一个 cell 运行后自动在下方新建。
  await frame.locator(".empty").getByRole("button", { name: "代码 cell" }).click();
  await cellAt(frame, 0).locator(".cm-editor.cm-focused").waitFor();
  await page.keyboard.type('print("hello from the panel")\n6 * 7');
  await page.keyboard.press("Shift+Enter");
  await cellAt(frame, 0).locator(".output.stream").getByText("hello from the panel").waitFor({ timeout: 60_000 });
  await cellAt(frame, 0).locator(".mime.plain").getByText("42").waitFor();
  await cellAt(frame, 0).locator(".gut-btn .prompt", { hasText: "[1]" }).waitFor({ state: "attached" });
  await cellAt(frame, 1).locator(".cm-editor.cm-focused").waitFor();
  assert.equal(await cells(frame).count(), 2);
  // 面板里的编辑与运行记为用户所做，不显示 Agent 注记。
  assert.equal((await nbDoc()).cells[0].run.by, "user");
  assert.equal((await nbDoc()).cells[0].edit.by, "user");
  assert.equal(await cellAt(frame, 0).locator(".meta").count(), 0);

  // 3. 命令模式：m 转 Markdown，编辑后运行即渲染（含公式）。
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await cellAt(frame, 1).locator(".prose.rendered").waitFor();
  await page.keyboard.press("Enter");
  await cellAt(frame, 1).locator(".cm-editor.cm-focused").waitFor();
  await page.keyboard.type("# Results\nEnergy $E = mc^2$");
  await page.keyboard.press("Shift+Enter");
  await cellAt(frame, 1).locator(".prose.rendered h1").getByText("Results").waitFor();
  assert.equal(await cellAt(frame, 1).locator(".katex").count(), 1);
  // 最后一个 cell 运行后在下方新建了空 cell；命令模式 DD 删除它。
  await cellAt(frame, 2).locator(".cm-editor.cm-focused").waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelectorAll(".cell").length === 2);

  // 4. 编辑已防抖保存到 server（文件）。
  await frame.locator(".hdr .save").getByText("已保存").waitFor({ timeout: 15_000 });
  let doc = await nbDoc();
  assert.deepEqual(
    doc.cells.map((cell) => [cell.type, cell.source]),
    [
      ["code", 'print("hello from the panel")\n6 * 7'],
      ["markdown", "# Results\nEnergy $E = mc^2$"],
    ],
  );
  const disk = JSON.parse(await readFile(join(workspace, "e2e/demo.ipynb"), "utf8"));
  assert.equal(disk.cells[0].outputs[0].text.join(""), "hello from the panel\n");

  // 5. Agent 修改 cell：面板显示新内容；Agent 插入的 cell 可在面板运行。
  const codeId = doc.cells[0].id;
  await agent(page, "edit_notebook", {
    operations: [
      { op: "update", cellId: codeId, source: 'print("agent was here")' },
      {
        op: "insert",
        source:
          "from IPython.display import HTML, display\ndisplay(HTML('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><script>window.__pwned = 1</script>'))\nimport base64\nfrom IPython.display import Image\ndisplay(Image(data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')))",
      },
      { op: "insert", source: "1/0" },
    ],
  });
  await cellAt(frame, 0).locator(".cm-content").getByText('print("agent was here")').waitFor();
  await cellAt(frame, 2).locator(".cm-content").getByText("display(HTML(").waitFor();
  await cellAt(frame, 0).locator(".meta").getByText("Agent 修改过").waitFor();
  await agent(page, "execute_cells", { all: true });
  await cellAt(frame, 2).locator(".mime .html table td").first().waitFor();
  assert.equal((await nbDoc()).cells[0].run.by, "agent");
  // 刚修改过的 cell 优先注明“修改过”；Agent 的运行在 cell 选中时注明。
  await cellAt(frame, 0).locator(".meta").getByText("Agent 修改过").waitFor();
  await cellAt(frame, 2).locator(".mime .html table td").first().waitFor();
  assert.equal(await cellAt(frame, 2).locator(".mime.image img").count(), 1);
  assert.equal(await cellAt(frame, 2).locator("script").count(), 0, "output scripts are stripped");
  assert.equal(await frame.evaluate(() => window.__pwned), undefined);
  await cellAt(frame, 3).locator(".output.error").getByText("ZeroDivisionError").first().waitFor();

  // 6. 错误 cell：让 Agent 修复 → 主对话收到消息。
  await cellAt(frame, 3).click({ position: { x: 5, y: 5 } });
  await cellAt(frame, 3).getByRole("button", { name: "让 Agent 修复" }).click();
  await page.waitForFunction(() => window.__messages.length === 1);
  const fixMessage = await page.evaluate(() => window.__messages[0]);
  assert.match(fixMessage, /e2e\/demo\.ipynb/);
  assert.match(fixMessage, /ZeroDivisionError/);

  // 7. 引用 cell 到对话上下文。
  await cellAt(frame, 3).getByRole("button", { name: "在对话中引用" }).click();
  await page.waitForFunction(() => window.__context.length === 1);
  const context = await page.evaluate(() => window.__context[0]);
  assert.equal(context.structuredContent.cellId, (await nbDoc()).cells[3].id);

  // 7b. 未选中的 cell：直接点左侧运行按钮就运行（按下时不选中、不滚动），之后被选中。
  assert.ok(!(await cellAt(frame, 0).getAttribute("class")).includes(" sel"));
  const scrollBefore = await frame.locator(".cells").evaluate((el) => el.scrollTop);
  const countBefore = (await nbDoc()).cells[0].executionCount;
  await cellAt(frame, 0).hover();
  await cellAt(frame, 0).locator(".gut-btn.idle").click();
  for (let i = 0; i < 100 && (await nbDoc()).cells[0].executionCount === countBefore; i++) await new Promise((r) => setTimeout(r, 100));
  const rerun = (await nbDoc()).cells[0];
  assert.ok(rerun.executionCount > countBefore, "clicking the run button of an unselected cell runs it");
  assert.equal(rerun.run.by, "user");
  assert.equal(typeof rerun.run.seq, "number");
  assert.equal(typeof rerun.run.batch, "string");
  assert.ok((await cellAt(frame, 0).getAttribute("class")).includes(" sel"));
  assert.equal(await frame.locator(".cells").evaluate((el) => el.scrollTop), scrollBefore);

  // 8. 编辑冲突：用户输入尚未提交时 Agent 修改同一 cell → 提示，保留用户版本。
  doc = await nbDoc();
  const errorCellId = doc.cells[3].id;
  await typeInto(frame, 3, " + 1");
  await agent(page, "edit_notebook", { operations: [{ op: "update", cellId: errorCellId, source: "2/0" }] });
  await cellAt(frame, 3).getByText("你输入时 Agent 修改了这个 cell。").waitFor({ timeout: 10_000 });
  await cellAt(frame, 3).getByRole("button", { name: "对比" }).click();
  await cellAt(frame, 3).locator(".compare pre").getByText("2/0").waitFor();
  await cellAt(frame, 3).getByRole("button", { name: "保留我的" }).click();
  await page.waitForFunction(async () => true);
  for (let i = 0; i < 50 && (await nbDoc()).cells[3].source !== "1/0 + 1"; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await nbDoc()).cells[3].source, "1/0 + 1");

  // 9. 中断长时间运行的 cell。
  await page.keyboard.press("Escape");
  await page.keyboard.press("b");
  await cellAt(frame, 4).locator(".cm-editor.cm-focused").waitFor();
  await page.keyboard.type("import time\ntime.sleep(60)");
  await page.keyboard.press("Control+Enter");
  await cellAt(frame, 4).locator(".gut-btn.running").waitFor({ timeout: 15_000 });
  await cellAt(frame, 4).locator(".meta").getByText("运行中").waitFor();
  await cellAt(frame, 4).locator(".gut-btn.running").click();
  await cellAt(frame, 4).locator(".output.error").getByText("KeyboardInterrupt").first().waitFor({ timeout: 20_000 });

  await page.screenshot({ path: join(artifacts, "zh-light-panel.png") });

  // 11. 英文深色：同一 server 状态，内联卡片与窄侧栏。
  const inline = await open("?theme=dark&locale=en&mode=inline", { width: 420, height: 200 });
  await inline.frame.locator(".inline-title").getByText("demo.ipynb").waitFor();
  await inline.frame.getByRole("button", { name: "Open in side panel" }).waitFor();
  await inline.outer.screenshot({ path: join(artifacts, "en-dark-inline.png") });

  const dark = await open("?theme=dark&locale=en", { width: 420, height: 860 });
  await dark.frame.locator(".cell").first().waitFor();
  assert.equal(await dark.frame.locator("html").getAttribute("data-theme"), "dark");
  for (let i = 0; i < 100 && (await nbDoc()).save.state !== "saved"; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await nbDoc()).save.state, "saved", JSON.stringify((await nbDoc()).save));
  await dark.frame.locator(".hdr .save").getByText("Saved", { exact: true }).waitFor();
  assert.ok(
    await dark.frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "no horizontal overflow at 420px",
  );
  await dark.outer.screenshot({ path: join(artifacts, "en-dark-panel.png") });

  assert.deepEqual(errors, []);
  process.stdout.write(`jupyter-notebook e2e: ok (screenshots in ${artifacts})\n`);
} finally {
  await browser.close();
  for (const response of sseClients) response.end();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await client.close();
  await rm(workspace, { recursive: true, force: true });
}
