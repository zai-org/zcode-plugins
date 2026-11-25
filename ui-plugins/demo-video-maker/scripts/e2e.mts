// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板。需要 Chrome 与 ffmpeg。
// E2E_RECORDINGS 指向含 search-v1.webm、search-v2.webm、map.webm 的文件夹（真实录屏）；否则用 ffmpeg 生成测试画面。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "demo-video-maker-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "demo-e2e-"));
await mkdir(join(workspace, "录屏"));
if (process.env.E2E_RECORDINGS) await cp(process.env.E2E_RECORDINGS, join(workspace, "录屏"), { recursive: true });
else
  for (const [name, d] of [["search-v1", 8], ["search-v2", 5], ["map", 8]] as const)
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=25:duration=${d}`, "-pix_fmt", "yuv420p", join(workspace, `录屏/${name}.webm`)]);

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent opens two recordings");
  await harness.agent(outer, "demo_open", { recordings: ["录屏/search-v1.webm", "录屏/map.webm"] });
  await frame.locator(".seg").nth(1).waitFor();
  step("agent saves a full project");
  await harness.agent(outer, "demo_save", {
    path: "演示/咖啡百科",
    project: {
      size: "1280x720",
      intro: { title: "三步查到任何一种咖啡", subtitle: "Wikipedia 搜索演示 · Penova" },
      segments: [
        { id: "search", label: "搜索词条", source: "录屏/search-v1.webm", start: 0.8, end: 8,
          zooms: [{ at: 1.2, duration: 3, x: 0.55, y: 0.0, w: 0.4, h: 0.4 }],
          callouts: [{ at: 0.5, duration: 3.5, text: "在右上角搜索框输入“Espresso”", position: "top" }],
          subtitles: [{ at: 4.5, duration: 2.5, text: "回车后直接打开词条页面。" }] },
        { id: "map", label: "地图缩放", source: "录屏/map.webm", start: 1, end: 8.5,
          callouts: [{ at: 0.5, duration: 3, text: "滚轮放大到街区" }] },
      ],
      output: "演示/coffee-demo.mp4",
    },
  });
  await frame.locator(".zr").first().waitFor();
  await frame.locator('input[type="range"]').evaluate((el: HTMLInputElement) => { el.value = "2.6"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await frame.waitForTimeout(1500);
  await outer.screenshot({ path: join(shots, "01-editor.png") });

  step("user drags a zoom box on segment 2, then renders");
  await frame.locator(".seg").nth(1).click();
  await frame.waitForTimeout(1500);
  const box = await frame.locator(".stage").boundingBox();
  assert.ok(box);
  await outer.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await outer.mouse.down();
  await outer.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 5 });
  await outer.mouse.up();
  assert.equal(await frame.locator(".zr").count(), 1);
  await frame.locator("button", { hasText: "渲染视频" }).click();
  await frame.locator(".card", { hasText: "已生成 演示/coffee-demo.mp4" }).waitFor({ timeout: 600_000 });
  await frame.locator(".frames img").nth(5).waitFor({ timeout: 60_000 });
  await outer.screenshot({ path: join(shots, "02-rendered.png") });

  step("product updated: replace segment 'search' → only it re-renders");
  await harness.agent(outer, "demo_replace_segment", { path: "演示/咖啡百科.demovideo.json", segment: "search", source: "录屏/search-v2.webm" });
  const r = await harness.agent(outer, "demo_render", { path: "演示/咖啡百科.demovideo.json" });
  assert.deepEqual(r.structuredContent.fresh, ["search"]);
  assert.deepEqual(r.structuredContent.reused, ["intro", "map"]);
  await frame.locator(".card", { hasText: "重新渲染：search" }).waitFor({ timeout: 120_000 });
  await frame.locator(".frames img").nth(5).waitFor({ timeout: 60_000 });
  await outer.screenshot({ path: join(shots, "03-replaced.png") });
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
