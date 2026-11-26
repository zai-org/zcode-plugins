import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { fileNameFor, fillDocx, paragraphs, placeholders } from "../src/merge.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = (body: string) => ({ "word/document.xml": strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`), "[Content_Types].xml": strToU8("<Types/>") });

describe("fillDocx", () => {
  it("fills placeholders split across runs and keeps run formatting", () => {
    const files = doc(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Dear {{Na</w:t></w:r><w:r><w:t>me}}, you &amp; {{X}} {{Name}}</w:t></w:r></w:p>`);
    expect(placeholders(files)).toEqual(["Name", "X"]);
    const out = unzipSync(fillDocx(files, { Name: "Ann <B>", X: "a\nb" }).bytes);
    const xml = strFromU8(out["word/document.xml"]);
    expect(xml).toContain("<w:b/></w:rPr><w:t xml:space=\"preserve\">Dear Ann &lt;B&gt;</w:t>");
    expect(xml).toContain("you &amp; a</w:t><w:br/><w:t xml:space=\"preserve\">b Ann &lt;B&gt;");
    expect(paragraphs(out)[0]).toBe("Dear Ann <B>, you & ab Ann <B>");
  });
  it("reports fields that have no value", () => {
    const r = fillDocx(doc(`<w:p><w:r><w:t>{{A}}-{{B}}</w:t></w:r></w:p>`), { A: "1" });
    expect(r.missing).toEqual(["B"]);
  });
  it("builds file names", () => {
    expect(fileNameFor("{姓名}-offer-{n}", { 姓名: "李明" }, 0)).toBe("李明-offer-1");
    expect(fileNameFor("{{x}}", {}, 4)).toBe("document-5");
  });
});

describe("merge tools on the sample offer letter", () => {
  it("opens template + sheet, warns about empty values, exports one DOCX per row", async () => {
    const ws = await mkdtemp(join(tmpdir(), "merge-"));
    await cp(join(HERE, "samples"), join(ws, "hr"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("merge_open", { inputs: ["hr/offer-template.docx", "hr/new-hires.xlsx"], settings: { fileName: "{姓名}-录用通知书" } });
    expect(r.data.totalRows).toBe(3);
    expect(r.text).toContain("{{入职日期}}");
    expect(r.data.issues.filter((i: any) => i.level === "error")).toEqual([]);
    expect(r.data.issues.find((i: any) => i.row === 2).message).toContain("上级");
    expect(r.data.preview).toContain("李明");
    expect(r.data.preview).toContain("2026-12-07");
    await call("merge_edit", { project: "offer-template", set: [{ row: 2, values: { 上级: "王磊" } }] });
    const out = await call("merge_export", { project: "offer-template" });
    const files: string[] = out.data.exported;
    expect(files.filter((f) => f.endsWith(".docx"))).toHaveLength(3);
    const alex = unzipSync(new Uint8Array(await readFile(join(ws, files.find((f) => f.includes("Alex Turner"))!))));
    const text = paragraphs(alex).join("\n");
    expect(text).toContain("Data Analyst");
    expect(text).toContain("入职日期为 2027-01-04");
    expect(text).toContain("王磊");
    expect(text).not.toContain("{{");
    expect(strFromU8(alex["word/header1.xml"] ?? strToU8(""))).toContain("杭州青禾科技有限公司");
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(join(ws, files.find((f) => f.endsWith(".zip"))!)))))).toHaveLength(3);
  });
  it("blocks export when a field has no column, and explains bad files", async () => {
    const ws = await mkdtemp(join(tmpdir(), "merge-"));
    await writeFile(join(ws, "t.docx"), zipSync(doc(`<w:p><w:r><w:t>{{Name}} {{Nope}}</w:t></w:r></w:p>`)));
    await writeFile(join(ws, "d.csv"), "Name\nAnn\n");
    await writeFile(join(ws, "bad.docx"), "x");
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("merge_open", { inputs: ["t.docx", "d.csv"] });
    expect(r.data.issues[0]).toMatchObject({ level: "error", key: "Nope" });
    await expect(call("merge_export", { project: "t" })).rejects.toMatchObject({ code: "has_errors" });
    await expect(call("merge_open", { inputs: ["bad.docx", "d.csv"] })).rejects.toMatchObject({ code: "bad_docx" });
  });
});
