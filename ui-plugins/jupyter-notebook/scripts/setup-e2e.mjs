import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * 设置页端到端：真实打包 server + 真实的 uv 虚拟环境（一开始没有 jupyter-server / ipykernel）+ 官方 AppBridge 宿主。
 * 缺少依赖 → 交给 Agent（检查消息）→ 脚本像 Agent 一样把两个包装进环境 → 页面自己前进 → Agent 启动 server → 选择 notebook。
 * 设置页本身不应发起工具调用（宿主会为它们弹出审批）。需要 uv；先运行 pnpm build。
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.JUPYTER_NOTEBOOK_E2E_ARTIFACTS || join(tmpdir(), "jupyter-notebook-setup-e2e"));
await mkdir(artifacts, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "jupyter-nb-setup-"));
await writeFile(join(workspace, "pyproject.toml"), '[project]\nname = "analysis"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n');
await run("uv", ["venv", "--quiet", "--python", "3.12", join(workspace, ".venv")]);
const venvPython = join(workspace, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

const client = new Client({ name: "jupyter-notebook-setup-e2e", version: "1" });
const sseClients = new Set();
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
  for (const response of sseClients) response.write(`data: ${JSON.stringify(notification.params)}\n\n`);
});
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist/server.mjs")],
    cwd: workspace,
    // PATH 中的 python3 不应装有 jupyter：只留系统目录。
    env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", ZCODE_WORKSPACE_ROOT: workspace },
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
const context = { theme: params.get('theme') || 'light', locale: params.get('locale') || 'en-US', displayMode: params.get('mode') || 'fullscreen' };
const bridge = new AppBridge(null, {name:'jupyter-setup-e2e',version:'1'}, {
  serverTools:{}, serverResources:{ listChanged: true }, message:{text:{}}, updateModelContext:{text:{}, structuredContent:{}},
  experimental: { "zcode/resourceSubscribe": {} },
}, {hostContext:context});
window.__messages = [];
window.__calls = [];
window.__initializations = 0;
bridge.oncalltool = (args) => { window.__calls.push(args.name); return rpc('callTool', args); };
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.onmessage = async (params) => { window.__messages.push(params.content[0].text); return {}; };
bridge.onupdatemodelcontext = async () => ({});
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
      response.end('<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe></iframe><script type="module" src="/host.js"></script>');
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
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
const errors = [];
async function open(query, viewport = { width: 480, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const outer = await context.newPage();
  outer.on("pageerror", (error) => errors.push(String(error)));
  outer.on("console", (message) => {
    if (message.type() === "error" && !/favicon/.test(message.text())) errors.push(message.text());
  });
  await outer.goto(`${base}/${query}`);
  await outer.waitForFunction(() => window.__initializations === 1);
  const frame = outer.frames().find((item) => item !== outer.mainFrame());
  return { outer, frame };
}
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`) });
const step = (name) => process.stdout.write(`• ${name}\n`);
const text = (frame, selector) => frame.locator(selector).first().innerText();

try {
  step("missing packages: requirements from the real uv environment, before anyone clicks Start");
  const { outer, frame } = await open("?theme=light&locale=en-US");
  await frame.locator(".setup h1").getByText("Set up Jupyter for this workspace").waitFor({ timeout: 30_000 });
  const rows = await text(frame, ".req .card");
  assert.match(rows, /Project Python[\s\S]*\.venv\/bin\/python · managed by uv[\s\S]*3\.12/);
  assert.match(rows, /jupyter-server[\s\S]*Not installed in \.venv[\s\S]*Missing[\s\S]*ipykernel[\s\S]*Not installed in \.venv[\s\S]*Missing/);
  assert.match(await text(frame, ".handoff .msg"), /uv add --dev jupyter-server ipykernel/);
  await frame.getByRole("button", { name: "Install them yourself" }).click();
  assert.equal(await text(frame, ".setup .cmd code"), "uv add --dev jupyter-server ipykernel");
  await frame.getByRole("button", { name: "Use uv for this session only" }).waitFor();
  await frame.waitForTimeout(300);
  await shot(outer, "01-missing");

  step("send to agent: the message, the working state, the chat card and a dark Chinese panel");
  await frame.getByRole("button", { name: "Send to agent" }).click();
  await frame.locator(".sent").waitFor();
  const [message] = await outer.evaluate(() => window.__messages);
  assert.match(
    message,
    /^Set up Jupyter for the Jupyter Notebook panel in ZCode\.\n\nThe panel checked this workspace:\n• Project Python: \.venv\/bin\/python \(3\.12\.\d+\), managed by uv\n• Missing packages: jupyter-server, ipykernel\n\nPlease:\n1\. Add both to this project's environment: `uv add --dev jupyter-server ipykernel`\./,
  );
  assert.match(message, /start_server/);
  assert.equal(await text(frame, ".setup h1"), "Setting up Jupyter");
  await shot(outer, "02-working");
  const zh = await open("?theme=dark&locale=zh-CN");
  await zh.frame.locator(".setup h1").getByText("正在配置 Jupyter").waitFor();
  await shot(zh.outer, "03-working-dark-zh");
  const inline = await open("?mode=inline", { width: 620, height: 120 });
  await inline.frame.locator(".inline-card").getByText("Agent is installing jupyter-server and ipykernel").waitFor();
  await shot(inline.outer, "04-inline-working");

  step("the agent installs the packages: the page notices and moves on by itself");
  await run("uv", ["pip", "install", "--quiet", "--python", venvPython, "jupyter-server==2.21.1", "ipykernel==7.4.0"], { cwd: workspace });
  await frame.locator(".setup h1").getByText("Connect a Jupyter server").waitFor({ timeout: 30_000 });
  await shot(outer, "05-ready-to-start");
  assert.deepEqual(await outer.evaluate(() => window.__calls), [], "the setup page made no tool calls");

  step("the agent starts a server: the panel offers notebooks");
  const started = await client.callTool({ name: "start_server", arguments: {} }, undefined, { timeout: 240_000 });
  assert.ok(!started.isError, JSON.stringify(started.content));
  await frame.getByText("Open a notebook").waitFor({ timeout: 30_000 });
  await shot(outer, "06-picker");

  assert.deepEqual(errors, []);
  console.log(`ok — screenshots in ${artifacts}`);
} finally {
  await browser.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  server.close();
}
