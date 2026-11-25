import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanEmails, cleanName, cleanPhones, companyKey, guessMapping, namesCompatible, normalizeRow } from "../src/clean.ts";
import { createServer } from "../src/server.ts";

// 虚构名单（见 samples/contacts/mk.py）：CRM 导出 xlsx、展会登记 GBK CSV、英文通讯录 CSV。
const SAMPLES = process.env.CONTACT_SAMPLES ?? "/workspace/zcode-new-plugins/samples/contacts";
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const FILES = ["lists/CRM导出-2025.xlsx", "lists/展会登记表.csv", "lists/linkedin-contacts.csv"];

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "contacts-"));
  await cp(SAMPLES, join(workspace, "lists"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("normalising", () => {
  it("formats phones", () => {
    expect(cleanPhones("138-1234-5678").map((p) => p.value)).toEqual(["+86 138 1234 5678"]);
    expect(cleanPhones("(021) 6234 5678；13911112222").map((p) => p.value)).toEqual(["+86 21 6234 5678", "+86 139 1111 2222"]);
    expect(cleanPhones("0086 139 0211 2233 转 801")[0].value).toBe("+86 139 0211 2233 ext. 801");
    expect(cleanPhones("(415) 555-0132")[0]).toMatchObject({ value: "+1 415 555 0132", assumed: "+1" });
    expect(cleanPhones("+44 20 7946 0958")[0].value).toBe("+44 20 7946 0958");
    expect(cleanPhones("1881234567")[0].valid).toBe(false);
    expect(cleanPhones("020 7946 0958", "GB")[0].value).toBe("+44 20 7946 0958");
  });
  it("cleans names, emails and companies", () => {
    expect(cleanName(" 周 杰 ")).toBe("周杰");
    expect(cleanName("DAVID MILLER")).toBe("David Miller");
    expect(cleanName("mary o'neil-smith")).toBe("Mary O'Neil-Smith");
    expect(cleanEmails("mailto:Li.Na@GreenLeaf.cn; x@y")).toEqual([{ value: "li.na@greenleaf.cn", valid: true }, { value: "x@y", valid: false }]);
    expect(companyKey("上海华信科技有限公司")).toBe(companyKey("上海华信科技"));
    expect(companyKey("BrightPath, Inc.")).toBe(companyKey("BrightPath Inc"));
    expect(namesCompatible("Chen Emily", "emily chen")).toBe(true);
    expect(namesCompatible("陈静", "陈晶")).toBe(false);
  });
  it("guesses mappings from headers and contents", () => {
    expect(guessMapping(["First Name", "Last Name", "E-mail", "Mobile", "Tel", "Org", "x"], [{ x: "a@b.co", Org: "Acme" }])).toEqual({ "First Name": "first", "Last Name": "last", "E-mail": "email", Mobile: "phone", Tel: "phone2", Org: "", x: "" });
    expect(guessMapping(["c1", "c2"], [{ c1: "Tom", c2: "13812345678" }, { c1: "Ann", c2: "+1 415 555 0132" }])).toEqual({ c1: "", c2: "phone" });
    const c = normalizeRow("f", 2, { 名: "伟", 姓: "张", 手机: "13812345678 / 13912345678 / 13712345678" }, { 名: "first", 姓: "last", 手机: "phone" });
    expect(c.values).toMatchObject({ name: "张伟", phone: "+86 138 1234 5678", phone2: "+86 139 1234 5678", notes: "phone: +86 137 1234 5678" });
    expect(c.issues).toEqual([]);
  });
});

describe("tools", () => {
  it("loads three lists, merges sure duplicates and lists possible ones", async () => {
    const r = await call("contacts_load", { files: FILES });
    expect(r.isError).toBeFalsy();
    const v = r.structuredContent;
    expect(v.tables.map((t: any) => t.rows)).toEqual([10, 10, 5]);
    expect(v.tables[2].mapping).toMatchObject({ "First Name": "first", "Last Name": "last", Phone: "phone" });
    expect(v.summary).toMatchObject({ rows: 25, contacts: 16, merged: 8, removed: 9, pending: 3 });
    const byName = (n: string) => v.result.filter((x: any) => x.values.name === n);
    expect(byName("张伟")[0]).toMatchObject({ sources: ["lists/CRM导出-2025.xlsx#2", "lists/展会登记表.csv#2", "lists/linkedin-contacts.csv#3"], values: { phone: "+86 138 1234 5678", email: "zhangwei@huaxin-tech.com", company: "上海华信科技有限公司" } });
    expect(byName("张伟")[0].values.notes).toMatch(/展会扫码.*Name: Wei Zhang/);
    expect(byName("王芳").map((x: any) => x.values.email2)).toEqual(["wang.fang@yuanjing.com", ""]);
    expect(byName("赵磊")[0].values).toMatchObject({ phone: "+86 137 0000 0000", phone2: "+86 139 1111 2222", company: "成都天府软件有限公司" });
    expect(byName("刘洋")[0].values.company).toBe("海洋物流集团有限公司");
    expect(byName("Emily Chen")[0].sources.length).toBe(2);
    expect(byName("孙丽")[0].issues.map((i: any) => i.problem)).toEqual(["invalid phone", "invalid email"]);
    expect(v.pairs.map((p: any) => p.reason).sort()).toEqual(["same name, same company, same last 8 phone digits", "same name, same email name", "same phone, different name"]);
    expect(r.content[0].text).toMatch(/25 rows from 3 file\(s\) → 16 contacts/);
  });

  it("applies decisions and remaps columns", async () => {
    const v0 = (await call("contacts_load", {})).structuredContent;
    const miller = v0.pairs.find((p: any) => p.reason.startsWith("same name, same company"));
    const chen = v0.pairs.find((p: any) => p.reason.startsWith("same phone"));
    const wang = v0.pairs.find((p: any) => p.reason.includes("email name"));
    const r = await call("contacts_decide", { decisions: [{ pair: miller.id, merge: true }, { pair: chen.id, merge: false }, { pair: wang.id, merge: false }, { pair: "x|y", merge: true }] });
    const v = r.structuredContent;
    expect(r.content[0].text).toMatch(/3 decision\(s\) saved\. Not a current pair: x\|y/);
    expect(v.summary).toMatchObject({ contacts: 15, pending: 0 });
    const dm = v.result.find((x: any) => x.values.name === "David Miller");
    expect(dm).toMatchObject({ auto: false, values: { phone: "+44 20 7946 0958", phone2: "", email: "david.miller@northwind.com", email2: "dmiller@northwind.com" } });
    const m = await call("contacts_map", { file: "lists/CRM导出-2025.xlsx", mapping: { 客户等级: "notes" } });
    expect(m.structuredContent.result.find((x: any) => x.values.name === "吴敏").values.notes).toBe("B");
    expect((await call("contacts_map", { file: "lists/CRM导出-2025.xlsx", mapping: { 不存在: "notes" } })).isError).toBe(true);
  });

  it("exports xlsx and csv", async () => {
    const r = await call("contacts_export", {});
    expect(r.structuredContent.files).toEqual(["cleaned/contacts-clean.xlsx"]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await readFile(join(workspace, "cleaned/contacts-clean.xlsx")) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["联系人", "合并日志", "问题", "待确认"]);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toContain("电话");
    expect(sheet.actualRowCount).toBe(16);
    expect(book.worksheets[1].actualRowCount).toBe(10);
    const csv = await call("contacts_export", { format: "csv", output: "out", lang: "en" });
    expect(csv.structuredContent.files).toEqual(["out/contacts-clean.csv", "out/merge-log.csv"]);
    const text = await readFile(join(workspace, "out/contacts-clean.csv"), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")[0]).toBe("\uFEFFName,Phone,Phone 2,Email,Email 2,Company,Title,City,WeChat,Notes,Sources");
    expect(text).toMatch(/\+86 138 1234 5678/);
  });

  it("rejects bad input", async () => {
    await writeFile(join(workspace, "x.pdf"), "x");
    expect((await call("contacts_load", { files: ["x.pdf"] })).isError).toBe(true);
    expect((await call("contacts_load", { files: ["missing.csv"] })).isError).toBe(true);
    expect(existsSync(join(workspace, ".contact-cleaner/project.json"))).toBe(true);
  });
});
