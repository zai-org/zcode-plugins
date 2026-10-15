import { expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeZotero } from "#test/fake-zotero.mjs";
import { makePdf } from "#test/pdf-fixture.mjs";
import { createZoteroMcpServer } from "#z/adapters/server.ts";
import { ZoteroSession } from "#z/app/session.ts";
import { URIS, type AnnotationsDoc } from "#z/contract.ts";
import { pdfjsDataDir } from "#z/pdf/extract.ts";

it("searches, highlights and saves a mathematical PDF quote through MCP without truncating its character", async () => {
  const fake = await startFakeZotero({ authorize: "always" });
  const session = new ZoteroSession({
    baseUrl: fake.url,
    keyFile: join(fake.storage, "keys.json"),
    workspaceRoot: fake.storage,
    pdfjsDataDir: pdfjsDataDir(),
  });
  const server = createZoteroMcpServer({ session, assetRoot: fake.storage, pdfjsDataDir: pdfjsDataDir() });
  const client = new Client({ name: "unicode-quote-test", version: "1" });
  try {
    await writeFile(
      fake.state.files.get("PDFATTAA"),
      makePdf([["The equation x = 1 follows."]], { unicodeMap: { x: "𝑥" } }),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const found = await client.callTool({ name: "find_in_pdf", arguments: { key: "PAPERAAA", query: "x = 1" } });
    expect(found.isError).toBeFalsy();
    expect(found.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("«𝑥 = 1»") })]));

    const highlighted = await client.callTool({ name: "highlight", arguments: { key: "PAPERAAA", quote: "equation x" } });
    expect(highlighted.isError, JSON.stringify(highlighted.content)).toBeFalsy();
    const before = await client.readResource({ uri: URIS.annotations("user", "PDFATTAA") });
    const { highlights: [highlight] } = JSON.parse((before.contents[0] as { text: string }).text) as AnnotationsDoc;
    expect(highlight.quote).toBe("equation 𝑥");
    expect(highlight.rects).toHaveLength(1);
    expect(highlight.rects[0]![2]).toBeGreaterThan(highlight.rects[0]![0]);

    const saved = await client.callTool({ name: "save_highlights", arguments: { ids: [highlight.id] } });
    expect(saved.isError).toBeFalsy();
    const { saved: [{ key }] } = saved.structuredContent as { saved: { key: string }[] };
    const annotation = fake.state.items.get(key).data;
    expect(annotation.annotationText).toBe("equation 𝑥");
    expect(annotation.annotationSortIndex).toMatch(/^00000\|000004\|/);
    expect(JSON.parse(annotation.annotationPosition)).toEqual({ pageIndex: 0, rects: highlight.rects });

    const resource = await client.readResource({ uri: URIS.annotations("user", "PDFATTAA") });
    const doc = JSON.parse((resource.contents[0] as { text: string }).text) as AnnotationsDoc;
    expect(doc.highlights).toEqual([expect.objectContaining({ quote: "equation 𝑥", savedAs: key })]);
    expect(doc.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ text: "equation 𝑥" })]));
  } finally {
    session.close();
    await client.close();
    await server.close();
    await fake.close();
    await rm(fake.storage, { recursive: true, force: true });
  }
});
