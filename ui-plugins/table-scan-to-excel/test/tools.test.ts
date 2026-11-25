import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkTable, normalizeTable, parseNumber } from "../src/check.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const fixtures = join(import.meta.dirname, "fixtures");
let tables: any[];

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "tablescan-"));
  await copyFile(join(fixtures, "purchase-photo.jpg"), join(workspace, "采购单.jpg"));
  await writeFile(join(workspace, "notes.txt"), "x");
  tables = JSON.parse(await readFile(join(fixtures, "purchase.transcription.json"), "utf8"));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "..") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

describe("numbers", () => {
  it("parses printed numbers and keeps their format", () => {
    expect(parseNumber("1,636.50")).toEqual({ value: 1636.5, format: "#,##0.00" });
    expect(parseNumber("(1,200)")).toEqual({ value: -1200, format: "#,##0;(#,##0)" });
    expect(parseNumber("12.5%")).toEqual({ value: 0.125, format: "0.0%" });
    expect(parseNumber("￥３２０元")?.value).toBe(320);
    expect(parseNumber("−7")?.value).toBe(-7);
    expect(parseNumber("A4")).toBeNull();
    expect(parseNumber("1,23")).toBeNull();
    expect(parseNumber("2026-11-07")).toBeNull();
    expect(parseNumber("十")?.value).toBe(10);
    expect(parseNumber("十一")?.value).toBe(11);
    expect(parseNumber("二十")?.value).toBe(20);
    expect(parseNumber("一百零三")?.value).toBe(103);
    expect(parseNumber("￥十二元")?.value).toBe(12);
  });
  it("flags a wrong Total column and a CJK numeral in a quantity column", () => {
    const census = normalizeTable({
      headerRows: 1,
      rows: [
        ["Province", "Males", "Females", "Total"],
        ["Bengal", "100", "90", "200"],
        ["Madras", "80", "70", "150"],
        ["Total", "180", "160", "350"],
      ],
    }, 0).table;
    const rowIssues = checkTable(census).filter((i) => i.kind === "total_mismatch");
    expect(rowIssues.some((i) => i.row === 1 && i.col === 3 && /190/.test(i.message))).toBe(true);
    const tea = normalizeTable({
      headerRows: 1,
      rows: [
        ["商品", "数量", "单价"],
        ["春茶 龙井", "十", "68"],
        ["咖啡杯", "2", "99"],
        ["合计", "", "167"],
      ],
    }, 0).table;
    expect(checkTable(tea).map((i) => `${i.kind}:${i.row}:${i.col}`)).toEqual([]);
    expect(checkTable({
      ...tea,
      rows: [
        ["商品", "数量", "单价"],
        ["春茶 龙井", "十", "68"],
        ["咖啡杯", "两盒", "99"],
        ["合计", "", "167"],
      ],
    }).some((i) => i.kind === "not_number" && i.row === 2 && i.col === 1)).toBe(true);
  });
  it("checks subtotals and grand totals, respecting confirmed cells", () => {
    const { table } = normalizeTable(tables[0], 0);
    const issues = checkTable(table);
    expect(issues.map((i) => i.kind).sort()).toEqual(["total_mismatch", "uncertain"]);
    expect(issues.find((i) => i.kind === "total_mismatch")!.message).toMatch(/1626.5.*difference 10/);
    table.confirmed.push([10, 5], [7, 2]);
    expect(checkTable(table)).toEqual([]);
  });
  it("pads ragged rows and flags text in numeric columns", () => {
    const { table, issues } = normalizeTable({ rows: [["Item", "Amount"], ["a", "10"], ["b"], ["c", "l0"], ["d", "5"], ["Total", "15"]] }, 0);
    expect(issues[0].kind).toBe("ragged_row");
    expect(table.rows[2]).toEqual(["b", ""]);
    expect(checkTable(table).map((i) => i.kind)).toEqual(["not_number"]);
    const census = normalizeTable(JSON.parse(readFileSync(join(fixtures, "census.transcription.json"), "utf8"))[0], 0).table;
    expect(checkTable(census).map((i) => i.kind)).toEqual(["uncertain", "uncertain"]);
  });
});

describe("tools", () => {
  it("lists the tools with the panel", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["image_view", "table_export", "table_save", "table_scan_open", "table_submit", "workspace_files"]);
    expect((tools[0]._meta as any).ui.resourceUri).toBe("ui://table-scan-to-excel/panel.html");
  });
  it("opens an image and returns it for the model to read", async () => {
    const r = await call("table_scan_open", { image: "采购单.jpg" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/1536×1342[\s\S]*table_submit/);
    expect(r.content[1].type).toBe("image");
    expect(Buffer.from(r.content[1].data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
  it("rejects bad input", async () => {
    expect((await call("table_scan_open", { image: "../x.jpg" })).structuredContent.error.code).toBe("outside_workspace");
    expect((await call("table_scan_open", { image: "notes.txt" })).structuredContent.error.code).toBe("bad_image");
    expect((await call("table_export", { image: "采购单.jpg" })).structuredContent.error.code).toBe("not_transcribed");
    expect((await call("table_submit", { image: "采购单.jpg", tables: [] })).structuredContent.error.code).toBe("missing_tables");
  });
  it("submits, reports the wrong total, keeps confirmations on resubmit, exports xlsx + csv", async () => {
    const r = await call("table_submit", { image: "采购单.jpg", tables });
    expect(r.content[0].text).toMatch(/11 rows × 6 columns, 6 merged[\s\S]*2 cell\(s\) to review[\s\S]*合计 F11/);
    const saved = JSON.parse(await readFile(join(workspace, "tables/采购单.tablescan.json"), "utf8"));
    saved.tables[0].confirmed = [[7, 2]];
    await call("table_save", { image: "采购单.jpg", tables: saved.tables });
    const again = await call("table_submit", { image: "采购单.jpg", tables });
    expect(again.structuredContent.issues.map((i: any) => i.kind)).toEqual(["total_mismatch"]);
    const reopen = await call("table_scan_open", { image: "采购单.jpg" });
    expect(reopen.content).toHaveLength(1);
    expect(reopen.content[0].text).toMatch(/transcribed before/);

    const ex = await call("table_export", { image: "采购单.jpg", format: "both" });
    expect(ex.structuredContent.files).toEqual(["tables/采购单.xlsx", "tables/采购单.csv"]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await readFile(join(workspace, "tables/采购单.xlsx"))) as any);
    const sheet = book.getWorksheet("采购明细")!;
    expect(sheet.getCell("F11").value).toBe(1636.5);
    expect(sheet.getCell("F11").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("D3").value).toBe(120);
    expect(sheet.getCell("C8").value).toBe("A4 70g 500张");
    expect((sheet.getCell("F11").fill as any).fgColor.argb).toBe("FFFECACA");
    expect(String((sheet.getCell("F11").note as any)?.texts?.[0]?.text ?? sheet.getCell("F11").note)).toMatch(/1626.5/);
    expect(sheet.getCell("A1").isMerged && sheet.getCell("A2").isMerged).toBe(true);
    expect((sheet as any)._merges.D1.model).toMatchObject({ top: 1, left: 4, bottom: 1, right: 6 });
    expect(sheet.getCell("A1").font?.bold).toBe(true);
    const csv = await readFile(join(workspace, "tables/采购单.csv"), "utf8");
    expect(csv.startsWith("\uFEFF序号,商品")).toBe(true);
    expect(csv).toContain('合计,,,,,"1,636.50"');
  });
  it("lists images with their transcription state", async () => {
    const r = await call("workspace_files", {});
    expect(r.structuredContent.images).toEqual([{ path: "采购单.jpg", done: true }]);
  });
});
