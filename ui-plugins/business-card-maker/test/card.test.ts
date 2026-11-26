import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { splitName, vcard } from "../src/card.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("names and vCards", () => {
  it("splits Chinese and English names", () => {
    expect(splitName("林晓雯")).toEqual({ family: "林", given: "晓雯" });
    expect(splitName("欧阳明")).toEqual({ family: "欧阳", given: "明" });
    expect(splitName("Lei Wang")).toEqual({ family: "Wang", given: "Lei" });
  });
  it("writes a vCard 3.0", () => {
    const v = vcard({ name: "陈思", nameEn: "Si Chen", title: "产品经理", titleEn: "", dept: "产品部", mobile: "186 1234 5678", phone: "", email: "a@b.example", address: "" }, { company: "青禾科技", companyEn: "", website: "qinghe.example", address: "福州市, 鼓楼区" });
    expect(v).toContain("N:陈;思;;;\r\n");
    expect(v).toContain("ORG:青禾科技;产品部");
    expect(v).toContain("TEL;TYPE=CELL:18612345678");
    expect(v).toContain("URL:https://qinghe.example");
    expect(v).toContain("ADR;TYPE=WORK:;;福州市\\, 鼓楼区;;;;");
  });
});

describe("card tools", () => {
  it("makes print, sheet and vcf files", async () => {
    const root = await mkdtemp(join(tmpdir(), "card-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("card_open", { inputs: ["team.xlsx", "logo.png"], project: "t", settings: { company: "青禾科技", companyEn: "Qinghe Tech Co., Ltd.", website: "www.qinghe.example", address: "福州市鼓楼区五四路 100 号" } });
    expect(o.data.stats).toMatchObject({ cards: 4, perSheet: 10 });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[1]).toMatchObject({ name: "欧阳明", title: "技术总监", dept: "研发部" });
    expect(o.text).toContain("4 cards");
    const e1 = await c.call("card_edit", { project: "t", set: [{ row: 2, values: { email: "chensi-at-qinghe" } }] });
    expect(JSON.stringify(e1.data.issues)).toContain("looks wrong");
    await c.call("card_edit", { project: "t", set: [{ row: 2, values: { email: "chensi@qinghe.example" } }] });
    const ex = await c.call("card_export", { project: "t" });
    const files = ex.text.split("\n").filter((l: string) => l.startsWith("- ")).map((l: string) => l.slice(2));
    expect(files).toContain("business-card-maker/t/cards-print.pdf");
    expect(files).toContain("business-card-maker/t/vcards/欧阳明.vcf");
    const printPath = join(root, "business-card-maker/t/cards-print.pdf");
    const doc = await PDFDocument.load(await readFile(printPath));
    expect(doc.getPageCount()).toBe(8);
    const tb = doc.getPage(0).getTrimBox();
    expect(tb.width).toBeCloseTo((90 * 72) / 25.4, 1);
    expect(tb.height).toBeCloseTo((54 * 72) / 25.4, 1);
    const txt = execFileSync("pdftotext", ["-layout", printPath, "-"]).toString();
    expect(txt).toContain("林晓雯");
    expect(txt).toContain("ming@qinghe.example");
    expect(txt).toContain("上海市徐汇区");
    expect(txt).toContain("Qinghe Tech");
    const sheet = await PDFDocument.load(await readFile(join(root, "business-card-maker/t/cards-a4.pdf")));
    expect(sheet.getPageCount()).toBe(8);
    const all = await readFile(join(root, "business-card-maker/t/contacts.vcf"), "utf8");
    expect(all.match(/BEGIN:VCARD/g)).toHaveLength(4);
    expect(all).toContain("FN:王磊");
  });
});
