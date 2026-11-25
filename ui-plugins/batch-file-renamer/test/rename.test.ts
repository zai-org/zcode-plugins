import { cp, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { newName, plan, type Rules } from "../src/rename.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const R: Rules = { find: "", replace: "", regex: false, template: "{name}", start: 1, pad: 3, case: "keep", extCase: "lower", spaces: "keep", sort: "name" };

describe("rules", () => {
  it("applies replace, template, case and spaces", () => {
    const f = { path: "a/IMG_20261103_101522.JPG", mtime: "2026-11-03T10:15:22Z" };
    expect(newName(f, 0, R).name).toBe("IMG_20261103_101522.jpg");
    expect(newName(f, 4, { ...R, regex: true, find: "^IMG_(\\d{4})(\\d{2})(\\d{2})_.*$", replace: "$1-$2-$3", template: "{name} 杭州 {n}" }).name).toBe("2026-11-03 杭州 005.jpg");
    expect(newName({ path: "notes  draft FINAL.txt", mtime: "" }, 0, { ...R, case: "title", spaces: "dash" }).name).toBe("Notes-Draft-Final.txt");
    expect(newName(f, 0, { ...R, template: "{parent}-{date}" }).name).toBe("a-2026-11-03.jpg");
    expect(newName(f, 0, { ...R, find: "/", replace: "x" }).name).toBe("IMG_20261103_101522.jpg");
    expect(newName(f, 0, { ...R, template: "a:b" }).name).toBe("a_b.jpg");
    expect(newName(f, 0, { ...R, regex: true, find: "(" }).error).toMatch(/regular expression/);
    expect(newName({ ...f, override: "封面" }, 0, R).name).toBe("封面.jpg");
  });
  it("flags duplicates and clashes, allows swaps", () => {
    const files = [{ path: "x/a.txt", mtime: "" }, { path: "x/b.txt", mtime: "" }];
    expect(plan(files, { ...R, template: "same" }, () => false).every((p) => /same name/.test(p.error ?? ""))).toBe(true);
    expect(plan(files, { ...R, template: "c" , find: "", }, () => false)[0].error).toMatch(/same name/);
    const swap = plan([{ path: "x/a.txt", mtime: "", override: "b" }, { path: "x/b.txt", mtime: "", override: "a" }], R, () => true);
    expect(swap.map((p) => [p.to, p.error])).toEqual([["x/b.txt", undefined], ["x/a.txt", undefined]]);
    expect(plan([files[0]], { ...R, template: "z" }, (p) => p === "x/z.txt")[0].error).toMatch(/already has/);
  });
});

describe("rename tools", () => {
  it("renames, logs and undoes on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "rename-"));
    await cp(join(HERE, "samples/photos"), join(root, "相册"), { recursive: true });
    await writeFile(join(root, "相册/keep.md"), "x");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("rename_open", { inputs: ["相册"], project: "trip", settings: { only: "jpg, png" } });
    expect(o.data.stats).toMatchObject({ files: 5, rename: 2 });
    const e = await c.call("rename_edit", { project: "trip", settings: { template: "杭州-{n}", sort: "name" } });
    expect(e.data.rows.map((r: { _to: string }) => r._to)).toEqual(["IMG_20261103_101522.jpg".replace(/.*/, "杭州-001.jpg"), "杭州-002.jpg", "杭州-003.jpg", "杭州-004.png", "杭州-005.jpg"]);
    await c.call("rename_edit", { project: "trip", set: [{ row: 4, values: { override: "keep.md" } }] });
    const bad = await c.call("rename_status", { project: "trip" });
    expect(bad.data.issues[0].message).toMatch(/already has/);
    await c.call("rename_edit", { project: "trip", set: [{ row: 4, values: { override: "微信图片" } }] });
    const x = await c.call("rename_export", { project: "trip" });
    expect(x.text).toMatch(/Renamed 5/);
    const names = (await readdir(join(root, "相册"))).sort();
    expect(names).toEqual(["keep.md", "notes  draft FINAL.txt", "微信图片.jpg", "报价单 (1).pdf", "报价单 (2).pdf", "杭州-001.jpg", "杭州-002.jpg", "杭州-003.jpg", "杭州-004.png"].sort());
    const again = await c.call("rename_status", { project: "trip" });
    expect(again.data.stats.rename).toBe(0);
    await c.call("rename_export", { project: "trip", formats: ["undo"] });
    expect((await readdir(join(root, "相册"))).sort()).toContain("IMG_20261103_101522.JPG");
    expect((await readdir(join(root, "相册"))).sort()).toContain("WeChat Image_20261106.jpg");
  });
});
