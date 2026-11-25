import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { inferField, inferMapping, normDate, toRecords } from "../src/schema.ts";
import { createServer } from "../src/server.ts";

// 虚构样例（samples/sheet/make-sheets.mjs）：咖啡馆物料库存表（中文表头，预置问题）、它的更新版、课程预约表 .xlsx。
export const MAKE = process.env.SHEET_SAMPLE ?? "/workspace/zcode-new-plugins/samples/sheet/make-sheets.mjs";
export function makeSheets(dir: string) {
  const local = join(import.meta.dirname, "../node_modules/.sheet-sample.mjs"); // 放进 node_modules 以解析 exceljs
  copyFileSync(MAKE, local);
  mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [local, dir]);
}
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
const seed = (html: string) => JSON.parse(/<script id="seed" type="application\/json">(.*?)<\/script>/s.exec(html)![1]);
const cfg = (html: string) => JSON.parse(/<script id="cfg" type="application\/json">(.*?)<\/script>/s.exec(html)![1]);
beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "sta-"));
  makeSheets(join(ws, "data"));
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("inference", () => {
  it("guesses column types", () => {
    expect(inferField("单价", ["68", "1,680", "25"], 0).type).toBe("money");
    expect(inferField("库存", ["42", "0", "十", "7", "9", "12", "5"], 0).type).toBe("number");
    expect(inferField("日期", ["2026/11/2", "2026-10-28", "2026年9月30日"], 0).type).toBe("date");
    expect(inferField("Phone", ["5550101", "5550102", "5550103"], 0).type).toBe("phone");
    expect(inferField("Contact", ["a@x.com", "b@y.org", "c@z.io"], 0).type).toBe("email");
    expect(inferField("site", ["https://a.com", "http://b.org"], 0).type).toBe("url");
    expect(inferField("在售", ["是", "否", "是", ""], 0).type).toBe("boolean");
    expect(inferField("Status", ["open", "closed", "open", "open", "closed", "open"], 0)).toMatchObject({ type: "select", options: ["closed", "open"] });
    expect(inferField("Notes", ["x".repeat(80), "y".repeat(90)], 0).type).toBe("longtext");
    expect(normDate("2026-02-30")).toBeUndefined();
    expect(normDate("2026/2/3")).toBe("2026-02-03");
  });
  it("picks key and title fields and gives Chinese columns ascii-safe keys", () => {
    const m = inferMapping(["编号", "姓名", "城市"], [{ 编号: "1", 姓名: "甲", 城市: "a" }, { 编号: "2", 姓名: "乙", 城市: "b" }]);
    expect(m.fields.map((f) => f.key)).toEqual(["f1", "f2", "f3"]);
    expect(m.keyField).toBe("f1");
    expect(m.titleField).toBe("f2");
    const { issues } = toRecords(m, [{ 编号: "1", 姓名: "甲", 城市: "a" }, { 编号: "1", 姓名: "乙", 城市: "b" }]);
    expect(issues).toEqual([{ row: 3, column: "编号", value: "1", message: "duplicate key (also row 2)" }]);
  });
});

describe("tools on the café samples", () => {
  it("app_new: inventory CSV → app with inferred fields and the planted problems", async () => {
    const r = await call("app_new", { source: "data/库存表.csv", title: "物料库存" });
    expect(r.isError).toBeFalsy();
    const p = r.structuredContent.project;
    expect(p.out).toBe(`apps/${p.id}/index.html`);
    expect(p.settings.lang).toBe("zh");
    const type = Object.fromEntries(p.mapping.fields.map((f: any) => [f.column, f.type]));
    expect(type).toMatchObject({ SKU: "text", 商品名称: "text", 分类: "select", 库存: "number", 单价: "money", 补货日期: "date", 在售: "boolean" });
    const issues = r.structuredContent.issues.map((i: any) => `${i.row}:${i.column}:${i.message}`);
    expect(issues).toContain("12:库存:not a number");
    expect(issues.some((i: string) => i.includes(":SKU:"))).toBe(true);
    expect(issues.some((i: string) => i.includes(":补货日期:"))).toBe(true);
    expect(r.content[0].text).toContain("Cloudflare Pages");
    const html = await readFile(join(ws, p.out), "utf8");
    const s = seed(html);
    expect(s.rows).toHaveLength(15);
    expect(s.rows[0]).toMatchObject({ sku: "HB-001", f4: 42, f5: 68, f7: "2026-11-02", f8: true });
    expect(html).not.toMatch(/<script src=|https?:\/\/(?!www\.w3)/); // 单文件、无外部资源
    expect(r.structuredContent.preview).not.toContain("<script");
  });

  it("app_update: field changes, highlight rule and settings are kept in the rebuilt file", async () => {
    const id = (await call("app_list", {})).structuredContent.apps[0].id;
    const r = await call("app_update", { id, fields: [{ column: "备注", label: "说明", type: "longtext" }, { column: "供应商", hidden: true }], highlight: { column: "库存", op: "<=", value: 5, label: "库存不足" }, accent: "#0f766e", sort: { column: "库存", dir: "asc" } });
    expect(r.isError).toBeFalsy();
    const c = cfg(await readFile(join(ws, r.structuredContent.project.out), "utf8"));
    expect(c.fields.find((f: any) => f.column === "供应商")).toBeUndefined();
    expect(c.fields.find((f: any) => f.column === "备注")).toMatchObject({ label: "说明", type: "longtext" });
    expect(c.highlight).toEqual({ key: "f4", op: "<=", value: 5, label: "库存不足" });
    expect(c.accent).toBe("#0f766e");
    expect(r.structuredContent.preview).toContain("库存不足");
    const bad = await call("app_update", { id, highlight: { column: "商品名称", op: "<=", value: 1, label: "x" } });
    expect(bad.isError).toBe(true);
  });

  it("app_refresh: keeps the mapping, reports added/removed columns and changes the seed version", async () => {
    const id = (await call("app_list", {})).structuredContent.apps[0].id;
    const out = join(ws, `apps/${id}/index.html`);
    const v1 = seed(await readFile(out, "utf8")).version;
    await rename(join(ws, "data/库存表-更新.csv"), join(ws, "data/库存表.csv"));
    const r = await call("app_refresh", { id });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/new columns: 货架位置; removed columns: 备注; data changed/);
    const html = await readFile(out, "utf8");
    const c = cfg(html), s = seed(html);
    expect(s.version).not.toBe(v1);
    expect(s.rows).toHaveLength(16); // 缺 SKU 的行被删、新增 2 行
    expect(c.highlight.label).toBe("库存不足");
    expect(c.fields.find((f: any) => f.column === "供应商")).toBeUndefined(); // 隐藏设置保留
    expect(c.fields.find((f: any) => f.column === "货架位置")).toBeTruthy();
    expect(r.structuredContent.issues.some((i: any) => i.message === "not a number")).toBe(false);
  });

  it("xlsx bookings: phone/email/select/boolean, bad email flagged, English UI", async () => {
    const r = await call("app_new", { source: "data/bookings.xlsx" });
    const p = r.structuredContent.project;
    expect(p.settings.lang).toBe("en");
    const type = Object.fromEntries(p.mapping.fields.map((f: any) => [f.column, f.type]));
    expect(type).toMatchObject({ Phone: "phone", Email: "email", Service: "select", Date: "date", Guests: "number", Confirmed: "boolean" });
    expect(r.structuredContent.issues).toEqual([expect.objectContaining({ column: "Email", value: "ana@example" })]);
    expect((await call("app_check", { id: p.id })).structuredContent.issues).toHaveLength(1);
    expect((await call("app_list", {})).structuredContent.apps).toHaveLength(2);
  });

  it("errors are clear", async () => {
    expect((await call("app_new", { source: "nope.csv" })).content[0].text).toMatch(/not found/);
    await writeFile(join(ws, "x.pdf"), "x");
    expect((await call("app_new", { source: "x.pdf" })).content[0].text).toMatch(/\.csv, \.tsv or \.xlsx/);
    expect((await call("app_update", { id: "zzz" })).content[0].text).toMatch(/No app/);
  });
});
