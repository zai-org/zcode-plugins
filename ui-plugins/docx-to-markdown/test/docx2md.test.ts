import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { convertDocx } from "../src/convert.ts";
import { parseXml, text } from "../src/xml.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body: string) => zipSync({ "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`) });
const o = { mediaDir: "m", headingOffset: 0, underline: false };

describe("convert", () => {
  it("parses xml", () => {
    const x = parseXml('<a k="1&amp;2"><b>x &lt; y</b><c/></a>');
    expect(text(x)).toBe("x < y");
  });
  it("handles runs, escaping, vmerge and code", () => {
    const r = convertDocx(docx(
      '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>大纲二级</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">1. 不是列表 a*b </w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>粗斜</w:t></w:r><w:r><w:rPr><w:strike/></w:rPr><w:t>删</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="1"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr><w:t>const longer_value = compute(1, 2, 3);</w:t></w:r></w:p>'), o);
    expect(r.markdown).toBe("## 大纲二级\n\n1\\. 不是列表 a\\*b ***粗斜***~~删~~\n\n| A | B |\n| --- | --- |\n| x | 1 |\n|   | 2 |\n\n```\nconst longer_value = compute(1, 2, 3);\n```\n");
  });
  it("rejects non-docx", () => {
    expect(() => convertDocx(new Uint8Array([1, 2, 3]), o)).toThrow(/Not a .docx/);
  });
});

describe("docx2md tools", () => {
  it("converts python-docx and round-trips markdown-to-docx output", async () => {
    const root = await mkdtemp(join(tmpdir(), "docx2md-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const op = await c.call("docx2md_open", { inputs: ["资料/员工手册.docx", "资料/会员系统说明.docx"], project: "h" });
    expect(op.data.rows[0]._info).toBe("4 headings · 1 tables · 1 images · 2 lists · 1 links");
    expect(op.data.stats.errors ?? 0).toBe(0);
    await c.call("docx2md_edit", { project: "h", settings: { frontMatter: true } });
    const e = await c.call("docx2md_export", { project: "h" });
    expect(e.text).toContain("员工手册_images/image1.png");
    const md = await readFile(join(root, "docx-to-markdown/h/员工手册.md"), "utf8");
    expect(md).toContain('title: "员工手册（2026 版）"');
    expect(md).toContain("# 员工手册（2026 版）\n\n## 第一章 入职须知");
    expect(md).toContain("### 1.1 工作时间\n\n1. 门店");
    expect(md).toContain("| 病假 | 按实际 | 需医院证明 \\| 病历 |");
    expect(md).toContain("[员工手册在线版](https://penova.example/handbook)");
    expect(md).toContain("![](%E5%91%98%E5%B7%A5%E6%89%8B%E5%86%8C_images/image1.png)");
    expect((await stat(join(root, "docx-to-markdown/h/员工手册_images/image1.png"))).size).toBeGreaterThan(100);
    const rt = await readFile(join(root, "docx-to-markdown/h/会员系统说明.md"), "utf8");
    expect(rt).toContain("- 积分累计与兑换\n   - 消费 1 元积 1 分");
    expect(rt).toContain("```\n{ \"member\": \"M0001\", \"points\": 1280 }\n```");
    expect(rt).toContain("![系统架构图](");
    expect(rt).not.toContain("更新域");
  });
});
