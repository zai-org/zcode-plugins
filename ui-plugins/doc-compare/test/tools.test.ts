import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { compare, similarity, tokens, wordDiff } from "../src/compare.ts";
import { textParas } from "../src/extract.ts";
import { createServer } from "../src/server.ts";

// 真实样本：GitHub 服务条款 2025-03 与 2026-04 两版（CC0）及其 DOCX/PDF；模拟的中文合同两版。见 samples/doc-compare/SOURCES.txt。
// 样本不在仓库里时，这两组测试跳过，其余测试用下面现场生成的 DOCX。
const SAMPLES = process.env.DOC_SAMPLES ?? "/workspace/zcode-new-plugins/samples/doc-compare";
const HAVE_SAMPLES = existsSync(join(SAMPLES, "tos-2025-03.pdf"));

/** 最小 DOCX：段落数组，"#" 开头为标题；可带修订（[+插入+]、[-删除-]）。 */
function docx(paras: string[]) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const run = (t: string) => t.split(/(\[\+.*?\+\]|\[-.*?-\])/).filter(Boolean).map((part) =>
    part.startsWith("[+") ? `<w:ins w:id="1" w:author="a"><w:r><w:t xml:space="preserve">${esc(part.slice(2, -2))}</w:t></w:r></w:ins>`
    : part.startsWith("[-") ? `<w:del w:id="2" w:author="a"><w:r><w:delText>${esc(part.slice(2, -2))}</w:delText></w:r></w:del>`
    : `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join("");
  const body = paras.map((p) => (p.startsWith("#") ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(p.slice(1))}</w:p>` : `<w:p>${run(p)}</w:p>`)).join("");
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格 A &amp; B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`) });
}
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "dc-"));
  if (HAVE_SAMPLES) await cp(SAMPLES, join(workspace, "docs"), { recursive: true });
  else await mkdir(join(workspace, "docs"));
  await writeFile(join(workspace, "docs/gen-v1.docx"), docx(["#服务协议", "付款期限为30日。", "保留条款。"]));
  await writeFile(join(workspace, "docs/gen-v2.docx"), docx(["#服务协议", "付款期限为[-30-][+45+]日。", "新增的保密条款。", "保留条款。"]));
  await writeFile(join(workspace, "docs/gen-v2.md"), "---\ntitle: x\n---\n# 服务协议\n\n付款期限为60日。\n\n- 新增的保密条款。\n\n保留条款。\n\n单元格 A & B\n");
  await writeFile(join(workspace, "docs/broken.docx"), "not a zip");
  await writeFile(join(workspace, "docs/a.docx.bak"), "x");
  await writeFile(join(workspace, "docs/a.txt"), "第一段。\n\n第二段内容不变。\n\n要移动的这一段文字足够长，可以识别。\n\n最后一段。\n");
  await writeFile(join(workspace, "docs/b.txt"), "第一段。\n\n第二段内容不变。\n\n最后一段。\n\n要移动的这一段文字足够长，可以识别。\n");
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("diff", () => {
  it("tokenizes CJK by character and keeps numbers and words whole", () => {
    expect(tokens("于2025年6月 cost $1,200.50 ok")).toEqual(["于", "2025", "年", "6", "月", " ", "cost", " ", "$", "1,200.50", " ", "ok"]);
  });
  it("word diff is minimal and readable", () => {
    expect(wordDiff("Effective date: November 16, 2020", "Effective date: April 27, 2026")).toEqual([
      { op: "=", text: "Effective date: " },
      { op: "-", text: "November 16" },
      { op: "+", text: "April 27" },
      { op: "=", text: ", " },
      { op: "-", text: "2020" },
      { op: "+", text: "2026" },
    ]);
    expect(wordDiff("支付合同金额的40%作为预付款", "支付合同金额的30%作为预付款")).toEqual([{ op: "=", text: "支付合同金额的" }, { op: "-", text: "40" }, { op: "+", text: "30" }, { op: "=", text: "%作为预付款" }]);
  });
  it("pairs edited paragraphs even when much text was appended", () => {
    expect(similarity("乙方应于2025年6月30日前完成全部开发并交付甲方验收。", "乙方应于2025年7月15日前完成全部开发并交付甲方验收；因甲方原因导致延期的，交付时间相应顺延。")).toBeGreaterThan(0.6);
    const r = compare(textParas("A one.\n\nB two three four five.\n\nC six.", false), textParas("A one.\n\nB two three four five six seven.\n\nNew para here.\n\nC six.", false));
    expect(r.changes.map((c) => c.kind)).toEqual(["modified", "added"]);
  });
  it("ignore options", () => {
    const A = textParas("Hello, World.", false), B = textParas("hello world", false);
    expect(compare(A, B).changes).toHaveLength(1);
    expect(compare(A, B, { ignoreCase: true, ignorePunctuation: true }).changes).toHaveLength(0);
  });
});

describe("generated documents", () => {
  it("DOCX with tracked changes (accepted) vs Markdown", async () => {
    const s = (await call("compare_open", { old: "docs/gen-v2.docx", new: "docs/gen-v2.md" })).structuredContent;
    expect(s.A.map((p: any) => p.text)).toEqual(["服务协议", "付款期限为45日。", "新增的保密条款。", "保留条款。", "单元格A & B"]);
    expect(s.A[0].heading).toBe(1);
    expect(s.B[0]).toMatchObject({ text: "服务协议", heading: 1, loc: "L4" });
    expect(s.changes.map((c: any) => c.summary)).toEqual(["“45” → “60”"]);
    const g = (await call("compare_open", { old: "docs/gen-v1.docx", new: "docs/gen-v2.docx" })).structuredContent;
    expect(g.changes.map((c: any) => [c.kind, c.summary, c.numbers])).toEqual([["modified", "“30” → “45”", true], ["added", "+ 新增的保密条款。", false]]);
  });
});

describe.skipIf(!HAVE_SAMPLES)("real documents", () => {
  it("GitHub Terms of Service 2025 → 2026: same result from Markdown, DOCX and PDF", async () => {
    const stats: Record<string, any> = {};
    for (const ext of ["md", "docx", "pdf"]) {
      const r = await call("compare_open", { old: `docs/tos-2025-03.${ext}`, new: `docs/tos-2026-04.${ext}` });
      expect(r.isError).toBeFalsy();
      stats[ext] = r.structuredContent.stats;
      const eff = r.structuredContent.changes.find((c: any) => c.oldText.includes("Effective date"));
      expect(eff.kind).toBe("modified");
      expect(eff.numbers).toBe(true);
      expect(eff.summary).toBe("“November 16” → “April 27”; “2020” → “2026”");
      expect(r.structuredContent.changes.some((c: any) => c.kind === "added" && c.newText.includes("“Affiliate” means any entity"))).toBe(true);
    }
    expect(stats.docx).toMatchObject({ oldParas: 202, newParas: 236, modified: 44, added: 36 });
    // PDF 文字层还原出的段落与 DOCX 几乎一致（最多差 1 段）
    expect(Math.abs(stats.pdf.oldParas - stats.docx.oldParas)).toBeLessThanOrEqual(1);
    expect(stats.pdf.newParas).toBe(stats.docx.newParas);
    expect(Math.abs(stats.pdf.modified - stats.docx.modified) + Math.abs(stats.pdf.added - stats.docx.added)).toBeLessThanOrEqual(2);
  });

  it("Chinese contract: DOCX vs PDF across formats, character-level", async () => {
    const r = await call("compare_open", { old: "docs/合同-v1.docx", new: "docs/合同-v2.pdf" });
    const s = r.structuredContent;
    expect(s.stats).toMatchObject({ modified: 5, added: 1, deleted: 0, numbers: 4 });
    expect(s.changes.map((c: any) => c.summary)).toEqual([
      "“6” → “7”; “30” → “15”; +“；因甲方原因导致延期的，交付时间相应顺延”",
      "+“伍仟”; “60,000” → “65,000”",
      "“40” → “30”; “60” → “70”",
      "“七” → “五”",
      "+ 验收合格后提供三个月免费维护，期间修复程序缺陷不另收费。",
      "+“。未经甲方书面同意”; “可以在作品集中” → “不得对外”; “截图” → “内容”",
    ]);
    expect(s.changes[0].oldLoc).toMatch(/^¶\d+$/);
    expect(s.changes[0].newLoc).toBe("p.1");
  });

  it("detects moved paragraphs", async () => {
    const s = (await call("compare_open", { old: "docs/a.txt", new: "docs/b.txt" })).structuredContent;
    expect(s.changes.map((c: any) => c.kind)).toEqual(["moved"]);
    expect(s.rows.filter((r: any) => r.kind === "moved")).toHaveLength(2);
  });
});

describe.skipIf(!HAVE_SAMPLES)("review and export", () => {
  it("keeps review marks across runs and exports HTML/CSV", async () => {
    const open = (await call("compare_open", { old: "docs/合同-v1.docx", new: "docs/合同-v2.docx" })).structuredContent;
    const [pay, prepay] = [open.changes[1], open.changes[2]];
    const r = await call("compare_review", { old: "docs/合同-v1.docx", new: "docs/合同-v2.docx", reviews: [{ id: pay.id, status: "ok" }, { id: prepay.id, status: "question", note: "预付款比例降低，需确认现金流" }, { id: "nope" }] });
    expect(r.content[0].text).toMatch(/1 confirmed, 1 questioned, 4 open.*Unknown id\(s\): nope/);
    const again = (await call("compare_open", { old: "docs/合同-v1.docx", new: "docs/合同-v2.docx" })).structuredContent;
    expect(again.changes[2]).toMatchObject({ status: "question", note: "预付款比例降低，需确认现金流" });
    const ex = await call("compare_export", { old: "docs/合同-v1.docx", new: "docs/合同-v2.docx" });
    expect(ex.structuredContent.files).toEqual(["doc-compare/合同-v1__合同-v2.html", "doc-compare/合同-v1__合同-v2.csv"]);
    const html = await readFile(join(workspace, "doc-compare/合同-v1__合同-v2.html"), "utf8");
    expect(html).toContain("<del>40</del>");
    expect(html).toContain("<ins>30</ins>");
    expect(html).toContain("预付款比例降低，需确认现金流");
    const csv = await readFile(join(workspace, "doc-compare/合同-v1__合同-v2.csv"), "utf8");
    expect(csv.startsWith("\ufeffno,id,type")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(7);
    const q = await call("compare_export", { old: "docs/合同-v1.docx", new: "docs/合同-v2.docx", format: "csv", only: "question" });
    expect(q.structuredContent).toMatchObject({ count: 1, files: ["doc-compare/合同-v1__合同-v2-question.csv"] });
  });

});

describe("errors and files", () => {
  it("explains bad inputs", async () => {
    expect((await call("compare_open", { old: "docs/broken.docx", new: "docs/a.txt" })).content[0].text).toMatch(/not a readable .docx/);
    expect((await call("compare_open", { old: "docs/a.txt", new: "docs/a.txt" })).content[0].text).toMatch(/same file/);
    expect((await call("compare_open", { old: "docs/a.txt", new: "docs/a.docx.bak" })).content[0].text).toMatch(/supported formats/);
    expect((await call("compare_open", { old: "../etc/passwd.txt", new: "docs/a.txt" })).isError).toBe(true);
  });

  it("lists documents", async () => {
    const f = (await call("workspace_files", {})).structuredContent.files;
    expect(f).toEqual(expect.arrayContaining(["docs/gen-v1.docx", "docs/gen-v2.md", "docs/a.txt"]));
    expect(f.some((x: string) => x.startsWith("doc-compare/"))).toBe(false);
  });
});
