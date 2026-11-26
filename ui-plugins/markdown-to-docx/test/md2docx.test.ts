import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DocBuilder, imageSize } from "../src/docx.ts";
import { imageRefs, resolvePath, splitFrontMatter } from "../src/server.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const filesOf = (r: { text: string }) => r.text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
const HERE = dirname(fileURLToPath(import.meta.url));
const opts = { latin: "Calibri", cjk: "SimSun", size: 11, page: "A4" as const, margin: 25, toc: false, title: "t", author: "", breakH1: true };

describe("converter", () => {
  it("parses helpers", () => {
    expect(splitFrontMatter("---\ntitle: 年报\nauthor: Lin\n---\n# A").meta).toEqual({ title: "年报", author: "Lin" });
    expect(resolvePath("docs/a/x.md", "../img/p%20q.png")).toBe("docs/img/p q.png");
    expect(imageRefs("![a](x.png) and ![b](https://e.com/y.png)")).toEqual(["x.png", "https://e.com/y.png"]);
    expect(imageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0x80, 0, 0, 1, 0x40]))).toEqual({ ext: "png", w: 640, h: 320 });
  });
  it("maps markdown to word xml", () => {
    const b = new DocBuilder(opts, () => undefined);
    b.add("# 标题 *x*\n\n**粗** _斜_ ~~删~~ `code` [链接](https://a.b)\n\n- a\n  - b\n1. one\n2. two\n\n- [x] done\n\n| h | n |\n|---|--:|\n| a | 1 |\n\n```\nl1\nl2\n```\n\n> q\n\n![缺](none.png)\n\n<!-- pagebreak -->\n", true);
    const z = unzipSync(b.build());
    const doc = strFromU8(z["word/document.xml"]);
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("<w:b/><w:bCs/>");
    expect(doc).toContain("<w:strike/>");
    expect(doc).toContain('w:rStyle w:val="CodeChar"');
    expect(doc).toMatch(/<w:hyperlink r:id="rId\d+">/);
    expect(doc).toContain('<w:ilvl w:val="1"/>');
    expect(doc).toContain("☑ ");
    expect(doc).toContain('<w:jc w:val="right"/>');
    expect((doc.match(/w:pStyle w:val="Code"/g) ?? []).length).toBe(2);
    expect(doc).toContain('w:pStyle w:val="Quote"');
    expect(doc).toContain("missing image: none.png");
    expect(doc).toContain('w:type="page"');
    expect(b.stats).toMatchObject({ headings: 1, tables: 1, lists: 3, code: 1, missing: ["none.png"] });
    expect(strFromU8(z["word/numbering.xml"])).toContain('<w:num w:numId="2"><w:abstractNumId w:val="1"/>');
    expect(strFromU8(z["word/styles.xml"])).toContain('w:eastAsia="SimSun"');
  });
});

describe("md2docx tools", () => {
  it("converts and merges", async () => {
    const root = await mkdtemp(join(tmpdir(), "md2docx-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("md2docx_open", { inputs: ["docs/产品说明书.md", "docs/会议纪要.md"], project: "d", settings: { toc: true } });
    expect(o.data.rows[0]).toMatchObject({ title: "青禾茶业会员系统 产品说明", out: "产品说明书" });
    expect(o.data.rows[0]._info).toContain("1 tables");
    const e = await c.call("md2docx_export", { project: "d" });
    expect(filesOf(e).length).toBe(2);
    const z = unzipSync(new Uint8Array(await readFile(join(root, filesOf(e)[0]))));
    expect(Object.keys(z)).toContain("word/media/image1.png");
    const doc = strFromU8(z["word/document.xml"]);
    expect(doc).toContain("TOC \\o");
    expect(doc).toContain("<wp:extent cx=\"5760000\" cy=\"2880000\"/>");
    await c.call("md2docx_edit", { project: "d", settings: { merge: true, mergedName: "全部" } });
    const m = await c.call("md2docx_export", { project: "d" });
    expect(filesOf(m)).toHaveLength(1);
    expect(filesOf(m)[0]).toMatch(/全部\.docx$/);
    const md = strFromU8(unzipSync(new Uint8Array(await readFile(join(root, filesOf(m)[0]))))["word/document.xml"]);
    expect(md).toContain("<w:pageBreakBefore/>");
    expect(md).toContain("11 月例会纪要");
  });
});
