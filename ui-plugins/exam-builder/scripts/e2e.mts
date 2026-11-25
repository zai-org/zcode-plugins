// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "exam-builder-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "exam-e2e-"));
await cp(process.env.EXAM_SAMPLES ?? "/workspace/zcode-new-plugins/samples/exam", join(workspace, "题库"), { recursive: true });
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("teacher ticks the maths bank and loads it");
  await frame.locator("label", { hasText: "高一数学题库.md" }).locator("input").check();
  await frame.locator("button", { hasText: "载入题库" }).click();
  await frame.locator(".issue").nth(4).waitFor({ timeout: 60_000 });
  assert.match(await frame.locator(".stats").textContent() ?? "", /37道题32可用5个问题4个章节/);
  step("teacher fills in the rules and builds two sets");
  await frame.locator("input.title").fill("高一数学期中测试");
  await frame.locator("input.short").fill("90 分钟");
  await frame.locator("input[data-type='single']").fill("6");
  await frame.locator("input[data-type='multi']").fill("1");
  await frame.locator("input[data-type='tf']").fill("2");
  await frame.locator("input[data-type='short']").fill("1");
  await frame.locator(".rules .row input.n").first().fill("2");
  await frame.locator("button", { hasText: "组卷" }).click();
  await frame.locator(".paper .q").nth(5).waitFor({ timeout: 60_000 });
  await frame.locator(".paper svg").first().waitFor();
  await outer.screenshot({ path: join(shots, "01-bank-and-paper.png") });
  step("teacher swaps the first question");
  const first = await frame.locator(".paper .q").first().getAttribute("data-id");
  await frame.locator(".paper .q").first().hover();
  await frame.locator(".paper .q").first().locator(".swap").click();
  await frame.waitForFunction((id) => document.querySelector(".paper .q")?.getAttribute("data-id") !== id && !document.getElementById("root")!.classList.contains("busy"), first);
  step("agent checks the papers; teacher looks at set B's answer key");
  const st = (await harness.agent(outer, "exam_bank", {})).structuredContent;
  assert.equal(st.project.papers.length, 2);
  await frame.locator(".tab", { hasText: "B 卷" }).click();
  await frame.locator(".tab", { hasText: "答案" }).click();
  await frame.locator(".paper .q", { hasText: "答案：" }).first().waitFor();
  await outer.screenshot({ path: join(shots, "02-answer-key.png") });
  step("teacher exports");
  await frame.locator("button", { hasText: "导出 PDF + HTML" }).click();
  await frame.locator(".toast", { hasText: "已导出 9 个文件" }).waitFor({ timeout: 120_000 });
  assert.ok((await stat(join(workspace, "exams/高一数学期中测试/高一数学期中测试-A卷.pdf"))).size > 20_000);
  assert.ok((await stat(join(workspace, "exams/高一数学期中测试/高一数学期中测试-B卷-答案.pdf"))).size > 10_000);
  assert.deepEqual(harness.errors, []);
  process.stdout.write(`WS=${workspace}\n`);
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
