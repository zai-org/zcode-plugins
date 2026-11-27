import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { parseClock, parseHours, parseRates, rateFor, roundHours } from "../src/time.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RATES = "青禾茶饮 = 300\n青禾茶饮/小程序 = 360\n北辰律所 = 450";

describe("time", () => {
  it("parses durations and clock times", () => {
    expect(["1.5", "1,5", "1:30", "1h30m", "90m", "1小时30分", "PT1H30M"].map(parseHours)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(parseHours("abc")).toBeNull();
    expect(["09:00", "2:30 pm", "下午3:15", "2026-11-02 09:15", "9am"].map(parseClock)).toEqual([540, 870, 915, 555, 540]);
  });
  it("rounds per entry", () => {
    expect([0.4, 0.75, 1.01, 2 + 1 / 3].map((h) => roundHours(h, "up15"))).toEqual([0.5, 0.75, 1.25, 2.5]);
    expect(roundHours(1.01, "up6")).toBe(1.1);
    expect(roundHours(1.12, "near15")).toBe(1);
    expect(roundHours(0.25, "up60")).toBe(1);
  });
  it("picks the most specific rate", () => {
    const { rules, bad } = parseRates(RATES + "\n@小周 = 200\n* = 100\noops");
    expect(bad).toEqual([6]);
    expect(rateFor(rules, { client: "青禾茶饮", project: "小程序", person: "小周" }, 0).rate).toBe(360);
    expect(rateFor(rules, { client: "青禾茶饮", project: "品牌手册", person: "小周" }, 0).rate).toBe(300);
    expect(rateFor(rules, { client: "别家", project: "x", person: "小周" }, 0).rate).toBe(200);
    expect(rateFor(rules, { client: "别家", project: "x", person: "佩妮" }, 0)).toEqual({ rate: 100, from: "default" });
  });
});

describe("tools", () => {
  it("summarises a log, flags problems and exports XLSX, PDFs and CSV", async () => {
    const root = await mkdtemp(join(tmpdir(), "ts-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("timesheet_open", { inputs: ["logs"], project: "t", settings: { from: "2026-11-01", to: "2026-11-30" } });
    const issues0 = JSON.stringify(r0.data.issues);
    expect(issues0).toContain("no rate");
    await c.call("timesheet_edit", { project: "t", settings: { rates: RATES, yourName: "Penova 设计工作室", terms: "请在收到后 15 天内付款。" } });
    const r1 = await c.call("timesheet_status", { project: "t" });
    expect(r1.data.stats).toEqual({ entries: 13, hours: 23.07, billedHours: 21.75, amount: 8392.5, clients: 2, outside: 1 });
    const issues = JSON.stringify(r1.data.issues);
    expect(issues).toContain("Row 7 looks like a duplicate of row 6");
    expect(issues).toContain("1 entry outside 2026-11-01 – 2026-11-30");
    expect(issues).not.toContain("no rate");
    const rows = r1.data.rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ hours: 2.3333, billed: "2:30", amount: "¥900.00" });
    expect(rows[11]).toMatchObject({ billable: false, amount: "—" });
    expect(String(rows[11].notes)).toContain("non-billable keyword");
    expect(rows[12]).toMatchObject({ billed: "2:15", amount: "¥1,012.50" });
    expect(String(rows[12].notes)).toContain("overnight");
    // 删掉重复行，加税
    await c.call("timesheet_edit", { project: "t", remove: [7], settings: { taxRate: 6 } });
    const r2 = await c.call("timesheet_export", { project: "t" });
    expect(r2.data.stats).toMatchObject({ amount: 7132.5 });
    expect(r2.text).toContain("ST-202611-01 北辰律所: ¥3,935.25");
    expect(r2.text).toContain("ST-202611-02 青禾茶饮: ¥3,625.20");
    const out = join(root, "timesheet-report", "t");
    for (const f of ["statements/北辰律所.pdf", "statements/青禾茶饮.pdf"]) expect((await PDFDocument.load(await readFile(join(out, f)))).getPageCount()).toBe(1);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(out, "timesheet.xlsx"));
    expect(book.worksheets.map((w) => w.name)).toEqual(["Entries", "By client & project", "By person"]);
    const sum = book.getWorksheet("By client & project")!;
    expect(sum.getRow(sum.rowCount).values).toEqual([undefined, "Total", "", 17.23, 2.5, 18.25, "", 7132.5]);
    expect(book.getWorksheet("Entries")!.rowCount).toBe(13);
    const csv = String(await readFile(join(out, "summary.csv")));
    expect(csv).toContain("青禾茶饮,小程序,6.5,1,7,360,2520");
    expect(csv).toContain("内部,作品集,0,1.5,0,,0");
  });
});
