// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
// CITE_SAMPLES：国家统计局 2024 年统计公报（网页打印成 PDF）、WHO 肥胖事实清单网页，以及一份故意写错几处的简报。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "citation-checker-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "cite-e2e-"));
const S = process.env.CITE_SAMPLES ?? "/workspace/zcode-new-plugins/samples/cite";
await mkdir(join(workspace, "简报"), { recursive: true });
await cp(join(S, "报告.md"), join(workspace, "简报/报告.md"));
await cp(join(S, "资料"), join(workspace, "简报/资料"), { recursive: true });

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1400, height: 950 });
  step("agent checks the brief against the folder's PDF and web page");
  const r = await harness.agent(outer, "cite_check", { report: "简报/报告.md" });
  const s = r.structuredContent.state;
  assert.deepEqual(s.claims.map((c: any) => c.status), ["ok", "ok", "ok", "number", "number", "ok", "ok", "ok", "missing", "ok", "quote", "weak"]);
  assert.match(r.content[0].text, /5\.2% not in source \(source says 5\.1%\)/);
  await frame.locator(".item").nth(11).waitFor({ timeout: 60_000 });
  assert.equal(await frame.locator(".fchip.number").textContent(), "数字不符 2");

  step("first problem is selected: unemployment 5.2% vs 5.1%, PDF page with the passage highlighted");
  await frame.locator(".item.sel", { hasText: "失业率" }).waitFor();
  await frame.locator(".nums td.bad", { hasText: "资料为 5.1%" }).waitFor();
  await frame.locator(".pagebox .hl").first().waitFor({ timeout: 60_000 });
  assert.match(await frame.locator(".vhead").textContent() ?? "", /统计公报-2024\.pdf · 第 3 \/ 51 页/);
  const pb = (await frame.locator(".pagebox").boundingBox())!;
  const hl = (await frame.locator(".pagebox .hl").first().boundingBox())!;
  assert.ok(hl.x >= pb.x && hl.x + hl.width <= pb.x + pb.width + 1 && hl.y > pb.y && hl.width > 20, "highlight sits on the page");
  // 高亮下面确实是深色文字：取画布像素
  const dark = await frame.locator(".pagebox").evaluate((box) => {
    const c = box.querySelector("canvas")!, h = box.querySelector(".hl") as HTMLElement;
    const k = c.width / c.clientWidth, g = c.getContext("2d")!;
    const d = g.getImageData(h.offsetLeft * k, h.offsetTop * k, h.offsetWidth * k, h.offsetHeight * k).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) n++;
    return n / (d.length / 4);
  });
  assert.ok(dark > 0.04, `highlighted area has text pixels (${dark})`);
  await frame.waitForTimeout(400);
  await outer.screenshot({ path: join(shots, "01-number-mismatch.png") });

  step("user marks it wrong with a note; panel moves on to the next open problem");
  await frame.locator("input.note").fill("公报为 5.1%");
  await frame.locator(".vbtn.wrong").click();
  await frame.locator(".item.sel", { hasText: "新能源汽车" }).waitFor();
  await frame.locator(".item", { hasText: "失业率" }).locator(".vchip.wrong").waitFor();

  step("quote mismatch shows the word diff and jumps to the WHO page paragraph");
  await frame.locator(".item", { hasText: "tripled" }).click();
  await frame.locator(".qdiff ins", { hasText: "tripled" }).waitFor();
  await frame.locator(".qdiff del", { hasText: "more than doubled" }).waitFor();
  await frame.locator(".textview mark", { hasText: "Worldwide adult obesity has more than doubled since 1990" }).waitFor();
  await outer.screenshot({ path: join(shots, "02-quote-mismatch.png") });

  step("cross-language claim needs a look: numbers agree with the English source");
  await frame.locator(".item", { hasText: "45% 超重" }).click();
  await frame.locator(".textview mark", { hasText: "45% of adults 18 years and over" }).waitFor();
  await frame.locator(".vbtn.supported").click();
  await frame.locator(".item", { hasText: "45% 超重" }).locator(".vchip.supported").waitFor();

  step("unsupported claim has no source passage");
  await frame.locator(".fchip.missing").click();
  assert.equal(await frame.locator(".item").count(), 1);
  await frame.locator(".item", { hasText: "快递网点" }).click();
  await frame.locator(".detail", { hasText: "资料里找不到支持这句话的内容" }).waitFor();

  step("agent records the remaining verdicts; panel follows");
  const rv = await harness.agent(outer, "cite_review", { report: "简报/报告.md", reviews: [{ id: "C5", verdict: "wrong", note: "公报为增长 38.7%" }, { id: "C9", verdict: "unsupported", note: "两份资料都没有快递网点数" }, { id: "C11", verdict: "wrong", note: "原文为 more than doubled" }] });
  assert.match(rv.content[0].text, /reviewed 5\/12/);
  await frame.locator(".item", { hasText: "快递网点" }).locator(".vchip.unsupported").waitFor();
  await frame.locator(".fchip", { hasText: "全部" }).click();
  await frame.locator(".item", { hasText: "1349084" }).click();
  await frame.locator(".pagebox .hl").first().waitFor({ timeout: 60_000 });
  assert.match(await frame.locator(".vhead").textContent() ?? "", /第 2 \/ 51 页/);
  await outer.screenshot({ path: join(shots, "03-supported.png") });

  step("user exports the table");
  await frame.locator("button", { hasText: "导出 HTML" }).click();
  await frame.locator(".toast", { hasText: "报告.citations.html" }).waitFor();
  const html = await readFile(join(workspace, "简报/报告.citations.html"), "utf8");
  assert.match(html, /公报为 5\.1%/);
  assert.match(html, /两份资料都没有快递网点数/);
  const page = await outer.context().newPage();
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(`file://${join(workspace, "简报/报告.citations.html")}`);
  await page.screenshot({ path: join(shots, "04-exported-table.png"), fullPage: true });
  await page.close();

  const errors = harness.errors.filter((e: string) => !/favicon/.test(e));
  assert.deepEqual(errors, [], "no console errors");
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
