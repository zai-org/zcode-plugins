// Browser protocol regression: real plugin artifacts and official App/AppBridge.
// OpenPencil 使用资源声明生成 CSP；此夹具不替代桌面 partition / origin 隔离验证。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readPluginCatalog } from "./plugin-catalog.mjs";
import { checkOpenPencilEditor } from "./tests/openpencil-editor.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { plugins } = await readPluginCatalog(root);
const host = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { z } from "zod";
const rpc = async (method, args) => {
  const response = await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method, args }) });
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const bridge = new AppBridge(null, { name: 'page-test', version: '1' }, {
  serverTools: {}, serverResources: {}, updateModelContext: {}, message: {},
  experimental: { 'zcode/widgetState': {} },
}, { hostContext: { theme: 'dark', locale: 'en-US', displayMode: 'fullscreen', 'zcode/widgetState': { restored: true } } });
window.initializations = 0;
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.oncalltool = (args) => rpc('callTool', args);
bridge.onupdatemodelcontext = async (params) => { window.modelContext = params; return {}; };
bridge.onmessage = async (params) => { window.followUp = params; return {}; };
bridge.onsizechange = () => {};
bridge.setRequestHandler('ui/set-widget-state', { params: z.object({ widgetState: z.unknown() }), result: EmptyResultSchema }, async (params) => { window.savedState = params.widgetState; return {}; });
bridge.oninitialized = async () => {
  window.initializations++;
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await rpc('initial', {}));
};
const frame = document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
window.bridge = bridge;
frame.src = '/panel';
`,
    resolveDir: root,
    sourcefile: "host-test.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
try {
  for (const short of ["excalidraw", "openpencil"].filter(
    (name) => !process.argv[2] || name === process.argv[2],
  )) {
    const temporary = await mkdtemp(join(tmpdir(), "mcp-app-page-"));
    const plugin = plugins.find(({ entry }) => entry.name === short)?.installed;
    assert.ok(plugin, `Missing marketplace entry: ${short}`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(plugin, "dist/server.mjs")],
      cwd: temporary,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: temporary,
        ZCODE_WORKSPACE_ROOT: temporary,
        ZCODE_PLUGIN_DATA: join(temporary, "data"),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "page-test", version: "1" });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    let moduleFailure = null;
    let server;
    try {
      console.log(`Starting browser protocol check: ${short}`);
      page.on("pageerror", (error) => console.error(`Browser error (${short}): ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") console.error(`Console (${short}): ${message.text()}`);
      });
      await client.connect(transport);
      const create = {
        excalidraw: {
          name: "create_diagram",
          arguments: { id: "page", title: "Page", elements: [] },
        },
        openpencil: { name: "new_design", arguments: { path: "page.fig" } },
      }[short];
      const initial = await client.callTool(create);
      assert.ok(!initial.isError, JSON.stringify(initial));
      const panel = await client.readResource({ uri: `ui://${short}/panel.html` });
      server = createServer(async (request, response) => {
        try {
          if (request.url === "/") {
            response.setHeader("Content-Type", "text/html");
            response.end(
              '<iframe style="border:0;width:100%;height:780px"></iframe><script type="module" src="/host.js"></script>',
            );
          } else if (request.url === "/host.js") {
            response.setHeader("Content-Type", "text/javascript");
            response.end(host.outputFiles[0].text);
          } else if (request.url === "/panel") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            if (short === "openpencil") {
              // 旧测试没有 CSP，无法发现安装包漏报 WASM / kiwi 动态编译权限。
              const meta = panel.contents[0]._meta;
              const flags = meta?.["zcode/csp"];
              response.setHeader(
                "Content-Security-Policy",
                [
                  "default-src 'none'",
                  `script-src 'self' 'unsafe-inline' blob: data:${flags?.unsafeEval === true ? " 'unsafe-eval'" : ""}${flags?.wasmUnsafeEval === true ? " 'wasm-unsafe-eval'" : ""}`,
                  "style-src 'self' 'unsafe-inline'",
                  "img-src 'self' data: blob:",
                  "font-src 'self' data:",
                  `connect-src ${meta.ui.csp.connectDomains.join(" ")}`,
                  "worker-src 'self' blob:",
                ].join("; "),
              );
            }
            response.end(panel.contents[0].text);
          } else if (request.url === "/rpc" && request.method === "POST") {
            let body = "";
            for await (const chunk of request) body += chunk;
            const { method, args } = JSON.parse(body);
            let result =
              method === "initial"
                ? initial
                : method === "readResource"
                  ? await client.readResource(args)
                  : method === "callTool"
                    ? await client.callTool(args)
                    : null;
            if (moduleFailure && method === "readResource") {
              if (args.uri.endsWith("/assets.json"))
                result = {
                  contents: [
                    { uri: args.uri, text: JSON.stringify({ scripts: ["bundle-0.txt"] }) },
                  ],
                };
              else if (args.uri.endsWith("/bundle-0.txt"))
                result = { contents: [{ uri: args.uri, text: moduleFailure }] };
            }
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result));
          } else response.writeHead(404).end();
        } catch (error) {
          response
            .writeHead(500, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: error.message }));
        }
      });
      await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
      await page.goto(`http://127.0.0.1:${server.address().port}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForFunction(() => window.initializations === 1, null, { timeout: 15000 });
      const frame = page.frames().find((item) => item !== page.mainFrame());
      await frame.waitForFunction((name) => Boolean(window[`__${name}Panel`]), short, {
        timeout: 30000,
      });
      assert.deepEqual(
        await frame.evaluate(() => window.__pluginClient.toolOutput),
        initial.structuredContent,
      );
      assert.equal(await frame.evaluate(() => window.__pluginClient.theme), "dark");
      await frame.evaluate(() =>
        window.__pluginClient.setWidgetState({ restored: false, edited: true }),
      );
      assert.deepEqual(await page.evaluate(() => window.savedState), {
        restored: false,
        edited: true,
      });
      await page.evaluate(() => window.bridge.sendToolCancelled({ reason: "stopped" }));
      await frame.waitForFunction(() => window.__pluginClient.toolCancelled?.reason === "stopped");
      assert.equal(await page.evaluate(() => window.initializations), 1);
      if (short === "openpencil") {
        assert.deepEqual(panel.contents[0]._meta["zcode/csp"], {
          wasmUnsafeEval: true,
          unsafeEval: true,
        });
        assert.equal(
          await frame.evaluate(() => window.__openpencilPanel.documents.error.value),
          null,
        );
        assert.equal(
          await frame.evaluate(() => window.__openpencilPanel.documents.current.value?.id),
          initial.structuredContent.document.id,
        );
        await frame.waitForFunction(
          () => window.__openpencilPanel.canvasReady && window.__openpencilPanel.bridgeConnected,
        );
        const pages = await client.callTool({ name: "list_pages", arguments: {} });
        assert.ok(!pages.isError, JSON.stringify(pages));
        // 真实画布交互及 .fig worker 保存，覆盖 WASM 启动后才触发的 kiwi 编译。
        await frame.locator('[data-test-id="toolbar-tool-rectangle"]').click();
        const canvas = await frame.locator('[data-test-id="canvas-area"]').boundingBox();
        assert.ok(canvas);
        await page.mouse.move(canvas.x + 100, canvas.y + 100);
        await page.mouse.down();
        await page.mouse.move(canvas.x + 220, canvas.y + 180, { steps: 5 });
        await page.mouse.up();
        await frame.waitForFunction(() => window.__openpencilPanel.documents.isDirty());
        await frame.evaluate(() => window.__openpencilPanel.flush());
        assert.equal(
          await frame.evaluate(() => window.__openpencilPanel.documents.status.value),
          "saved",
        );
        assert.equal(
          await frame.evaluate(() => window.__openpencilPanel.documents.error.value),
          null,
        );
        // 启动完成后不应再由加载器接管编辑阶段的异常。
        await frame.evaluate(() =>
          window.dispatchEvent(new ErrorEvent("error", { message: "later editor error" })),
        );
        assert.ok(await frame.locator('[data-test-id="canvas-area"]').isVisible());
        await checkOpenPencilEditor({ page, frame, client, initial });
        console.log(
          "PASS OpenPencil CSP: document loaded, canvas ready, bridge call, draw and save",
        );
        for (const source of [
          "await Promise.reject(new Error('startup rejection'));",
          "throw new Error('startup evaluation');",
          "const = ;",
        ]) {
          moduleFailure = source;
          await page.reload({ waitUntil: "domcontentloaded" });
          const failedFrame = page.frames().find((item) => item !== page.mainFrame());
          await failedFrame.waitForFunction(() =>
            document.getElementById("root")?.textContent?.includes("Failed to load:"),
          );
          const message = await failedFrame.locator("#root").innerText();
          assert.ok(!message.includes("Loading design editor"), message);
          assert.match(message, /startup rejection|startup evaluation|Unexpected token/);
        }
        console.log(
          "PASS OpenPencil module startup errors: rejection, evaluation and syntax error end Loading",
        );
      }
      console.log(
        `PASS official App/AppBridge ${short}: one connection, initial result, theme, widget state, cancellation`,
      );
    } catch (error) {
      await page.screenshot({ path: `/tmp/mcp-app-${short}-failure.png` }).catch(() => {});
      for (const frame of page.frames())
        console.error(
          (
            await frame
              .locator("body")
              .innerText()
              .catch(() => "")
          ).slice(0, 2500),
        );
      console.error(`Failed ${short}: ${error.stack}`);
      throw error;
    } finally {
      await page.close();
      if (server) {
        server.closeAllConnections();
        await new Promise((accept) => server.close(accept));
      }
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
