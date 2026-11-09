import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { startHarness } from "./harness.mjs";

/**
 * 设置页端到端：真实页面（ZCode 的 CSP）+ 测试 server（Typst 的查找结果由脚本控制）。
 * 未安装 → 交给 Agent（检查发出的消息）→ “正在安装” → Typst 出现 → 已就绪 → 预览。
 * 全程不应有页面发起的工具调用（宿主会为它们弹出审批）。先运行 pnpm build。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(process.env.TYPST_E2E_ARTIFACTS || join(tmpdir(), "typst-setup-e2e"));
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "typst-setup-"));
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
const workspace = join(scratch, "ws");
await cp(join(root, "test/fixtures/paper"), workspace, { recursive: true });
const toolchainFile = join(scratch, "toolchain.json");
const FACTS = { os: "macos", osName: "macOS 15.4", arch: "Apple silicon", tools: [{ name: "Homebrew", version: "4.5.2", path: "/opt/homebrew/bin/brew" }] };
const setToolchain = (toolchain, facts = FACTS) => writeFile(toolchainFile, JSON.stringify({ toolchain, facts }));
await setToolchain({ state: "missing" });

const harness = await startHarness({
  workspace,
  server: serverFile,
  env: { ZCODE_PLUGIN_DATA: join(scratch, "data"), TYPST_TEST_TOOLCHAIN: toolchainFile, TYPST_TEST_DIST: join(root, "dist") },
});
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`) });
const step = (name) => process.stdout.write(`• ${name}\n`);
const text = (frame, selector) => frame.locator(selector).first().innerText();

try {
  step("missing Typst: requirements, facts and the message for the agent");
  const { outer, frame } = await harness.open("?theme=light&locale=en-US", { width: 480, height: 900 });
  await frame.locator(".setup h1").waitFor();
  assert.equal(await text(frame, ".setup h1"), "Set up Typst");
  assert.equal(await frame.locator(".req .row").count(), 2);
  assert.match(await text(frame, ".req .row"), /Typst CLI[\s\S]*Not on PATH, \/opt\/homebrew\/bin or ~\/\.cargo\/bin[\s\S]*Missing/);
  await frame.locator(".req .card-foot").getByText("Homebrew 4.5.2").waitFor();
  assert.match(await text(frame, ".handoff .msg"), /brew install typst/);
  await shot(outer, "01-missing");

  step("the manual path opens on the tab for this computer");
  await frame.getByRole("button", { name: "Install it yourself" }).click();
  assert.equal(await frame.locator(".seg button[aria-pressed=true]").innerText(), "macOS");
  assert.equal(await text(frame, ".setup .cmd code"), "brew install typst");
  await frame.getByRole("button", { name: "Windows" }).click();
  assert.equal(await text(frame, ".setup .cmd code"), "winget install --id Typst.Typst");
  await frame.getByRole("button", { name: "Show all" }).click();
  assert.match(await text(frame, ".handoff .msg"), /The panel picks Typst up on its own/);
  await shot(outer, "02-manual-open");

  step("send to agent: the message goes to the chat and the page shows the agent working");
  await frame.getByRole("button", { name: "Send to agent" }).click();
  await frame.locator(".sent").waitFor();
  const sent = await outer.evaluate(() => window.__messages);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^Set up Typst for the Typst panel in ZCode\.\n\nThe panel checked this computer:\n• macOS 15\.4, Apple silicon\n• `typst` is not on PATH, in \/opt\/homebrew\/bin or in ~\/\.cargo\/bin\n• Homebrew 4\.5\.2 is available\n\nPlease:\n1\. Install Typst 0\.12 or later\. Prefer `brew install typst`\./);
  assert.equal(await text(frame, ".setup h1"), "Setting up Typst");
  await frame.locator(".req .live").getByText("Watching").waitFor();
  await frame.locator(".req .glyph.spin").waitFor();
  await frame.getByRole("button", { name: "Show message" }).click();
  await frame.locator(".sent-message .msg").waitFor();
  await shot(outer, "03-working");

  step("other pages (dark, Chinese) and the chat card know the agent is working");
  const zh = await harness.open("?theme=dark&locale=zh-CN", { width: 480, height: 900 });
  await zh.frame.locator(".setup h1").getByText("正在安装 Typst").waitFor();
  await shot(zh.outer, "04-working-dark-zh");
  const inline = await harness.open("?mode=inline", { width: 620, height: 120 });
  await inline.frame.locator(".inline-card").getByText("Agent is setting up Typst").waitFor();
  await inline.frame.locator(".inline-card .lamp.agent").waitFor();
  await shot(inline.outer, "05-inline-working");

  step("Typst appears: the page turns ready on its own, then opens the preview");
  // 截图中显示一个普通的 typst 路径，而不是仓库所在位置。
  const typst = join(scratch, "bin", "typst");
  await mkdir(dirname(typst), { recursive: true });
  await symlink(join(root, "test/fake-typst.mjs"), typst);
  await setToolchain({ state: "ready", path: typst, source: "common", version: "0.14.2" });
  await frame.locator(".setup h1").getByText("Typst is ready").waitFor({ timeout: 10_000 });
  await frame.locator(".req .live").getByText("All set").waitFor();
  await shot(outer, "06-ready");
  await frame.locator(".page canvas").first().waitFor({ timeout: 15_000 });
  await inline.frame.locator(".inline-card .lamp.ok").waitFor({ timeout: 10_000 });

  step("too old and broken installations, checked again from the page");
  await setToolchain({ state: "too_old", path: "/usr/local/bin/typst", source: "common", version: "0.11.1", error: "Typst 0.11.1 is older than 0.12.0." });
  // 已就绪时 server 不再定时查找；像设置页的“重新检查”一样立即查一次。
  await harness.client.readResource({ uri: "ui://typst-workbench/setup/check/e2e" });
  const old = await harness.open("?theme=light&locale=en-US", { width: 480, height: 900 });
  await old.frame.locator(".setup h1").getByText("Update Typst").waitFor({ timeout: 10_000 });
  assert.match(await text(old.frame, ".req"), /0\.11\.1[\s\S]*Too old/);
  await shot(old.outer, "07-too-old");
  await setToolchain({ state: "error", path: "/opt/typst/typst", source: "setting", error: "The Typst path in the plugin settings (/opt/typst/typst) is not an executable file." });
  await old.frame.getByRole("button", { name: "Check again" }).click();
  await old.frame.locator(".setup h1").getByText("Typst cannot run").waitFor({ timeout: 10_000 });
  await old.frame.locator(".setup .error-box").waitFor();
  await shot(old.outer, "08-error");

  step("the setup page made no tool calls (they would ask for approval)");
  const calls = await outer.evaluate(() => window.__calls);
  assert.deepEqual(calls, [], `the setup page made tool calls: ${calls.join(", ")}`);
  assert.deepEqual(harness.errors, []);
  console.log(`ok — screenshots in ${artifacts}`);
} finally {
  await harness.close();
}
