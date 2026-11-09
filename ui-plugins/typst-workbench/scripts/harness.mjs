import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * 浏览器测试宿主：真实打包的 server（stdio）+ 官方 AppBridge 宿主页 + 隔离 iframe 中的面板。
 * 宿主页用与 ZCode 相同的 CSP 约束面板。测试脚本同时扮演 Agent：经同一个 MCP 连接调用工具，
 * 并像宿主一样把结果推给页面。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 与 ZCode 给 MCP App 页面的限制一致：没有网络，允许 wasm（声明了 zcode/csp.wasmUnsafeEval）。
export const PANEL_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' blob: data: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";

/** server：要运行的 server 入口（默认真实打包的 dist/server.mjs）。 */
export async function startHarness({ env = {}, workspace, server = join(root, "dist/server.mjs") }) {
  const client = new Client({ name: "typst-harness", version: "1" });
  const sseClients = new Set();
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    for (const response of sseClients) response.write(`data: ${JSON.stringify(notification.params)}\n\n`);
  });
  const stderr = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: workspace,
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace, ...env },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  await client.connect(transport);
  const html = await readFile(join(root, "dist/ui/panel.html"), "utf8");
  const hostJs = await build({
    stdin: {
      contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { z } from "zod";
const WidgetState = z.object({ method: z.literal('ui/set-widget-state'), params: z.object({ widgetState: z.unknown() }) });
const rpc = async (method, args) => {
  const response = await fetch('/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args})});
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const params = new URLSearchParams(location.search);
const context = { theme: params.get('theme') || 'light', locale: params.get('locale') || 'en-US', displayMode: params.get('mode') || 'fullscreen' };
const bridge = new AppBridge(null, {name:'typst-harness',version:'1'}, {
  serverTools:{}, serverResources:{ listChanged: true }, message:{text:{}}, updateModelContext:{text:{}, structuredContent:{}}, openLinks:{},
  experimental: params.get('nosub') ? { "zcode/widgetState": {} } : { "zcode/resourceSubscribe": {}, "zcode/widgetState": {} },
}, {hostContext:{...context, "zcode/widgetState": JSON.parse(sessionStorage.getItem('widgetState') || 'null')}});
window.__messages = [];
window.__context = [];
window.__links = [];
window.__calls = [];
window.__initializations = 0;
bridge.oncalltool = (args) => { window.__calls.push(args.name); return rpc('callTool', args); };
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.onmessage = async (params) => { window.__messages.push(params.content[0].text); return {}; };
bridge.onupdatemodelcontext = async (params) => { window.__context.push(params); return {}; };
bridge.onopenlink = async (params) => { window.__links.push(params.url); return {}; };
bridge.setRequestHandler('resources/subscribe', async (request) => { await rpc('subscribe', { uri: request.params.uri }); return {}; });
bridge.setRequestHandler('resources/unsubscribe', async (request) => { await rpc('unsubscribe', { uri: request.params.uri }); return {}; });
bridge.setRequestHandler(WidgetState, async (request) => { sessionStorage.setItem('widgetState', JSON.stringify(request.params.widgetState)); return {}; });
bridge.oninitialized = () => { window.__initializations++; };
window.__sendToolResult = (result) => bridge.sendToolResult(result);
window.__setContext = (patch) => bridge.setHostContext({ ...context, ...patch });
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
  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          '<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-same-origin"></iframe><script type="module" src="/host.js"></script>',
        );
      } else if (url.pathname === "/host.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(hostJs.outputFiles[0].text);
      } else if (url.pathname === "/panel") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Security-Policy", PANEL_CSP);
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
              : method === "unsubscribe"
                ? await client.unsubscribeResource(args)
                : await client.callTool(args, undefined, { timeout: 300_000 });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result ?? {}));
      } else if (url.pathname === "/favicon.ico") response.writeHead(204).end();
      else response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((done) => http.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${http.address().port}`;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  const errors = [];
  const contexts = [];

  const open = async (query = "", viewport = { width: 720, height: 900 }) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    contexts.push(context);
    const outer = await context.newPage();
    outer.on("pageerror", (error) => errors.push(String(error)));
    outer.on("console", (message) => {
      if (message.type() === "error" && !/favicon/.test(message.text())) errors.push(message.text());
    });
    await outer.goto(`${base}/${query}`);
    await outer.waitForFunction(() => window.__initializations === 1);
    const frame = outer.frames().find((item) => item !== outer.mainFrame());
    assert.ok(frame, "official App iframe exists");
    return { outer, frame, context };
  };
  /** 扮演 Agent：调用工具，再像宿主一样把结果推给页面。 */
  const agent = async (outer, name, args, { expectError = false } = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    if (expectError) assert.ok(result.isError, `${name} should fail`);
    else assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
    if (outer) await outer.evaluate((value) => window.__sendToolResult(value), result);
    return result;
  };
  const close = async () => {
    await browser.close().catch(() => undefined);
    await client.close().catch(() => undefined);
    http.close();
  };
  return { client, open, agent, close, errors, stderr, base, contexts: () => contexts.filter((context) => context.pages().length) };
}
