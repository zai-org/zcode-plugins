// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 poppler（pdftotext/pdftoppm）。
// REDACT_SAMPLES 指向虚构的样本资料（见 SOURCES.txt）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "share-redactor-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "red-e2e-"));
await cp(process.env.REDACT_SAMPLES ?? "/workspace/zcode-new-plugins/samples/redact", join(workspace, "外发资料"), { recursive: true });
const people = (await readFile(join(workspace, "外发资料/people.txt"), "utf8")).trim().split("\n").map((l) => l.split("\t"));

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent scans the quote PDF and the customer list with customer names as keywords");
  const r = await harness.agent(outer, "redact_scan", { settings: { files: ["外发资料/报价单.pdf", "外发资料/客户名单.xlsx"], keywords: people.map((p) => p[0]) } });
  assert.deepEqual(r.structuredContent.files.map((f: any) => f.hits.length), [7, 22]);
  assert.ok(!r.content[0].text.includes(people[2][2]), "agent text never shows full ID numbers");
  await frame.locator(".pagebox .box").nth(6).waitFor({ timeout: 60_000 });
  step("user keeps the account manager's work email, draws a box over the price table, adds the contract file");
  await frame.locator(".hit", { hasText: "wang.xm@example.com" }).locator("input[type=checkbox]").uncheck();
  await frame.locator(".pagebox .box.kept").waitFor();
  const page = frame.locator(".pagebox").first();
  const pb = (await page.boundingBox())!;
  const ib = (await outer.locator("iframe").boundingBox())!;
  const at = (fx: number, fy: number) => [ib.x + pb.x + pb.width * fx, ib.y + pb.y + pb.height * fy] as const;
  await outer.mouse.move(...at(0.08, 0.22));
  await outer.mouse.down();
  await outer.mouse.move(...at(0.42, 0.3), { steps: 8 });
  await outer.mouse.up();
  await frame.locator(".pagebox .box.area").waitFor();
  await frame.locator(".toolbar select").selectOption("外发资料/合作协议.docx");
  await frame.locator(".file", { hasText: "合作协议.docx" }).waitFor();
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(shots, "01-review.png") });
  step("user exports; PDF is rasterised in the panel and everything is self-checked");
  await frame.locator("button", { hasText: "导出脱敏副本" }).click();
  await frame.locator(".result", { hasText: "quote" }).or(frame.locator(".result", { hasText: "报价单.redacted.pdf" })).waitFor({ timeout: 300_000 });
  assert.equal(await frame.locator(".result .ok").count(), 3);
  assert.equal(await frame.locator(".result .bad").count(), 0);
  const out = join(workspace, "redacted");
  const pdfText = execFileSync("pdftotext", [join(out, "报价单.redacted.pdf"), "-"]).toString();
  assert.equal(pdfText.trim(), "", "no text layer");
  const pdfinfo = execFileSync("pdfinfo", [join(out, "报价单.redacted.pdf")]).toString();
  assert.match(pdfinfo, /Pages:\s+1/);
  assert.doesNotMatch(pdfinfo, /Author|Chrome|Skia/);
  // 涂黑处是黑的、保留的邮箱处不是：用 pdftoppm 渲染后在浏览器里取像素
  execFileSync("pdftoppm", ["-png", "-r", "72", "-singlefile", join(out, "报价单.redacted.pdf"), join(workspace, "check")]);
  const scan = r.structuredContent.files[0];
  const rectOf = (v: string) => scan.hits.find((h: any) => h.value === v).rects[0];
  await cp(join(workspace, "check.png"), join(shots, "04-output-pdf.png"));
  const png = (await readFile(join(workspace, "check.png"))).toString("base64");
  const lum = await outer.evaluate(async ({ data, rects }: any) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    return rects.map((r: any) => { const d = g.getImageData(Math.round(r.x + 2), Math.round(img.height - r.y - r.h + 2), Math.round(r.w - 4), Math.round(r.h - 4)).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); });
  }, { data: png, rects: [rectOf(people[2][2]), rectOf(people[2][3]), rectOf("wang.xm@example.com")] });
  assert.ok(lum[0] < 30 && lum[1] < 30, `redacted areas are black ${lum}`);
  assert.ok(lum[2] > 150, `kept email is visible ${lum}`);
  const xlsxText = execFileSync("unzip", ["-p", join(out, "客户名单.redacted.xlsx")]).toString();
  for (const p of people) for (const v of [p[1], p[2], p[3], p[0]]) assert.ok(!xlsxText.includes(v), `xlsx still contains ${v.slice(0, 3)}…`);
  const docxText = execFileSync("unzip", ["-p", join(out, "合作协议.redacted.docx")]).toString();
  for (const v of [people[0][1], people[0][2], "lina@example.cn", "王晓明", "1590000"]) assert.ok(!docxText.includes(v), `docx still contains ${v.slice(0, 3)}…`);
  const log = await readFile(join(out, "redaction-log.csv"), "utf8");
  assert.ok(log.includes("area"));
  for (const p of people) assert.ok(!log.includes(p[2]));
  await frame.waitForTimeout(300);
  await outer.screenshot({ path: join(shots, "02-exported.png") });
  await frame.locator(".file", { hasText: "客户名单.xlsx" }).click();
  await frame.waitForTimeout(300);
  await outer.screenshot({ path: join(shots, "03-xlsx.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join("").slice(-2000));
  throw error;
} finally {
  await harness.close();
}
