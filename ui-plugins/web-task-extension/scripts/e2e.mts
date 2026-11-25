// 浏览器端到端测试：
// 1) 真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板：生成扩展、看校验/权限/弹窗预览、在面板里编辑步骤并重新生成；
// 2) 把生成的扩展真的加载进 Chrome（CDP Extensions.loadUnpacked，等同“加载已解压的扩展程序”），
//    在设置页填值，点弹窗里的“运行任务”，对本地虚构供应商门户跑完整流程（打开、关横幅、填写、提交、等待、翻页提取、导出 CSV、下载规格单）；
// 3) 另一个扩展对真实的 books.toscrape.com 跑翻页提取并导出 JSON。需要 Chrome 和网络（第 3 步）。
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "web-task-extension-shots");
mkdirSync(shots, { recursive: true });
const S = process.env.TASK_SAMPLES ?? "/workspace/zcode-new-plugins/samples/webtask";
const workspace = await mkdtemp(join(tmpdir(), "wte-e2e-"));
const step = (t: string) => process.stdout.write(`• ${t}\n`);

// 本地虚构门户
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain; charset=utf-8" };
const portal = createServer((req, res) => {
  const p = join(S, "portal", decodeURIComponent(new URL(req.url!, "http://x").pathname).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(join(S, "portal")) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
const port = await new Promise<number>((ok) => portal.listen(0, "127.0.0.1", () => ok((portal.address() as { port: number }).port)));
const PORTAL = `http://127.0.0.1:${port}`;
const task = (f: string) => JSON.parse(readFileSync(join(S, f), "utf8").replaceAll("{{PORTAL}}", PORTAL));

const harness = await startHarness({ workspace });
let chrome: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
try {
  step("panel: generate the portal extension");
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 1000 });
  await harness.agent(outer, "ext_new", task("portal-task.json"));
  await frame.locator(".sum.ok", { hasText: "harbor-parts-price-export-1.0.0.zip" }).waitFor({ timeout: 20_000 });
  assert.equal(await frame.locator(".checks .bad").count(), 0);
  assert.equal(await frame.locator("table.perm tr").count(), 4);
  await frame.locator("table.perm", { hasText: "保存到“下载”文件夹" }).waitFor();
  assert.equal(await frame.locator("ol.steps li").count(), 10);
  const pop = frame.frameLocator("iframe.pop");
  await pop.locator("#run", { hasText: "运行任务" }).waitFor();
  await outer.screenshot({ path: join(shots, "01-panel-generated.png") });

  step("panel: edit steps (JSON) → regenerate 1.0.1");
  await frame.locator("button.editbtn").click();
  const draft = JSON.parse(await frame.locator("textarea.edit").inputValue());
  draft.steps[7].maxPages = 3;
  draft.steps.push({ action: "wait", ms: 500, note: "Let the downloads start" });
  await frame.locator("textarea.edit").fill(JSON.stringify(draft, null, 2));
  await frame.locator("button.apply").click();
  await frame.locator("h1", { hasText: "v1.0.1" }).waitFor({ timeout: 20_000 });
  assert.equal(await frame.locator("ol.steps li").count(), 11);
  await frame.locator("ol.steps li", { hasText: "最多 3 页" }).waitFor();
  step("panel: invalid edit is rejected with the reason");
  await frame.locator("button.editbtn").click();
  const bad = JSON.parse(await frame.locator("textarea.edit").inputValue());
  bad.steps[2].value = "{{sku}}";
  await frame.locator("textarea.edit").fill(JSON.stringify(bad));
  await frame.locator("button.apply").click();
  await frame.locator(".toast.error", { hasText: "sku" }).waitFor({ timeout: 10_000 });
  await frame.locator("button.editbtn").click();
  await harness.agent(outer, "ext_new", task("books-task.json"));
  await frame.locator(".sum.ok", { hasText: "mystery-books-price-list-1.0.0.zip" }).waitFor({ timeout: 20_000 });
  await harness.agent(outer, "ext_new", task("current-tab-task.json"));
  await frame.locator(".checks .warn", { hasText: "activeTab" }).waitFor({ timeout: 20_000 });
  const { outer: en, frame: enf } = await harness.open("?locale=en-US", { width: 1280, height: 1000 });
  await enf.locator("select.pick").waitFor({ timeout: 20_000 });
  await enf.locator("select.pick").selectOption("extensions/harbor-parts-price-export");
  await enf.locator("h1", { hasText: "v1.0.1" }).waitFor();
  await enf.locator("button.recheck").click();
  await enf.locator(".sum.ok", { hasText: "1.0.1.zip" }).waitFor();
  await en.screenshot({ path: join(shots, "02-panel-en.png") });

  step("chrome: load the generated extensions unpacked");
  const downloads = join(workspace, "Downloads");
  mkdirSync(downloads, { recursive: true });
  const profile = join(workspace, "chrome-profile");
  mkdirSync(join(profile, "Default"), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true }, safebrowsing: { enabled: false } }));
  chrome = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging", "--lang=zh-CN"], locale: "zh-CN", viewport: { width: 420, height: 720 }, deviceScaleFactor: 2, acceptDownloads: true });
  const cdp = await chrome.browser()!.newBrowserCDPSession();
  // Playwright 默认把下载重定向到它的临时目录；改回普通“允许下载到指定文件夹”，相当于用户的“下载”目录。
  await cdp.send("Browser.setDownloadBehavior" as never, { behavior: "default" } as never);
  const load = async (out: string) => (await cdp.send("Extensions.loadUnpacked" as never, { path: join(workspace, out) } as never) as { id: string }).id;
  const portalId = await load("extensions/harbor-parts-price-export");
  const booksId = await load("extensions/mystery-books-price-list");
  const tabId = await load("extensions/copy-table-from-this-page");
  assert.ok(portalId && booksId && tabId, "Chrome accepted all three manifests");
  const pageErrors: string[] = [];
  chrome.on("page", (p) => p.on("pageerror", (e) => pageErrors.push(String(e))));

  step("chrome: options page — set the category");
  const opts = await chrome.newPage();
  await opts.setViewportSize({ width: 900, height: 900 });
  await opts.goto(`chrome-extension://${portalId}/options.html`);
  await opts.locator("select[name=category]").selectOption("brakes");
  await opts.locator("#save").click();
  await opts.locator("#saved").waitFor();
  await opts.locator("#perms tr", { hasText: "127.0.0.1" }).waitFor();
  await opts.screenshot({ path: join(shots, "04-options.png"), fullPage: true });

  step("chrome: popup → Run task against the portal");
  const popup = await chrome.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${portalId}/popup.html`);
  await popup.locator("#run", { hasText: "运行任务" }).click();
  await popup.locator("#steps li.done").nth(10).waitFor({ timeout: 60_000 });
  assert.equal(await popup.locator("#err").isHidden(), true, await popup.locator("#err").textContent() ?? "");
  await popup.locator(".set b", { hasText: "共 9 行" }).waitFor();
  await popup.bringToFront();
  await popup.screenshot({ path: join(shots, "03-popup-run.png"), fullPage: true });
  const run = await popup.evaluate(() => chrome.storage.local.get("lastRun"));
  const parts = run.lastRun.data.parts as { sku: string; price: string; stock: string; sheet: string }[];
  assert.equal(parts.length, 9);
  assert.ok(parts.every((p) => p.sku.startsWith("HB-BR-") && !/Backorder/.test(p.stock) && p.price.startsWith("€") && p.sheet.startsWith(`${PORTAL}/sheets/`)));
  assert.deepEqual(parts.map((p) => p.sku).slice(0, 3), ["HB-BR-1001", "HB-BR-1002", "HB-BR-1004"]);
  const deadline = Date.now() + 15_000;
  const files = () => readdirSync(downloads, { recursive: true }).map(String).filter((f) => !/crdownload$/.test(f));
  while (Date.now() < deadline && !(files().some((f) => f.endsWith(".csv")) && files().filter((f) => f.endsWith(".txt")).length >= 2)) await new Promise((r) => setTimeout(r, 300));
  const csvName = files().find((f) => f.endsWith(".csv"));
  assert.ok(csvName && /harbor-parts\/brakes-\d{4}-\d{2}-\d{2}\.csv$/.test(csvName), `csv in ${files().join(", ")}`);
  const csv = readFileSync(join(downloads, csvName!), "utf8");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.trim().split(/\r\n/).length, 10);
  assert.match(csv, /^\ufeffsku,part,price,stock,sheet\r\nHB-BR-1001,"Hydraulic disc brake set, 2-piston",€89\.50,42 in stock,/);
  assert.equal(files().filter((f) => f.endsWith(".txt")).length, 2);
  step(`  downloaded: ${files().join(", ")}`);

  step("chrome: books.toscrape.com (real site), 3 pages → JSON");
  const bp = await chrome.newPage();
  await bp.setViewportSize({ width: 380, height: 600 });
  await bp.goto(`chrome-extension://${booksId}/popup.html`);
  await bp.locator("#run").click();
  await bp.locator("#steps li.done").nth(3).waitFor({ timeout: 90_000 }).catch(async (e) => { throw new Error(`${e}\n${await bp.locator("#err").textContent()}`); });
  const br = await bp.evaluate(() => chrome.storage.local.get("lastRun"));
  const books = br.lastRun.data.books as { title: string; price: string; rating: string; url: string }[];
  assert.equal(books.length, 32, `books: ${books.length}`);
  assert.ok(books.every((b) => b.title && /^£\d+\.\d\d$/.test(b.price) && b.url.startsWith("https://books.toscrape.com/catalogue/")));
  await bp.locator(".set b", { hasText: "共 32 行" }).waitFor();
  await bp.screenshot({ path: join(shots, "05-books-run.png"), fullPage: true });
  const end2 = Date.now() + 10_000;
  while (Date.now() < end2 && !files().some((f) => f.endsWith(".json"))) await new Promise((r) => setTimeout(r, 300));
  const jsonName = files().find((f) => /books\/mystery-.*\.json$/.test(f));
  assert.ok(jsonName, files().join(", "));
  assert.equal(JSON.parse(readFileSync(join(downloads, jsonName!), "utf8")).length, 32);

  step("chrome: activeTab extension refuses to run without a target tab and says why");
  const tp = await chrome.newPage();
  await tp.goto(`chrome-extension://${tabId}/popup.html`);
  await tp.locator("#run").click();
  await tp.locator("#err:not([hidden])", { hasText: "不是网页" }).waitFor({ timeout: 20_000 });
  step(`  message: ${await tp.locator("#err").textContent()}`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  await chrome?.close().catch(() => undefined);
  await harness.close();
  portal.close();
}
