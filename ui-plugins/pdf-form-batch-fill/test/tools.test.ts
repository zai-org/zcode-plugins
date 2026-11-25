import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.ts";
import { makeChineseForm, makeRoster } from "./fixtures.ts";

let workspace: string;
let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as any;
  return result;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "formfill-"));
  await writeFile(join(workspace, "报名表.pdf"), await makeChineseForm(true));
  await writeFile(join(workspace, "flat.pdf"), await makeChineseForm(false));
  await writeFile(join(workspace, "名单.csv"), makeRoster());
  await writeFile(join(workspace, "fw9.pdf"), await readFile(join(import.meta.dirname, "fixtures/fw9.pdf")));
  await writeFile(join(workspace, "w9.csv"), "Name,Business\nJane Doe,Doe Consulting LLC\nJohn Roe,\n");
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe("pdf-form-batch-fill", () => {
  it("lists fields and proposes a mapping", async () => {
    const result = await call("form_open", { pdf: "报名表.pdf", roster: "名单.csv" });
    expect(result.isError).toBeFalsy();
    const { info, template, roster } = result.structuredContent;
    expect(info.fields.map((f: any) => f.name)).toEqual(["name", "phone", "idcard", "address", "course", "gender", "stay", "note"]);
    expect(roster.rowCount).toBe(30);
    expect(roster.columns).toContain("序号");
    expect(template.fields.length).toBe(8);
  });

  it("checks and generates one PDF per row with a report", async () => {
    const template = {
      pdf: "报名表.pdf",
      roster: "名单.csv",
      fields: [
        { id: "name", kind: "acro", name: "name", source: "{姓名}", required: true },
        { id: "phone", kind: "acro", name: "phone", source: "{手机号}", required: true },
        { id: "idcard", kind: "acro", name: "idcard", source: "{身份证号}" },
        { id: "address", kind: "acro", name: "address", source: "{通讯地址}", minFontSize: 8 },
        { id: "course", kind: "acro", name: "course", source: "{课程}" },
        { id: "gender", kind: "acro", name: "gender", source: "{性别}" },
        { id: "stay", kind: "acro", name: "stay", source: "{住宿}" },
        { id: "note", kind: "acro", name: "note", source: "{备注}" },
      ],
      output: { dir: "out", fileName: "{序号}-{姓名}-报名表.pdf", flatten: true, merged: true },
    };
    const saved = await call("template_save", { path: "冬季班.formfill.json", template });
    expect(saved.isError).toBeFalsy();
    const check = await call("form_check", { template: "冬季班.formfill.json" });
    const kinds = check.structuredContent.issues.map((i: any) => `${i.row}:${i.kind}`);
    expect(kinds).toContain("7:missing");
    expect(kinds).toContain("12:overflow");
    expect(kinds).toContain("20:bad_option");
    expect(kinds.length).toBe(3);

    const generated = await call("form_generate", { template: "冬季班.formfill.json" });
    expect(generated.isError).toBeFalsy();
    const files = await readdir(join(workspace, "out"));
    expect(files.filter((f) => f.endsWith("报名表.pdf")).length).toBe(30);
    expect(files).toContain("_merged.pdf");
    expect(files).toContain("_report.csv");
    const merged = await PDFDocument.load(await readFile(join(workspace, "out/_merged.pdf")));
    expect(merged.getPageCount()).toBe(30);
    const report = await readFile(join(workspace, "out/_report.csv"), "utf8");
    expect(report).toMatch(/12,.*overflow/);
  });

  it("fills free-position text boxes on a flat PDF", async () => {
    const template = {
      pdf: "flat.pdf",
      roster: "名单.csv",
      fields: [
        { id: "n", kind: "box", page: 0, rect: [140, 118, 380, 24], source: "{姓名}", required: true },
        { id: "a", kind: "box", page: 0, rect: [140, 238, 380, 24], source: "{通讯地址}", minFontSize: 7 },
        { id: "r", kind: "box", page: 0, rect: [140, 402, 380, 100], source: "{备注}", multiline: true },
      ],
      output: { dir: "flat-out", fileName: "{姓名}.pdf", flatten: true, merged: false },
    };
    const result = await call("form_generate", { template, rows: [1, 12] });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.files.length).toBe(2);
    expect(result.structuredContent.issues.filter((i: any) => i.kind === "overflow").length).toBe(1);
  });

  it("fills the real IRS W-9 form", async () => {
    const opened = await call("form_open", { pdf: "fw9.pdf", roster: "w9.csv" });
    expect(opened.structuredContent.info.fields.length).toBeGreaterThan(15);
    const first = opened.structuredContent.info.fields[0].name;
    const result = await call("form_generate", {
      template: { pdf: "fw9.pdf", roster: "w9.csv", fields: [{ id: "a", kind: "acro", name: first, source: "{Name}" }], output: { dir: "w9-out", fileName: "W9-{Name}.pdf", flatten: false, merged: false } },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(await readFile(join(workspace, "w9-out/W9-Jane Doe.pdf")));
    expect(doc.getForm().getTextField(first).getText()).toBe("Jane Doe");
  });

  it("rejects paths outside the workspace", async () => {
    const result = await call("form_open", { pdf: "../../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside_workspace/);
  });
});
