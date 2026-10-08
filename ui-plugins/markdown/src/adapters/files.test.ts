// 工作区文件 IO 的路径边界与原子写行为。
import { access, mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownError } from "../contract.ts";
import {
  assertMarkdownExtension,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "./files.ts";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "md-files-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("assertMarkdownExtension", () => {
  it("accepts .md and .markdown (case-insensitive)", () => {
    expect(() => assertMarkdownExtension("docs/a.md")).not.toThrow();
    expect(() => assertMarkdownExtension("docs/Notes.MARKDOWN")).not.toThrow();
  });
  it("rejects other extensions", () => {
    expect(() => assertMarkdownExtension("docs/a.txt")).toThrow(MarkdownError);
  });
});

describe("readWorkspaceFile", () => {
  it("reads a file inside the workspace", async () => {
    await writeFile(join(workspace, "note.md"), "# hi");
    const { content } = await readWorkspaceFile(workspace, "note.md");
    expect(content).toBe("# hi");
  });
  it("rejects paths escaping the workspace", async () => {
    await expect(readWorkspaceFile(workspace, "../secret.md")).rejects.toMatchObject({
      code: "path_outside_workspace",
    });
  });
  it("rejects symlinks pointing outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "md-out-"));
    try {
      await writeFile(join(outside, "secret.md"), "x");
      await symlink(join(outside, "secret.md"), join(workspace, "linked.md"));
      await expect(readWorkspaceFile(workspace, "linked.md")).rejects.toMatchObject({
        code: "path_outside_workspace",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("reports missing files as not_found", async () => {
    await expect(readWorkspaceFile(workspace, "missing.md")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("writeWorkspaceFile", () => {
  it("rejects an escaped parent before creating any directories outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "md-out-"));
    try {
      await symlink(outside, join(workspace, "escape"));
      await expect(writeWorkspaceFile(workspace, "escape/new/nested/note.md", "x", false))
        .rejects.toMatchObject({ code: "path_outside_workspace" });
      await expect(access(join(outside, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("creates a new file and refuses to overwrite without the flag", async () => {
    await writeWorkspaceFile(workspace, "a.md", "one", false);
    await expect(writeWorkspaceFile(workspace, "a.md", "two", false)).rejects.toMatchObject({
      code: "file_exists",
    });
    expect(await readFile(join(workspace, "a.md"), "utf8")).toBe("one");
  });
  it("overwrites atomically when asked", async () => {
    await writeWorkspaceFile(workspace, "a.md", "one", false);
    await writeWorkspaceFile(workspace, "a.md", "two", true);
    expect(await readFile(join(workspace, "a.md"), "utf8")).toBe("two");
  });
  it("creates parent directories", async () => {
    await writeWorkspaceFile(workspace, "docs/deep/note.md", "x", false);
    expect(await readFile(join(workspace, "docs/deep/note.md"), "utf8")).toBe("x");
  });
  it("refuses to overwrite a symbolic link", async () => {
    const outside = await mkdtemp(join(tmpdir(), "md-out-"));
    try {
      await writeFile(join(outside, "target.md"), "keep");
      await mkdir(join(workspace, "dir"));
      await symlink(join(outside, "target.md"), join(workspace, "dir/link.md"));
      await expect(
        writeWorkspaceFile(workspace, "dir/link.md", "clobber", true),
      ).rejects.toMatchObject({ code: "unsafe_path" });
      expect(await readFile(join(outside, "target.md"), "utf8")).toBe("keep");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
