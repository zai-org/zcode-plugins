import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cleanCell, detect, halfwidth } from "../src/clean.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const O = { trim: true, spaces: true, fullwidth: true, numbers: true, dates: true, emails: true, phones: true };

describe("cells", () => {
  it("cleans by type", () => {
    expect(halfwidth("Ａｌｅｘ　２５６０，你好")).toBe("Alex 2560，你好");
    expect(cleanCell(" ¥1,280.00 ", "number", O).value).toBe(1280);
    expect(cleanCell("八百", "number", O)).toEqual({ value: "八百", problem: "not a number" });
    expect(cleanCell("2026年11月5日", "date", O).value).toBe("2026-11-05");
    expect(cleanCell("Lin.XM@QingHe.CN", "email", O).value).toBe("lin.xm@qinghe.cn");
    expect(cleanCell("+86 139-1111-2222", "phone", O).value).toBe("+8613911112222");
    expect(cleanCell("上海  好物", "text", O).value).toBe("上海 好物");
    expect(detect("金额", ["1", "2", "x", "3", "4"])).toBe("number");
    expect(detect("备注", ["a", "b"])).toBe("text");
  });
});

describe("clean tools", () => {
  it("cleans a GBK CSV, dedupes and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "clean-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("clean_open", { inputs: ["客户名单-导出.csv"], project: "kh" });
    expect(o.data.stats).toMatchObject({ rows: 5, kept: 4, duplicates: 1, empty: 0, problems: 2 });
    expect(o.data.rows[0]).toMatchObject({ c0: "杭州青禾茶业有限公司", c2: "13800001234", c4: "2026-11-03", c5: 1280 });
    expect(o.data.rows[2]._status).toMatch(/重复 #0/);
    expect(o.data.rows[3].c1).toBe("Alex Wong");
    const e = await c.call("clean_edit", { project: "kh", set: [{ row: 4, values: { c5: "800", c3: "chen@xiaoman.cn" } }] });
    expect(e.data.stats.problems).toBe(0);
    const k = await c.call("clean_edit", { project: "kh", settings: { dedupe: "none" } });
    expect(k.data.stats.kept).toBe(5);
    await c.call("clean_edit", { project: "kh", settings: { dedupe: "key", keyCols: "客户名称" } });
    await c.call("clean_export", { project: "kh" });
    const csv = await readFile(join(root, "csv-cleaner/kh/cleaned.csv"), "utf8");
    expect(csv.split("\r\n")[0]).toBe("\uFEFF客户名称,联系人,手机,邮箱,下单日期,金额,备注");
    expect(csv).toMatch(/深圳 Brightline,Alex Wong,075588886666,alex@brightline.example,2026-11-20,3450.5,需要发票/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await readFile(join(root, "csv-cleaner/kh/cleaned.xlsx"))) as never);
    expect(book.getWorksheet("cleaned")!.rowCount).toBe(5);
    expect(book.getWorksheet("cleaned")!.getCell("F2").value).toBe(1280);
    expect(book.getWorksheet("removed")!.rowCount).toBe(2);
    expect(await readFile(join(root, "csv-cleaner/kh/changes.csv"), "utf8")).toMatch(/¥1,280\.00/);
  });
});
