import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { detect, KINDS, luhn, maskValue, validId } from "../src/detect.ts";
import { createServer } from "../src/server.ts";

// 全部是虚构数据：身份证号、银行卡号只是校验位合法的随机数字。
const SAMPLES = process.env.REDACT_SAMPLES ?? "/workspace/zcode-new-plugins/samples/redact";
const HAVE_SAMPLES = existsSync(join(SAMPLES, "报价单.pdf"));
const ID = "310104199007214314", CARD = "6222022601815908309";
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

function docx() {
  const body = [
    `<w:p><w:r><w:t>联系人王晓明，手机 138</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> 1234 5678</w:t></w:r><w:r><w:t>。</w:t></w:r></w:p>`,
    `<w:p><w:del w:id="1" w:author="x"><w:r><w:delText>旧邮箱 old@example.com</w:delText></w:r></w:del><w:r><w:t>身份证 ${ID}</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>客服热线 400-820-8820 与金额 ¥5,000 不处理。</w:t></w:r></w:p>`,
  ].join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`),
    "word/footer1.xml": strToU8(`<w:ftr xmlns:w="w"><w:p><w:r><w:t>王晓明 wang@example.com</w:t></w:r></w:p></w:ftr>`),
    "word/_rels/document.xml.rels": strToU8(`<Relationships><Relationship Id="r9" Type="hyperlink" Target="mailto:wang@example.com" TargetMode="External"/></Relationships>`),
    "docProps/core.xml": strToU8(`<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>王晓明</dc:creator><cp:lastModifiedBy>李娜</cp:lastModifiedBy></cp:coreProperties>`),
  });
}
function xlsx() {
  return zipSync({
    "[Content_Types].xml": strToU8(`<Types><Override PartName="/xl/calcChain.xml" ContentType="x"/></Types>`),
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="客户" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="ws"/><Relationship Id="rId9" Type="calc" Target="calcChain.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>姓名</t></si><si><t>王晓明</t></si><si><r><t>卡号 6222 0226 </t></r><r><t>0181 5908 309</t></r></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="3"><v>13812345678</v></c><c r="C2" t="s"><v>2</v></c><c r="D2"><f>B2</f><v>13812345678</v></c><c r="E2" t="inlineStr"><is><t>wang@example.com</t></is></c><c r="F2"><v>1.38123456780001E+10</v></c></row></sheetData></worksheet>`),
    "xl/calcChain.xml": strToU8(`<calcChain><c r="D2" i="1"/></calcChain>`),
    "docProps/core.xml": strToU8(`<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>王晓明</dc:creator></cp:coreProperties>`),
  });
}
async function pdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Customer: Wang Xiaoming", { x: 50, y: 780, size: 12, font });
  page.drawText(`Mobile: +86 138-1234-5678  Email: wang@example.com`, { x: 50, y: 760, size: 12, font });
  page.drawText(`Card: ${CARD}`, { x: 50, y: 740, size: 12, font });
  doc.setAuthor("Wang Xiaoming");
  return doc.save();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "red-"));
  await mkdir(join(workspace, "share"));
  await writeFile(join(workspace, "share/协议.docx"), docx());
  await writeFile(join(workspace, "share/客户.xlsx"), xlsx());
  await writeFile(join(workspace, "share/quote.pdf"), await pdf());
  await writeFile(join(workspace, "share/notes.md"), `# 回访\n\n- 王晓明 13812345678 / wang@example.com\n- Support +1 415-555-0132\n`);
  if (HAVE_SAMPLES) await cp(SAMPLES, join(workspace, "samples"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("detection", () => {
  it("validates IDs and cards and avoids look-alikes", () => {
    expect(validId(ID)).toBe(true);
    expect(validId("310104199007214315")).toBe(false);
    expect(luhn(CARD)).toBe(true);
    const t = `订单号 20240512123456789，身份证 ${ID}，错误的 310104199013214314，卡 ${CARD}，手机 13812345678，热线 400-820-8820，¥12,000`;
    expect(detect(t, { kinds: ["phone", "id", "bank", "email"], keywords: [] }).map((h) => [h.kind, h.value])).toEqual([["id", ID], ["bank", CARD], ["phone", "13812345678"]]);
    expect(detect(t, { kinds: KINDS, keywords: [] }).at(-1)).toMatchObject({ kind: "amount", value: "¥12,000" });
  });
  it("masks", () => {
    expect(maskValue("phone", "138 1234 5678", "partial", true)).toBe("138****5678");
    expect(maskValue("id", ID, "partial", true)).toBe("310***********4314");
    expect(maskValue("email", "wang@example.com", "label", true)).toBe("[邮箱]");
    expect(maskValue("keyword", "王晓明", "partial", true)).toBe("王**");
  });
});

describe("tools", () => {
  const settings = { files: ["share/协议.docx", "share/客户.xlsx", "share/quote.pdf", "share/notes.md"], keywords: ["王晓明", "李娜", "Wang Xiaoming"] };
  it("scans all formats, including split runs, deleted text, footers, links, metadata and numeric cells", async () => {
    const r = await call("redact_scan", { settings });
    expect(r.isError).toBeFalsy();
    const files = r.structuredContent.files;
    const got = (i: number) => files[i].hits.map((h: any) => `${h.kind}@${h.loc}`);
    expect(got(0)).toEqual(["keyword@¶1", "phone@¶1", "email@¶2", "id@¶2", "keyword@footer1 ¶1", "email@footer1 ¶1", "email@link", "keyword@properties", "keyword@properties"]);
    expect(got(1)).toEqual(["keyword@客户!A2", "bank@客户!C2", "email@客户!E2", "phone@客户!B2", "phone@客户!D2", "phone@客户!F2", "keyword@properties"]);
    expect(got(2)).toEqual(["keyword@p.1", "phone@p.1", "email@p.1", "bank@p.1"]);
    expect(files[2].hits[1].rects[0]).toMatchObject({ page: 1 });
    expect(files[2].hits[1].rects[0].y).toBeGreaterThan(750);
    expect(got(3)).toEqual(["keyword@L3", "phone@L3", "email@L3", "phone@L4"]);
    // 给 Agent 的文字里只有部分遮盖的值
    expect(r.content[0].text).toContain("138****5678");
    expect(r.content[0].text).not.toContain(ID);
  });

  it("keeps chosen values everywhere and exports clean copies that pass the self-check", async () => {
    const scan = (await call("redact_scan", { settings })).structuredContent;
    const support = scan.files[3].hits.find((h: any) => h.value === "+1 415-555-0132");
    const saved = await call("redact_save", { settings: { ...settings, mask: "partial" }, keepIds: [support.id] });
    expect(saved.structuredContent.settings.keep).toHaveLength(1);
    const ex = (await call("redact_export", { settings: {} })).structuredContent;
    expect(ex.pending).toEqual(["share/quote.pdf"]);
    expect(ex.results.map((x: any) => [x.output, x.check.ok])).toEqual([
      ["redacted/协议.redacted.docx", true],
      ["redacted/客户.redacted.xlsx", true],
      ["redacted/notes.redacted.md", true],
    ]);
    const md = await readFile(join(workspace, "redacted/notes.redacted.md"), "utf8");
    expect(md).toBe("# 回访\n\n- 王** 138****5678 / w***@example.com\n- Support +1 415-555-0132\n");
    const d = unzipSync(await readFile(join(workspace, "redacted/协议.redacted.docx")));
    const doc = strFromU8(d["word/document.xml"]);
    expect(doc).toContain("<w:t>联系人王**，手机 138****5678</w:t>");
    expect(doc).toContain('<w:t xml:space="preserve"></w:t>');
    expect(doc).toContain("<w:delText>旧邮箱 o***@example.com</w:delText>");
    expect(doc).toContain("400-820-8820");
    expect(strFromU8(d["word/_rels/document.xml.rels"])).not.toContain("wang@example.com");
    expect(strFromU8(d["docProps/core.xml"])).toBe(`<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator></dc:creator><cp:lastModifiedBy></cp:lastModifiedBy></cp:coreProperties>`);
    const x = unzipSync(await readFile(join(workspace, "redacted/客户.redacted.xlsx")));
    const sheet = strFromU8(x["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain(`<c r="B2" s="3" t="inlineStr"><is><t xml:space="preserve">138****5678</t></is></c>`);
    expect(sheet).not.toContain("<f>B2</f>");
    expect(sheet).not.toMatch(/13812345678|1\.381234/);
    expect(strFromU8(x["xl/sharedStrings.xml"])).toBe("<sst><si><t>姓名</t></si><si><t>王**</t></si><si><r><t>卡号 **** **** **** 8309</t></r><r><t></t></r></si></sst>");
    expect(x["xl/calcChain.xml"]).toBeUndefined();
    expect(strFromU8(x["[Content_Types].xml"])).not.toContain("calcChain");
    const log = await readFile(join(workspace, "redacted/redaction-log.csv"), "utf8");
    expect(log).not.toContain("13812345678");
    expect(log).not.toContain(ID);
  });

  it("assembles an image-only PDF and self-checks it", async () => {
    await call("pdf_page", { job: "j1", index: 0, data: PNG.toString("base64"), w: 595, h: 842 });
    const r = await call("pdf_finish", { settings: {}, file: "share/quote.pdf", job: "j1", pages: 1 });
    expect(r.structuredContent).toMatchObject({ output: "redacted/quote.redacted.pdf", check: { ok: true } });
    const out = await PDFDocument.load(await readFile(join(workspace, "redacted/quote.redacted.pdf")));
    expect(out.getPageCount()).toBe(1);
    expect(out.getAuthor()).toBeUndefined();
    expect((await call("pdf_finish", { settings: {}, file: "share/quote.pdf", job: "missing", pages: 2 })).content[0].text).toMatch(/Got 0 of 2 pages/);
  });

  it("explains bad inputs", async () => {
    expect((await call("redact_scan", { settings: { files: ["share/a.doc"] } })).content[0].text).toMatch(/save .doc/);
    expect((await call("redact_scan", { settings: { files: [] , keywords: []} })).isError).toBe(true);
  });
});

describe.skipIf(!HAVE_SAMPLES)("realistic samples", () => {
  it("finds everything in the sample contract, customer list and quote", async () => {
    const r = (await call("redact_scan", { settings: { files: ["samples/合作协议.docx", "samples/客户名单.xlsx", "samples/报价单.pdf", "samples/会议纪要.md", "samples/通讯录.csv"], keywords: ["王晓明", "李娜", "陈建国"], keep: [], mask: "label" } })).structuredContent;
    expect(r.files.map((f: any) => f.hits.length)).toEqual([16, 22, 7, 6, 9]);
    const ex = (await call("redact_export", { settings: {} })).structuredContent;
    expect(ex.results.every((x: any) => x.check.ok)).toBe(true);
    const csv = await readFile(join(workspace, "redacted/通讯录.redacted.csv"), "utf8");
    expect(csv.split("\n")[1]).toBe("[已隐去],[手机号],[邮箱]");
  });
});
