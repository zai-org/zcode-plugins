import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DocumentRegistry } from "./registry.ts";
let workspace: string;
let registry: DocumentRegistry;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "md-races-"));
  registry = new DocumentRegistry(workspace);
});
afterEach(async () => {
  for (const doc of registry.list()) registry.close(doc.id);
  await rm(workspace, { recursive: true, force: true });
});
it("rejects a write after disk drift before the watcher runs", async () => {
  const { doc } = await registry.open("a.md", "original", true);
  doc.watcher?.close();
  await writeFile(join(workspace, "a.md"), "external");
  await expect(registry.save(doc, "draft", 1)).rejects.toMatchObject({ code: "revision_conflict" });
  expect(await readFile(join(workspace, "a.md"), "utf8")).toBe("external");
});
it("admits only one concurrent save with the same revision", async () => {
  const { doc } = await registry.open("a.md", "original", true);
  const result = await Promise.allSettled([
    registry.save(doc, "first", 1),
    registry.save(doc, "second", 1),
  ]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(doc.revision).toBe(2);
});
it("rejects creating an already open document", async () => {
  await registry.open("a.md", "original", true);
  await expect(registry.open("a.md", "replacement", true)).rejects.toMatchObject({
    code: "file_exists",
  });
});
it("normalizes aliases to one revision owner", async () => {
  const first = await registry.open("a.md", "original", true);
  const again = await registry.open("./a.md");
  expect(again.doc).toBe(first.doc);
});
it("treats patch replacement as literal text", async () => {
  const { doc } = await registry.open("a.md", "hello hello", true);
  const result = await registry.patch(doc, [{ find: "hello", replace: "$& $$ $`", all: true }]);
  expect(result.content).toBe("$& $$ $` $& $$ $`");
});
it("detects external edits even when native watch notifications are lost", async () => {
  const { doc } = await registry.open("a.md", "original", true);
  doc.watcher?.close();
  await writeFile(join(workspace, "a.md"), "external without native notification");
  await expect.poll(() => doc.externalChange, { timeout: 5000 }).toBe(true);
  expect(doc.revision).toBe(2);
  registry.close(doc.id);
  const revision = doc.revision;
  await writeFile(join(workspace, "a.md"), "after close");
  expect(registry.get(doc.id)).toBeUndefined();
  expect(doc.revision).toBe(revision);
});
