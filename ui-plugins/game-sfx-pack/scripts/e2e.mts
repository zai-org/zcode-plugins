// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 ffmpeg。
// E2E_SFX 指向含 rain.ogg、rain_and_thunder.ogg 的文件夹（Wikimedia Commons 公有领域录音，见 SOURCES.txt）；否则用 ffmpeg 生成。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "game-sfx-pack-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "sfx-e2e-"));
const dir = join(workspace, "recordings");
await mkdir(dir);
if (process.env.E2E_SFX) await cp(process.env.E2E_SFX, dir, { recursive: true });
else {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:a=0.2", join(dir, "rain.ogg")]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=19:c=brown:a=0.4", join(dir, "rain_and_thunder.ogg")]);
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 900 });
  step("agent creates a platformer sound set");
  const r = await harness.agent(outer, "sfx_open", { name: "森林关卡", events: ["跳跃", "拾取金币", "角色受击", "敌人爆炸", "按钮点击", "菜单确认", "失败"], files: ["recordings/rain.ogg", "recordings/rain_and_thunder.ogg"] });
  const p = r.structuredContent.project;
  assert.deepEqual(p.sounds.map((s: any) => s.category), ["player", "pickup", "combat", "combat", "ui", "ui", "ui", "imported", "imported"]);
  await frame.locator(".snd").nth(8).waitFor();
  await frame.waitForFunction(() => document.querySelectorAll(".snd .small.muted").length >= 9 && ![...document.querySelectorAll(".snd .small.muted")].some((e) => e.textContent?.startsWith("…")), undefined, { timeout: 120_000 });
  step("user auditions, re-rolls the jump, makes the rain loop and exports");
  await frame.locator(".snd").first().locator("button.play").click();
  await frame.locator(".snd").first().locator("button", { hasText: "🎲" }).click();
  await frame.locator(".snd").first().locator("input[type=range]").first().waitFor();
  await frame.locator(".snd").nth(7).locator("label", { hasText: "无缝循环" }).locator("input").check();
  await frame.waitForTimeout(1500);
  await outer.screenshot({ path: join(shots, "01-sounds.png") });
  await frame.locator(".settings select").nth(1).selectOption("both");
  await frame.locator("button", { hasText: "导出素材包" }).click();
  await frame.locator(".card", { hasText: "已导出" }).waitFor({ timeout: 300_000 });
  const m = JSON.parse(await readFile(join(workspace, "sfx/manifest.json"), "utf8"));
  assert.equal(m.sounds.length, 9);
  const rain = m.sounds.find((s: any) => s.name === "rain");
  assert.equal(rain.loop, true);
  assert.notEqual(m.sounds[0].seed, 1);
  for (const s of m.sounds) assert.ok(Math.abs(s.loudness + 18) < 0.5 || s.peak > -1.1, JSON.stringify(s));
  execFileSync("ffprobe", ["-v", "error", join(workspace, "sfx/imported/rain.ogg")]);
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(shots, "02-exported.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
