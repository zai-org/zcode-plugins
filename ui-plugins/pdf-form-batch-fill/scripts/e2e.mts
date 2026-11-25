// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。
// 运行：node --experimental-strip-types scripts/e2e.mts（需要本机 Chrome，或设置 CHROME_PATH）。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";
import { makeChineseForm, makeRoster } from "../test/fixtures.ts";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "pdf-form-batch-fill-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "formfill-e2e-"));
await writeFile(join(workspace, "报名表.pdf"), await makeChineseForm(true));
await writeFile(join(workspace, "扁平表.pdf"), await makeChineseForm(false));
await writeFile(join(workspace, "名单.csv"), makeRoster());
await writeFile(join(workspace, "fw9.pdf"), await readFile(new URL("../test/fixtures/fw9.pdf", import.meta.url)));

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1280, height: 900 });

  step("empty panel offers file pickers");
  await frame.locator("text=表单批量填写").first().waitFor();
  await frame.locator("select option", { hasText: "报名表.pdf" }).first().waitFor({ state: "attached" });

  step("agent opens a form with a saved template");
  await harness.agent(null, "template_save", {
    path: "冬季班.formfill.json",
    template: {
      pdf: "报名表.pdf",
      roster: "名单.csv",
      fields: [
        { id: "name", kind: "acro", name: "name", label: "姓名", source: "{姓名}", required: true },
        { id: "phone", kind: "acro", name: "phone", label: "手机号", source: "{手机号}", required: true },
        { id: "idcard", kind: "acro", name: "idcard", label: "身份证号", source: "{身份证号}" },
        { id: "address", kind: "acro", name: "address", label: "通讯地址", source: "{通讯地址}", minFontSize: 8 },
        { id: "course", kind: "acro", name: "course", label: "报名课程", source: "{课程}" },
        { id: "gender", kind: "acro", name: "gender", label: "性别", source: "{性别}" },
        { id: "stay", kind: "acro", name: "stay", label: "需要住宿", source: "{住宿}" },
        { id: "note", kind: "acro", name: "note", label: "备注", source: "{备注}" },
      ],
      output: { dir: "输出", fileName: "{序号}-{姓名}.pdf", flatten: true, merged: true },
    },
  });
  await harness.agent(outer, "form_open", { template: "冬季班.formfill.json" });
  await frame.locator(".fields tr[data-id]").nth(7).waitFor();
  await frame.waitForFunction(() => (document.querySelector("#page") as HTMLCanvasElement)?.width > 100);
  assert.equal(await frame.locator(".overlay .box").count(), 8);
  await outer.screenshot({ path: join(shots, "01-mapping.png") });

  step("preview a filled row");
  await frame.locator("label", { hasText: "预览填写效果" }).locator("input").check();
  await frame.locator("text=第 1 行").waitFor();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "02-preview-row1.png") });

  step("check all rows shows the three planted problems");
  await frame.locator("button", { hasText: "检查全部" }).click();
  await frame.locator("h2", { hasText: "发现 3 个问题" }).waitFor({ timeout: 60_000 });
  await frame.locator("tr.clickable", { hasText: "超出" }).click();
  await frame.locator("text=第 12 行").waitFor();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "03-issues-row12.png") });

  step("edit a mapping in the panel and generate");
  const phone = frame.locator('.fields tr[data-id="phone"] input[list]');
  await phone.fill("{手机号}");
  await frame.locator("button", { hasText: "生成 30 份" }).click();
  await frame.locator("h2", { hasText: "已生成 30 份" }).waitFor({ timeout: 120_000 });
  const files = await readdir(join(workspace, "输出"));
  assert.equal(files.filter((f) => /^\d\d-.*\.pdf$/.test(f)).length, 30);
  assert.ok(files.includes("_merged.pdf") && files.includes("_report.csv"));
  await outer.screenshot({ path: join(shots, "04-generated.png") });

  step("flat PDF: drag a free text box onto the page");
  await harness.agent(outer, "form_open", { pdf: "扁平表.pdf", roster: "名单.csv" });
  await frame.locator("text=这份 PDF 没有可填写的表单域").waitFor();
  await frame.locator("button", { hasText: "+ 自由位置文字框" }).click();
  const overlay = frame.locator("#overlay");
  const box = (await overlay.boundingBox())!;
  const scale = box.width / 595;
  await outer.mouse.move(box.x + 142 * scale, box.y + 120 * scale);
  await outer.mouse.down();
  await outer.mouse.move(box.x + 400 * scale, box.y + 140 * scale, { steps: 5 });
  await outer.mouse.up();
  await frame.locator('.fields tr[data-id="box1"]').waitFor();
  await frame.locator('.fields tr[data-id="box1"] input[list]').fill("{姓名}");
  await frame.locator("label", { hasText: "预览填写效果" }).locator("input").check();
  await frame.waitForTimeout(1200);
  await outer.screenshot({ path: join(shots, "05-flat-box.png") });

  step("real IRS W-9 form renders with its fields");
  await harness.agent(outer, "form_open", { pdf: "fw9.pdf" });
  await frame.locator(".fields tr[data-id]").nth(10).waitFor();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "06-w9.png") });

  assert.deepEqual(harness.errors.filter((e: string) => !/Warning/.test(e)), []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
