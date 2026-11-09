// 开发用：连接本机真实的 Zotero（只读操作）并截图面板。用法：node scripts/preview.mjs <输出目录>
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHarness } from "./harness.mjs";

const out = resolve(process.argv[2] ?? join(tmpdir(), "zotero-preview"));
const workspace = await mkdtemp(join(tmpdir(), "zotero-preview-ws-"));
const harness = await startHarness({ workspace });
try {
  const { outer, frame } = await harness.open("?theme=light");
  await frame.locator(".item-row").first().waitFor({ timeout: 20_000 });
  await outer.screenshot({ path: join(out, "1-library.png") });
  await frame.locator(".scope-btn").click();
  await outer.screenshot({ path: join(out, "2-collections.png") });
  await frame.locator(".menu-pick", { hasText: "Reachability Types" }).click();
  await frame.locator(".item-row").first().waitFor();
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(out, "3-collection.png") });
  const list = await harness.client.callTool({ name: "search_library", arguments: { query: "Pop the Stack", limit: 1 } });
  const key = list.structuredContent.items[0].key;
  await harness.agent(outer, "open_item", { key, view: "details" });
  await frame.locator(".detail-title").waitFor();
  await frame.waitForTimeout(500);
  await outer.screenshot({ path: join(out, "4-item.png") });
  await harness.agent(outer, "highlight", { key, quote: "a type system that tracks the underlying storage mode of values", comment: "Mid-line highlight: checks glyph-width interpolation on a LaTeX font." });
  await frame.locator(".page canvas:not(.pending)").first().waitFor({ timeout: 30_000 });
  await frame.waitForTimeout(1500);
  await outer.screenshot({ path: join(out, "5-reader.png") });
  console.log("errors:", harness.errors);
} finally {
  await harness.close();
}
