import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { normDate, readForm } from "../src/forms.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("forms", () => {
  it("reads every field type with tooltips and required flags", async () => {
    const r = await readForm(new Uint8Array(await readFile(join(HERE, "samples/returned-forms/04-Chen Xiao.pdf"))));
    expect(r.fields.map((f) => `${f.name}:${f.type}:${f.required ? "req" : ""}`)).toEqual(["name:text:req", "email:text:req", "phone:text:req", "dept:dropdown:", "session:radio:", "vegetarian:checkbox:", "arrival:text:", "notes:text:", "consent:checkbox:req"]);
    expect(r.fields[0].label).toBe("姓名 Name");
    expect(r.fields[3].options).toEqual(["产品部", "研发部", "市场部", "行政部"]);
    expect(r.values).toEqual({ name: "Chen Xiao", email: "chen.xiao@example.com", phone: "+86 186 0000 1234", dept: "行政部", session: "Day 2 (12/13)", vegetarian: true, arrival: "2026-12-12", notes: "Arriving late,\nafter 8 pm", consent: true });
  });
  it("handles PDFs without a form and broken files", async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    expect((await readForm(await doc.save())).fields).toEqual([]);
    expect((await readForm(new TextEncoder().encode("not a pdf"))).error).toBeTruthy();
    expect(["2026/1/5", "12/11/2026", "05.01.2026", "next week"].map(normDate)).toEqual(["2026-01-05", "2026-12-11", "2026-01-05", null]);
  });
});

describe("tools", () => {
  it("collects, flags, fixes and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "fc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("formcollect_open", { inputs: ["returned-forms"], project: "t" });
    expect(r0.data.stats).toEqual({ forms: 5, fields: 9, complete: 3, missing: 2, invalid: 1, blank: 1 });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => `${String(r.file).split("/").pop()} ${r.status}`)).toEqual(["01-张伟.pdf complete 完整", "02-李娜.pdf missing 1 缺 1 项", "03-王强.pdf missing 1 缺 1 项", "04-Chen Xiao.pdf complete 完整", "05-张伟-修改.pdf complete 完整", "blank-form.pdf blank 空白"]);
    const issues = JSON.stringify(r0.data.issues);
    expect(issues).toContain("02-李娜.pdf: 手机 Phone: missing");
    expect(issues).toContain("“lina@” isn't an email address");
    expect(issues).toContain("同意活动须知 I agree: not ticked");
    expect(issues).toContain("05-张伟-修改.pdf has the same 邮箱 Email as returned-forms/01-张伟.pdf");
    await c.call("formcollect_edit", { project: "t", set: [{ row: 1, values: { f1: "lina@example.com", f2: "13700001111" } }, { row: 0, values: { include: false } }] });
    const r1 = await c.call("formcollect_status", { project: "t" });
    expect(r1.data.stats).toMatchObject({ forms: 4, complete: 3, missing: 1, invalid: 0 });
    expect(JSON.stringify(r1.data.issues)).not.toContain("same 邮箱");
    await c.call("formcollect_export", { project: "t" });
    const out = join(root, "pdf-form-collector", "t");
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(out, "responses.xlsx"));
    const sh = book.getWorksheet("Responses")!;
    expect(sh.rowCount).toBe(5);
    expect(sh.getRow(1).values).toEqual([undefined, "File", "姓名 Name", "邮箱 Email", "手机 Phone", "部门 Department", "场次 Session", "素食 Vegetarian", "到达日期 Arrival date", "备注 Notes", "同意活动须知 I agree"]);
    expect(sh.getRow(3).values).toEqual([undefined, "03-王强.pdf", "王强", "wangqiang@example.com", "13912345678", "研发部", "Day 1 (12/12)", "否", "2026-12-11", "", "否"]);
    const cell = sh.getCell(3, 10);
    expect((cell.fill as { fgColor: { argb: string } }).fgColor.argb).toBe("FFFDE68A");
    expect(String(cell.note)).toContain("not ticked");
    expect(book.getWorksheet("Fields")!.getRow(2).values).toEqual([undefined, "name", "姓名 Name", "text", "yes", "", 4, 4]);
    const csv = String(await readFile(join(out, "responses.csv")));
    expect(csv).toContain("02-李娜.pdf,李娜,lina@example.com,13700001111,市场部,Day 2 (12/13),是,,需要无障碍房间,是");
    expect(csv).toContain(`"Arriving late,\nafter 8 pm"`);
    expect(csv).toContain("05-张伟-修改.pdf,张伟,zhangwei@example.com");
  });
});
