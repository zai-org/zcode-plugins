// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 ffmpeg。
// E2E_INTERVIEW 指向含 interview.ogg 与 interview.en.srt 的文件夹（Wikimedia Commons 上的真实访谈，CC BY 3.0）；否则用 ffmpeg 生成一段。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "interview-notes-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "interview-e2e-"));
await mkdir(join(workspace, "interviews-raw"));
if (process.env.E2E_INTERVIEW) await cp(process.env.E2E_INTERVIEW, join(workspace, "interviews-raw"), { recursive: true });
else {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=300", "-c:a", "libvorbis", join(workspace, "interviews-raw/interview.ogg")]);
  const lines = ["Rupika: Abhinav, would you tell us about the working groups?", "The partnerships working group", "what is happening right and what needs improvement", "In India, we don't have knowledge about that", "integrating these all", "Abhinav: we need a common platform"];
  await writeFile(join(workspace, "interviews-raw/interview.en.srt"), lines.map((l, i) => `${i + 1}\n00:00:${String(10 + i * 3).padStart(2, "0")},000 --> 00:00:${String(12 + i * 3).padStart(2, "0")},000\n${l}\n`).join("\n"));
}
const audio = "interviews-raw/interview.ogg";

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent opens the interview");
  const opened = await harness.agent(outer, "interview_open", { audio, title: "Partnerships working group — interview" });
  const text = opened.content[0].text as string;
  const maybe = (s: string) => { const l = text.split("\n").find((x) => x.includes(s)); return l ? /\[(u\d+) /.exec(l)![1] : undefined; };
  const find = (s: string) => maybe(s) ?? assert.fail(`line not found: ${s}`);
  step("agent submits needs with quotes");
  await harness.agent(outer, "interview_submit", {
    audio,
    speakers: { "Speaker 1": "Rupika (interviewer)", Rupika: "Rupika (interviewer)" },
    needs: [
      { title: "Share partnership stories across countries", category: "Knowledge sharing", priority: "high", detail: "Good partnerships in one country are unknown elsewhere; a shared place to learn from them is missing.", quotes: [{ utterance: find("we don't have knowledge about that") }, { utterance: find("integrating these all") }] },
      { title: "Review what works and what needs improvement in existing partnerships", category: "Process", priority: "medium", quotes: [{ utterance: find("what needs improvement"), text: "what needs improvement" }] },
      { title: "Reach organisations not yet partnered", category: "Outreach", priority: "low", quotes: [] },
    ],
  });
  await frame.locator(".need").nth(2).waitFor();
  step("user plays a quote, confirms a need and fixes a speaker");
  await frame.locator(".need").first().locator(".quote button.play").first().click();
  await frame.waitForFunction(() => document.querySelector(".line.on") !== null);
  await frame.locator(".need").first().locator(".st button").nth(1).click();
  const q = find("would you tell us about the working groups");
  await frame.locator(`#line-${q} select.sp`).selectOption({ label: "Rupika (interviewer)" });
  await frame.locator(".need").nth(2).click();
  const extra = maybe("whom we have yet not partnered") ?? find("we need a common platform");
  await frame.locator(`#line-${extra}`).hover();
  await frame.locator(`#line-${extra} button.add`).click();
  assert.equal(await frame.locator(".need").nth(2).locator(".quote").count(), 1);
  await frame.locator(".need").first().click();
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "01-review.png") });
  step("user exports");
  await frame.locator("button", { hasText: "导出纪要" }).click();
  await frame.locator(".card", { hasText: "已导出" }).waitFor({ timeout: 60_000 });
  const md = await readFile(join(workspace, "interviews/interview.md"), "utf8");
  assert.match(md, /Status: Confirmed/);
  assert.match(md, /> “In India, we don't have knowledge about that” — /);
  assert.match(md, /\*\*Rupika \(interviewer\)\*\* \[\d\d:\d\d\] Abhinav, would you tell us/);
  const html = await readFile(join(workspace, "interviews/interview.html"), "utf8");
  const page = await harness.contexts()[0].newPage();
  await page.goto(`file://${join(workspace, "interviews/interview.html")}`);
  await page.locator(".need blockquote button").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, "02-export.png"), fullPage: false });
  assert.ok(Number(await page.evaluate(() => (document.getElementById("a") as HTMLAudioElement).currentTime)) > 1);
  assert.match(html, /src="\.\.\/interviews-raw\/interview\.ogg"/);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
