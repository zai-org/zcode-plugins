// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
// EBOOK_SAMPLES 指向示例书稿（魯迅《吶喊》選篇、Alice 前两章，均为公有领域，见 SOURCES.txt）。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "ebook-maker-shots");
await mkdir(shots, { recursive: true });
const samples = process.env.EBOOK_SAMPLES ?? "/workspace/zcode-new-plugins/samples/ebook";
const workspace = await mkdtemp(join(tmpdir(), "ebook-e2e-"));
await cp(join(samples, "nahan"), join(workspace, "書稿/吶喊"), { recursive: true });
await cp(join(samples, "alice"), join(workspace, "drafts/alice"), { recursive: true });

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent opens the Alice draft; the panel lists the missing image and the broken link");
  const r = await harness.agent(outer, "ebook_open", { dir: "drafts/alice" });
  assert.match(r.content[0].text, /✗ chapter2\.md:11: Image not found: img\/pool\.png/);
  await frame.locator(".chap").nth(1).waitFor();
  await frame.locator(".tabs button", { hasText: "检查" }).click();
  await frame.locator(".issue", { hasText: "img/pool.png" }).waitFor();
  assert.equal(await frame.locator(".issue .badge.bad").count(), 2);
  await frame.locator(".data td", { hasText: "https://en.wikisource.org" }).waitFor();
  await outer.screenshot({ path: join(shots, "01-checks.png") });

  step("user switches to the 吶喊 book, previews 孔乙己, edits the subtitle and reorders chapters");
  await frame.locator(".toolbar select").selectOption("書稿/吶喊");
  await frame.locator(".chap", { hasText: "孔乙己" }).click();
  await frame.locator(".preview h1", { hasText: "孔乙己" }).waitFor();
  await frame.locator(".preview p", { hasText: "魯鎭的酒店的格局" }).waitFor();
  const sub = frame.locator('.meta input[data-key="subtitle"]');
  await sub.fill("小說三篇");
  await sub.press("Tab");
  await frame.locator(".chap", { hasText: "故鄉" }).locator("button", { hasText: "↑" }).click();
  await frame.locator(".chap").nth(2).filter({ hasText: "故鄉" }).waitFor();
  await frame.waitForTimeout(300);
  let cfg = JSON.parse(await readFile(join(workspace, "書稿/吶喊/book.json"), "utf8"));
  assert.equal(cfg.subtitle, "小說三篇");
  assert.deepEqual(cfg.chapters, ["00-前言.md", "01-狂人日記.md", "03-故鄉.md", "02-孔乙己.md"]);
  await frame.locator(".chap", { hasText: "故鄉" }).locator("button", { hasText: "↓" }).click();
  await frame.locator(".chap").nth(3).filter({ hasText: "故鄉" }).waitFor();
  await frame.locator(".chap", { hasText: "狂人日記" }).click();
  await frame.locator(".preview blockquote", { hasText: "某君昆仲" }).waitFor();
  await outer.screenshot({ path: join(shots, "02-preview.png") });

  step("user exports EPUB + PDF and pages through the PDF");
  await frame.locator("button", { hasText: "导出 EPUB + PDF" }).click();
  await frame.locator(".result", { hasText: "PDF" }).waitFor({ timeout: 120_000 });
  await frame.locator(".pages canvas").nth(7).waitFor({ timeout: 120_000 });
  await frame.waitForTimeout(1500);
  await outer.screenshot({ path: join(shots, "03-pdf.png") });
  cfg = JSON.parse(await readFile(join(workspace, "書稿/吶喊/book.json"), "utf8"));
  assert.deepEqual(cfg.chapters, ["00-前言.md", "01-狂人日記.md", "02-孔乙己.md", "03-故鄉.md"]);
  const epub = unzipSync(await readFile(join(workspace, "書稿/吶喊/export/吶喊（選篇）.epub")));
  assert.match(strFromU8(epub["OEBPS/text/title.xhtml"]), /<p class="subtitle">小說三篇<\/p>/);
  const pdf = await readFile(join(workspace, "書稿/吶喊/export/吶喊（選篇）.pdf"));
  assert.ok(pdf.length > 100_000);

  step("agent exports the Alice draft as EPUB only; the panel follows");
  const a = await harness.agent(outer, "ebook_export", { dir: "drafts/alice", formats: ["epub"] });
  assert.match(a.content[0].text, /drafts\/alice\/export\/alice\.epub/);
  assert.match(a.content[0].text, /2 problem\(s\) still open/);
  await frame.locator(".result", { hasText: "alice.epub" }).waitFor();
  await frame.locator(".chap", { hasText: "Down the Rabbit-Hole" }).click();
  await frame.locator(".preview figure img").first().waitFor();
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(shots, "04-alice.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join("").slice(-2000));
  throw error;
} finally {
  await harness.close();
}
