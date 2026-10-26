import { describe, expect, it } from "vitest";
import { makePdf, samplePaper } from "#test/pdf-fixture.mjs";
import { extractPdf, pdfjsDataDir, pdfjsFactoryUrls } from "#z/pdf/extract.ts";
import {
  buildPage,
  charWidth,
  findInPage,
  findQuote,
  normalize,
  parsePages,
  readableText,
  rectsFor,
  searchPages,
  sortIndex,
  textAt,
  type PageText,
} from "#z/domain/text.ts";

const page = (text: string, index = 0): PageText => buildPage([{ str: text, transform: [10, 0, 0, 10, 72, 700], width: text.length * 5, height: 10, hasEOL: false }], { index, label: String(index + 1), width: 612, height: 792 });

describe("normalize", () => {
  it("folds quotes, dashes, ligatures, case and whitespace, keeping a map to the source", () => {
    const { value, map } = normalize("We  don’t\n“ﬁx” A–B");
    expect(value).toBe('we don\'t "fix" a-b');
    // “ﬁ” 的两个字符都映射回连字本身。
    const fi = value.indexOf("fi");
    expect(map[fi]).toBe(map[fi + 1]);
  });

  it("joins words hyphenated at a line break but keeps real hyphens", () => {
    expect(normalize("de-\nallocated stack-allocated").value).toBe("deallocated stack-allocated");
    expect(normalize("Type-\nSystem").value).toBe("type- system");
  });

  it("compact mode drops all whitespace", () => {
    expect(normalize("a b\nc", true).value).toBe("abc");
  });
});

describe("findInPage / findQuote", () => {
  it("finds a quote regardless of spacing and line breaks", () => {
    const target = page("the call stack\nremains the backbone of most runtimes");
    const match = findInPage(target, "call stack remains   the backbone");
    expect(match).not.toBeNull();
    expect(target.text.slice(match!.start, match!.end)).toBe("call stack\nremains the backbone");
  });

  it("tolerates missing spaces in the PDF text", () => {
    const target = page("thecallstack remains");
    expect(findInPage(target, "the call stack")).not.toBeNull();
  });

  it("matches 'start … end' quotes", () => {
    const target = page("We identify a range of use cases where this delayed-popping strategy is beneficial, ranging from closures to trait objects.");
    const match = findInPage(target, "We identify a range of use cases … ranging from closures");
    expect(match).not.toBeNull();
    expect(target.text.slice(match!.start, match!.end)).toBe("We identify a range of use cases where this delayed-popping strategy is beneficial, ranging from closures");
  });

  it("prefers the requested page and falls back to the others", () => {
    const pages = [page("alpha beta", 0), page("gamma alpha beta", 1)];
    expect(findQuote(pages, "alpha beta", 1)!.pageIndex).toBe(1);
    expect(findQuote(pages, "alpha beta")!.pageIndex).toBe(0);
    expect(findQuote(pages, "not there")).toBeNull();
  });

  it("finds a quote that continues on the next page and anchors it on the first", () => {
    const pages = [page("the end of one page", 0), page("continues here and more", 1)];
    const match = findQuote(pages, "end of one page continues here");
    expect(match).toEqual({ pageIndex: 0, start: 4, end: pages[0]!.text.length });
  });
});

describe("rectsFor and sortIndex", () => {
  it("interpolates partial spans by glyph width and merges a line into one rect", () => {
    const target = buildPage(
      [
        { str: "hello ", transform: [10, 0, 0, 10, 100, 500], width: 30, height: 10 },
        { str: "world", transform: [10, 0, 0, 10, 130, 500], width: 25, height: 10, hasEOL: true },
        { str: "next line", transform: [10, 0, 0, 10, 100, 486], width: 45, height: 10 },
      ],
      { index: 2, label: "3", width: 612, height: 792 },
    );
    const start = target.text.indexOf("llo");
    const end = target.text.indexOf("next") + 4;
    const rects = rectsFor(target, start, end);
    expect(rects).toHaveLength(2);
    // "he" 占 "hello " 宽度的 1112/2390（Helvetica 字宽）。
    expect(rects[0]![0]).toBeCloseTo(100 + (30 * 1112) / 2390, 2);
    expect(rects[0]![2]).toBeCloseTo(155);
    expect(rects[0]![1]).toBeCloseTo(497.5);
    expect(rects[0]![3]).toBeCloseTo(507.5);
    const nextWidth = [..."next line"].reduce((sum, char) => sum + charWidth(char), 0);
    const nextPart = [..."next"].reduce((sum, char) => sum + charWidth(char), 0);
    expect(rects[1]![2]).toBeCloseTo(100 + (45 * nextPart) / nextWidth, 2);
    expect(sortIndex(target, start, rects)).toBe("00002|000002|00284");
    expect(charWidth("i")).toBeLessThan(charWidth("m"));
    expect(charWidth("类")).toBe(1000);
  });
});

describe("parsePages", () => {
  it("parses single pages, ranges and open ranges", () => {
    expect(parsePages("3", 10)).toEqual([2]);
    expect(parsePages("2-4, 9-", 10)).toEqual([1, 2, 3, 8, 9]);
    expect(parsePages("8-20", 10)).toEqual([7, 8, 9]);
    expect(() => parsePages("x", 10)).toThrow(/Invalid page range/);
  });
});

describe("real PDF text", () => {
  it("extracts pages, labels, and anchors quotes across hyphenated line breaks", async () => {
    const pdf = await extractPdf(new Uint8Array(samplePaper()), pdfjsDataDir());
    expect(pdf.pageCount).toBe(3);
    expect(pdf.pages.map((entry) => entry.label)).toEqual(["i", "1", "2"]);
    expect(readableText(pdf.pages[1]!.text)).toContain("the stack frame is deallocated together");
    const match = findQuote(pdf.pages, "we just don't pop the stack! Instead, the stack frame is deallocated");
    expect(match?.pageIndex).toBe(1);
    expect(textAt(pdf.pages[1]!, match!.start, match!.end)).toBe("we just don’t pop the stack! Instead, the stack frame is deallocated");
    const rects = rectsFor(pdf.pages[1]!, match!.start, match!.end);
    expect(rects).toHaveLength(3);
    // 第一行从 "we" 开始，不在行首；后续行从左边距开始。
    expect(rects[0]![0]).toBeGreaterThan(200);
    expect(rects[1]![0]).toBeCloseTo(72, 0);
    expect(rects[2]![0]).toBeCloseTo(72, 0);
    expect(rects[0]![1]).toBeGreaterThan(rects[1]![1]);
  });

  it("accepts a Windows pdf.js data folder", async () => {
    const dir = "C:\\Users\\me\\.zcode\\plugins\\zotero\\dist\\pdfjs\\";
    expect(pdfjsFactoryUrls(dir)).toEqual({ cMapUrl: `${dir}cmaps/`, standardFontDataUrl: `${dir}standard_fonts/` });
    // pdf.js 在 getDocument 中同步检查结尾的 "/"；这份 PDF 不需要 CMap，文件夹不存在也能读出文本。
    expect((await extractPdf(new Uint8Array(samplePaper()), dir)).pageCount).toBe(3);
  });

  it("ends a mid-line highlight at the right glyph", async () => {
    const pdf = await extractPdf(new Uint8Array(samplePaper()), pdfjsDataDir());
    const evaluation = pdf.pages[2]!;
    const match = findQuote([evaluation], "Execution time improves between 10% and 25%")!;
    const [rect] = rectsFor(evaluation, match.start, match.end);
    const width = [..."Execution time improves between 10% and 25%"].reduce((sum, char) => sum + charWidth(char), 0);
    // 11 pt Helvetica，从 x = 72 开始。
    expect(rect![0]).toBeCloseTo(72, 1);
    expect(rect![2]).toBeCloseTo(72 + (11 * width) / 1000, 0);
  });

  it("searches with snippets", async () => {
    const pdf = await extractPdf(new Uint8Array(samplePaper()), pdfjsDataDir());
    const hits = searchPages(pdf.pages, "STACK", 10);
    expect(hits.map((hit) => hit.pageIndex)).toEqual([1, 1, 1]);
    expect(hits[0]!.snippet).toContain("«");
    expect(searchPages(pdf.pages, "delayed popping", 5)[0]!.label).toBe("1");
  });

  it("rejects files that are not PDFs and reports pages without text", async () => {
    await expect(extractPdf(new TextEncoder().encode("hello"), null)).rejects.toThrow(/Could not read the PDF/);
    const empty = await extractPdf(new Uint8Array(makePdf([[]])), null);
    expect(empty.pages[0]!.text).toBe("");
  });
});
