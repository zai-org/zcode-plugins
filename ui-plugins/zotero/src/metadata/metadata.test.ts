import { describe, expect, it } from "vitest";
import { samplePaper } from "#test/pdf-fixture.mjs";
import {
  arxivToZotero,
  cslToZotero,
  downloadPdf,
  parseIdentifier,
  resolveIdentifier,
  safeFilename,
  zoteroFilename,
  type Fetcher,
} from "#z/metadata/metadata.ts";

describe("parseIdentifier", () => {
  it.each([
    ["10.1145/3571209", { kind: "doi", value: "10.1145/3571209" }],
    ["https://doi.org/10.4230/LIPIcs.ECOOP.2022.15", { kind: "doi", value: "10.4230/LIPIcs.ECOOP.2022.15" }],
    ["doi: 10.1000/xyz123.", { kind: "doi", value: "10.1000/xyz123" }],
    ["2207.03402", { kind: "arxiv", value: "2207.03402" }],
    ["arXiv:2207.03402v3", { kind: "arxiv", value: "2207.03402" }],
    ["https://arxiv.org/abs/2503.07328v2", { kind: "arxiv", value: "2503.07328" }],
    ["https://arxiv.org/pdf/2503.07328.pdf", { kind: "arxiv", value: "2503.07328" }],
    ["hep-th/9901001", { kind: "arxiv", value: "hep-th/9901001" }],
    ["10.48550/arXiv.2503.07328", { kind: "arxiv", value: "2503.07328" }],
  ])("%s", (input, expected) => {
    expect(parseIdentifier(input)).toEqual(expected);
  });

  it("rejects other strings", () => {
    expect(parseIdentifier("Types and Programming Languages")).toBeNull();
    expect(parseIdentifier("https://example.com/paper.pdf")).toBeNull();
  });
});

describe("cslToZotero", () => {
  it("maps a Crossref conference paper", () => {
    const item = cslToZotero({
      type: "paper-conference",
      title: "What If We Don't Pop the Stack?",
      "container-title": ["36th European Conference on Object-Oriented Programming (ECOOP 2022)"],
      event: { name: "ECOOP" },
      author: [{ family: "Xhebraj", given: "Anxhelo" }, { literal: "The Team" }],
      editor: [{ family: "Ali", given: "Karim" }],
      issued: { "date-parts": [[2022, 6]] },
      page: "15:1-15:29",
      DOI: "10.4230/LIPIcs.ECOOP.2022.15",
      abstract: "<jats:title>Abstract</jats:title><jats:p>Using a stack &amp; more.</jats:p>",
      ISBN: ["978-3-95977-225-9"],
    });
    expect(item).toMatchObject({
      itemType: "conferencePaper",
      proceedingsTitle: "36th European Conference on Object-Oriented Programming (ECOOP 2022)",
      conferenceName: "ECOOP",
      date: "2022-06",
      pages: "15:1-15:29",
      abstractNote: "Using a stack & more.",
      ISBN: "978-3-95977-225-9",
    });
    expect(item.creators).toEqual([
      { creatorType: "author", firstName: "Anxhelo", lastName: "Xhebraj" },
      { creatorType: "author", name: "The Team" },
      { creatorType: "editor", firstName: "Karim", lastName: "Ali" },
    ]);
  });

  it("maps journal articles and defaults unknown types", () => {
    expect(cslToZotero({ type: "journal-article", title: "T", "container-title": "JFP", volume: 3 })).toMatchObject({ itemType: "journalArticle", publicationTitle: "JFP", volume: "3" });
    expect(cslToZotero({ type: "something-new", title: "T" }).itemType).toBe("journalArticle");
  });
});

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2503.07328v2</id>
    <published>2025-03-10T14:00:00Z</published>
    <title>Complete the Cycle: Reachability Types
      with Expressive Cyclic References</title>
    <summary>  Local reasoning about programs that combine aliasing &amp; mutable state.  </summary>
    <author><name>Haotian Deng</name></author>
    <author><name>Siyuan He</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">Accepted at OOPSLA</arxiv:comment>
    <category term="cs.PL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

describe("arxivToZotero", () => {
  it("builds a preprint with the PDF link", () => {
    const { item, pdfUrl } = arxivToZotero(ATOM, "2503.07328");
    expect(item).toMatchObject({
      itemType: "preprint",
      title: "Complete the Cycle: Reachability Types with Expressive Cyclic References",
      abstractNote: "Local reasoning about programs that combine aliasing & mutable state.",
      date: "2025-03-10",
      archiveID: "arXiv:2503.07328",
      DOI: "10.48550/arXiv.2503.07328",
      extra: "Comment: Accepted at OOPSLA",
      tags: [{ tag: "cs.PL", type: 1 }],
    });
    expect(item.creators[0]).toEqual({ creatorType: "author", firstName: "Haotian", lastName: "Deng" });
    expect(pdfUrl).toBe("https://arxiv.org/pdf/2503.07328v2");
  });

  it("reports unknown ids", () => {
    expect(() => arxivToZotero('<feed><entry><id>http://arxiv.org/api/errors</id><title>Error</title></entry></feed>', "9999.99999")).toThrow(/no paper/);
    expect(() => arxivToZotero("<feed></feed>", "1")).toThrow(/no paper/);
  });
});

const fakeFetch =
  (routes: Record<string, () => Response>): Fetcher =>
  async (url) => {
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  };

describe("network", () => {
  it("resolves DOIs through content negotiation", async () => {
    const fetcher = fakeFetch({
      "https://doi.org/10.1/x": () => Response.json({ type: "article-journal", title: "Found", "container-title": "J" }),
      "https://doi.org/10.1/missing": () => new Response("", { status: 404 }),
    });
    expect((await resolveIdentifier({ kind: "doi", value: "10.1/x" }, fetcher)).item).toMatchObject({ title: "Found", DOI: "10.1/x" });
    await expect(resolveIdentifier({ kind: "doi", value: "10.1/missing" }, fetcher)).rejects.toThrow(/does not know/);
  });

  it("downloads PDFs and rejects HTML landing pages and oversized files", async () => {
    const pdf = new Uint8Array(samplePaper());
    const fetcher = fakeFetch({
      "https://ok.test/": () => new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="paper v2.pdf"' } }),
      "https://html.test/": () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
      "https://big.test/": () => new Response("x", { headers: { "content-length": String(500 * 1024 * 1024) } }),
    });
    const result = await downloadPdf("https://ok.test/file", fetcher);
    expect(result.bytes.length).toBe(pdf.length);
    expect(result.filename).toBe("paper v2.pdf");
    await expect(downloadPdf("https://html.test/x", fetcher)).rejects.toThrow(/did not return a PDF/);
    await expect(downloadPdf("https://big.test/x", fetcher)).rejects.toThrow(/too large/);
    await expect(downloadPdf("file:///etc/passwd", fetcher)).rejects.toThrow(/http or https/);
  });

  it("builds safe file names", () => {
    expect(safeFilename("../../a/b:c?.pdf")).toBe(".. .. a b c .pdf");
    expect(safeFilename("")).toBe("document.pdf");
    expect(zoteroFilename({ title: "Types: A Survey?", creators: [{ creatorType: "author", lastName: "Doe" }, { creatorType: "author", lastName: "Roe" }], date: "2020-01-01" })).toBe(
      "Doe and Roe - 2020 - Types A Survey.pdf",
    );
  });
});
