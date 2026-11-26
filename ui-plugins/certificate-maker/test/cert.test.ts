import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, fields, fitSize, measurer, parseLayout } from "../src/cert.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("layout", () => {
  it("parses lines, defaults and bad lines", () => {
    const { boxes, bad } = parseLayout("# x\n{Name} | 50 | 40 | 30 | #ff0000 | left | bold | 60\nHello | 10 | 20\noops | a | b");
    expect(boxes[0]).toMatchObject({ template: "{Name}", x: 50, y: 40, size: 30, color: "#ff0000", align: "left", bold: true, maxWidth: 60 });
    expect(boxes[1]).toMatchObject({ size: 16, align: "center", bold: false, maxWidth: 80 });
    expect(bad).toEqual(["oops | a | b"]);
    expect(fields(parseLayout(DEFAULT_LAYOUT).boxes)).toEqual(["姓名", "奖项", "日期"]);
  });
  it("shrinks long text to fit", async () => {
    const k = await measurer();
    const box = parseLayout("{a} | 50 | 50 | 44 | #000000 | center | bold | 50").boxes[0];
    expect(fitSize(k, "Ann", box, 842).size).toBe(44);
    const long = fitSize(k, "Christopher Montgomery-Wellington the Third", box, 842);
    expect(long.size).toBeLessThan(44);
  });
});

describe("certificate tools", () => {
  it("opens background + names, flags empty names, exports PDFs", async () => {
    const ws = await mkdtemp(join(tmpdir(), "cert-"));
    await cp(join(HERE, "samples"), join(ws, "颁奖"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("certificate_open", { inputs: ["颁奖/certificate-bg.png", "颁奖/winners.xlsx"], project: "年会" });
    expect(r.data.totalRows).toBe(5);
    expect(r.data.preview).toContain("<svg");
    expect(r.data.preview).toContain("林小满");
    expect(r.data.rows[2]._fit).toContain("pt");
    expect(r.data.issues.some((i: any) => i.row === 4 && i.level === "error")).toBe(true);
    await expect(call("certificate_export", { project: "年会" })).rejects.toMatchObject({ code: "has_errors" });
    await call("certificate_edit", { project: "年会", set: [{ row: 4, values: { 姓名: "宋雨桐" } }] });
    const out = await call("certificate_export", { project: "年会" });
    expect(out.data.exported).toHaveLength(6);
    const pdf = await PDFDocument.load(await readFile(join(ws, out.data.exported[0])));
    expect(pdf.getPageCount()).toBe(5);
    expect(out.data.exported[5]).toMatch(/each\/5-宋雨桐\.pdf$/);
    const bad = await call("certificate_edit", { project: "年会", settings: { layout: "{Nope} | 50 | 50" } });
    expect(bad.data.issues[0]).toMatchObject({ level: "error", key: "Nope" });
  });
});
