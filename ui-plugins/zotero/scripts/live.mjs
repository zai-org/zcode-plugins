import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * 针对本机正在运行的真实 Zotero 检查打包后的 server。
 * 默认只读；--write 时在一个临时分类里创建条目、笔记、注释并在结束时删除（Zotero 会弹出授权对话框）。
 * 用法：node scripts/live.mjs [--write]
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const workspace = await mkdtemp(join(tmpdir(), "zotero-live-"));
const client = new Client({ name: "zotero-live", version: "1" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist/server.mjs")],
    cwd: workspace,
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace, ZCODE_PLUGIN_DATA: join(workspace, ".data") },
    stderr: "ignore",
  }),
);
const call = async (name, args = {}) => {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 400_000 });
  const text = result.content[0].text;
  process.stdout.write(`  ${result.isError ? "✗" : "✓"} ${name} (${Date.now() - started} ms)${result.isError ? `: ${text}` : ""}\n`);
  return { ...result, text };
};
const ok = async (name, args) => {
  const result = await call(name, args);
  assert.ok(!result.isError, `${name}: ${result.text}`);
  return result;
};
const step = (name) => process.stdout.write(`• ${name}\n`);
const created = { items: [], collections: [] };

try {
  step("read-only checks");
  const status = await ok("list_collections");
  assert.match(status.text, /Zotero .* is running/);
  process.stdout.write(`    ${status.text.split("\n")[0]}\n`);
  const recent = await ok("search_library", { limit: 50 });
  const withPdf = recent.structuredContent.items.filter((item) => item.pdf);
  assert.ok(withPdf.length, "the library has at least one item with a PDF among the 50 most recent");
  let checked = 0;
  for (const item of withPdf.slice(0, 5)) {
    const detail = await ok("get_item", { key: item.key });
    assert.match(detail.text, new RegExp(`key ${item.key}`));
    const text = await call("read_fulltext", { key: item.key, pages: "1-2", maxChars: 4000 });
    if (text.isError) {
      // 附件可能没有下载到本机（只在云端），这不是插件错误。
      assert.match(text.text, /file_missing|not_pdf/);
      continue;
    }
    const body = text.text.split("\n").slice(2).join(" ");
    // 取第一页里一段较长的连续文字，检验查找、高亮与打开。
    const sentence = body.split(/(?<=[.!?])\s+/).map((part) => part.trim()).find((part) => part.length > 50 && part.length < 200 && !part.includes("---"));
    if (sentence) {
      const phrase = sentence.split(" ").slice(2, 8).join(" ");
      const found = await ok("find_in_pdf", { key: item.key, query: phrase, maxResults: 3 });
      assert.match(found.text, /match\(es\)/, `find_in_pdf should find "${phrase}"`);
      const highlighted = await ok("highlight", { key: item.key, quote: sentence, comment: "live test (not saved)", open: false });
      assert.match(highlighted.text, /Highlighted h\d+ on page/);
      await ok("open_item", { key: item.key, quote: phrase });
    }
    const info = JSON.parse((await client.readResource({ uri: `ui://zotero/lib/user/pdf/${item.pdf}/info.json` })).contents[0].text);
    const first = (await client.readResource({ uri: `ui://zotero/lib/user/pdf/${item.pdf}/0` })).contents[0].blob;
    assert.ok(Buffer.from(first, "base64").subarray(0, 1024).toString("latin1").includes("%PDF-"));
    assert.ok(info.parts >= 1);
    checked += 1;
  }
  assert.ok(checked > 0, "at least one PDF could be read");
  await ok("clear_highlights", {});
  await ok("cite", { keys: withPdf.slice(0, 3).map((item) => item.key), format: "text", style: "apa" });
  const bib = await ok("cite", { keys: withPdf.slice(0, 3).map((item) => item.key) });
  assert.doesNotMatch(bib.text, /file = \{/);
  await ok("search_annotations", {});
  const collections = status.structuredContent.collections;
  if (collections.length) {
    const largest = [...collections].sort((a, b) => b.numItems - a.numItems)[0];
    const exported = await ok("export_bib", { collection: largest.key, path: "refs/live.bib" });
    const file = await readFile(join(workspace, "refs/live.bib"), "utf8");
    assert.doesNotMatch(file, /file = \{|\/Users\/|C:\\\\/);
    process.stdout.write(`    exported ${exported.structuredContent.count} entries from "${largest.name}"\n`);
  }

  if (write) {
    step("write checks (approve the request in Zotero)");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const collection = await ok("create_collection", { name: `ZCode live test ${stamp}` });
    created.collections.push(collection.structuredContent.key);
    const added = await ok("add_item", {
      identifier: "arXiv:1706.03762",
      collections: [collection.structuredContent.key],
      tags: ["zcode-live-test"],
      note: "Added by the **ZCode Zotero plugin** live test; it is deleted at the end.",
    });
    const key = added.structuredContent.duplicate ?? added.structuredContent.key;
    if (!added.structuredContent.duplicate) created.items.push(key);
    process.stdout.write(`    ${added.text.replace(/\n/g, "\n    ")}\n`);
    if (!added.structuredContent.duplicate) {
      assert.ok(added.structuredContent.attachmentKey, "the arXiv PDF was attached");
      const text = await ok("read_fulltext", { key, pages: "1", maxChars: 2000 });
      assert.match(text.text, /attention/i);
      const highlighted = await ok("highlight", { key, quote: "The dominant sequence transduction models", comment: "live test annotation", save: true });
      assert.match(highlighted.text, /Saved to Zotero as annotation/);
      const detail = await ok("get_item", { key });
      assert.match(detail.text, /live test annotation/);
      assert.match(detail.text, /Added by the ZCode Zotero plugin live test/);
      const updated = await ok("update_item", { key, addTags: ["zcode-live-test-2"], fields: { extra: "zcode live test" } });
      assert.match(updated.text, /Updated/);
      const exported = await ok("export_bib", { collection: collection.structuredContent.key, path: "live-test.bib" });
      assert.equal(exported.structuredContent.count, 1);
    }
    const metadataItem = await ok("add_item", {
      metadata: { itemType: "report", title: `ZCode live test report ${stamp}`, creators: [{ lastName: "Tester", firstName: "Live" }], institution: "ZCode" },
      collections: [collection.structuredContent.key],
    });
    created.items.push(metadataItem.structuredContent.key);
    const note = await ok("add_note", { markdown: "Standalone note from the live test.", collections: [collection.structuredContent.key] });
    created.items.push(note.structuredContent.key);
  }
  process.stdout.write(`Live checks passed${write ? " (including writes)" : " (read-only)"}.\n`);
} finally {
  if (created.items.length || created.collections.length) {
    step("cleaning up");
    // 直接用本地 API 删除本次创建的条目与分类（插件本身不提供删除工具）。
    const keyFile = JSON.parse(await readFile(join(workspace, ".data/local-api-keys.json"), "utf8").catch(() => "{}"));
    const [serverId, key] = Object.entries(keyFile)[0] ?? [];
    if (!key) process.stdout.write("  no remembered key (Allow instead of Always Allow); delete the test collection in Zotero by hand.\n");
    else {
      const base = "http://127.0.0.1:23119/api/users/0";
      const version = (await fetch(`${base}/items/top?limit=1&format=keys`)).headers.get("last-modified-version");
      const headers = { "Zotero-API-Key": key, "Zotero-Server-ID": serverId, "If-Unmodified-Since-Version": version };
      const items = await fetch(`${base}/items?itemKey=${created.items.join(",")}`, { method: "DELETE", headers });
      process.stdout.write(`  deleted ${created.items.length} item(s): HTTP ${items.status}\n`);
      const after = (await fetch(`${base}/items/top?limit=1&format=keys`)).headers.get("last-modified-version");
      const collections = await fetch(`${base}/collections?collectionKey=${created.collections.join(",")}`, {
        method: "DELETE",
        headers: { ...headers, "If-Unmodified-Since-Version": after },
      });
      process.stdout.write(`  deleted ${created.collections.length} collection(s): HTTP ${collections.status}\n`);
    }
  }
  await client.close();
}
