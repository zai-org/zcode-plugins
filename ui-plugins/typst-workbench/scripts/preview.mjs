// 开发用：用本机的 typst 打开示例文档并截图面板。用法：node scripts/preview.mjs <输出目录> [theme] [locale]
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "typst-preview"));
await mkdir(out, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "typst-preview-ws-"));
await cp(join(root, "test/fixtures/paper"), workspace, { recursive: true });
const harness = await startHarness({ workspace, env: { ZCODE_PLUGIN_DATA: join(workspace, ".data") } });
try {
  const { outer, frame } = await harness.open(`?theme=${process.argv[3] ?? "light"}&locale=${process.argv[4] ?? "en-US"}`);
  await frame.locator(".page canvas").first().waitFor({ timeout: 30_000 });
  await frame.waitForTimeout(800);
  await outer.screenshot({ path: join(out, "1-preview.png") });
  await harness.agent(outer, "show", { file: "sections/body.typ", line: 2, comment: "This sentence comes from sections/body.typ line 2." });
  await frame.waitForTimeout(1000);
  await outer.screenshot({ path: join(out, "2-highlight.png") });
  console.log("errors:", harness.errors);
} finally {
  await harness.close();
}
