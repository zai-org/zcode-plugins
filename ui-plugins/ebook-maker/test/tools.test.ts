import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument, PDFName } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { extractFootnotes, parseChapter, slugger } from "../src/book.ts";
import { xhtmlFragment } from "../src/epub.ts";
import { createServer } from "../src/server.ts";

const SAMPLES = process.env.EBOOK_SAMPLES ?? "/workspace/zcode-new-plugins/samples/ebook";
const HAVE_SAMPLES = existsSync(join(SAMPLES, "nahan/book.json"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function pdfPages(data: Uint8Array) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(((await (await doc.getPage(i)).getTextContent()).items as { str: string }[]).map((x) => x.str).join(""));
  await task.destroy();
  return pages;
}

const CH1 = `# 第一章 出发

清晨六点[^a]，我们从[第二章](02-arrive.md#到达之后)出发。外链：<https://example.com/a>。

![路线图](img/map.png)

## 准备

- 第一项 **加粗**
- 第二项 *斜体* 与 \`code\`
  1. 嵌套一
  2. 嵌套二

> 引用一段话。
>
> 第二段引用。

| 项目 | 数量 |
|---|--:|
| 水 | 2 |
| 面包 | 4 |

\`\`\`js
console.log("[^not-a-note]");
\`\`\`

<p>原样&nbsp;HTML<br>换行</p>

[^a]: 当地时间，见[附录](#准备)。
[^unused]: 没人引用。
`;
const CH2 = `# 到达之后

傍晚到达[^b]。坏链接：[第三章](03-none.md)、[坏锚点](01-start.md#没有这个)。

![动图](img/anim.gif)

![缺图](img/missing.png)

参考[^nope]。

[^b]: 第二条注释，带 **粗体**。
`;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ebook-"));
  await mkdir(join(workspace, "book/img"), { recursive: true });
  await writeFile(join(workspace, "book/01-start.md"), CH1);
  await writeFile(join(workspace, "book/02-arrive.md"), CH2);
  await writeFile(join(workspace, "book/README.md"), "not a chapter");
  await writeFile(join(workspace, "book/img/map.png"), PNG);
  await writeFile(join(workspace, "book/img/anim.gif"), Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary"));
  await writeFile(join(workspace, "book/cover.png"), PNG);
  if (HAVE_SAMPLES) await cp(SAMPLES, join(workspace, "samples"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

describe("markdown", () => {
  it("numbers footnotes, keeps code untouched and makes GitHub-style slugs", () => {
    const { text, defs } = extractFootnotes(CH1);
    expect([...defs.keys()]).toEqual(["a", "unused"]);
    expect(text).toContain('console.log("[^not-a-note]")');
    const s = slugger();
    expect([s("到达之后"), s("Hello, World!"), s("Hello World"), s("Hello World")]).toEqual(["到达之后", "hello-world", "hello-world-1", "hello-world-2"]);
    const { chapter, issues } = parseChapter("01-start.md", CH1, "c01");
    expect(chapter.title).toBe("第一章 出发");
    expect(chapter.footnotes.map((f) => f.n)).toEqual([1]);
    expect(chapter.blocks.map((b) => b.t)).toEqual(["h", "p", "img", "h", "list", "quote", "table", "code", "html"]);
    expect(issues.map((i) => i.kind)).toEqual(["unused-footnote"]);
  });
  it("turns HTML into XHTML or escapes it", () => {
    expect(xhtmlFragment("<p>a&nbsp;b<br>c</p>")).toBe("<p>a&#160;b<br/>c</p>");
    expect(xhtmlFragment("<div><p>unclosed</div>")).toBe("<p>&lt;div&gt;&lt;p&gt;unclosed&lt;/div&gt;</p>");
  });
});

describe("tools", () => {
  it("opens a folder, infers settings and reports every problem with file:line", async () => {
    const r = await call("ebook_open", { dir: "book" });
    expect(r.isError).toBeFalsy();
    const v = r.structuredContent;
    expect(v.saved).toBe(false);
    expect(v.config).toMatchObject({ title: "book", language: "zh-CN", cover: "cover.png" });
    expect(v.chapters.map((c: any) => c.file)).toEqual(["01-start.md", "02-arrive.md"]);
    const got = v.issues.map((i: any) => `${i.level}:${i.kind}:${i.file ?? ""}:${i.line ?? ""}`);
    expect(got).toEqual([
      "error:missing-footnote:02-arrive.md:9",
      "error:missing-image:02-arrive.md:7",
      "error:broken-link:02-arrive.md:3",
      "error:broken-anchor:02-arrive.md:3",
      "warning:unused-footnote:01-start.md:30",
      "warning:pdf-image:02-arrive.md:5",
      "warning:metadata::",
      "warning:metadata::",
    ]);
    expect(v.external).toEqual([{ url: "https://example.com/a", file: "01-start.md", line: 3, text: "https://example.com/a" }]);
    expect(r.content[0].text).toContain("02-arrive.md:7: Image not found: img/missing.png");
  });

  it("saves metadata and chapter order to book.json", async () => {
    const r = await call("ebook_save", { dir: "book", meta: { title: "旅行笔记", author: "佩妮", subtitle: "示例", tocDepth: 2, pdf: { pageSize: "B6" } }, chapters: ["02-arrive.md", "01-start.md"] });
    expect(r.isError).toBeFalsy();
    const saved = JSON.parse(await readFile(join(workspace, "book/book.json"), "utf8"));
    expect(saved).toMatchObject({ title: "旅行笔记", author: "佩妮", tocDepth: 2, pdf: { pageSize: "B6", fontSize: 10.5 }, chapters: ["02-arrive.md", "01-start.md"], cover: "cover.png" });
    expect(saved.identifier).toMatch(/^urn:uuid:/);
    await call("ebook_save", { dir: "book", chapters: ["01-start.md", "02-arrive.md"] });
    const again = JSON.parse(await readFile(join(workspace, "book/book.json"), "utf8"));
    expect(again.title).toBe("旅行笔记");
    expect(again.identifier).toBe(saved.identifier);
    const bad = await call("ebook_save", { dir: "book", chapters: ["../x.md"] });
    expect(bad.isError).toBe(true);
  });

  it("writes a well-formed EPUB 3 with navigation, linked notes and images", async () => {
    const r = await call("ebook_export", { dir: "book", formats: ["epub"] });
    expect(r.isError).toBeFalsy();
    const path = r.structuredContent.outputs[0].path;
    expect(path).toBe("book/export/旅行笔记.epub");
    const raw = await readFile(join(workspace, path));
    // mimetype 是第一个条目且不压缩
    expect(raw.subarray(30, 38).toString()).toBe("mimetype");
    expect(raw.readUInt16LE(8)).toBe(0);
    const files = unzipSync(raw);
    for (const [name, data] of Object.entries(files)) if (/\.(xhtml|opf|ncx|xml)$/.test(name)) expect([name, XMLValidator.validate(strFromU8(data))]).toEqual([name, true]);
    const opf = strFromU8(files["OEBPS/content.opf"]);
    for (const m of opf.matchAll(/href="([^"]+)"/g)) expect(files[`OEBPS/${m[1]}`], m[1]).toBeDefined();
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain("<dc:title>旅行笔记</dc:title>");
    expect(opf).toMatch(/<spine toc="ncx">\s*<itemref idref="cover-page"[^>]*\/>\s*<itemref idref="title-page"\/>\s*<itemref idref="nav"\/>\s*<itemref idref="c01"\/>/);
    const nav = strFromU8(files["OEBPS/nav.xhtml"]);
    expect(nav).toContain('<a href="text/c01.xhtml#准备">准备</a>');
    const c1 = strFromU8(files["OEBPS/text/c01.xhtml"]);
    expect(c1).toContain('<a href="c02.xhtml#到达之后">第二章</a>');
    expect(c1).toContain('<sup><a class="noteref" epub:type="noteref" id="c01-fnref-1" href="#c01-fn-1">1</a></sup>');
    expect(c1).toContain('<aside class="footnote" epub:type="footnote" id="c01-fn-1">');
    expect(c1).toContain('见<a href="#准备">附录</a>');
    expect(c1).toMatch(/<figure><img src="\.\.\/images\/001-map\.png" alt="路线图"\/><figcaption>路线图<\/figcaption><\/figure>/);
    expect(c1).toContain("<p>原样&#160;HTML<br/>换行</p>");
    expect(c1).toContain('console.log(&quot;[^not-a-note]&quot;);');
    const c2 = strFromU8(files["OEBPS/text/c02.xhtml"]);
    expect(c2).toContain("[^nope]");
    expect(c2).toContain('<p class="missing">[缺图]</p>');
    expect(c2).toContain("坏链接：第三章、");
    expect(c2).not.toContain('href="03-none.md"');
    expect(Object.keys(files).filter((f) => f.startsWith("OEBPS/images/")).sort()).toEqual(["OEBPS/images/001-map.png", "OEBPS/images/002-anim.gif", "OEBPS/images/003-cover.png"]);
  });

  it("lays out a PDF with contents page numbers, endnotes, bookmarks and links", async () => {
    const r = await call("ebook_export", { dir: "book", formats: ["pdf"] });
    expect(r.isError).toBeFalsy();
    const out = r.structuredContent.outputs[0];
    expect(out.path).toBe("book/export/旅行笔记.pdf");
    const data = await readFile(join(workspace, out.path));
    const pdf = await PDFDocument.load(data);
    expect(pdf.getTitle()).toBe("旅行笔记");
    expect(pdf.getAuthor()).toBe("佩妮");
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(354.33, 1);
    expect(pdf.catalog.get(PDFName.of("Outlines"))).toBeDefined();
    const pages = await pdfPages(data);
    expect(pages.length).toBe(out.pages);
    // 封面、扉页、目录、第一章……
    expect(pages[1]).toContain("旅行笔记");
    const toc = pages[2];
    expect(toc).toMatch(/第一章 出发.*1/);
    const ch2Page = pages.findIndex((p, i) => i > 2 && p.includes("到达之后") && p.includes("傍晚到达"));
    expect(toc).toMatch(new RegExp(`到达之后[. ]*${ch2Page - 2}`));
    const all = pages.join("\n");
    expect(all).toContain("清晨六点");
    expect(all).toContain("注释");
    expect(all).toContain("当地时间");
    expect(all).toContain('console.log("[^not-a-note]");');
    expect(all).toContain("面包");
    const annots = pdf.getPages().flatMap((p) => p.node.Annots()?.asArray() ?? []);
    expect(annots.length).toBeGreaterThan(5);
    expect(r.content[0].text).toContain("Image not found: img/missing.png");
  });

  it("explains bad input", async () => {
    expect((await call("ebook_open", { dir: "nope" })).content[0].text).toContain("Folder not found");
    expect((await call("ebook_open", { dir: "../.." })).isError).toBe(true);
    await mkdir(join(workspace, "empty"));
    expect((await call("ebook_export", { dir: "empty" })).content[0].text).toContain("No Markdown chapters");
    expect((await call("file_data", { path: "book/01-start.md" })).isError).toBe(true);
  });

  it.skipIf(!HAVE_SAMPLES)("builds the sample books (魯迅《吶喊》選篇, Alice) and finds the draft mistakes", async () => {
    const nahan = await call("ebook_export", { dir: "samples/nahan" });
    expect(nahan.structuredContent.issues.filter((i: any) => i.level === "error")).toEqual([]);
    const pdfOut = nahan.structuredContent.outputs.find((o: any) => o.format === "pdf");
    const pages = await pdfPages(await readFile(join(workspace, pdfOut.path)));
    expect(pages[2]).toMatch(/目錄前言.*1狂人日記.*3孔乙己.*\d+故鄉.*\d+/);
    const kong = Number(/孔乙己[. ]*(\d+)/.exec(pages[2])![1]);
    expect(pages[kong + 2]).toContain("魯鎭的酒店的格局");
    const epub = unzipSync(await readFile(join(workspace, nahan.structuredContent.outputs[0].path)));
    expect(strFromU8(epub["OEBPS/text/c02.xhtml"])).toContain("<blockquote><p>某君昆仲");
    expect(strFromU8(epub["OEBPS/content.opf"])).toContain("<dc:language>zh-Hant</dc:language>");
    const alice = await call("ebook_check", { dir: "samples/alice" });
    expect(alice.structuredContent.issues.filter((i: any) => i.level === "error").map((i: any) => `${i.kind} ${i.target}`)).toEqual(["missing-image img/pool.png", "broken-link chapter3.md"]);
    expect(alice.content[0].text).toContain("External links:\n  chapter2.md:59 https://en.wikisource.org/");
  });
});
