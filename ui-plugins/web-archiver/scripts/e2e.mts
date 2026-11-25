// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 和网络（采集两个真实网页）。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "web-archiver-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "webarch-e2e-"));
const REAL = ["https://en.wikipedia.org/wiki/Web_archiving", "https://www.ruanyifeng.com/blog/2024/01/weekly-issue-285.html"];

// 本地的“会变化的页面”：价格表改了一行、加了一段
let version = 1;
const http = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="zh-CN"><head><title>会员价格说明</title></head><body><article><h1>会员价格说明</h1>
<p>本页面说明会员的价格与权益。以下内容会不定期调整，请以页面为准。我们会提前一周通知所有会员。</p>
<p>月度会员：每月 ${version === 1 ? "30" : "36"} 元，可随时取消。年度会员享受八五折优惠，并赠送两个月的额外时长。</p>
<p>学生会员需要提供有效的学生证明，审核通过后价格为月度会员的一半。审核一般在三个工作日内完成。</p>
${version === 2 ? "<p>自 2027 年 1 月 1 日起，新增家庭会员：最多五人共享，每月 68 元。</p>" : ""}
<p>如有疑问，请通过帮助中心联系客服。客服工作时间为每天上午九点到晚上九点。</p></article></body></html>`);
});
await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
const local = `http://127.0.0.1:${(http.address() as { port: number }).port}/pricing`;

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("user pastes two real URLs, ticks screenshot and captures");
  await frame.locator(".toolbar textarea").fill(REAL.join("\n"));
  await frame.locator("label", { hasText: "截图" }).locator("input").check();
  await frame.locator("button", { hasText: "采集" }).click();
  await frame.locator(".result .ok").nth(1).waitFor({ timeout: 240_000 });
  await frame.locator(".reader h1", { hasText: "科技爱好者周刊" }).waitFor({ timeout: 30_000 });
  await frame.locator(".reader img").first().waitFor();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "01-article.png") });
  const index = JSON.parse(await readFile(join(workspace, "web-archive/index.json"), "utf8"));
  assert.equal(index.entries.length, 2);
  for (const e of index.entries) {
    const c = e.captures[0];
    assert.ok(c.paragraphs > 20, `${e.url} paragraphs`);
    assert.ok(c.images > 0, `${e.url} images`);
    assert.equal(c.screenshot, true, `${e.url} screenshot`);
    const md = await readFile(join(workspace, c.dir, "article.md"), "utf8");
    assert.match(md, /\]\(assets\/001\.\w+\)/);
  }
  step("user opens the Wikipedia capture and its screenshot");
  await frame.locator(".entry", { hasText: "Web archiving" }).locator(".cap").first().click();
  await frame.locator(".reader", { hasText: "Web archiving is the process of collecting" }).waitFor();
  await frame.locator(".tabs button", { hasText: "截图" }).click();
  await frame.locator(".shot img").waitFor();
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(shots, "02-screenshot.png") });

  step("agent captures a pricing page twice; the second capture shows what changed");
  await harness.agent(outer, "archive_capture", { urls: [local] });
  version = 2;
  const r = await harness.agent(outer, "archive_capture", { urls: [local] });
  assert.match(r.content[0].text, /\+1 −0 ~1 paragraph\(s\)/);
  await frame.locator(".cap.sel", { hasText: "+1 −0 ~1" }).waitFor();
  await frame.locator(".cap.sel").click();
  await frame.locator(".diff .mod ins", { hasText: "6" }).waitFor();
  await frame.locator(".diff .add", { hasText: "家庭会员" }).waitFor();
  await frame.waitForTimeout(300);
  await outer.screenshot({ path: join(shots, "03-changes.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join("").slice(-2000));
  throw error;
} finally {
  await harness.close();
  http.close();
}
