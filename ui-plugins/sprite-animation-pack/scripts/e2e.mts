// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome。
// E2E_SPRITES 指向含 runner-sheet.png 与 runner-frames/ 的文件夹（OpenGameArt CC0 角色，见 SOURCES.txt）；否则生成简单的小人。
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRaster, decodeImage, encodePng } from "../src/kit/raster.ts";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "sprite-animation-pack-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "sprites-e2e-"));
const art = join(workspace, "art");
if (process.env.E2E_SPRITES) await cp(process.env.E2E_SPRITES, art, { recursive: true });
else {
  await mkdir(join(art, "runner-frames"), { recursive: true });
  const sheet = createRaster(256, 96);
  const counts = { idle: 5, run: 8, jump: 4 };
  let row = 0;
  for (const [name, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const w = 10 + (i % 3) * 2, h = 24 - (i % 2);
      const img = createRaster(w, h, [60 + i * 20, 90, 200, 255]);
      await writeFile(join(art, `runner-frames/runner_${name}_${String(i + 1).padStart(2, "0")}.png`), encodePng(img));
      for (let y = 0; y < h; y++) sheet.data.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), ((row * 32 + 32 - h + y) * 256 + i * 32 + 4) * 4);
    }
    row++;
  }
  await writeFile(join(art, "runner-sheet.png"), encodePng(sheet));
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 900 });
  step("agent opens the trimmed frames");
  const opened = await harness.agent(outer, "sprite_open", { frames: "art/runner-frames", name: "runner", fps: 12 });
  assert.match(opened.content[0].text, /idle 5f 12fps loop anchor=feet \(auto\); jump 4f .*; run 8f /);
  await frame.locator(".act").nth(2).waitFor();
  await frame.locator(".strip .fr canvas").first().waitFor();
  step("user inspects run, nudges a frame, sets jump to play once and exports at 4×");
  await frame.locator(".act").nth(2).click({ position: { x: 4, y: 4 } });
  await frame.locator(".strip .fr").nth(3).click();
  await frame.locator(".strip .fr").nth(3).locator("button[title='右移 1px']").click();
  await frame.locator("label", { hasText: "洋葱皮" }).locator("input").check();
  await frame.locator(".act").nth(1).locator("input[type=checkbox]").uncheck();
  await frame.locator(".settings select").first().selectOption("4");
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "01-run-onion.png") });
  await frame.locator(".act").nth(2).click({ position: { x: 4, y: 4 } });
  const play = frame.locator("button", { hasText: "▶ 播放" });
  if (await play.count()) await play.click();
  await frame.locator("button", { hasText: "导出动作包" }).click();
  await frame.locator(".card", { hasText: "已导出" }).waitFor();
  const dir = join(workspace, "sprites/runner");
  const json = JSON.parse(await readFile(join(dir, "runner.json"), "utf8"));
  assert.deepEqual(json.meta.frameTags.map((t: any) => [t.name, t.from, t.to, t.repeat ?? "∞"]), [["idle", 0, 4, "∞"], ["jump", 5, 8, "1"], ["run", 9, 16, "∞"]]);
  const project = JSON.parse(await readFile(join(dir, "runner.sprites.json"), "utf8"));
  assert.equal(project.actions[2].frames[3].dx, 1);
  const atlas = decodeImage(await readFile(join(dir, "runner.png")));
  assert.equal(atlas.width, json.meta.size.w);
  assert.match(await readFile(join(dir, "runner.tres"), "utf8"), /"name": &"jump",\n"speed": 12\.048/);
  await frame.waitForTimeout(600);
  await outer.screenshot({ path: join(shots, "02-exported.png") });
  step("agent opens the original sheet with a grid");
  const sheet = await harness.agent(outer, "sprite_open", { sheet: "art/runner-sheet.png", grid: { width: 32, height: 32 }, actions: ["idle", "run", "jump"], name: "runner-sheet" });
  assert.match(sheet.content[0].text, /idle 5f .* anchor=keep \(auto\); run 8f .*; jump 4f /);
  await frame.locator(".act input[type=text]").nth(2).and(frame.locator("[value='jump']")).waitFor().catch(() => undefined);
  await frame.locator(".act").nth(2).click({ position: { x: 4, y: 4 } });
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(shots, "03-sheet-jump.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
