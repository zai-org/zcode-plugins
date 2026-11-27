// Browser e2e: packaged server + official AppBridge host + isolated iframe (ZCode-like CSP).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "whitebackground-shots");
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "whitebackground-e2e-"));
const harness = await startHarness({ workspace });
const step = (text: string) => process.stdout.write(`• ${text}\n`);
let failShot: (() => Promise<unknown>) | undefined;

try {
  const { outer, frame } = await harness.open("?locale=zh-CN", { width: 900, height: 1400 });
  failShot = () => outer.screenshot({ path: join(shots, "failed.png") });

  step("panel loads in Chinese");
  await frame.locator("h1", { hasText: "白底图" }).waitFor();
  await frame.locator("#width").fill("16");
  await frame.locator("#height").fill("16");
  step("user creates a 16×16 white canvas");
  await frame.locator("#create").click();
  await frame.locator("#saved-path", { hasText: "whitebackground/white-16x16.png" }).waitFor({ timeout: 60_000 });
  await frame.locator("#preview img").waitFor();
  assert.ok((await stat(join(workspace, "whitebackground/white-16x16.png"))).size > 0);
  await outer.screenshot({ path: join(shots, "01-panel.png") });

  step("user opens the square editor");
  await frame.locator('[data-workflow="square"] button[data-open="square"]').click();
  await frame.locator('[data-workflow="square"] .url', { hasText: "https://whitebackground.app/make-image-square" }).waitFor();
  await frame.locator('[data-workflow="square"] button.link').click();
  await outer.waitForFunction(() => (window as unknown as { __links: string[] }).__links.includes("https://whitebackground.app/make-image-square"));
  await outer.screenshot({ path: join(shots, "02-editor.png") });

  step("pricing link is requested through the host");
  await frame.locator("#pricing").click();
  await outer.waitForFunction(() => (window as unknown as { __links: string[] }).__links.includes("https://whitebackground.app/pricing"));

  step("agent saves another canvas; path escape is rejected");
  await harness.agent(outer, "canvas_create", { width: 32, height: 16 });
  await frame.locator("#saved-path", { hasText: "whitebackground/white-32x16.png" }).waitFor();
  await frame.locator("#preview img").waitFor();
  assert.ok((await stat(join(workspace, "whitebackground/white-32x16.png"))).size > 0);
  await harness.agent(outer, "canvas_create", { width: 16, height: 16, output: "../escape.png" }, { expectError: true });

  step("a newly opened panel reloads the last canvas without waiting for a tool-result notification");
  const late = await harness.open("?locale=zh-CN", { width: 900, height: 1400 });
  await late.frame.locator("#saved-path", { hasText: "whitebackground/white-32x16.png" }).waitFor({ timeout: 60_000 });
  await late.frame.locator("#preview img").waitFor();
  const previewSrc = await late.frame.locator("#preview img").getAttribute("src");
  assert.ok(previewSrc?.startsWith("data:image/png"), previewSrc);
  await late.outer.screenshot({ path: join(shots, "04-late-preview.png") });

  step("English dark panel");
  const en = await harness.open("?locale=en-US&theme=dark", { width: 900, height: 1400 });
  await en.frame.locator("h1", { hasText: "WhiteBackground" }).waitFor();
  await harness.agent(en.outer, "panel_open", {});
  await en.frame.locator("h1", { hasText: "WhiteBackground" }).waitFor();
  await en.outer.screenshot({ path: join(shots, "03-en-dark.png") });

  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} catch (error) {
  await failShot?.().catch(() => undefined);
  console.error("page errors:", harness.errors, harness.stderr.join(""));
  throw error;
} finally {
  await harness.close();
}
