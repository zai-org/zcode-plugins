// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
// DOC_SAMPLES 指向样本文件夹（GitHub 服务条款两版，CC0；模拟的中文合同两版），见 SOURCES.txt。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "doc-compare-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "dc-e2e-"));
await cp(process.env.DOC_SAMPLES ?? "/workspace/zcode-new-plugins/samples/doc-compare", join(workspace, "合同与条款"), { recursive: true });

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1400, height: 950 });
  step("user picks the Chinese contract: old DOCX vs new PDF");
  await frame.locator(".toolbar select").first().locator("option", { hasText: "合同-v1.docx" }).waitFor({ state: "attached" });
  await frame.locator(".toolbar select").nth(0).selectOption("合同与条款/合同-v1.docx");
  await frame.locator(".toolbar select").nth(1).selectOption("合同与条款/合同-v2.pdf");
  await frame.locator("button", { hasText: "对照" }).click();
  await frame.locator(".card.chg").nth(5).waitFor();
  assert.equal(await frame.locator(".card.chg").count(), 6);
  step("user clicks the prepayment change, confirms the price, questions the prepayment");
  const prepay = frame.locator(".card.chg", { hasText: "“40” → “30”" });
  await prepay.click();
  await frame.locator(".drow.sel del", { hasText: "40" }).waitFor();
  await prepay.locator("button", { hasText: "疑问" }).click();
  await frame.locator(".card.chg.question input.note").fill("预付款从 40% 降到 30%，需要和财务确认");
  await frame.locator(".card.chg.question input.note").press("Enter");
  await frame.locator(".card.chg", { hasText: "65,000" }).locator("button", { hasText: "确认" }).click();
  await frame.locator(".chip", { hasText: "已确认 1" }).waitFor();
  await frame.locator(".chip", { hasText: "# 涉及数字" }).click();
  assert.equal(await frame.locator(".card.chg").count(), 4);
  await frame.locator(".chip", { hasText: "全部" }).click();
  await frame.waitForTimeout(300);
  await outer.screenshot({ path: join(shots, "01-contract.png") });
  await frame.locator("button", { hasText: "导出报告" }).click();
  await frame.locator(".card", { hasText: "已导出" }).waitFor();
  const review = JSON.parse(await readFile(join(workspace, "doc-compare/合同-v1__合同-v2.review.json"), "utf8"));
  assert.deepEqual(Object.values(review.reviews).map((r: any) => r.status).sort(), ["ok", "question"]);
  const page = await outer.context().newPage();
  await page.goto(pathToFileURL(join(workspace, "doc-compare/合同-v1__合同-v2.html")).href);
  await page.locator("tr.question", { hasText: "需要和财务确认" }).waitFor();
  await page.screenshot({ path: join(shots, "03-report.png"), fullPage: true });
  await page.close();

  step("agent compares the GitHub Terms of Service 2025 → 2026 (PDFs) and flags the AI section");
  const r = await harness.agent(outer, "compare_open", { old: "合同与条款/tos-2025-03.pdf", new: "合同与条款/tos-2026-04.pdf" });
  const ai = r.structuredContent.changes.find((c: any) => c.kind === "added" && /AI Features, Training, and Your Data/.test(c.newText));
  assert.ok(ai, "AI section heading is an addition");
  await harness.agent(outer, "compare_review", { old: "合同与条款/tos-2025-03.pdf", new: "合同与条款/tos-2026-04.pdf", reviews: [{ id: ai.id, status: "question", note: "New AI/training terms — check opt-out" }] });
  await frame.locator(".card.chg.question").first().waitFor();
  await frame.locator(".card.chg.question").first().click();
  await frame.waitForTimeout(800);
  await frame.locator(".gap").first().waitFor();
  await outer.screenshot({ path: join(shots, "02-terms.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
