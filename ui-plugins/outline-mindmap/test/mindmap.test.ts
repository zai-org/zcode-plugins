import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { parseOutline } from "../src/outline.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("outline", () => {
  it("reads headings and nested lists", async () => {
    const items = parseOutline(await readFile(join(HERE, "samples/开店计划.md"), "utf8"), "x");
    expect(items[0]).toEqual({ level: 0, text: "茶铺开店计划" });
    expect(items[1]).toEqual({ level: 1, text: "选址" });
    expect(items[3]).toEqual({ level: 3, text: "工作日午间" });
    expect(items[5]).toEqual({ level: 2, text: "租金预算 每月 2 万以内" });
    expect(items.filter((x) => x.level === 1).map((x) => x.text)).toEqual(["选址", "产品", "营销", "团队", "资金"]);
  });
  it("adds a centre for plain lists and reads OPML", () => {
    expect(parseOutline("- a\n  - b\n- c\n", "根")).toEqual([{ level: 0, text: "根" }, { level: 1, text: "a" }, { level: 2, text: "b" }, { level: 1, text: "c" }]);
    expect(parseOutline('<?xml version="1.0"?><opml><head><title>T</title></head><body><outline text="A &amp; B"><outline text="c"/></outline><outline text="d"/></body></opml>', "f")).toEqual([{ level: 0, text: "T" }, { level: 1, text: "A & B" }, { level: 2, text: "c" }, { level: 1, text: "d" }]);
    expect(parseOutline("# A\n#### deep\n", "f")).toEqual([{ level: 0, text: "A" }, { level: 1, text: "deep" }]);
  });
});

describe("tools", () => {
  it("opens the outline, edits nodes and exports every format", async () => {
    const root = await mkdtemp(join(tmpdir(), "mm-"));
    await cp(join(HERE, "samples"), join(root, "notes"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("mindmap_open", { inputs: ["notes/开店计划.md"], project: "shop" });
    expect(o.data.stats).toMatchObject({ nodes: 25, branches: 5, depth: 3 });
    await c.call("mindmap_edit", { project: "shop", set: [{ row: 6, values: { 内容: "竞品调研" } }, { row: 10, values: { include: false } }, { row: 1, values: { color: "#abcdef" } }], add: [{ level: 1, text: "风险" }, { level: 2, text: "租约到期" }] });
    const st = await c.call("mindmap_status", { project: "shop" });
    expect(st.data.stats).toMatchObject({ nodes: 26, branches: 6 });
    await c.call("mindmap_export", { project: "shop" });
    const dir = join(root, "outline-mindmap/shop");
    const svg = await readFile(join(dir, "mindmap.svg"), "utf8");
    expect(svg).toContain("竞品调研");
    expect(svg).not.toContain("桂花乌龙");
    expect(svg).toContain('fill="#abcdef"');
    expect(await readFile(join(dir, "mindmap.opml"), "utf8")).toContain('<outline text="风险">');
    const mm = await readFile(join(dir, "mindmap.mm"), "utf8");
    expect(mm.match(/POSITION="left"/g)?.length).toBeGreaterThan(0);
    expect(await readFile(join(dir, "outline.md"), "utf8")).toContain("## 风险\n- 租约到期");
    expect((await readFile(join(dir, "mindmap.png"))).subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);
});
