// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 ffmpeg。
// E2E_COURSE 指向含 course-overview-6002x.webm 与 .en.srt 的文件夹（真实课程录像，Wikimedia Commons CC BY 2.0）；否则用 ffmpeg 生成。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "course-video-packager-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "course-e2e-"));
await mkdir(join(workspace, "课程"));
const real = !!process.env.E2E_COURSE;
if (real) await cp(process.env.E2E_COURSE!, join(workspace, "课程"), { recursive: true });
else {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=25:duration=662", "-f", "lavfi", "-i", "sine=frequency=300:duration=662", "-shortest", "-pix_fmt", "yuv420p", "-preset", "ultrafast", join(workspace, "课程/course-overview-6002x.webm")]);
  await writeFile(join(workspace, "课程/course-overview-6002x.en.srt"), "1\n00:00:00,550 --> 00:00:03,060\nIntro\n");
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent opens the full lecture");
  await harness.agent(outer, "course_open", { video: "课程/course-overview-6002x.webm" });
  await frame.locator("#timeline").waitFor();
  step("agent saves a chapter plan from the transcript");
  await harness.agent(outer, "course_save", {
    project: {
      video: "课程/course-overview-6002x.webm", subtitles: "课程/course-overview-6002x.en.srt",
      title: "6.002x Circuits and Electronics — Course Overview", author: "Anant Agarwal, MITx", accent: "#a31f34",
      chapters: [
        { title: "What is engineering?", start: 0, summary: "Where a circuits course fits: engineering as the purposeful use of science." },
        { title: "From experiments to laws", start: "2:09", summary: "Tables of measurements, Ohm's law and Maxwell's equations as abstractions." },
        { title: "The lumped circuit abstraction", start: "4:46", summary: "Resistors, capacitors, inductors, sources and MOSFETs as lumped elements." },
        { title: "Amplifiers and the analog path", start: "5:49", summary: "Amplifiers, filters, oscillators and analog subsystems." },
        { title: "The digital abstraction", start: "6:50", summary: "Gates, combinational logic, clocked systems, instruction sets." },
        { title: "What 6.002x covers", start: "8:56", summary: "The map of the EECS curriculum and follow-on courses." },
      ],
      output: "发布包",
    },
  });
  await frame.locator("table.chs tr").nth(6).waitFor();
  await frame.locator("table.chs tr").nth(3).locator("input.t").focus();
  await frame.waitForTimeout(2500);
  await outer.screenshot({ path: join(shots, "01-chapters.png") });

  step("user renames a chapter and builds the package");
  const title = frame.locator("table.chs tr").nth(4).locator('input[type="text"]').nth(1);
  await title.fill("Amplifiers, filters and the analog path");
  await title.press("Tab");
  await frame.locator("button", { hasText: "生成发布包" }).click();
  await frame.locator(".card", { hasText: "已生成 6 章" }).waitFor({ timeout: 900_000 });
  await frame.locator(".covers img").nth(5).waitFor({ timeout: 60_000 });
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "02-built.png"), fullPage: true });
  const md = await readFile(join(workspace, "发布包/index.md"), "utf8");
  assert.match(md, /04:46 The lumped circuit abstraction\n05:49 Amplifiers, filters and the analog path/);
  if (real) assert.match(await readFile(join(workspace, "发布包/chapters/05-The digital abstraction.srt"), "utf8"), /^1\n00:00:00,000 --> /);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
