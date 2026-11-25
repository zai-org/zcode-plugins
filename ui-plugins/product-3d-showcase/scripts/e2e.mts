// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板（WebGL）。需要 Chrome 与 ffprobe。
// E2E_MODELS 指向含 WaterBottle.glb 与 avocado/ 的文件夹（Khronos glTF-Sample-Assets，CC0，见 SOURCES.txt）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "product-3d-showcase-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "p3d-e2e-"));
const models = process.env.E2E_MODELS ?? "/workspace/zcode-new-plugins/samples/models";
await cp(join(models, "WaterBottle.glb"), join(workspace, "products/bottle.glb"), { recursive: true });
await cp(join(models, "avocado"), join(workspace, "products/avocado"), { recursive: true });

/** PNG 尺寸与四角/中心像素的透明度（在浏览器里解码）。 */
async function pngStats(page: any, file: string) {
  const b64 = (await readFile(file)).toString("base64");
  return page.evaluate(async (data: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const px = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
    return { w: img.width, h: img.height, corner: px(2, 2), center: px(img.width >> 1, img.height >> 1), opaqueShare: opaque / (d.length / 4) };
  }, b64);
}

const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1300, height: 950 });
  step("agent opens the water bottle with transparent background");
  const r = await harness.agent(outer, "showcase_open", { model: "products/bottle.glb", settings: { title: "Water Bottle", angles: ["front", "three-quarter-left", "three-quarter-right", "back"], background: "transparent", size: 1200, video: { seconds: 3, size: 720 } } });
  assert.equal(r.structuredContent.info.textures, 4);
  await frame.waitForFunction(() => document.querySelectorAll(".ang img").length === 4 && [...document.querySelectorAll<HTMLImageElement>(".ang img")].every((i) => i.src.startsWith("data:image/png")), undefined, { timeout: 120_000 });
  step("user drags the preview to a low hero angle and adds it");
  const box = (await frame.locator(".stage canvas").boundingBox())!;
  const outerBox = (await outer.locator("iframe").boundingBox())!;
  const ox = outerBox.x + box.x + box.width / 2, oy = outerBox.y + box.y + box.height / 2;
  await outer.mouse.move(ox, oy);
  await outer.mouse.down();
  await outer.mouse.move(ox - 120, oy - 40, { steps: 10 });
  await outer.mouse.up();
  await frame.waitForTimeout(600);
  await frame.locator("button", { hasText: "加入这个角度" }).click();
  await frame.waitForFunction(() => document.querySelectorAll(".ang img").length === 5 && [...document.querySelectorAll<HTMLImageElement>(".ang img")].every((i) => i.src.startsWith("data:image/png")), undefined, { timeout: 60_000 });
  const hero = await frame.locator(".ang").nth(4).locator(".muted").textContent();
  assert.notEqual(hero, "0° / 8°");
  await outer.screenshot({ path: join(shots, "01-angles.png") });
  step("user switches to soft lighting and exports everything");
  await frame.locator(".settings select").first().selectOption("soft");
  await frame.waitForTimeout(800);
  await frame.locator("button", { hasText: "导出全部" }).click();
  await frame.locator(".card.done").waitFor({ timeout: 300_000 });
  const out = join(workspace, "showcase/bottle");
  const saved = JSON.parse(await readFile(join(out, "showcase.json"), "utf8"));
  assert.equal(saved.lighting, "soft");
  assert.equal(saved.angles.length, 5);
  for (const a of saved.angles) {
    const st = await pngStats(outer, join(out, `${a.name}.png`));
    assert.equal(st.w, 1200);
    assert.equal(st.corner[3], 0, `${a.name}: corner should be transparent`);
    assert.ok(st.center[3] > 200, `${a.name}: product should be in the centre ${st.center}`);
    assert.ok(st.opaqueShare > 0.05 && st.opaqueShare < 0.7, `${a.name}: product fills ${st.opaqueShare}`);
  }
  const front = await pngStats(outer, join(out, "front.png"));
  const back = await pngStats(outer, join(out, "back.png"));
  assert.notDeepEqual(front.center, back.center);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name", "-of", "default=nw=1", join(out, "turntable.webm")]).toString().match(/duration=([\d.]+)/)?.[1] ?? 0);
  const probe = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", join(out, "turntable.webm")]).toString().trim();
  step(`webm: ${probe}, ${dur || "?"}s`);
  assert.match(probe, /^720,720,(\d+)/);
  assert.equal(Number(probe.split(",")[2]), 90, "3 s × 30 fps, frame-exact");
  assert.ok(Math.abs(dur - 3) < 0.1);
  const mp4 = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,pix_fmt,nb_read_frames", "-of", "csv=p=0", join(out, "turntable.mp4")]).toString().trim();
  assert.equal(mp4, "h264,yuv420p,90");
  await outer.screenshot({ path: join(shots, "02-exported.png") });

  step("the exported web viewer works from file:// for a .gltf with external textures");
  await harness.agent(outer, "showcase_open", { model: "products/avocado/Avocado.gltf", settings: { title: "Avocado", angles: ["front", "top"], video: { enabled: false }, background: "#f1f5f9" } });
  await frame.waitForFunction(() => document.querySelectorAll(".ang img").length === 2 && [...document.querySelectorAll<HTMLImageElement>(".ang img")].every((i) => i.src.startsWith("data:image/png")), undefined, { timeout: 120_000 });
  await harness.agent(outer, "showcase_export", { settings: JSON.parse(await readFile(join(workspace, "showcase/Avocado/showcase.json"), "utf8")) });
  await frame.locator(".card.done", { hasText: "Avocado" }).waitFor({ timeout: 300_000 });
  const page = await outer.context().newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(pathToFileURL(join(workspace, "showcase/Avocado/viewer/index.html")).href);
  await page.waitForFunction(() => !document.getElementById("loading"), undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const nonBg = await page.evaluate(() => {
    const c = document.getElementById("view") as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width; t.height = c.height;
    const g = t.getContext("2d")!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 241) + Math.abs(d[i + 1] - 245) + Math.abs(d[i + 2] - 249) > 40) n++;
    return n / (d.length / 4);
  });
  assert.ok(nonBg > 0.03, `viewer shows the model (${nonBg})`);
  await page.screenshot({ path: join(shots, "03-viewer.png") });
  assert.deepEqual(errors, []);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
