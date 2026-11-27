import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { batesId, fileLabelFor } from "../src/stamp.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const hex = (t: string) => `<${Buffer.from(t, "latin1").toString("hex").toUpperCase()}>`;
function content(doc: PDFDocument, page: PDFPage) {
  const c = page.node.Contents();
  const list = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  return list.map((ref) => { const st = doc.context.lookup(ref); return st instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(st).decode()).toString("latin1") : ""; }).join("\n");
}

describe("stamp", () => {
  it("formats ids and labels", () => {
    expect(batesId("DOC-", 7, 6)).toBe("DOC-000007");
    expect(batesId("ABC", 12, 4, "-C")).toBe("ABC0012-C");
    expect([1, 2, 26, 27, 28].map((n) => fileLabelFor("Exhibit {A}", n, "x"))).toEqual(["Exhibit A", "Exhibit B", "Exhibit Z", "Exhibit AA", "Exhibit AB"]);
    expect(fileLabelFor("证据 {n}：{name}", 3, "合同")).toBe("证据 3：合同");
  });
});

describe("tools", () => {
  it("numbers across files, reorders and exports stamped PDFs with an index", async () => {
    const root = await mkdtemp(join(tmpdir(), "bates-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("bates_open", { inputs: ["exhibits"], project: "t" });
    expect(r0.data.stats).toEqual({ files: 3, pages: 6, first: "DOC-000001", last: "DOC-000006" });
    expect((r0.data.rows as Record<string, unknown>[]).map((r) => `${r.pages} ${r.first} ${r.last} ${r.output}`)).toEqual(["3 DOC-000001 DOC-000003 DOC-000001-DOC-000003 01 服务合同.pdf", "2 DOC-000004 DOC-000005 DOC-000004-DOC-000005 02 发票扫描.pdf", "1 DOC-000006 DOC-000006 DOC-000006 03 Email chain.pdf"]);
    // 邮件放到最前，改前缀和起始号，加标签
    await c.call("bates_edit", { project: "t", set: [{ row: 2, values: { order: 5 } }, { row: 0, values: { label: "Exhibit 1 (contract)" } }], settings: { prefix: "PNV", start: 101, digits: 5, label: "COPY", fileLabel: "Exhibit {A}", merged: true } });
    const r1 = await c.call("bates_export", { project: "t" });
    expect(r1.data.stats).toMatchObject({ first: "PNV00101", last: "PNV00106" });
    const out = join(root, "bates-numbering", "t");
    expect((await readdir(join(out, "stamped"))).sort()).toEqual(["PNV00101 03 Email chain.pdf", "PNV00102-PNV00104 01 服务合同.pdf", "PNV00105-PNV00106 02 发票扫描.pdf"]);
    const contract = await PDFDocument.load(await readFile(join(out, "stamped/PNV00102-PNV00104 01 服务合同.pdf")));
    const pages = contract.getPages();
    expect(content(contract, pages[0])).toContain(hex("PNV00102"));
    expect(content(contract, pages[0])).toContain(hex("Exhibit 1 (contract)"));
    expect(content(contract, pages[2])).toContain(hex("PNV00104"));
    expect(content(contract, pages[2])).toContain(hex("COPY"));
    expect(content(contract, pages[2])).not.toContain(hex("Exhibit 1 (contract)"));
    const inv = await PDFDocument.load(await readFile(join(out, "stamped/PNV00105-PNV00106 02 发票扫描.pdf")));
    const rotated = content(inv, inv.getPages()[1]);
    expect(rotated).toContain(hex("PNV00106"));
    expect(rotated).toMatch(/[\d.e-]+ 1 -1 [\d.e-]+ [\d.]+ [\d.]+ Tm/);
    expect(content(inv, inv.getPages()[0])).toContain(hex("Exhibit C"));
    expect((await PDFDocument.load(await readFile(join(out, "combined.pdf")))).getPageCount()).toBe(6);
    const csv = String(await readFile(join(out, "index.csv")));
    expect(csv).toContain("1,exhibits/03 Email chain.pdf,1,PNV00101,PNV00101,Exhibit A,stamped/PNV00101 03 Email chain.pdf");
    expect(csv).toContain("2,exhibits/01 服务合同.pdf,3,PNV00102,PNV00104,Exhibit 1 (contract),");
  });
  it("flags digit overflow and unreadable files", async () => {
    const root = await mkdtemp(join(tmpdir(), "bates-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "exhibits", "04 broken.pdf"), "not a pdf");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    await c.call("bates_open", { inputs: ["exhibits"], project: "t", settings: { start: 98, digits: 2 } });
    const r = await c.call("bates_status", { project: "t" });
    const issues = JSON.stringify(r.data.issues);
    expect(issues).toContain("needs more than 2 digits");
    expect(issues).toContain("04 broken.pdf");
    await expect(c.call("bates_export", { project: "t", formats: ["pdf"] })).rejects.toThrow(/Can't stamp/);
  });
});
