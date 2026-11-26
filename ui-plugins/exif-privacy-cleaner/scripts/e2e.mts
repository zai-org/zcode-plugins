// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
// 场景写在 test/e2e.json：用户在面板里选文件打开 → Agent 修改 → 用户在表格里改一格 → 导出。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const name = pkg.name.replace("@penova/plugin-", "");
const spec = JSON.parse(await readFile(join(root, "test/e2e.json"), "utf8"));
const shots = process.env.E2E_SHOTS ?? join(tmpdir(), `${name}-shots`);
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), `${name}-e2e-`));
const samples = process.env.SAMPLES ?? join(root, "test/samples");
if (existsSync(samples)) await cp(samples, join(workspace, spec.folder ?? "samples"), { recursive: true });

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
let failShot: (() => Promise<unknown>) | undefined;
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1400, height: 950 });
  failShot = () => outer.screenshot({ path: join(shots, "failed.png") });
  step("user picks the sample in the panel and opens it");
  await frame.locator(".start").waitFor();
  for (const pick of spec.pick ?? []) await frame.locator("label.file", { hasText: pick }).first().click();
  for (const [key, value] of Object.entries(spec.startSettings ?? {})) {
    const el = frame.locator(`.settings [data-key="${key}"]`);
    if (typeof value === "boolean") await el.setChecked(value);
    else if ((await el.evaluate((e) => e.tagName)) === "SELECT") await el.selectOption(String(value));
    else await el.fill(String(value));
  }
  await frame.locator("button.open").click();
  await frame.locator(".project .summary").waitFor();
  const project = (await frame.locator(".pname").textContent())!.trim();
  if (spec.edit) {
    step("agent edits the project");
    await harness.agent(outer, `${spec.prefix}_edit`, { project, ...spec.edit });
  }
  if (spec.uiEdit) {
    step("user edits a cell in the table");
    const cell = frame.locator(`tr[data-row="${spec.uiEdit.row}"] td[data-key="${spec.uiEdit.key}"]`);
    if (typeof spec.uiEdit.value === "boolean") await cell.locator("input").setChecked(spec.uiEdit.value);
    else if (await cell.locator("select").count()) await cell.locator("select").selectOption(String(spec.uiEdit.value));
    else {
      const input = cell.locator("input");
      await input.fill(String(spec.uiEdit.value));
      await input.press("Enter");
      await input.blur();
    }
    await frame.waitForTimeout(800);
  }
  if (spec.expectText) await frame.locator("#root", { hasText: spec.expectText }).waitFor();
  await frame.waitForTimeout(400);
  await outer.screenshot({ path: join(shots, "01-panel.png") });
  step("user exports");
  const all = frame.locator("button.expall");
  if (await all.count()) await all.click();
  else await frame.locator("button.exp").first().click();
  await frame.locator(".exported li").first().waitFor({ timeout: 300_000 });
  await frame.waitForTimeout(300);
  await outer.screenshot({ path: join(shots, "02-exported.png") });
  const files = await frame.locator(".exported li").allTextContents();
  for (const f of files) assert.ok((await stat(join(workspace, f.trim()))).size > 0, `${f} is empty`);
  for (const pattern of spec.expectFiles ?? []) assert.ok(files.some((f) => new RegExp(pattern).test(f)), `expected an exported file matching ${pattern}; got ${files.join(", ")}`);

  step("English panel");
  const en = await harness.open("?locale=en-US&theme=dark", { width: 1400, height: 950 });
  await harness.agent(en.outer, `${spec.prefix}_status`, { project });
  await en.frame.locator(".project .summary").waitFor();
  await en.frame.waitForTimeout(400);
  await en.outer.screenshot({ path: join(shots, "03-en-dark.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — ${files.length} file(s) exported; screenshots in ${shots}`);
} catch (error) {
  await failShot?.().catch(() => undefined);
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
