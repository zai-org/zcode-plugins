import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { autoFull, bandOf, histogram, parseBands, parseKeyNums, parseScore, rank, stats } from "../src/grades.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("grade maths", () => {
  it("reads scores, settings and bands", () => {
    expect(parseScore("88")).toEqual({ kind: "ok", value: 88 });
    expect(parseScore("９５分")).toEqual({ kind: "ok", value: 95 });
    expect(parseScore("缺考")).toEqual({ kind: "absent" });
    expect(parseScore("")).toEqual({ kind: "absent" });
    expect(parseScore("A+")).toEqual({ kind: "bad", raw: "A+" });
    const k = parseKeyNums("语文=150; 数学：120\n100");
    expect([k.all, [...k.map]]).toEqual([100, [["语文", 150], ["数学", 120]]]);
    expect(parseKeyNums("数学 很重要").errors).toHaveLength(1);
    expect(autoFull([88, 99])).toBe(100);
    expect(autoFull([101, 140])).toBe(150);
    const b = parseBands("及格 60; 优秀 85; 良好 75");
    expect(b.map((x) => x.name)).toEqual(["优秀", "良好", "及格", "其他"]);
    expect([bandOf(85, b), bandOf(84.9, b), bandOf(10, b)]).toEqual(["优秀", "良好", "其他"]);
  });
  it("ranks, stats and histograms", () => {
    expect(rank([90, 80, 90, undefined, 70])).toEqual([1, 3, 1, undefined, 4]);
    expect(stats([60, 90, 120, 135], 150, 60, 85)).toMatchObject({ n: 4, mean: 101.25, median: 105, pass: 75, excellent: 25, max: 135, min: 60 });
    expect(histogram([50, 89, 90, 135, 150], 150)).toEqual([{ label: "<90", count: 2 }, { label: "90–104", count: 1 }, { label: "105–119", count: 0 }, { label: "120–134", count: 0 }, { label: "135–150", count: 2 }]);
  });
});

describe("tools", () => {
  it("computes totals, weights, ranks and writes the files", async () => {
    const root = await mkdtemp(join(tmpdir(), "grades-"));
    await writeFile(join(root, "s.csv"), "学号,姓名,班级,数学,英语,总分\n1,甲,一班,140,90,999\n2,乙,一班,120,110,0\n3,丙,二班,缺考,145,0\n4,丁,二班,90,60,0\n");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("grades_open", { inputs: ["s.csv"], project: "t" });
    const rows = () => o.data.rows as Record<string, unknown>[];
    expect(o.data.summary).toMatch(/数学\/150, 英语\/150/);
    expect(rows().map((r) => [r.total, r.avg, r.rank, r.classRank])).toEqual([[230, 76.7, 1, 1], [230, 76.7, 1, 1], [145, 96.7, 4, 2], [150, 50, 3, 1]]);
    expect(o.data.issues.some((i: { message: string }) => /Not used as subjects: 总分/.test(i.message))).toBe(true);
    const w = await c.call("grades_edit", { project: "t", settings: { weights: "数学=3", rankBy: "avg", fullMarks: "数学=150; 英语=150" } });
    const wr = w.data.rows as Record<string, unknown>[];
    expect(wr.map((r) => r.avg)).toEqual([85, 78.3, 96.7, 55]);
    expect(wr.map((r) => r.rank)).toEqual([2, 3, 1, 4]);
    expect(wr.map((r) => r.band)).toEqual(["优秀", "良好", "优秀", "不及格"]);
    const bad = await c.call("grades_edit", { project: "t", set: [{ row: 3, values: { 数学: "160" } }] });
    expect(bad.data.issues.some((i: { level: string; message: string }) => i.level === "error" && /outside 0–150/.test(i.message))).toBe(true);
    await expect(c.call("grades_export", { project: "t" })).rejects.toThrow(/errors/);
  });
  it("handles the sample class and exports grades, report cards and summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "grades-"));
    await cp(join(HERE, "samples"), join(root, "成绩"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("grades_open", { inputs: ["成绩/scores.xlsx"], project: "mid", settings: { school: "Penova 实验中学" } });
    expect(o.data.stats).toMatchObject({ students: 24, subjects: 5, classes: 2 });
    expect(o.data.summary).toMatch(/语文\/150, 数学\/150, 英语\/150, 物理\/100, 化学\/100/);
    expect(o.data.issues.some((i: { row?: number; message: string }) => i.row === 7 && /absent/.test(i.message))).toBe(true);
    await c.call("grades_edit", { project: "mid", set: [{ row: 0, values: { 评语: "数学进步明显，继续保持。" } }] });
    await c.call("grades_export", { project: "mid" });
    const out = join(root, "grade-book", "mid");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "grades.xlsx"));
    expect(wb.worksheets.map((x) => x.name)).toEqual(["成绩 Scores", "统计 Statistics", "分数段 Distribution"]);
    const sc = wb.getWorksheet("成绩 Scores")!;
    expect(sc.rowCount).toBe(25);
    expect(sc.getCell("G9").value).toBe("缺考");
    expect(sc.getCell("N2").value).toBe("数学进步明显，继续保持。");
    expect(wb.getWorksheet("统计 Statistics")!.rowCount).toBe(1 + 5 * 3);
    const cards = await PDFDocument.load(await readFile(join(out, "report-cards.pdf")));
    expect(cards.getPageCount()).toBe(24);
    const sum = await PDFDocument.load(await readFile(join(out, "summary.pdf")));
    expect(sum.getPageCount()).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
