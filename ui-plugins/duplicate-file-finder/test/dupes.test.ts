import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pickKeep } from "../src/dupes.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("keep rule", () => {
  it("prefers originals over copies", () => {
    const f = (path: string, mtime = "2026-01-01") => ({ path, size: 1, mtime });
    expect(pickKeep([f("a/合同-终版 (1).pdf"), f("a/合同-终版.pdf"), f("a/b/合同.pdf")], "smart")).toBe(1);
    expect(pickKeep([f("a/b/logo.png"), f("a/logo copy.png")], "smart")).toBe(0);
    expect(pickKeep([f("x", "2026-03-01"), f("y", "2025-01-01")], "oldest")).toBe(1);
    expect(pickKeep([f("x", "2026-03-01T00:00:00Z"), f("y", "2025-01-01T00:00:00Z")], "newest")).toBe(0);
    expect(pickKeep([f("a/x"), f("备份/x")], "folder", "备份")).toBe(1);
  });
});

describe("dupes tools", () => {
  it("finds identical files only, moves extras and restores", async () => {
    const root = await mkdtemp(join(tmpdir(), "dupes-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("dupes_open", { inputs: ["下载"], project: "dl" });
    expect(o.data.stats).toMatchObject({ groups: 2, extra: 3 });
    const kept = o.data.rows.filter((r: { keep: boolean }) => r.keep).map((r: { path: string }) => r.path);
    expect(kept).toEqual(["下载/合同-终版.pdf", "下载/logo.png"]);
    const k = o.data.rows.findIndex((r: { path: string }) => r.path === "下载/logo.png");
    const none = await c.call("dupes_edit", { project: "dl", set: [{ row: k, values: { keep: false } }] });
    expect(none.data.issues[0]).toMatchObject({ level: "error" });
    await c.call("dupes_edit", { project: "dl", set: [{ row: k, values: { keep: true } }] });
    const x = await c.call("dupes_export", { project: "dl" });
    expect(x.text).toMatch(/Moved 3/);
    expect((await readdir(join(root, "下载"))).sort()).not.toContain("合同-终版 (1).pdf");
    expect(await readdir(join(root, "duplicate-file-finder/dl/review/下载/旧电脑备份"))).toHaveLength(2);
    expect(await readFile(join(root, "duplicate-file-finder/dl/duplicates.csv"), "utf8")).toMatch(/extra,下载\/合同-终版 \(1\)\.pdf,3030/);
    const s = await c.call("dupes_status", { project: "dl" });
    expect(s.data.stats.groups).toBe(0);
    await c.call("dupes_export", { project: "dl", formats: ["restore"] });
    expect((await readdir(join(root, "下载/旧电脑备份"))).sort()).toEqual(["logo copy.png", "合同.pdf"]);
  });
});
