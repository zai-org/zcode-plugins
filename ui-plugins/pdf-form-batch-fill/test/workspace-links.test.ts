import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "../src/kit/workspace.ts";

// 回归测试：工作区里的符号链接不能把读写带到工作区之外（TEST-FINDINGS #2）
describe("workspace symlink containment", () => {
  const base = mkdtempSync(join(tmpdir(), "wslinks-"));
  const root = join(base, "项目 ws"), outside = join(base, "outside");
  mkdirSync(join(root, "inner"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "SECRET");
  writeFileSync(join(root, "inner", "ok.txt"), "ok");
  symlinkSync(outside, join(root, "out-link"));
  symlinkSync(join(outside, "secret.txt"), join(root, "secret-link.txt"));
  symlinkSync(join(outside, "new-file.txt"), join(root, "dangling.txt"));
  symlinkSync(join(root, "inner"), join(root, "inner-link"));
  symlinkSync(root, join(base, "root-link"));
  const ws = new Workspace(root);

  it("refuses to read through a link to outside (directory and file links)", async () => {
    await expect(ws.read("out-link/secret.txt")).rejects.toMatchObject({ code: "outside_workspace" });
    await expect(ws.read("secret-link.txt")).rejects.toMatchObject({ code: "outside_workspace" });
    expect(await ws.exists("out-link/secret.txt")).toBe(false);
  });
  it("refuses to write through a link, including to targets that do not exist yet", async () => {
    await expect(ws.write("out-link/a/b/new.txt", "x")).rejects.toMatchObject({ code: "outside_workspace" });
    await expect(ws.write("dangling.txt", "x")).rejects.toMatchObject({ code: "outside_workspace" });
    expect(existsSync(join(outside, "a"))).toBe(false);
    expect(existsSync(join(outside, "new-file.txt"))).toBe(false);
  });
  it("still allows normal paths, new nested files and links that stay inside", async () => {
    expect(await ws.write("新 目录/子/文件.txt", "中文")).toBe("新 目录/子/文件.txt");
    expect((await ws.read("inner-link/ok.txt")).toString()).toBe("ok");
    await expect(ws.read("../outside/secret.txt")).rejects.toMatchObject({ code: "outside_workspace" });
  });
  it("works when the workspace root itself is reached through a link", async () => {
    const viaLink = new Workspace(join(base, "root-link"));
    expect((await viaLink.read("inner/ok.txt")).toString()).toBe("ok");
    await expect(viaLink.read("out-link/secret.txt")).rejects.toMatchObject({ code: "outside_workspace" });
  });
});
