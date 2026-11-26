import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { byDay, grid, isoWeek } from "../src/cal.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer, parseHolidayText } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("calendar maths", () => {
  it("lays out a month", () => {
    const g = grid(2027, 2, 1); // 2027-02-01 是周一
    expect(g[0][0]).toBe(1);
    expect(g).toHaveLength(4);
    const s = grid(2027, 2, 0);
    expect(s[0][1]).toBe(1);
    expect(grid(2026, 8, 1)).toHaveLength(6); // 2026-08-01 周六
  });
  it("counts ISO weeks", () => {
    expect(isoWeek(2027, 1, 1)).toBe(53);
    expect(isoWeek(2027, 1, 4)).toBe(1);
    expect(isoWeek(2026, 12, 31)).toBe(53);
  });
  it("expands multi-day events and parses holidays", () => {
    const d = byDay([{ date: "2027-01-30", endDate: "2027-02-02", title: "x", kind: "holiday", color: "" }]);
    expect([...d.keys()]).toEqual(["2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02"]);
    expect(parseHolidayText("2027-01-01 元旦, 2027-02-06..2027-02-12 春节\n2027-02-20 补班")).toEqual([
      { date: "2027-01-01", endDate: "", title: "元旦", kind: "holiday", color: "" },
      { date: "2027-02-06", endDate: "2027-02-12", title: "春节", kind: "holiday", color: "" },
      { date: "2027-02-20", endDate: "", title: "补班", kind: "workday", color: "" },
    ]);
  });
});

describe("calendar tools", () => {
  it("makes monthly and yearly PDFs", async () => {
    const root = await mkdtemp(join(tmpdir(), "cal-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("cal_open", { inputs: ["events.csv"], project: "y", settings: { title: "青禾 2027" } });
    expect(o.data.stats).toMatchObject({ months: 12, events: 7, holidays: 5 });
    expect(o.text).toContain("12 months from 2027-01");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[1]).toMatchObject({ date: "2027-02-06", endDate: "2027-02-12", kind: "假期" });
    expect(rows[9]).toMatchObject({ kind: "补班" });
    await c.call("cal_edit", { project: "y", settings: { weekNumbers: true, holidays: "2027-06-09 端午（示例）" } });
    await c.call("cal_export", { project: "y" });
    const mp = join(root, "printable-calendar/y/calendar-2027-monthly.pdf");
    const doc = await PDFDocument.load(await readFile(mp));
    expect(doc.getPageCount()).toBe(12);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    const t1 = execFileSync("pdftotext", ["-f", "1", "-l", "1", "-layout", mp, "-"]).toString();
    expect(t1).toContain("2027 年 1 月");
    expect(t1).toContain("项目启动会");
    expect(t1).toContain("W53");
    const t6 = execFileSync("pdftotext", ["-f", "6", "-l", "6", mp, "-"]).toString();
    expect(t6).toContain("端午（示例）");
    const yp = join(root, "printable-calendar/y/calendar-2027-year.pdf");
    const ydoc = await PDFDocument.load(await readFile(yp));
    expect(ydoc.getPageCount()).toBe(1);
    expect(execFileSync("pdftotext", [yp, "-"]).toString()).toContain("年会");
    // 不选文件也能出日历
    const blank = await c.call("cal_open", { inputs: [], project: "b", settings: { year: 2028, startMonth: 9, months: 6, lang: "en", weekStart: "sun" } });
    expect(blank.text).toContain("6 months from 2028-09");
    await c.call("cal_export", { project: "b", formats: ["monthly"] });
    const bt = execFileSync("pdftotext", ["-f", "5", "-l", "5", join(root, "printable-calendar/b/calendar-2028-monthly.pdf"), "-"]).toString();
    expect(bt).toContain("January 2029");
  });
});
