// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "contact-list-cleaner-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "contacts-e2e-"));
await cp(process.env.CONTACT_SAMPLES ?? "/workspace/zcode-new-plugins/samples/contacts", join(workspace, "客户名单"), { recursive: true });
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 900 });
  step("user ticks the three lists and cleans them up");
  for (const f of ["CRM导出-2025.xlsx", "展会登记表.csv", "linkedin-contacts.csv"]) await frame.locator("label", { hasText: f }).locator("input").check();
  await frame.locator("button", { hasText: "开始整理" }).click();
  await frame.locator(".pair").nth(2).waitFor({ timeout: 60_000 });
  assert.match(await frame.locator(".stats").textContent() ?? "", /25原始行16整理后联系人8组已合并3对待确认/);
  await outer.screenshot({ path: join(shots, "01-pairs.png") });
  step("user decides: the Millers are the same person, 陈静/陈晶 share an office line, the two 王芳 are different people");
  await frame.locator(".pair", { hasText: "David Miller" }).locator("button", { hasText: "合并" }).click();
  await frame.locator(".pair.decided", { hasText: "David Miller" }).waitFor();
  await frame.locator(".pair", { hasText: "陈晶" }).locator("button", { hasText: "保留两条" }).click();
  await frame.locator(".pair.decided", { hasText: "陈晶" }).waitFor();
  step("agent records the last decision");
  const pend = (await harness.agent(outer, "contacts_load", {})).structuredContent.pairs.filter((p: any) => !p.decision);
  assert.equal(pend.length, 1);
  await harness.agent(outer, "contacts_decide", { decisions: [{ pair: pend[0].id, merge: false }] });
  await frame.locator(".stats", { hasText: "0对待确认" }).waitFor();
  step("user maps the CRM 客户等级 column to notes and looks at the result");
  await frame.locator(".tab", { hasText: "字段映射" }).click();
  await frame.locator("select[data-col='客户等级']").selectOption("notes");
  await frame.waitForFunction(() => (document.querySelector("select[data-col='客户等级']") as HTMLSelectElement | null)?.value === "notes" && !document.getElementById("root")!.classList.contains("busy"));
  await outer.screenshot({ path: join(shots, "02-mapping.png") });
  await frame.locator(".tab", { hasText: "整理结果" }).click();
  await frame.locator("table.result tr", { hasText: "孙丽" }).locator("td.bad").first().waitFor();
  assert.equal(await frame.locator("table.result tr").count(), 16);
  await outer.screenshot({ path: join(shots, "03-result.png") });
  step("user exports to Excel");
  await frame.locator("button", { hasText: "导出 Excel" }).click();
  await frame.locator(".toast", { hasText: "contacts-clean.xlsx" }).waitFor();
  assert.ok((await stat(join(workspace, "cleaned/contacts-clean.xlsx"))).size > 5000);
  await frame.locator(".tab", { hasText: "合并日志" }).click();
  await frame.locator("td", { hasText: "用户确认" }).waitFor();
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
