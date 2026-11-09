import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
const directory = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const http = createServer(async (req, res) => {
  try {
    const path = resolve(directory, `.${new URL(req.url, "http://localhost").pathname}`);
    if (!path.startsWith(directory + sep)) throw new Error("Invalid path");
    res.setHeader("Content-Type", ({ ".wasm":"application/wasm", ".js":"text/javascript", ".html":"text/html" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${http.address().port}/index.html?webgl`);
  await page.waitForFunction(() => typeof window.wasmBindings?.craft_catalog === "function", null, { timeout: 120000 });
  const tools = await page.evaluate(() => JSON.parse(window.wasmBindings.craft_catalog()));
  if (!Array.isArray(tools) || !tools.length || new Set(tools.map((t) => t.name)).size !== tools.length)
    throw new Error("Invalid/duplicate WASM tool catalog");
  await writeFile(output, JSON.stringify(tools, null, 2) + "\n");
  console.log(`Extracted ${tools.length} tools from compiled WASM`);
} finally { if (browser) await browser.close(); http.closeAllConnections(); await new Promise((done) => http.close(done)); }
