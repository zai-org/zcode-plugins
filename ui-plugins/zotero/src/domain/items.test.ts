import { describe, expect, it } from "vitest";
import { creatorSummary, htmlToText, itemLine, parseAnnotation, summarize, yearOf, type RawItem } from "#z/domain/items.ts";
import { decodeQuery, encodeQuery, libraryPrefix } from "#z/contract.ts";
import { stripLocalPaths } from "#z/zotero/library.ts";

const raw = (data: Record<string, unknown>, extra: Partial<RawItem> = {}): RawItem => ({
  key: "ABCD2345",
  version: 3,
  data: { key: "ABCD2345", itemType: "journalArticle", ...data },
  ...extra,
});

describe("summaries", () => {
  it("summarizes creators the way Zotero does", () => {
    expect(creatorSummary([])).toBe("");
    expect(creatorSummary([{ creatorType: "author", lastName: "Wadler" }])).toBe("Wadler");
    expect(creatorSummary([{ creatorType: "author", lastName: "A" }, { creatorType: "author", lastName: "B" }])).toBe("A and B");
    expect(
      creatorSummary([
        { creatorType: "editor", lastName: "E" },
        { creatorType: "author", lastName: "A" },
        { creatorType: "author", lastName: "B" },
        { creatorType: "author", name: "Org" },
      ]),
    ).toBe("A et al.");
  });

  it("finds the year, venue and preferred PDF", () => {
    const item = summarize(
      raw(
        { title: "T", date: "June 2021", proceedingsTitle: "POPL", tags: [{ tag: "x" }] },
        { links: { attachment: { href: "http://localhost/api/users/1/items/PDFK2345", attachmentType: "application/pdf", attachmentSize: 10 } } },
      ),
    );
    expect(item).toMatchObject({ year: "2021", venue: "POPL", tags: ["x"], pdf: { key: "PDFK2345", size: 10 } });
    expect(yearOf(raw({ date: "" }, { meta: { parsedDate: "1999-01-02" } }))).toBe("1999");
    expect(summarize(raw({ itemType: "attachment", contentType: "application/pdf", filename: "a.pdf" })).pdf).toEqual({ key: "ABCD2345" });
    expect(summarize(raw({ itemType: "note", note: "<h1>Heading</h1><p>body</p>" })).title).toBe("Heading");
  });

  it("formats one line per item for the model", () => {
    const line = itemLine(summarize(raw({ title: "Paper", date: "2020", publicationTitle: "JFP", creators: [{ creatorType: "author", lastName: "Doe" }] })));
    expect(line).toBe("[ABCD2345] Paper — Doe (2020) · JFP · article");
  });
});

describe("htmlToText", () => {
  it("keeps structure and decodes entities", () => {
    expect(htmlToText('<div><h1>Title</h1><p>A &amp; B&nbsp;&#x2014; C</p><ul><li>one</li><li>two</li></ul><script>x</script></div>')).toBe(
      "Title\nA & B — C\n\n- one\n- two",
    );
    expect(htmlToText('<div class="csl-entry">Doe, J. (2020).</div><span class="Z3988" title="ctx"></span>')).toBe("Doe, J. (2020).");
  });
});

describe("annotations", () => {
  it("parses position JSON and tolerates broken positions", () => {
    const annotation = parseAnnotation(
      raw({
        itemType: "annotation",
        annotationType: "highlight",
        annotationText: "text",
        annotationColor: "#5fb236",
        annotationPosition: JSON.stringify({ pageIndex: 4, rects: [[1, 2, 3, 4], [5, 6]] }),
        annotationPageLabel: "17",
        annotationSortIndex: "00004|000001|00010",
      }),
    );
    expect(annotation).toMatchObject({ pageIndex: 4, pageLabel: "17", rects: [[1, 2, 3, 4]], color: "#5fb236" });
    expect(parseAnnotation(raw({ itemType: "annotation", annotationPosition: "{" })).rects).toEqual([]);
  });
});

describe("contract helpers", () => {
  it("round-trips item queries through path-safe encoding", () => {
    const query = { q: "类型 系统/+=", collection: "ABCD2345", start: 50, mode: "everything" as const };
    const encoded = encodeQuery(query);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeQuery(encoded)).toEqual(query);
    expect(decodeQuery(encodeQuery({ q: "" }))).toEqual({});
  });

  it("maps library ids to API prefixes", () => {
    expect(libraryPrefix("user")).toBe("/api/users/0");
    expect(libraryPrefix("g123")).toBe("/api/groups/123");
    expect(() => libraryPrefix("../x")).toThrow(/Unknown library/);
  });

  it("removes local file paths from exports", () => {
    const bib = "@article{a,\n\ttitle = {T},\n\tfile = {PDF:/Users/me/Zotero/storage/X/a.pdf:application/pdf},\n}\n";
    expect(stripLocalPaths(bib)).toBe("@article{a,\n\ttitle = {T},\n}\n");
    expect(stripLocalPaths("TY  - JOUR\nL1  - file:///a.pdf\nER  - \n")).toBe("TY  - JOUR\nER  - \n");
  });
});
