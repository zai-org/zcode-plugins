// 浏览器 e2e 的假宿主桥：真实 dist/server.mjs（stdio）+ 本地 HTTP 服务。
// 页面里预注入 window.__pluginClient（client.ts 复用它，不建第二条连接），
// readResource/callTool/request 经 /rpc 代理到真实 MCP 客户端。
// ?doc=<id> 提供冷恢复 widgetState，?theme=dark 切换宿主主题。
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";

export async function startFixture() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temp = await mkdtemp(join(tmpdir(), "md-e2e-browser-"));
  const workspace = join(temp, "workspace");
  await mkdir(join(workspace, "docs"), { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist/server.mjs")],
    cwd: workspace,
    env: {
      ...process.env,
      ZCODE_WORKSPACE_ROOT: workspace,
      ZCODE_PLUGIN_DATA: join(temp, "data"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "md-e2e", version: "1" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return result.structuredContent;
  };


  const bridge = () => `<script>
    async function rpc(method, args) {
      const response = await fetch('/rpc', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
      const value = await response.json(); if(!response.ok) throw Error(value.error); return value;
    }
    window.__contexts = [];
    const query = new URLSearchParams(location.search);
    const initialWidgetState = query.get('doc') || query.get('path') ? { docId: query.get('doc'), path: query.get('path') } : null;
    const hostContext = { theme: query.get('theme') === 'dark' ? 'dark' : 'light', locale: 'zh-CN' };
    const capabilities = { experimental: { 'zcode/widgetState': true, 'zcode/resourceSubscribe': true } };
    const listeners = new Set();
    window.__handlers = {};
    window.__fireNotification = (method, params) => {
      for (const handler of Object.values(window.__handlers)) handler({ params });
    };
    const client = {
      get toolInput() { return window.__toolInput ?? null; },
      get toolOutput() { return window.__toolOutput ?? null; },
      get widgetState() { return window.__widgetState ?? initialWidgetState; },
      toolCancelled: null,
      get theme() { return hostContext.theme; },
      get locale() { return hostContext.locale; },
      get hostContext() { return hostContext; },
      app: {
        getHostVersion: () => 'e2e-host',
        getHostCapabilities: () => capabilities,
        getHostContext: () => hostContext,
        setNotificationHandler: (schema, handler) => { window.__handlers[schema.method] = handler; },
      },
      ready: async () => {},
      callTool: (name, args) => rpc('callTool', { name, arguments: args ?? {} }),
      readResource: (uri) => rpc('readResource', { uri }),
      request: (method, params) => rpc('request', { method, params }),
      setWidgetState: async (value) => {
        window.__widgetWrites = (window.__widgetWrites ?? 0) + 1;
        if (window.__widgetWrites > 30) throw Error('widget state feedback loop');
        window.__widgetState = value;
        for (const listener of listeners) listener();
      },
      updateModelContext: async (value) => { window.__contexts.push(value); },
      notifyIntrinsicHeight: () => {},
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    window.__pluginClient = client;
    window.__publish = (output, input = null) => {
      window.__toolInput = input; window.__toolOutput = output;
      for (const listener of listeners) listener();
      window.dispatchEvent(new Event('plugin:change'));
    };
  </script>`;

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && (request.url ?? "/").split("?")[0] === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        const html = await readFile(join(root, "dist/ui/panel.html"), "utf8");
        response.end(html.replace("<script>", `${bridge()}<script>`));
      } else if (request.method === "POST" && request.url === "/rpc") {
        let body = "";
        for await (const chunk of request) body += chunk;
        if (body.length > 16 * 1024 * 1024) throw new Error("Request too large");
        const { method, args } = JSON.parse(body);
        let result;
        if (method === "readResource") result = await client.readResource(args);
        else if (method === "callTool") result = await client.callTool(args);
        else if (method === "request") result = await client.request(args, EmptyResultSchema);
        else throw new Error(`unknown rpc: ${method}`);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result ?? {}));
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    call,
    get client() {
      return client;
    },
    workspace,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await client.close();
      await transport.close();
      await rm(temp, { force: true, recursive: true });
    },
  };
}
