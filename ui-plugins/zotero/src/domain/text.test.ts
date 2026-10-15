import { describe, expect, it } from "vitest";
import { makePdf, samplePaper } from "#test/pdf-fixture.mjs";
import { extractPdf, pdfjsDataDir } from "#z/pdf/extract.ts";
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

  it.each([
    ["𝑥 + 𝐘 + 𝟙", "x + y + 1"],
    ["𝒜\u030A", "å"],
    ["e\u0301", "é"],
    ["a\u0315\u0300", "à\u0315"],
    ["가", "가"],
    ["ﬁ", "fi"],
    ["ＦＵＬＬ", "full"],
  ])("normalizes complete Unicode sequences in %s", (source, expected) => {
    const { value, map, endMap } = normalize(source);
    expect(value).toBe(expected);
    expect(map).toHaveLength(value.length);
    expect(endMap).toHaveLength(value.length);
  });

  it("normalizes the mathematical alphanumeric block without splitting surrogate pairs", () => {
    for (let code = 0x1d400; code <= 0x1d7ff; code++) {
      const source = String.fromCodePoint(code);
      expect(normalize(source).value).toBe(source.normalize("NFKC").toLowerCase());
    }
  });

  it("maps normalized UTF-16 units to complete original graphemes", () => {
    expect(normalize("🚀 e\u0301 ﬁ 𝑥")).toEqual({
      value: "🚀 é fi x",
      map: [0, 0, 2, 3, 5, 6, 6, 7, 8],
      endMap: [2, 2, 3, 5, 6, 7, 7, 8, 10],
    });
  });

  it("recomposes combining sequences after compact whitespace removal", () => {
    expect(normalize("a \u0301b", true)).toEqual({ value: "áb", map: [0, 3], endMap: [3, 4] });
    expect(normalize("𝒜 \u030A", true)).toEqual({ value: "å", map: [0], endMap: [4] });
  });

  it("retains the full original grapheme when compatibility decomposition splits a ligature", () => {
    expect(normalize("ﬁ\u0301")).toEqual({ value: "fí", map: [0, 0], endMap: [2, 2] });
    expect(normalize("ﬃ\u0301")).toEqual({ value: "ffí", map: [0, 0, 0], endMap: [2, 2, 2] });
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

  it.each([
    ["a \u0301b", "a\u0301b"],
    ["e\u200b\u0301", "é"],
    ["e\u00ad\u0301", "e\u0301"],
    ["ㄱㅏ", "가"],
    ["ㄱㅏ", "가"],
    ["𝒜 \u030A", "å"],
  ])("keeps complete source ranges when folding %s joins a Unicode sequence", (source, quote) => {
    const target = page(source);
    expect(findInPage(target, quote)).toEqual({ pageIndex: 0, start: 0, end: source.length });
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

  it.each([
    ["𝑥", "x"],
    ["𝑥", "𝑥"],
    ["e\u0301", "é"],
    ["é", "e\u0301"],
    ["ﬁ", "fi"],
    ["𝒜\u030A", "å"],
    ["😀", "😀"],
  ])("maps %s back to the complete original UTF-16 range", (source, quote) => {
    const prefix = "Before 🚀 ";
    const target = page(`${prefix}${source} after`);
    const match = findInPage(target, quote);
    expect(match).toEqual({ pageIndex: 0, start: prefix.length, end: prefix.length + source.length });
    expect(textAt(target, match!.start, match!.end)).toBe(source);
  });

  it("keeps search offsets after supplementary characters and between repeated hits", () => {
    const target = page("😀 𝑥 and 𝑥 end");
    const hits = searchPages([target], "x", 10);
    expect(hits.map(({ start, end }) => [start, end])).toEqual([[3, 5], [10, 12]]);
    expect(hits.map(({ snippet }) => snippet)).toEqual([
      "…😀 «𝑥» and 𝑥 end…",
      "…😀 𝑥 and «𝑥» end…",
    ]);
  });

  it.each(["ﬁ\u0301", "ﬃ\u0301"])("keeps the original accent when matching part of %s", (source) => {
    const target = page(source);
    const match = findInPage(target, "f");
    expect(match).toEqual({ pageIndex: 0, start: 0, end: source.length });
    expect(textAt(target, match!.start, match!.end)).toBe(source);
    expect(searchPages([target], "f", 10)).toEqual([
      { pageIndex: 0, label: "1", snippet: `…«${source}»…`, start: 0, end: source.length },
    ]);
  });
});

describe("rectsFor and sortIndex", () => {
  it("covers the entire mathematical glyph without selecting adjacent text", () => {
    const target = buildPage(
      [
        { str: "A ", transform: [10, 0, 0, 10, 72, 700], width: 20, height: 10 },
        { str: "𝑥", transform: [10, 0, 0, 10, 92, 700], width: 11, height: 10 },
        { str: " end", transform: [10, 0, 0, 10, 103, 700], width: 30, height: 10 },
      ],
      { index: 0, label: "1", width: 612, height: 792 },
    );
    const match = findQuote([target], "x")!;
    expect(match).toEqual({ pageIndex: 0, start: 2, end: 4 });
    expect(rectsFor(target, match.start, match.end)).toEqual([[92, 697.5, 103, 707.5]]);
    expect(sortIndex(target, match.start, rectsFor(target, match.start, match.end))).toBe("00000|000002|00084");
  });

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
  it("finds and highlights normalized mathematical quotes in extracted PDF text", async () => {
    const pdf = await extractPdf(
      new Uint8Array(makePdf([["The equation x = 1 follows."]], { unicodeMap: { x: "𝑥" } })),
      pdfjsDataDir(),
    );
    const target = pdf.pages[0]!;
    expect(target.text).toContain("𝑥 = 1");
    const hits = searchPages(pdf.pages, "x = 1", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain("«𝑥 = 1»");
    const match = findQuote(pdf.pages, "x")!;
    expect(textAt(target, match.start, match.end)).toBe("𝑥");
    const [rect] = rectsFor(target, match.start, match.end);
    expect(rect![2]).toBeGreaterThan(rect![0]);
  });

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
