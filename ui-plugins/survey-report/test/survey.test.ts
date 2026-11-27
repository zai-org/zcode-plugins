import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { analyze, cleanLabel, crossTab, detectType } from "../src/survey.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("analysis", () => {
  it("detects question types", () => {
    expect(detectType("序号", ["1", "2", "3"])).toBe("skip");
    expect(detectType("提交时间", ["2026/11/01 10:00", "2026/11/02 11:00"])).toBe("skip");
    expect(detectType("您的性别", ["男", "女", "女", "男", "女"])).toBe("single");
    expect(detectType("常用功能（多选）", ["记账┋预算", "记账", "报表┋记账", "预算┋报表", "记账"])).toBe("multi");
    expect(detectType("Which features?", ["Export, Charts", "Charts", "Export", "Charts, Sharing", "Export"])).toBe("multi");
    expect(detectType("满意度", ["4", "5", "3", "4", "5", "2"])).toBe("rating");
    expect(detectType("您向朋友推荐我们的可能性（0-10）", ["9", "10", "6", "8"])).toBe("nps");
    expect(detectType("年龄", ["23", "35", "41", "29"])).toBe("number");
    expect(detectType("建议", ["希望能导出 Excel，谢谢", "界面再简洁一点", "很好用", "加载有点慢"])).toBe("text");
    expect(detectType("建议", ["很好，谢谢", "很好，谢谢", "加载慢，卡", "加载慢，卡", "无"])).not.toBe("multi");
    expect(cleanLabel("3、您最常用的功能有哪些？")).toBe("您最常用的功能有哪些？");
    expect(cleanLabel("Q12. Age")).toBe("Age");
  });
  it("counts choices, ratings and NPS", () => {
    const m = analyze("multi", ["记账┋预算", "记账", "", "其他┋记账"]);
    expect(m).toMatchObject({ answered: 3, mentions: 5 });
    expect(m.options).toEqual([{ label: "记账", count: 3, pct: 100 }, { label: "预算", count: 1, pct: 33.3 }, { label: "其他", count: 1, pct: 33.3 }]);
    const r = analyze("rating", ["5", "4", "4", "2", "x"]);
    expect(r).toMatchObject({ answered: 4, mean: 3.75, topBox: 75, scale: [1, 5], ignored: 1 });
    expect(r.options.map((o) => o.count)).toEqual([0, 1, 0, 2, 1]);
    const n = analyze("nps", ["10", "9", "8", "6", "3"]);
    expect(n.nps).toEqual({ score: 0, promoters: 40, passives: 20, detractors: 40 });
    const c = crossTab(["男", "女", "女", "男"], ["男", "女"], "rating", ["5", "3", "4", "4"]);
    expect(c?.rows[0].cells.map((x) => x.value)).toEqual([4.5, 3.5]);
  });
});

describe("tools", () => {
  it("builds a report from a survey export", async () => {
    const root = await mkdtemp(join(tmpdir(), "survey-"));
    await cp(join(HERE, "samples"), join(root, "问卷"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("survey_open", { inputs: ["问卷/survey.xlsx"], project: "q4", settings: { title: "用户满意度调查 2026", crossBy: "Q1" } });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => [r.no, r.type])).toEqual([["—", "skip"], ["—", "skip"], ["Q1", "single"], ["Q2", "single"], ["Q3", "multi"], ["Q4", "rating"], ["Q5", "nps"], ["Q6", "text"]]);
    expect(rows[2].label).toBe("您的年龄段");
    expect(o.data.stats).toEqual({ responses: 60, questions: 6, skipped: 2 });
    expect(String(rows[6].result)).toMatch(/^NPS /);
    const e = await c.call("survey_edit", { project: "q4", set: [{ row: 7, values: { 题目: "其他建议", chart: "none" } }, { row: 3, values: { chart: "bar" } }] });
    expect((e.data.rows as Record<string, unknown>[])[7].label).toBe("其他建议");
    await c.call("survey_export", { project: "q4" });
    const out = join(root, "survey-report", "q4");
    const html = String(await readFile(join(out, "report.html")));
    expect(html).toContain("用户满意度调查 2026");
    expect(html).toContain("其他建议");
    expect(html).toContain("希望能导出 Excel");
    expect(html).toContain("按“您的年龄段”交叉");
    expect((html.match(/<svg/g) ?? []).length).toBe(5);
    const pdf = await PDFDocument.load(await readFile(join(out, "report.pdf")));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "results.xlsx"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["汇总 Summary", "交叉 Cross-tab", "开放题 Open answers", "原始数据 Data"]);
    const sum = wb.getWorksheet("汇总 Summary")!;
    expect(sum.getCell("A2").value).toBe("Q1");
    expect(sum.getCell("D2").value).toBe(60);
    expect(wb.getWorksheet("原始数据 Data")!.rowCount).toBe(61);
    expect(wb.getWorksheet("开放题 Open answers")!.rowCount).toBe(16);
  }, 60_000);
  it("warns when the cross-tab question is not single choice", async () => {
    const root = await mkdtemp(join(tmpdir(), "survey-"));
    await cp(join(HERE, "samples"), join(root, "问卷"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("survey_open", { inputs: ["问卷/survey.xlsx"], project: "x", settings: { crossBy: "满意度" } });
    expect(o.data.issues.some((i: { message: string }) => /needs a single-choice/.test(i.message))).toBe(true);
    const r = await c.call("survey_edit", { project: "x", settings: { crossBy: "渠道" } });
    expect(r.data.summary).toMatch(/cross-tab by “您是通过什么渠道了解到我们的？”/);
  });
});
