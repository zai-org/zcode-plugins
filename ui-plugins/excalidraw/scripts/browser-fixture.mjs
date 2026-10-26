import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 使用真实打包 MCP/SQLite；只用本地 HTTP 替代宿主 bridge，不接触用户画板。
export async function startFixture() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temp = await mkdtemp(join(tmpdir(), "excalidraw-browser-"));
  const workspace = join(temp, "workspace");
  await mkdir(workspace);
  const connect = async () => {
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
    const client = new Client({ name: "browser-regression", version: "1" });
    await client.connect(transport);
    return { client, transport };
  };
  let { client, transport } = await connect();
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return result.structuredContent;
  };
  const initial = await call("create_diagram", {
    id: "demo",
    title: "应用启动流程",
    elements: [
      {
        id: "box",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        label: { text: "启动应用" },
      },
      {
        id: "second",
        x: 320,
        y: 0,
        width: 200,
        height: 100,
        backgroundColor: "#b2f2bb",
        fillStyle: "solid",
        label: { text: "创建窗口" },
      },
      {
        id: "third",
        x: 640,
        y: 0,
        width: 200,
        height: 100,
        backgroundColor: "#d0bfff",
        fillStyle: "solid",
        label: { text: "加载页面" },
      },
    ],
  });
  const html = await readFile(join(root, "dist/ui/panel.html"), "utf8");
  let bootstrap = { toolInput: null, toolOutput: initial, widgetState: null };
  const resourceReads = [];
  const bridge = () => `<script>
    async function rpc(method, args) {
      const response = await fetch('/rpc', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
      const value = await response.json(); if(!response.ok) throw Error(value.error); return value;
    }
    window.__contexts = [];
    window.__activeContexts = [];
    window.__pluginClient = {
      theme: 'light', locale: 'zh-CN', toolCancelled: null, ...${JSON.stringify(bootstrap)},
      readResource: (uri) => rpc('readResource', {uri}),
      callTool: (name, args) => rpc('callTool', {name, arguments:args}),
      updateModelContext: async (value) => {
        window.__latestContext = value;
        (value.structuredContent.kind === 'active-diagram' ? window.__activeContexts : window.__contexts).push(value);
      },
      setWidgetState: async (value) => { window.__pluginClient.widgetState = value; },
      notifyIntrinsicHeight: () => {},
    };
    window.__publish = (output, input = window.__pluginClient.toolInput) => { window.__pluginClient.toolInput = input; window.__pluginClient.toolOutput = output; window.dispatchEvent(new Event('plugin:change')); };
  </script>`;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html.replace("<script>", `${bridge()}<script>`));
      } else if (request.method === "POST" && request.url === "/rpc") {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 10 * 1024 * 1024) throw new Error("Request too large");
        }
        const { method, args } = JSON.parse(body);
        if (method === "readResource") resourceReads.push(args.uri);
        const result =
          method === "readResource"
            ? await client.readResource(args)
            : method === "callTool"
              ? await client.callTool(args)
              : null;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response
        .writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: String(error) }));
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
    resourceReads,
    setBootstrap(value) {
      bootstrap = { toolInput: null, toolOutput: null, widgetState: null, ...value };
    },
    async restart() {
      await client.close();
      await transport.close();
      ({ client, transport } = await connect());
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await client.close();
      await transport.close();
      await rm(temp, { force: true, recursive: true });
    },
  };
}
if (process.argv.includes("--serve")) {
  const fixture = await startFixture();
  console.log(fixture.url);
  const stop = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
