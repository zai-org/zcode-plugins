import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { evaluate, parseDates, type Rules } from "../src/att.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const R = (o: Partial<Rules> = {}): Rules => ({ start: 540, end: 1080, grace: 5, earlyGrace: 0, lunch: 60, otAfter: 30, otMin: 30, elastic: 0, weekend: [6, 0], holidays: new Set(), workdays: new Set(), ...o });

describe("rules", () => {
  it("parses date ranges", () => {
    expect([...parseDates("2026-10-01..2026-10-03, 2026-11-03")]).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-11-03"]);
  });
  it("judges a day", () => {
    expect(evaluate("2026-11-02", 9 * 60 + 4, 18 * 60 + 5, "", R()).status).toBe("正常");
    const late = evaluate("2026-11-02", 9 * 60 + 20, 18 * 60, "", R());
    expect(late.late).toBe(20);
    const flex = evaluate("2026-11-02", 9 * 60 + 20, 18 * 60 + 25, "", R({ elastic: 30 }));
    expect(flex.late).toBe(0);
    expect(flex.early).toBe(0);
    expect(evaluate("2026-11-02", 9 * 60 + 20, 18 * 60 + 10, "", R({ elastic: 30 })).early).toBe(10);
    const ot = evaluate("2026-11-02", 9 * 60, 20 * 60 + 30, "", R());
    expect(ot.ot).toBe(150);
    expect(evaluate("2026-11-02", 9 * 60, 18 * 60 + 20, "", R()).ot).toBe(0);
    expect(evaluate("2026-11-02", null, null, "", R()).absent).toBe(true);
    expect(evaluate("2026-11-02", null, null, "病假", R())).toMatchObject({ absent: false, excused: true });
    expect(evaluate("2026-11-02", null, 18 * 60, "", R()).missing).toBe(1);
    expect(evaluate("2026-11-07", 10 * 60, 15 * 60, "", R())).toMatchObject({ rest: true, ot: 240 });
    expect(evaluate("2026-11-07", null, null, "", R({ workdays: new Set(["2026-11-07"]) })).absent).toBe(true);
  });
});

describe("attendance tools", () => {
  it("reports a month", async () => {
    const root = await mkdtemp(join(tmpdir(), "att-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("attend_open", { inputs: ["punches.xlsx"], project: "nov" });
    expect(o.data.stats).toMatchObject({ people: 6, late: 4, missing: 2, absent: 3 });
    expect(o.text).toContain("6 people · 2026-11");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(6 * 21 + 2);
    const linMissing = rows.find((r) => r.name === "林晓雯" && r.date === "2026-11-09")!;
    expect(linMissing).toMatchObject({ in: "", status: "缺上班卡" });
    expect(String(rows.find((r) => r.name === "欧阳明" && r.date === "2026-11-14")!.status)).toBe("休息日加班");
    expect(JSON.stringify(o.data.issues)).toContain("2026-10 were left out");
    const zhao = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.name === "赵小雨" && (r.date === "2026-11-18" || r.date === "2026-11-19")).map(({ i }) => i);
    const e = await c.call("attend_edit", { project: "nov", settings: { holidays: "2026-11-12" }, set: zhao.map((row) => ({ row, values: { note: "年假" } })) });
    expect(e.data.stats).toMatchObject({ absent: 0, late: 4 });
    const lin = rows.findIndex((r) => r.name === "林晓雯" && r.date === "2026-11-09");
    const f = await c.call("attend_edit", { project: "nov", set: [{ row: lin, values: { in: "08:55" } }] });
    expect(f.data.stats).toMatchObject({ missing: 1 });
    await c.call("attend_export", { project: "nov" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "attendance-report/nov/attendance-2026-11.xlsx"));
    const sum = wb.getWorksheet(1)!;
    const head = (sum.getRow(1).values as unknown[]).slice(1);
    const row = (name: string) => { for (let i = 2; i <= sum.rowCount; i++) if (sum.getRow(i).getCell(1).value === name) return (sum.getRow(i).values as unknown[]).slice(1); return []; };
    const ch = row("陈思");
    expect(ch[head.indexOf("迟到次数")]).toBe(4);
    const oy = row("欧阳明");
    expect(oy[head.indexOf("休息日加班(时)")]).toBeGreaterThan(14); // 11-14 周六 + 11-12 设为节假日后整天算休息日加班
    expect(oy[head.indexOf("工作日加班(时)")]).toBeGreaterThan(12);
    expect(row("赵小雨")[head.indexOf("请假/出差")]).toBe(2);
    expect(row("王磊")[head.indexOf("应出勤天数")]).toBe(20);
    const p = new ExcelJS.Workbook();
    await p.xlsx.readFile(join(root, "attendance-report/nov/people/周子涵-2026-11.xlsx"));
    expect(p.getWorksheet(1)!.rowCount).toBe(23);
  });
});
