import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { startFakeZotero } from "#test/fake-zotero.mjs";
import { samplePaper } from "#test/pdf-fixture.mjs";
import { createZoteroMcpServer } from "#z/adapters/server.ts";
import { ZoteroSession } from "#z/app/session.ts";
import { STATE_URI, URIS, type AnnotationsDoc, type ItemDetail, type ItemList, type PdfInfo, type SessionState } from "#z/contract.ts";
import { pdfjsDataDir } from "#z/pdf/extract.ts";

type Fake = Awaited<ReturnType<typeof startFakeZotero>>;
let fake: Fake;
let client: Client;
let session: ZoteroSession;
let workspace: string;
const fetched: string[] = [];
const updates: string[] = [];

const ATOM = `<feed><entry><id>http://arxiv.org/abs/2207.03402v2</id><published>2022-07-07T00:00:00Z</published><title>Capturing Types</title><summary>Type systems that track captures.</summary><author><name>Aleksander Boruch-Gruszecki</name></author><author><name>Martin Odersky</name></author></entry></feed>`;

beforeAll(async () => {
  fake = await startFakeZotero({ authorize: "always" });
  workspace = await mkdtemp(join(tmpdir(), "zotero-ws-"));
  const pdf = new Uint8Array(samplePaper());
  session = new ZoteroSession({
    baseUrl: fake.url,
    keyFile: join(workspace, ".data", "keys.json"),
    workspaceRoot: workspace,
    pdfjsDataDir: pdfjsDataDir(),
    fetcher: async (url) => {
      fetched.push(url);
      if (url.startsWith("https://export.arxiv.org/api/query")) return new Response(ATOM);
      if (url.startsWith("https://arxiv.org/pdf/")) return new Response(pdf, { headers: { "content-type": "application/pdf" } });
      if (url === "https://doi.org/10.5555/new.1")
        return Response.json({ type: "paper-conference", title: "A New Conference Paper", "container-title": "POPL", author: [{ family: "Doe", given: "Jane" }], issued: { "date-parts": [[2024]] }, DOI: "10.5555/new.1" });
      if (url === "https://doi.org/10.1234/stack.2022.15") return Response.json({ type: "article-journal", title: "Second-Class Values Revisited", DOI: "10.1234/stack.2022.15" });
      if (url.startsWith("https://landing.test/")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  const server = createZoteroMcpServer({ session, assetRoot: workspace, pdfjsDataDir: pdfjsDataDir() });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => void updates.push(notification.params.uri));
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  session.close();
  await client.close();
  await fake.close();
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[]; structuredContent?: any };
  return { ...result, text: result.content[0]!.text };
};
const ok = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await call(name, args);
  expect(result.isError, `${name}: ${result.text}`).toBeFalsy();
  return result;
};
const fail = async (name: string, args: Record<string, unknown>, code: string) => {
  const result = await call(name, args);
  expect(result.isError, `${name} should fail`).toBe(true);
  expect(result.structuredContent.error.code).toBe(code);
  return result;
};
const readJson = async <T>(uri: string): Promise<T> => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text) as T;

describe("tool list", () => {
  it("exposes model tools with UI metadata, and panel-only tools hidden from the model", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "add_item", "add_note", "attach_pdf", "authorize_writes", "cite", "clear_highlights", "create_collection", "export_bib", "find_in_pdf",
        "get_item", "highlight", "list_collections", "open_item", "panel_launch_zotero", "panel_refresh", "read_fulltext", "save_highlights", "search_annotations",
        "search_library", "show_items", "update_item",
      ].sort(),
    );
    for (const tool of tools) {
      const ui = (tool._meta as { ui: { resourceUri: string; surface: string; visibility: string[] } }).ui;
      expect(ui.resourceUri).toBe("ui://zotero/panel.html");
      expect(ui.surface).toBe("zotero");
      expect(ui.visibility).toEqual(tool.name.startsWith("panel_") ? ["app"] : ["model", "app"]);
    }
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name);
    expect(readOnly).toEqual(expect.arrayContaining(["search_library", "get_item", "read_fulltext", "cite", "open_item"]));
    expect(readOnly).not.toContain("add_item");
    expect(readOnly).not.toContain("export_bib");
  });
});

describe("reading", () => {
  it("lists collections with status", async () => {
    const result = await ok("list_collections");
    expect(result.text).toContain("Zotero 11.0-test is running. Writes: available");
    expect(result.text).toMatch(/- PL \[CLPLAAAA\] \(1 item\)\n {2}- Type Systems \[CLTYAAAA\] \(1 item\)/);
    expect(result.text).toContain("Saved searches:\n- Stack papers [SRCHAAAA]");
  });

  it("searches by text, collection name and tag", async () => {
    expect((await ok("search_library", { query: "second-class" })).text).toContain("[PAPERAAA] Second-Class Values Revisited — Lovelace et al. (2022) · Journal of Stack Studies · article · PDF PDFATTAA");
    expect((await ok("search_library", { collection: "PL/Type Systems" })).structuredContent.items.map((item: { key: string }) => item.key)).toEqual(["PAPERAAA"]);
    expect((await ok("search_library", { tag: "capture checking" })).structuredContent.total).toBe(1);
    expect((await ok("search_library", { query: "region inference", mode: "everything" })).structuredContent.items[0].key).toBe("PAPERAAA");
    expect((await ok("search_library", { savedSearch: "SRCHAAAA" })).structuredContent.items[0].key).toBe("PAPERAAA");
    await fail("search_library", { collection: "Nope" }, "not_found");
  });

  it("reads an item with notes and the user's annotations", async () => {
    const result = await ok("get_item", { key: "PAPERAAA" });
    expect(result.text).toContain("Creators: Ada Lovelace; Alan Turing; Grace Hopper");
    expect(result.text).toContain("Collections: Type Systems [CLTYAAAA]");
    expect(result.text).toContain("- [PDFATTAA] Full Text PDF (application/pdf, 1 annotation(s))");
    expect(result.text).toContain("- p. 1 highlight #ffd400 “We design a type system that tracks storage modes.” — comment: Key contribution [tags: important] (key ANNTAAAA)");
    expect(result.text).toContain("Reading note: compare with region inference.");
    await fail("get_item", { key: "ZZZZZZZZ" }, "not_found");
    const invalid = await call("get_item", { key: "bad" });
    expect(invalid.isError).toBe(true);
  });

  it("searches annotations across the library", async () => {
    const result = await ok("search_annotations", { query: "storage" });
    expect(result.text).toContain("1 annotation(s) match.");
    expect(result.text).toContain("[PAPERAAA] Second-Class Values Revisited");
    expect((await ok("search_annotations", { color: "green" })).structuredContent.total).toBe(0);
    expect((await ok("search_annotations", { collection: "PL" })).structuredContent.total).toBe(1);
    expect((await ok("search_annotations", { tag: "important", item: "PAPERAAA" })).structuredContent.total).toBe(1);
  });

  it("reads full text by page with labels and continuation", async () => {
    const all = await ok("read_fulltext", { key: "PAPERAAA" });
    expect(all.text).toContain('"Second-Class Values Revisited" [PAPERAAA], PDF PDFATTAA, 3 pages.');
    expect(all.text).toContain("--- page 1 (printed i) ---\nPreface");
    expect(all.text).toContain("--- page 2 (printed 1) ---");
    expect(all.text).toContain("the stack frame is deallocated together");
    const cut = await ok("read_fulltext", { key: "PDFATTAA", pages: "2-3", maxChars: 1000 });
    expect(cut.text).not.toContain("Preface");
    expect(cut.structuredContent.lastPage).toBe(3);
    await fail("read_fulltext", { key: "TAPLBKAA" }, "not_pdf");
    await fail("read_fulltext", { key: "PAPERAAA", pages: "x" }, "invalid_input");
  });

  it("finds phrases in the PDF", async () => {
    const result = await ok("find_in_pdf", { key: "PAPERAAA", query: "delayed popping" });
    expect(result.text).toContain("- page 2 (printed 1):");
    expect(result.text).toContain("«delayed popping»");
    expect((await ok("find_in_pdf", { key: "PAPERAAA", query: "monads" })).text).toContain("No match");
  });

  it("formats citations and strips local paths", async () => {
    const bib = await ok("cite", { keys: ["PAPERAAA"] });
    expect(bib.text).toContain("@article{lovelace_second_2022,");
    expect(bib.text).not.toContain("file = ");
    const text = await ok("cite", { keys: ["PAPERAAA", "TAPLBKAA"], format: "text", style: "apa" });
    expect(text.text).toContain("[PAPERAAA] in-text: (Lovelace et al., 2022)\nLovelace et al.. Second-Class Values Revisited.");
    expect(text.text).toContain("[TAPLBKAA] in-text: (Pierce, 2002)");
  });
});

describe("panel views and highlights", () => {
  it("shows items and opens the reader at a quote", async () => {
    await client.subscribeResource({ uri: STATE_URI });
    const shown = await ok("show_items", { keys: ["PAPERAAA", "TAPLBKAA", "ZZZZZZZZ"], title: "Stack" });
    expect(shown.text).toContain("Unknown keys skipped: ZZZZZZZZ");
    let state = await readJson<SessionState>(STATE_URI);
    expect(state.view).toEqual({ kind: "items", library: "user", title: "Stack", keys: ["PAPERAAA", "TAPLBKAA"] });
    const opened = await ok("open_item", { key: "PAPERAAA", quote: "execution time improves" });
    expect(opened.structuredContent).toMatchObject({ view: "reader", attachmentKey: "PDFATTAA", page: 3 });
    state = await readJson<SessionState>(STATE_URI);
    expect(state.view).toMatchObject({ kind: "reader", attachmentKey: "PDFATTAA", pageIndex: 2 });
    expect(state.viewSeq).toBe(2);
    expect((await ok("open_item", { key: "TAPLBKAA" })).structuredContent.view).toBe("item");
    expect((await ok("open_item", { key: "PAPERAAA", page: 9 })).text).toContain("The PDF has 3 pages.");
  });

  it("highlights a quote, exposes it to the panel and saves it as a Zotero annotation", async () => {
    const result = await ok("highlight", { key: "PAPERAAA", quote: "we just don't pop the stack! Instead, the stack frame is deallocated", comment: "core idea" });
    expect(result.text).toContain("Highlighted h1 on page 2 (printed 1): “we just don’t pop the stack! Instead, the stack frame is deallocated”.");
    const doc = await readJson<AnnotationsDoc>(URIS.annotations("user", "PDFATTAA"));
    expect(doc.annotations.map((annotation) => annotation.key)).toEqual(["ANNTAAAA"]);
    expect(doc.highlights).toHaveLength(1);
    expect(doc.highlights[0]!.rects).toHaveLength(3);
    await fail("highlight", { key: "PAPERAAA", quote: "this sentence is not in the paper" }, "quote_not_found");

    const saved = await ok("save_highlights", {});
    expect(saved.text).toMatch(/Saved 1 highlight\(s\) to Zotero: h1 → [A-Z0-9]{8}\./);
    const key = saved.structuredContent.saved[0].key;
    const created = fake.state.items.get(key).data;
    expect(created).toMatchObject({ itemType: "annotation", parentItem: "PDFATTAA", annotationType: "highlight", annotationComment: "core idea", annotationColor: "#a28ae5", annotationPageLabel: "1" });
    expect(JSON.parse(created.annotationPosition)).toMatchObject({ pageIndex: 1 });
    expect(created.annotationSortIndex).toMatch(/^00001\|\d{6}\|\d{5}$/);
    expect((await ok("save_highlights", {})).text).toContain("already in Zotero");
    expect(fake.state.authorizeRequests).toBe(1);

    const after = await readJson<AnnotationsDoc>(URIS.annotations("user", "PDFATTAA"));
    expect(after.annotations).toHaveLength(2);
    expect(after.highlights[0]!.savedAs).toBe(key);
    expect((await ok("clear_highlights", { key: "PAPERAAA" })).text).toBe("Removed 1 highlight(s).");
    expect((await readJson<SessionState>(STATE_URI)).highlights).toEqual([]);
  });

  it("highlights and saves in one call, and clears by id", async () => {
    const result = await ok("highlight", { key: "PDFATTAA", quote: "Execution time improves", page: 3, color: "green", save: true });
    expect(result.text).toMatch(/Saved to Zotero as annotation [A-Z0-9]{8}\./);
    const id = result.structuredContent.highlight.id;
    expect((await ok("clear_highlights", { ids: [id] })).structuredContent.removed).toBe(1);
    await fail("clear_highlights", { ids: ["h999"] }, "not_found");
    await fail("highlight", { key: "PAPERAAA", quote: "Execution time", color: "plaid" }, "invalid_input");
  });
});

describe("resources", () => {
  it("serves the panel data", async () => {
    const list = await readJson<ItemList>(URIS.items("user", { collection: "CLPLAAAA" }));
    expect(list.items.map((item) => item.key)).toEqual(["PREPRAAA"]);
    const keyed = await readJson<ItemList>(URIS.items("user", { keys: ["TAPLBKAA", "PAPERAAA"] }));
    expect(keyed.items.map((item) => item.key)).toEqual(["TAPLBKAA", "PAPERAAA"]);
    const detail = await readJson<ItemDetail>(URIS.item("user", "PAPERAAA"));
    expect(detail.notes[0]!.excerpt).toBe("Reading note: compare with region inference.");
    const info = await readJson<PdfInfo>(URIS.pdfInfo("user", "PDFATTAA"));
    expect(info.parts).toBe(1);
    const part = (await client.readResource({ uri: URIS.pdfPart("user", "PDFATTAA", 0) })).contents[0] as { blob: string };
    expect(Buffer.from(part.blob, "base64").length).toBe(info.bytes);
    await expect(client.readResource({ uri: URIS.pdfPart("user", "PDFATTAA", 1) })).rejects.toThrow(/out of range/);
    const cmap = (await client.readResource({ uri: URIS.pdfjsData("cMapUrl", "UniGB-UCS2-H.bcmap") })).contents[0] as { blob: string };
    expect(cmap.blob.length).toBeGreaterThan(100);
    await expect(client.readResource({ uri: "ui://zotero/pdfjs/cMapUrl/..%2F..%2Fpackage.json" })).rejects.toThrow();
    await expect(client.readResource({ uri: "ui://zotero/lib/../item/PAPERAAA.json" })).rejects.toThrow();
  });

  it("notifies subscribers when the library changes in Zotero", async () => {
    const uri = URIS.item("user", "PAPERAAA");
    await client.subscribeResource({ uri });
    updates.length = 0;
    fake.touch("PAPERAAA", { title: "Renamed in Zotero" });
    await session.poll();
    await new Promise((done) => setTimeout(done, 300));
    expect(updates).toContain(uri);
    expect((await readJson<ItemDetail>(uri)).title).toBe("Renamed in Zotero");
    fake.touch("PAPERAAA", { title: "Second-Class Values Revisited" });
    await client.unsubscribeResource({ uri });
  });
});

describe("writing", () => {
  it("adds an arXiv paper with its PDF, tags, collection and note", async () => {
    const result = await ok("add_item", { identifier: "https://arxiv.org/abs/2207.03402", collections: ["PL"], tags: ["to-read"], note: "# Why\n- relevant to **capture checking**" });
    expect(result.text).toMatch(/Added "Capturing Types" as [A-Z0-9]{8} \(metadata from arXiv 2207\.03402\)\.\nAttached PDF [A-Z0-9]{8}\.\nAdded note [A-Z0-9]{8}\./);
    const { key, attachmentKey, noteKey } = result.structuredContent;
    expect(fake.state.items.get(key).data).toMatchObject({ itemType: "preprint", repository: "arXiv", archiveID: "arXiv:2207.03402", collections: ["CLPLAAAA"], tags: [{ tag: "to-read" }] });
    expect(fake.state.items.get(attachmentKey).data).toMatchObject({ parentItem: key, linkMode: "imported_url", title: "Preprint PDF", filename: "Boruch-Gruszecki and Odersky - 2022 - Capturing Types.pdf" });
    expect(fake.state.files.has(attachmentKey)).toBe(true);
    expect(fake.state.items.get(noteKey).data.note).toContain("<li>relevant to <strong>capture checking</strong></li>");
    expect(fetched).toContain("https://arxiv.org/pdf/2207.03402v2");
    // 刚加的 PDF 可以直接阅读。
    expect((await ok("read_fulltext", { key, pages: "2" })).text).toContain("we just don’t");
  });

  it("adds a DOI, skips duplicates, and keeps the item when the PDF fails", async () => {
    const added = await ok("add_item", { identifier: "10.5555/new.1", pdfUrl: "https://landing.test/paper" });
    expect(added.text).toContain('Added "A New Conference Paper"');
    expect(added.text).toContain("The PDF was not attached");
    expect(fake.state.items.get(added.structuredContent.key).data).toMatchObject({ itemType: "conferencePaper", proceedingsTitle: "POPL", DOI: "10.5555/new.1" });
    const duplicate = await ok("add_item", { identifier: "doi:10.1234/stack.2022.15" });
    expect(duplicate.text).toContain("already in the library as PAPERAAA; nothing was added");
    await fail("add_item", { identifier: "not an id" }, "invalid_input");
    await fail("add_item", {}, "invalid_input");
  });

  it("adds an item from metadata and a workspace PDF, rejecting paths outside the workspace", async () => {
    await mkdir(join(workspace, "papers"), { recursive: true });
    await writeFile(join(workspace, "papers", "draft.pdf"), samplePaper());
    await writeFile(join(workspace, "papers", "notes.txt"), "not a pdf");
    const result = await ok("add_item", {
      metadata: { itemType: "report", title: "Internal Report", creators: [{ lastName: "Team", firstName: "Our" }], institution: "Lab", date: "2026", bogusField: "dropped" },
      pdfPath: "papers/draft.pdf",
    });
    const data = fake.state.items.get(result.structuredContent.key).data;
    expect(data).toMatchObject({ itemType: "report", institution: "Lab", creators: [{ creatorType: "author", lastName: "Team", firstName: "Our" }] });
    expect(data.bogusField).toBeUndefined();
    expect(fake.state.items.get(result.structuredContent.attachmentKey).data.linkMode).toBe("imported_file");
    await fail("add_item", { metadata: { itemType: "report", title: "x" }, pdfPath: "papers/notes.txt" }, "not_pdf");
    await fail("add_item", { metadata: { itemType: "report", title: "x" }, pdfPath: "../outside.pdf" }, "invalid_input");
    await fail("add_item", { metadata: { itemType: "report", title: "x" }, pdfPath: "/etc/hosts" }, "path_outside_workspace");
    await fail("add_item", { metadata: { itemType: "spaceship", title: "x" } }, "invalid_input");
  });

  it("attaches a PDF to an existing item", async () => {
    const result = await ok("attach_pdf", { key: "TAPLBKAA", pdfPath: "papers/draft.pdf" });
    expect(result.text).toMatch(/Attached a \d+ KB PDF to "Types and Programming Languages" as [A-Z0-9]{8}\./);
    await fail("attach_pdf", { key: "NTEAAAAA", pdfPath: "papers/draft.pdf" }, "invalid_input");
    await fail("attach_pdf", { key: "TAPLBKAA" }, "invalid_input");
  });

  it("updates fields, tags and collections, retrying after a concurrent change", async () => {
    const result = await ok("update_item", { key: "TAPLBKAA", fields: { date: "2002-02" }, addTags: ["textbook", "types"], removeTags: ["missing"], addToCollections: ["Type Systems"] });
    expect(result.text).toContain('Updated "Types and Programming Languages" (TAPLBKAA): date → "2002-02"; tags → textbook, types; collections → CLTYAAAA.');
    expect(fake.state.items.get("TAPLBKAA").data).toMatchObject({ date: "2002-02", collections: ["CLTYAAAA"] });
    expect((await ok("update_item", { key: "TAPLBKAA", addTags: ["types"] })).text).toContain("nothing changed");
    // 用户同时在 Zotero 里改了条目：PATCH 先 412，再按新版本重试。
    const original = fetch;
    let raced = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!raced && init?.method === "PATCH") {
        raced = true;
        fake.touch("TAPLBKAA", { extra: "edited in Zotero" });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      await ok("update_item", { key: "TAPLBKAA", removeTags: ["textbook"] });
    } finally {
      globalThis.fetch = original;
    }
    expect(fake.state.items.get("TAPLBKAA").data).toMatchObject({ extra: "edited in Zotero", tags: [{ tag: "types" }] });
    await fail("update_item", { key: "TAPLBKAA", fields: { itemType: "book" } }, "invalid_input");
    await fail("update_item", { key: "NTEAAAAA", addToCollections: ["PL"] }, "invalid_input");
  });

  it("adds notes and collections", async () => {
    const note = await ok("add_note", { parentKey: "PAPERAAA", markdown: "Summary with `code`." });
    expect(fake.state.items.get(note.structuredContent.key).data).toMatchObject({ parentItem: "PAPERAAA", note: '<div data-schema-version="9"><p>Summary with <code>code</code>.</p>\n</div>' });
    const standalone = await ok("add_note", { markdown: "Ideas", collections: ["PL"] });
    expect(fake.state.items.get(standalone.structuredContent.key).data.collections).toEqual(["CLPLAAAA"]);
    await fail("add_note", { parentKey: "NTEAAAAA", markdown: "x" }, "invalid_input");
    const created = await ok("create_collection", { name: "Reading Group", parent: "PL" });
    expect(created.text).toMatch(/Created collection "Reading Group" \[[A-Z0-9]{8}\]/);
    expect((await ok("create_collection", { name: "Reading Group", parent: "PL" })).text).toContain("already exists");
  });

  it("exports a .bib file into the workspace", async () => {
    const result = await ok("export_bib", { collection: "PL" });
    expect(result.text).toContain("Wrote references.bib with");
    const bib = await readFile(join(workspace, "references.bib"), "utf8");
    expect(bib).toContain("@article{lovelace_second_2022,");
    expect(bib).not.toContain("file = ");
    expect(bib).not.toContain(fake.storage);
    expect((await ok("export_bib", { keys: ["TAPLBKAA"], path: "paper/refs.bib" })).text).toContain("Citation keys: pierce_types_2002");
    expect((await ok("export_bib", { collection: "PL" })).text).toContain("Updated references.bib");
    await fail("export_bib", { keys: ["TAPLBKAA"], path: "refs.txt" }, "invalid_input");
    await fail("export_bib", { keys: ["TAPLBKAA"], path: "../../escape.bib" }, "path_outside_workspace");
    await fail("export_bib", { collection: "Empty" }, "invalid_input");
  });

  it("asked for permission only once for all of the writes", () => {
    expect(fake.state.authorizeRequests).toBe(1);
  });
});
