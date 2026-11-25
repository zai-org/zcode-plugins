// 浏览器端到端测试：
// 1) 真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板：选文档目录 → 生成 → 站点结构/预览；改一篇文档 → 增量构建，列出重写的页面和原因；
// 2) 在 Chrome 里打开生成的站点（HTTP）：首页搜索下拉、键盘选择跳转、文章页面包屑/目录/相关文章/上一篇下一篇、搜索结果页；
// 3) 中文站点用 file:// 直接打开，离线中文搜索可用。需要 Chrome。
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "help-center-builder-shots");
mkdirSync(shots, { recursive: true });
const S = process.env.HELP_SAMPLES ?? "/workspace/zcode-new-plugins/samples/help";
const workspace = await mkdtemp(join(tmpdir(), "hcb-e2e-"));
cpSync(join(S, "harbor"), join(workspace, "docs"), { recursive: true });
cpSync(join(S, "zh"), join(workspace, "zh-docs"), { recursive: true });
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
let web: ReturnType<typeof createServer> | undefined;
try {
  step("panel: build the Harbor help center");
  const { outer, frame, context } = await harness.open("?locale=zh-CN", { width: 1440, height: 1000 });
  await frame.locator("select.docs option[value='docs']").waitFor({ state: "attached", timeout: 20_000 });
  await frame.locator("select.docs").selectOption("docs");
  await frame.locator("button.build").click();
  await frame.locator(".sum", { hasText: "15 篇文章、5 个分类、共 23 个页面" }).waitFor({ timeout: 60_000 });
  await frame.locator(".iss .info", { hasText: "onclick" }).waitFor();
  assert.equal(await frame.locator(".iss .error, .iss .warn").count(), 0);
  await frame.frameLocator("iframe.pv").locator(".hero h1", { hasText: "How can we help?" }).waitFor();
  await frame.locator(".tree a", { hasText: "Refunds" }).click();
  await frame.frameLocator("iframe.pv").locator(".crumbs", { hasText: "Billing & payments" }).waitFor();
  await frame.locator(".tree a", { hasText: "Create a Harbor Bikes account" }).click();
  await frame.frameLocator("iframe.pv").locator("article img[src^='data:image/png']").waitFor();
  await outer.screenshot({ path: join(shots, "01-panel-built.png") });

  step("panel: edit one article → incremental build lists what changed and why");
  const f = join(workspace, "docs/billing/refunds.md");
  writeFileSync(f, readFileSync(f, "utf8").replace("title: Refunds", "title: Refunds and chargebacks"));
  await frame.locator("button.build").click();
  await frame.locator(".sum", { hasText: "重写 7 个页面，16 个未变" }).waitFor({ timeout: 60_000 });
  await frame.locator(".rb li[data-out='rentals/change-or-cancel.html'] .why", { hasText: "相关文章变了" }).waitFor();
  await frame.locator(".rb li[data-out='billing/deposits.html'] .why", { hasText: "上一篇/下一篇变了" }).waitFor();
  await frame.locator(".rb li[data-out='billing/refunds.html'] .why", { hasText: "内容改了" }).waitFor();
  await frame.locator(".tree a", { hasText: "Refunds and chargebacks" }).click();
  await frame.frameLocator("iframe.pv").locator("article h1", { hasText: "Refunds and chargebacks" }).waitFor();
  await outer.screenshot({ path: join(shots, "02-panel-incremental.png") });
  await harness.agent(outer, "hc_build", { docs: "zh-docs", out: "zh-site" });
  await frame.locator(".sum", { hasText: "5 篇文章" }).waitFor({ timeout: 30_000 });

  step("site over HTTP: search dropdown, keyboard, article layout");
  const site = join(workspace, "help-center");
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".xml": "application/xml" };
  web = createServer((req, res) => {
    let p = join(site, decodeURIComponent(new URL(req.url!, "http://x").pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!p.startsWith(site) || !existsSync(p)) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end(readFileSync(join(site, "404.html"))); }
    res.writeHead(200, { "Content-Type": types[extname(p)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    res.end(readFileSync(p));
  });
  const port = await new Promise<number>((ok) => web!.listen(0, "127.0.0.1", () => ok((web!.address() as { port: number }).port)));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator(".hero input").fill("refund");
  await page.locator(".hero .results .hit").first().waitFor();
  assert.match(await page.locator(".hero .results .hit .hit-t").first().innerText(), /Refunds and chargebacks/);
  await page.locator(".hero input").fill("deposit card");
  await page.locator(".hero .results .hit-t", { hasText: "Deposits and card holds" }).waitFor();
  await page.screenshot({ path: join(shots, "03-site-search.png") });
  await page.locator(".hero input").press("ArrowDown");
  await page.locator(".hero input").press("Enter");
  await page.waitForURL(/billing\/deposits\.html$/);
  await page.locator(".crumbs", { hasText: "Billing & payments" }).waitFor();
  await page.goto(`http://127.0.0.1:${port}/getting-started/create-account.html`);
  await page.locator(".toc a", { hasText: "Sign up on the web" }).click();
  await page.waitForURL(/#sign-up-on-the-web$/);
  assert.equal(await page.locator(".side a.on").innerText(), "Create a Harbor Bikes account");
  await page.locator(".pn a.next", { hasText: "Take your first ride" }).waitFor();
  assert.ok(await page.locator("article img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 360));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shots, "04-site-article.png") });
  await page.locator(".top input").fill("full station");
  await page.locator(".top input").press("Enter");
  await page.waitForURL(/search\.html\?q=full/);
  await page.locator("#search-page .hit-t", { hasText: "Ending a rental when a station is full" }).waitFor();
  assert.match(await page.locator("#search-count").innerText(), /results for “full station”/);
  await page.goto(`http://127.0.0.1:${port}/billing/index.html`);
  assert.equal(await page.locator(".list li").count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/bikes/battery.html`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 391), "no horizontal scroll on mobile");
  assert.deepEqual(errors, []);

  step("Chinese site from file:// (offline search)");
  const zh = await context.newPage();
  await zh.setViewportSize({ width: 1280, height: 860 });
  await zh.goto(pathToFileURL(join(workspace, "zh-site/index.html")).href);
  await zh.locator(".hero h1", { hasText: "有什么可以帮你？" }).waitFor();
  await zh.locator(".hero input").fill("退款");
  await zh.locator(".hero .results .hit-t", { hasText: "会员如何退款" }).waitFor();
  assert.equal(await zh.locator(".hero .results .hit-t mark").first().innerText(), "退款");
  await zh.screenshot({ path: join(shots, "05-zh-file-search.png") });
  await zh.locator(".hero .results .hit").first().click();
  await zh.locator(".related a", { hasText: "我的数据安全吗" }).waitFor();
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  web?.close();
  await harness.close();
}
