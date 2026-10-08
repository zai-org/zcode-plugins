// 最近文档存储：去重置顶、限量、排除当前、按工作区隔离。
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecentStore } from "./recent.ts";

let dir = "";
let other = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "md-recent-"));
  other = await mkdtemp(join(tmpdir(), "md-recent-ws-"));
});
afterEach(async () => {
  await Promise.all([rm(dir, { recursive: true, force: true }), rm(other, { recursive: true, force: true })]);
});
const waitWrite = () => new Promise((resolve) => setTimeout(resolve, 1400));

describe("RecentStore", () => {
  it("records opens, dedupes and reorders to top", async () => {
    const store = new RecentStore(dir, "/ws/a");
    await store.touch("a.md");
    await store.touch("b.md");
    await store.touch("a.md");
    expect((await store.list(10)).map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
  });

  it("excludes the current document from the list", async () => {
    const store = new RecentStore(dir, "/ws/a");
    await store.touch("a.md");
    await store.touch("b.md");
    expect((await store.list(10, "a.md")).map((entry) => entry.path)).toEqual(["b.md"]);
  });

  it("caps the list length", async () => {
    const store = new RecentStore(dir, "/ws/a");
    for (let i = 0; i < 30; i += 1) await store.touch(`doc-${i}.md`);
    expect(await store.list(100)).toHaveLength(20);
    expect((await store.list(100))[0].path).toBe("doc-29.md");
  });

  it("persists per workspace and survives restart", async () => {
    await new RecentStore(dir, "/ws/a").touch("a.md");
    await new RecentStore(dir, "/ws/b").touch("b.md");
    await waitWrite();
    expect((await new RecentStore(dir, "/ws/a").list(10)).map((e) => e.path)).toEqual(["a.md"]);
    expect((await new RecentStore(dir, "/ws/b").list(10)).map((e) => e.path)).toEqual(["b.md"]);
  });

  it("tolerates a corrupted store file", async () => {
    const { createHash } = await import("node:crypto");
    const scope = createHash("sha256").update("/ws/a").digest("hex").slice(0, 12);
    const file = join(dir, `recent-${scope}.json`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "not json{", "utf8");
    const broken = new RecentStore(dir, "/ws/a");
    expect(await broken.list(5)).toEqual([]);
    await broken.touch("ok.md");
    await waitWrite();
    expect(JSON.parse(await readFile(file, "utf8")).entries).toHaveLength(1);
  });
});
