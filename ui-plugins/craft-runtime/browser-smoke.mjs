import { automationSmoke } from "./automation-smoke.mjs";
import { chineseSmoke } from "./chinese-smoke.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build, stop } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const selected = process.argv.slice(2);
const names = selected.length ? selected : (await readdir(join(root, "ui-plugins"))).filter((name) => name.endsWith("craft"));
const output = join(root, ".craft-cache/browser-results");
const trace = (value) => { if (process.env.CRAFT_TRACE) console.log(value); };
async function cleanup(label, operation) {
  let timer;
  try {
    await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Cleanup timed out: ${label}`)), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
await mkdir(output, { recursive: true });
const host = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const rpc = async (method, args) => {
  const response = await fetch('/rpc', { method: 'POST', body: JSON.stringify({method, args}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const bridge = new AppBridge(null, {name:'craft-browser-check', version:'1'}, {
  serverResources:{}, serverTools:{}, downloadFile:{},
  experimental: {'zcode/csp': {flags:['wasmUnsafeEval']}},
}, {hostContext: {theme:'dark',locale:'en-US',displayMode:'fullscreen'}});
window.initializations = 0; window.downloads = []; window.cancelDownload = false;
bridge.onreadresource = (params) => rpc('readResource',params);
bridge.oncalltool = (params) => rpc('callTool',params);
bridge.ondownloadfile = async (params) => {
  window.downloads.push(params); return {isError:window.cancelDownload};
};
bridge.onsizechange = () => {};
bridge.oninitialized = async () => {
  window.initializations++;
  await bridge.sendToolInput({arguments:{}});
  await bridge.sendToolResult(await rpc('callTool',{name:'open_editor',arguments:{}}));
};
const frame=document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
window.bridge=bridge;
frame.src='/panel?webgl';
`,
    resolveDir: root, sourcefile: "craft-host.mjs",
  },
  bundle: true, format: "esm", platform: "browser", write: false,
});
// Mirrors the relevant desktop CSP; this fixture does not test Electron partition isolation.
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline' blob: data: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
const launchBrowser = () => chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const results = [];
let browser;
try {
  for (const name of names) {
    const temporary = await mkdtemp(join(tmpdir(), "craft-ui-check-"));
    const installed = join(temporary, "installed");
    // A fresh process also releases GPU/audio resources between independent applications.
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    let http;
    let client;
    const started = Date.now();
    try {
      await cp(join(root, "external_plugins", name), installed, { recursive: true });
      const transport = new StdioClientTransport({
        command: process.execPath, args: [join(installed, "dist/server.mjs")], cwd: temporary,
        env: { PATH: process.env.PATH || "", ZCODE_WORKSPACE_ROOT: temporary }, stderr: "pipe",
      });
      client = new Client({ name: "craft-browser-check", version: "1" });
      await client.connect(transport);
      const panel = await client.readResource({ uri: `ui://${name}/panel.html` });
      assert.equal(panel.contents[0]._meta["zcode/csp"].wasmUnsafeEval, true);
      let chunks = 0;
      http = createServer(async (request, response) => {
        try {
          if (request.url === "/") {
            response.setHeader("Content-Type", "text/html");
            response.end('<!doctype html><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;overflow:hidden}</style><iframe sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen"></iframe><script type="module" src="/host.js"></script>');
          } else if (request.url === "/host.js") {
            response.setHeader("Content-Type", "text/javascript"); response.end(host.outputFiles[0].text);
          } else if (request.url?.startsWith("/panel")) {
            response.setHeader("Content-Type", "text/html");
            response.setHeader("Content-Security-Policy", csp);
            response.end(panel.contents[0].text);
          } else if (request.url === "/rpc" && request.method === "POST") {
            let body = "";
            for await (const chunk of request) body += chunk;
            const { method, args } = JSON.parse(body);
            const result = method === "readResource" ? await client.readResource(args) : await client.callTool(args);
            const serialized = JSON.stringify(result);
            if (method === "readResource") {
              assert.ok(Buffer.byteLength(serialized) < 8 * 1024 * 1024);
              if (args.uri.includes("/asset/")) chunks++;
            }
            response.setHeader("Content-Type", "application/json"); response.end(serialized);
          } else response.writeHead(404).end();
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message }));
        }
      });
      await new Promise((accept) => http.listen(0, "127.0.0.1", accept));
      console.log(`BROWSER ${name}`);
      const navigation = page.waitForEvent("framenavigated", { predicate: (frame) => frame.url().includes("/panel"), timeout: 15000 });
      await page.goto(`http://127.0.0.1:${http.address().port}`, { waitUntil: "domcontentloaded" });
      const frame = await navigation;
      await frame.waitForFunction(() => window.__craftPlugin?.loaded || window.__craftPlugin?.error, null, { timeout: 120000 });
      const state = await frame.evaluate(() => window.__craftPlugin);
      assert.equal(state.error, null, JSON.stringify({ state, consoleErrors }));
      assert.equal(state.loaded, true);
      assert.equal(await page.evaluate(() => window.initializations), 1);
      assert.ok(chunks > 1);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(output, `${name}.png`) });

      // Exercise the same anchor path used by upstream Save/Export, including immediate revocation.
      await page.evaluate(() => { window.cancelDownload = true; });
      await frame.evaluate(() => {
        const url = URL.createObjectURL(new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: "application/octet-stream" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "roundtrip.bin";
        anchor.click(); URL.revokeObjectURL(url);
      });
      await frame.waitForFunction(() => document.getElementById("craft-status").dataset.error === "true");
      assert.equal(await frame.locator("#craft-notice").isVisible(), true);
      await page.evaluate(() => { window.cancelDownload = false; });
      await frame.locator("#craft-retry-export").click();
      await frame.waitForFunction(() => window.__craftPlugin.exports === 1);
      const downloads = await page.evaluate(() => window.downloads);
      assert.equal(downloads.length, 2);
      assert.deepEqual(Buffer.from(downloads[1].contents[0].resource.blob, "base64"), Buffer.from([0, 1, 127, 128, 255]));
      let fileRoundtrip = false;
      if (["gridcraft", "wordcraft", "deckcraft"].includes(name)) {
        // Exercise upstream parsing and its real Save action, not just the adapter's drop event.
        const input = name === "gridcraft" ? "CraftFixture,Quantity\r\nAdapterRoundtrip,42\r\n" :
          name === "deckcraft" ? "# CraftFixture\n\nAdapterRoundtrip 42\n" : "CraftFixture AdapterRoundtrip 42\n";
        const fileName = `roundtrip.${name === "gridcraft" ? "csv" : name === "deckcraft" ? "md" : "txt"}`;
        await writeFile(join(temporary, fileName), input);
        const opened = await client.callTool({ name: "open_editor", arguments: { path: fileName } });
        assert.ok(!opened.isError);
        await page.evaluate((result) => window.bridge.sendToolResult(result), opened);
        await frame.waitForFunction((name) => window.__craftPlugin.openedFile === name, fileName);
        await page.waitForTimeout(500);
        await frame.locator("canvas").click({ position: { x: 500, y: 400 } });
        await page.keyboard.press("ControlOrMeta+s");
        await page.waitForFunction(() => window.downloads.length === 3);
        const saved = await page.evaluate(() => window.downloads[2].contents[0].resource);
        const bytes = Buffer.from(saved.blob, "base64");
        if (name !== "deckcraft") assert.match(decodeURIComponent(saved.uri), /roundtrip/);
        if (bytes.subarray(0, 2).toString() === "PK") {
          // The editors may save an Office document even when opening text/CSV.
          const savedPath = join(temporary, "roundtrip.zip");
          await writeFile(savedPath, bytes);
          const xml = execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(''.join(z.read(n).decode() for n in z.namelist() if n.endswith(('.xml','.json'))))", savedPath], { encoding: "utf8" });
          for (const value of ["CraftFixture", "AdapterRoundtrip", "42"]) assert.ok(xml.includes(value), value);
        } else for (const value of ["CraftFixture", "AdapterRoundtrip", "42"]) assert.ok(bytes.toString().includes(value), value);
        fileRoundtrip = true;
        await page.screenshot({ path: join(output, `${name}-roundtrip.png`) });
      }
      const automation = await automationSmoke({ client, frame, name, workspace:temporary, catalogPath:join(installed,"dist/tools.json") });
      const chinese = await chineseSmoke({ client, name, workspace: temporary, output: join(output, "chinese") });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(output, `${name}-chinese.png`) });
      assert.deepEqual(errors, [], JSON.stringify(consoleErrors));
      assert.equal(await frame.locator("#craft-toolbar, #craft-open, #craft-path").count(), 0);
      assert.equal(await frame.locator("#craft-stage").evaluate((element) => element.getBoundingClientRect().top), 0);
      assert.equal(await frame.locator("#craft-notice").isVisible(), false);
      results.push({ name, status: "passed", chunks, fileRoundtrip, automation, chinese, seconds: Math.round((Date.now() - started) / 1000), consoleErrors });
      console.log(`PASS ${name}: WASM render, ${chunks} resource chunks, one connection, save/cancel/retry`);
    } catch (error) {
      await page.screenshot({ path: join(output, `${name}-failed.png`) }).catch(() => {});
      results.push({ name, status: "failed", error: error.stack, consoleErrors, errors });
      console.error(`FAIL ${name}: ${error.message}\n${consoleErrors.join("\n")}`);
    } finally {
      await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
      trace(`${name}: close page`);
      await cleanup(`${name} page`, () => page.close());
      trace(`${name}: close HTTP`);
      if (http) await cleanup(`${name} HTTP`, () => new Promise((accept) => {
        http.close(accept); http.closeAllConnections();
      }));
      trace(`${name}: close MCP`);
      await cleanup(`${name} MCP`, () => client?.close());
      trace(`${name}: remove temp`);
      await cleanup(`${name} temp`, () => rm(temporary, { recursive: true, force: true }));
      await cleanup(`${name} browser`, () => browser.close());
      browser = undefined;
    }
  }
} finally {
  trace("close browser");
  try { if (browser) await cleanup("browser", () => browser.close()); }
  finally { stop(); }
  trace("browser checks complete");
}
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
