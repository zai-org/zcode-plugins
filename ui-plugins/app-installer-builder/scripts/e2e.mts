// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板；真的运行 electron-builder，
// 再用 xvfb 启动打好的应用（APP_INSTALLER_SMOKE=1 打印页面标题后退出）。需要 Chrome、网络（首次下载 Electron）和 xvfb-run（Linux）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "app-installer-builder-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "aib-e2e-"));
await cp(process.env.APP_SAMPLES ?? "/workspace/zcode-new-plugins/samples/app", workspace, { recursive: true });
execFileSync(process.execPath, ["build.mjs"], { cwd: join(workspace, "focus-timer") });
const userData = await mkdtemp(join(tmpdir(), "aib-home-"));
const smoke = (bin: string[], path = "") => {
  const out = execFileSync("xvfb-run", ["-a", ...bin, "--no-sandbox"], { env: { ...process.env, APP_INSTALLER_SMOKE: "1", APP_INSTALLER_SMOKE_PATH: path, XDG_CONFIG_HOME: userData }, encoding: "utf8", maxBuffer: 64 << 20, timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] });
  const m = /APP_INSTALLER_SMOKE (\{[^\n]*\})/.exec(out); // AppImage extraction output can interleave with it
  assert.ok(m, "app printed its smoke line");
  return JSON.parse(m[1]) as { title: string; url: string; text: string };
};
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 1400, height: 1000 });
  step("user picks the static site and generates the desktop config");
  await frame.locator("button.proj", { hasText: "focus-timer" }).click();
  await frame.locator(".head", { hasText: "静态网站（dist）" }).waitFor();
  await frame.locator("button", { hasText: "生成桌面配置" }).click();
  await frame.locator("pre.code", { hasText: "target: [dmg]" }).waitFor({ timeout: 30_000 });
  await frame.locator(".head img.icon").waitFor();
  assert.equal(await frame.locator("input.appid").inputValue(), "com.penovalabs.focustimer"); // from package.json author
  await frame.locator(".issue", { hasText: "SmartScreen" }).waitFor();
  step("user bumps the version, adds the Linux target and regenerates");
  await frame.locator("input.short").first().fill("1.3.1");
  await frame.locator('input[data-target="appimage"]').check();
  await frame.locator("button", { hasText: "保存并重新生成" }).click();
  await frame.locator(".head", { hasText: "1.3.1" }).waitFor({ timeout: 30_000 });
  assert.match(await readFile(join(workspace, "focus-timer/desktop/package.json"), "utf8"), /"version": "1.3.1"/);
  assert.equal(await frame.locator('button[data-build="dmg"]').isDisabled(), true);
  await frame.locator(".matrix td", { hasText: "需要在 Mac 上打包" }).waitFor();
  await outer.screenshot({ path: join(shots, "01-config.png") });
  step("user builds the unpacked Linux app (real electron-builder run)");
  await frame.locator('button[data-build="dir"]').click();
  await frame.locator(".job .badge", { hasText: "完成" }).waitFor({ timeout: 600_000 });
  await frame.locator(".out", { hasText: "linux-unpacked/" }).waitFor();
  await frame.locator(".job pre.log", { hasText: "electron-builder" }).waitFor();
  await outer.screenshot({ path: join(shots, "02-built.png") });
  step("the packaged app serves the SPA over app:// (incl. a client-side route)");
  const desk = join(workspace, "focus-timer/desktop/release/linux-unpacked");
  const s1 = smoke([join(desk, "focus-timer")], "/stats");
  assert.equal(s1.title, "Focus Timer");
  assert.equal(s1.url, "app://local/stats");
  assert.match(s1.text, /focus sessions completed/);
  step("agent packages the Node server as an AppImage");
  await harness.agent(outer, "app_setup", { dir: "notes-server", appId: "com.penovalabs.teamnotes", iconColor: "#0f766e", targets: ["dmg", "nsis", "appimage"] });
  await frame.locator(".head", { hasText: "Node 服务（server.js）" }).waitFor({ timeout: 30_000 });
  let r = await harness.agent(outer, "app_build", { target: "appimage" });
  for (let i = 0; i < 20 && (r as any).structuredContent?.job?.state === "running"; i++) r = await harness.agent(outer, "app_status", {});
  await frame.locator(".out", { hasText: ".AppImage" }).waitFor({ timeout: 120_000 });
  await outer.screenshot({ path: join(shots, "03-appimage.png") });
  const rel = join(workspace, "notes-server/desktop/release");
  const appimage = (await readdir(rel)).find((f) => f.endsWith(".AppImage"))!;
  const s2 = smoke([join(rel, appimage), "--appimage-extract-and-run"]);
  assert.equal(s2.title, "Team Notes");
  assert.match(s2.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.match(s2.text, /Welcome to Team Notes/);
  assert.ok((await readFile(join(userData, "Team Notes/server.log"), "utf8")).includes("Team Notes on http://127.0.0.1:"));
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  await harness.close();
}
