import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCommit } from "../src/changelog.ts";
import { webUrl } from "../src/git.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parse", () => {
  it("reads conventional, chinese and plain subjects", () => {
    expect(parseCommit("feat(api)!: rename")).toEqual({ type: "feat", scope: "api", summary: "rename", breaking: true });
    expect(parseCommit("fix: x", "BREAKING CHANGE: y").breaking).toBe(true);
    expect(parseCommit("修复：订单分页")).toMatchObject({ type: "fix", summary: "订单分页" });
    expect(parseCommit("新增会员等级")).toMatchObject({ type: "feat", summary: "会员等级" });
    expect(parseCommit("Add birthday coupons").type).toBe("feat");
    expect(parseCommit("Bump lodash to 4.17.21").type).toBe("deps");
    expect(parseCommit("random words").type).toBe("other");
    expect(webUrl("git@github.com:a/b.git")).toBe("https://github.com/a/b");
    expect(webUrl("https://user@gitlab.com/g/s/p.git")).toBe("https://gitlab.com/g/s/p");
  });
});

describe("changelog tools", () => {
  it("builds a changelog from a real repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "changelog-"));
    execFileSync(process.execPath, [join(HERE, "make-repo.mjs"), root]);
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("changelog_open", { inputs: ["shop-app"], project: "shop", settings: { next: "v1.2.0" } });
    expect(o.data.stats).toMatchObject({ releases: 3, commits: 13 });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.find((r) => r.summary === "rename /orders to /v2/orders")).toMatchObject({ _release: "v1.1.0", breaking: true, scope: "api" });
    expect(rows.find((r) => String(r.summary).startsWith("Merge"))!.include).toBe(false);
    const add = rows.findIndex((r) => r.summary === "Add birthday coupons");
    await c.call("changelog_edit", { project: "shop", set: [{ row: add, values: { summary: "生日优惠券", scope: "coupon" } }] });
    await c.call("changelog_export", { project: "shop" });
    const md = await readFile(join(root, "changelog-builder/shop/CHANGELOG.md"), "utf8");
    expect(md).toContain("## v1.2.0 (2026-09-05)\n\n### 新功能\n\n- **coupon:** 生日优惠券 ([");
    expect(md).toContain("- Dark mode ([#31](https://github.com/qinghe-demo/shop-app/issues/31)) ([3d3681f](https://github.com/qinghe-demo/shop-app/commit/");
    expect(md).toContain("- **coupon:** 生日优惠券");
    expect(md).toContain("### ⚠ 不兼容变更\n\n- **api:** Rename /orders to /v2/orders");
    expect(md).toContain("### 问题修复\n\n- 订单列表分页错误");
    expect(md).not.toContain("cache pnpm");
    expect(md).not.toContain("init project");
    expect(md.indexOf("## v1.2.0")).toBeLessThan(md.indexOf("## v1.1.0"));
    const notes = await readFile(join(root, "changelog-builder/shop/release-notes.md"), "utf8");
    expect(notes.startsWith("### 新功能")).toBe(true);
    expect(await readFile(join(root, "changelog-builder/shop/release-notes.html"), "utf8")).toContain("<h1>v1.2.0</h1>");
    await c.call("changelog_edit", { project: "shop", settings: { lang: "en", chores: true, range: "latest", next: "" } });
    await c.call("changelog_export", { project: "shop", formats: ["changelog"] });
    const en = await readFile(join(root, "changelog-builder/shop/CHANGELOG.md"), "utf8");
    expect(en).toContain("## Unreleased");
    expect(en).toContain("### CI");
    expect(en).not.toContain("v1.1.0");
  });
  it("reports a folder that is not a repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "changelog-"));
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    await expect(c.call("changelog_open", { inputs: ["."], project: "x" })).rejects.toMatchObject({ code: "git_failed" });
  });
});
