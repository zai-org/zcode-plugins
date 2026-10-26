import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { startFakeZotero } from "../test/fake-zotero.mjs";
import { startHarness } from "./harness.mjs";

/**
 * 设置页端到端：真实页面（ZCode 的 CSP）+ 测试 server（Zotero 的安装情况由脚本控制）+ 假 Zotero。
 * 未安装 → 交给 Agent（检查消息）→ 装好但未打开 → 打开 Zotero → 本地 API 未开启 → 开启 → 文献库。
 * 只有“打开 Zotero”是页面发起的工具调用（它运行程序）。先运行 pnpm build。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.ZOTERO_E2E_ARTIFACTS || join(tmpdir(), "zotero-setup-e2e"));
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "zotero-setup-"));
const serverFile = join(scratch, "setup-server.mjs");
await build({
  entryPoints: [join(root, "test/setup-server.ts")],
  outfile: serverFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["@napi-rs/canvas", "canvas"],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);' },
  logLevel: "warning",
});
const port = await new Promise((done) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => done(value));
  });
});
const setupFile = join(scratch, "setup.json");
const FACTS = { os: "macos", osName: "macOS 15.4", arch: "Apple silicon", tools: [{ name: "Homebrew", version: "4.5.2", path: "/opt/homebrew/bin/brew" }] };
const setApp = (app) => writeFile(setupFile, JSON.stringify({ app, facts: FACTS }));
await setApp({ state: "missing", searched: ["/Applications", "~/Applications"] });

const workspace = join(scratch, "ws");
await mkdir(workspace);
const harness = await startHarness({
  workspace,
  server: serverFile,
  env: { ZOTERO_URL: `http://127.0.0.1:${port}`, ZOTERO_TEST_SETUP: setupFile, ZOTERO_TEST_DIST: join(root, "dist"), ZCODE_PLUGIN_DATA: join(scratch, "data") },
});
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`) });
const step = (name) => process.stdout.write(`• ${name}\n`);
const text = (frame, selector) => frame.locator(selector).first().innerText();
let fake;

try {
  step("Zotero is not installed: requirements and the message for the agent");
  const { outer, frame } = await harness.open("?theme=light&locale=en-US", { width: 480, height: 900 });
  await frame.locator(".setup h1").getByText("Set up Zotero").waitFor();
  assert.equal(await frame.locator(".req .row").count(), 3);
  assert.match(await text(frame, ".req .row"), /Zotero app[\s\S]*Not in \/Applications or ~\/Applications[\s\S]*Missing/);
  await frame.locator(".req .card-foot").getByText("Homebrew 4.5.2").waitFor();
  await frame.getByRole("button", { name: "Install it yourself" }).click();
  assert.equal(await text(frame, ".setup .cmd code"), "brew install --cask zotero");
  await frame.waitForTimeout(300);
  await shot(outer, "01-missing");

  step("send to agent, then the inline card and a dark Chinese panel follow along");
  await frame.getByRole("button", { name: "Send to agent" }).click();
  await frame.locator(".sent").waitFor();
  const [message] = await outer.evaluate(() => window.__messages);
  assert.match(message, /^Set up Zotero for the Zotero panel in ZCode\.\n\nThe panel checked this computer:\n• macOS 15\.4, Apple silicon\n• Zotero is not installed \(looked in \/Applications and ~\/Applications\)\n• Homebrew 4\.5\.2 is available\n\nPlease:\n1\. Install Zotero 7 or later: `brew install --cask zotero`/);
  assert.match(message, new RegExp(`answers on 127\\.0\\.0\\.1:${port}\\.$`));
  assert.equal(await text(frame, ".setup h1"), "Setting up Zotero");
  await shot(outer, "02-working");
  const zh = await harness.open("?theme=dark&locale=zh-CN", { width: 480, height: 900 });
  await zh.frame.locator(".setup h1").getByText("正在安装 Zotero").waitFor();
  await shot(zh.outer, "03-working-dark-zh");
  const inline = await harness.open("?mode=inline", { width: 620, height: 120 });
  await inline.frame.locator(".inline-card").getByText("Agent is setting up Zotero").waitFor();

  step("installed but not open: one button opens it");
  await setApp({ state: "found", path: "/Applications/Zotero.app", version: "7.0.15", searched: [] });
  await frame.locator(".setup h1").getByText("Open Zotero").waitFor({ timeout: 10_000 });
  assert.match(await text(frame, ".req"), /\/Applications\/Zotero\.app[\s\S]*7\.0\.15[\s\S]*Nothing answers on 127\.0\.0\.1/);
  await inline.frame.locator(".inline-card").getByRole("button", { name: "Open Zotero" }).waitFor();
  await shot(outer, "04-closed");
  await shot(inline.outer, "05-inline-closed");
  await frame.getByRole("button", { name: "Open Zotero" }).click();
  await frame.getByRole("button", { name: "Opening…" }).waitFor();
  await outer.waitForFunction(() => window.__calls.length > 0);
  assert.deepEqual(await outer.evaluate(() => window.__calls), ["panel_launch_zotero"]);

  step("Zotero starts with the local API off: in-app steps, then it turns ready");
  fake = await startFakeZotero({ port, apiEnabled: false });
  await frame.locator(".setup h1").getByText("Turn on Zotero's local API").waitFor({ timeout: 10_000 });
  await frame.locator(".steps .pref").getByText("Allow other applications on this computer to communicate with Zotero").waitFor();
  await frame.locator(".crumbs").getByText("Settings…").waitFor();
  await shot(outer, "06-api-off");
  fake.state.apiEnabled = true;
  await frame.locator(".setup-shell").waitFor({ state: "detached", timeout: 10_000 });
  await inline.frame.locator(".inline-card .lamp.ok").waitFor({ timeout: 10_000 });
  await shot(outer, "07-library");

  assert.deepEqual(await outer.evaluate(() => window.__calls), ["panel_launch_zotero"], "only Open Zotero is a tool call");
  assert.deepEqual(harness.errors, []);
  console.log(`ok — screenshots in ${artifacts}`);
} finally {
  await harness.close();
  await fake?.close();
}
