// registry 的 revision 所有权与外部变更检测。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCH_DEBOUNCE_MS } from "../contract.ts";
import { DocumentRegistry } from "./registry.ts";

/** 轮询断言前置条件：机器负载下 watch 事件的到达时间有抖动。 */
async function waitFor(condition: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let workspace = "";
const registries: DocumentRegistry[] = [];
const makeRegistry = () => {
  const registry = new DocumentRegistry(workspace);
  registries.push(registry);
  return registry;
};

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "md-registry-"));
});
afterEach(async () => {
  for (const registry of registries.splice(0))
    for (const doc of registry.list()) registry.close(doc.id);
  await rm(workspace, { recursive: true, force: true });
  vi.useRealTimers();
});

const open = (registry: DocumentRegistry, path = "note.md", content = "# a") =>
  registry.open(join(workspace, path), content, true);

describe("DocumentRegistry", () => {
  it("derives a stable id from the relative path", () => {
    expect(DocumentRegistry.idFor("docs/api.md")).toBe(DocumentRegistry.idFor("docs/api.md"));
    expect(DocumentRegistry.idFor("a.md")).not.toBe(DocumentRegistry.idFor("b.md"));
  });

  it("opens the same path as the same document", async () => {
    const registry = makeRegistry();
    const first = await open(registry);
    const second = await registry.open(join(workspace, "note.md"));
    expect(second.doc.id).toBe(first.doc.id);
    expect(registry.list()).toHaveLength(1);
  });

  it("save bumps revision and rejects stale expectedRevision", async () => {
    const registry = makeRegistry();
    const { doc, content } = await open(registry);
    expect(doc.revision).toBe(1);
    const ref = await registry.save(doc, `${content}\nmore`, 1);
    expect(ref.revision).toBe(2);
    await expect(registry.save(doc, "stale", 1)).rejects.toMatchObject({
      code: "revision_conflict",
    });
  });

  it("patch applies find/replace and fails on no match", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry, "note.md", "# Title\n\nbody one one one");
    // 默认只替换第一处（与 contract 描述一致）。
    const first = await registry.patch(doc, [{ find: "one", replace: "1" }]);
    expect(first.replacements).toBe(1);
    expect(first.content).toContain("body 1 one one");
    const all = await registry.patch(doc, [{ find: "one", replace: "1", all: true }]);
    expect(all.replacements).toBe(2);
    expect(all.content).toContain("body 1 1 1");
    await expect(registry.patch(doc, [{ find: "nope", replace: "x" }])).rejects.toMatchObject({
      code: "no_matches",
    });
  });

  it("re-opening a drifted document bumps revision and flags external change", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry);
    // 面板关闭期间文件被外部改写，watcher 可能已回收；重新 open 必须暴露漂移。
    doc.watcher?.close();
    doc.watcher = undefined;
    await writeFile(join(workspace, "note.md"), "# drifted");
    const reopened = await registry.open(join(workspace, "note.md"));
    expect(reopened.doc.id).toBe(doc.id);
    expect(reopened.doc.externalChange).toBe(true);
    expect(reopened.doc.revision).toBe(2);
    expect(reopened.content).toBe("# drifted");
    // 旧 revision 保存仍会被拒绝。
    await expect(registry.save(doc, "stale", 1)).rejects.toMatchObject({
      code: "revision_conflict",
    });
  });

  it("re-opening an unchanged document keeps revision stable", async () => {
    const registry = makeRegistry();
    const first = await open(registry);
    const again = await registry.open(join(workspace, "note.md"));
    expect(again.doc.revision).toBe(first.doc.revision);
    expect(again.doc.externalChange).toBe(false);
  });

  it("detects external modification and flags conflict for stale writers", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry);
    const changes: string[] = [];
    registry.onChange((id) => changes.push(id));
    // 外部进程改写文件（轮询等待，避免机器负载下的固定时长抖动）。
    await writeFile(join(workspace, "note.md"), "# changed externally");
    await waitFor(() => doc.externalChange === true, 8000);
    expect(doc.externalChange).toBe(true);
    expect(doc.revision).toBe(2);
    expect(changes).toContain(doc.id);
    // 页面持有旧 revision 保存 → 冲突；草稿不落盘。
    await expect(registry.save(doc, "draft", 1)).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(await readFile(join(workspace, "note.md"))).toContain("externally");
  });

  it("absorbs watch events caused by its own writes", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry);
    await registry.save(doc, "# self write", 1);
    await new Promise((resolve) => setTimeout(resolve, WATCH_DEBOUNCE_MS + 800));
    expect(doc.externalChange).toBe(false);
    expect(doc.revision).toBe(2);
  });

  it("reload discards local state and re-reads the file", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry);
    await writeFile(join(workspace, "note.md"), "# external");
    const { content, ref } = await registry.reload(doc);
    expect(content).toBe("# external");
    expect(ref.revision).toBe(2);
    expect(doc.externalChange).toBe(false);
  });

  it("close stops tracking and watching", async () => {
    const registry = makeRegistry();
    const { doc } = await open(registry);
    registry.close(doc.id);
    expect(registry.get(doc.id)).toBeUndefined();
    await expect(registry.save({ ...doc } as never, "x", doc.revision)).rejects.toMatchObject({
      code: "unknown_document",
    });
  });
});

async function readFile(path: string) {
  const { readFile: read } = await import("node:fs/promises");
  return read(path, "utf8");
}
