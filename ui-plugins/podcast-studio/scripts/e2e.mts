// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 ffmpeg。
// E2E_PODCAST 指向含 host.wav、guest.wav、jingle.mp3 的文件夹（真实访谈录音做主持人轨，见 SOURCES.txt）；否则用 ffmpeg 生成。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "podcast-studio-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "podcast-e2e-"));
const dir = join(workspace, "录音");
await mkdir(dir);
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
if (process.env.E2E_PODCAST) await cp(process.env.E2E_PODCAST, dir, { recursive: true });
else {
  ff("-f", "lavfi", "-i", "anoisesrc=d=150:c=pink:a=0.25:seed=7", "-af", "lowpass=f=3000,volume='if(lt(mod(t*1.7,3),1.1),1,0.03)':eval=frame", join(dir, "host.wav"));
  ff("-i", join(dir, "host.wav"), "-f", "lavfi", "-i", "anoisesrc=d=150:c=brown:a=0.3:seed=3", "-filter_complex", "[0:a]adelay=1840:all=1,volume=-14dB[a];[1:a]volume='if(lt(mod(t*1.3+1,3),0.9),1,0.02)':eval=frame[b];[a][b]amix=inputs=2:normalize=0:duration=longest", join(dir, "guest.wav"));
  ff("-f", "lavfi", "-i", "sine=frequency=523:duration=4", "-ac", "2", join(dir, "jingle.mp3"));
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 900 });
  step("agent opens host + guest");
  const opened = await harness.agent(outer, "podcast_open", { tracks: ["录音/host.wav", "录音/guest.wav"], title: "第 12 期：开放知识的伙伴", intro: "录音/jingle.mp3", outro: "录音/jingle.mp3" });
  const p = opened.structuredContent.project;
  assert.ok(Math.abs(p.tracks[0].offset - p.tracks[1].offset - 1.84) < 0.01, `aligned: ${JSON.stringify(p.tracks)}`);
  step("agent names the speakers and cuts an off-topic part");
  await harness.agent(outer, "podcast_save", { project: { ...p, tracks: [{ ...p.tracks[0], name: "主持人 Rupika" }, { ...p.tracks[1], name: "嘉宾", gain: -2 }], cuts: [{ start: "0:53", end: "1:14", note: "跑题：气候" }] } });
  await frame.locator(".lane canvas").nth(1).waitFor();
  await frame.waitForFunction(() => document.querySelectorAll(".cuts tr").length === 1);
  step("user drags a second cut on the waveform");
  const lane = frame.locator(".lane").first();
  const box = (await lane.boundingBox())!;
  const xAt = (t: number) => box.x + (t / (opened.structuredContent.total as number)) * box.width;
  await outer.mouse.move(xAt(120), box.y + 30);
  await outer.mouse.down();
  await outer.mouse.move(xAt(126), box.y + 30, { steps: 6 });
  await outer.mouse.up();
  await frame.waitForFunction(() => document.querySelectorAll(".cuts tr").length === 2);
  step("user previews and renders");
  await outer.mouse.click(xAt(20), box.y + 30);
  await frame.locator("button", { hasText: "试听 15 秒" }).click();
  await frame.waitForFunction(() => !document.getElementById("root")!.classList.contains("busy"));
  await frame.waitForTimeout(1500);
  await outer.screenshot({ path: join(shots, "01-edit.png") });
  await frame.locator("button", { hasText: "导出节目" }).click();
  await frame.locator(".card", { hasText: "已导出" }).waitFor({ timeout: 600_000 });
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(shots, "02-rendered.png") });
  const mp3 = join(workspace, "podcast/第 12 期：开放知识的伙伴.mp3");
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString());
  const total = opened.structuredContent.total as number;
  assert.ok(Math.abs(d - (total - 21 - 6 + 8)) < 1, `duration ${d} vs ${total}`);
  const md = await readFile(join(workspace, "podcast/第 12 期：开放知识的伙伴.cuts.md"), "utf8");
  assert.match(md, /\| 主持人 Rupika \(录音\/host\.wav\) \| 1\.84\d s \| 0 dB/);
  assert.match(md, /跑题：气候/);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
