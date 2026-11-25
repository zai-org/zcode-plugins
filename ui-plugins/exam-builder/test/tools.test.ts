import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/bank.ts";
import { normalizePath, tex2svg } from "../src/math.ts";
import { buildPapers, quota } from "../src/paper.ts";
import { rich } from "../src/render.ts";
import { createServer } from "../src/server.ts";

// 虚构题库（samples/exam）：高一数学 37 题（含 5 处故意的错误）+ 英文物理 xlsx 6 题。
const SAMPLES = process.env.EXAM_SAMPLES ?? "/workspace/zcode-new-plugins/samples/exam";
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const BANK = "题库/高一数学题库.md";

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "exam-"));
  await cp(SAMPLES, join(workspace, "题库"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("parsing and layout helpers", () => {
  it("parses the Markdown format", () => {
    const qs = parseMarkdown("b.md", "# 函数\n## 单选 | 易 | 5分 | id: X1\n若 $x=1$，则\n![](a.png)\nA. 1\nB. 2\n答案：A\n解析：显然。\n## 判断 | 难\n对吗？\n答案：对\n");
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ id: "X1", type: "single", chapter: "函数", level: 1, score: 5, answer: "A", explanation: "显然。" });
    expect(qs[0].options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(qs[1]).toMatchObject({ type: "tf", level: 3, answer: "对" });
  });
  it("splits rich text", () => {
    expect(rich("设 $a_1$ 为\n$$x^2$$![p](i.png)").map((t) => t.k)).toEqual(["text", "math", "text", "br", "math", "img"]);
  });
  it("renders LaTeX and reports errors", () => {
    expect(tex2svg("\\frac{1}{2}").width).toBeGreaterThan(0.3);
    expect(tex2svg("\\frac{1}{2").error).toMatch(/brace/i);
  });
  it("turns quadratic curves into cubic ones for pdf-lib", () => {
    expect(normalizePath("M0 0Q10 10 20 0T40 0H50V5Z")).toBe("M0 0C6.667 6.667 13.333 6.667 20 0C26.667 -6.667 33.333 -6.667 40 0L50 0L50 5Z");
  });
  it("splits counts by difficulty ratio", () => {
    expect(quota(8, { easy: 5, medium: 3, hard: 2 })).toEqual({ 1: 4, 2: 2, 3: 2 });
    expect(quota(3, { easy: 1, medium: 1, hard: 1 })).toEqual({ 1: 1, 2: 1, 3: 1 });
  });
  it("is reproducible and never repeats questions", () => {
    const qs = Array.from({ length: 30 }, (_, i) => ({ id: `Q${i}`, type: "single" as const, chapter: "c", level: ((i % 3) + 1) as 1 | 2 | 3, stem: `q${i}`, options: [], answer: "A", explanation: "", file: "", line: 0, dir: "." }));
    const rules = { title: "t", sections: [{ type: "single" as const, count: 10 }], sets: 3, seed: "s" };
    const a = buildPapers(qs, rules, new Set()), b = buildPapers(qs, rules, new Set());
    expect(a).toEqual(b);
    const ids = a.papers.flatMap((p) => p.sections[0].ids);
    expect(new Set(ids).size).toBe(30);
    expect(buildPapers(qs, { ...rules, seed: "other" }, new Set()).papers[0].sections[0].ids).not.toEqual(a.papers[0].sections[0].ids);
  });
});

describe("tools", () => {
  it("loads and checks the banks", async () => {
    const r = await call("exam_bank", { files: [BANK, "题库/physics-bank.xlsx"] });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent;
    expect(s.stats.total).toBe(43);
    expect(s.issues.map((i: any) => `${i.id}:${i.kind}`).sort()).toEqual(["F-11:duplicate", "P-03:missing-image", "P-06:missing-answer", "P-08:latex", "T-10:bad-answer"]);
    expect(r.content[0].text).toMatch(/高一数学题库\.md:\d+/);
  });
  it("builds two sets without overlap and swaps a question", async () => {
    await call("exam_bank", { files: [BANK] });
    const r = await call("exam_build", { title: "高一数学期中测试", duration: "90 分钟", sections: [{ type: "single", count: 5 }, { type: "tf", count: 2 }, { type: "fill", count: 2 }, { type: "short", count: 1 }], difficulty: { easy: 5, medium: 3, hard: 2 }, sets: 2, seed: "2026" });
    expect(r.isError).toBeFalsy();
    const [a, b] = r.structuredContent.project.papers;
    const ia = a.sections.flatMap((s: any) => s.ids), ib = b.sections.flatMap((s: any) => s.ids);
    expect(ia).toHaveLength(10);
    expect(ia.filter((x: string) => ib.includes(x))).toEqual([]);
    for (const bad of ["F-11", "P-03", "P-06", "P-08", "T-10"]) expect([...ia, ...ib]).not.toContain(bad);
    const again = await call("exam_build", { title: "高一数学期中测试", duration: "90 分钟", sections: [{ type: "single", count: 5 }, { type: "tf", count: 2 }, { type: "fill", count: 2 }, { type: "short", count: 1 }], difficulty: { easy: 5, medium: 3, hard: 2 }, sets: 2, seed: "2026" });
    expect(again.structuredContent.project.papers[0].sections[0].ids).toEqual(a.sections[0].ids);
    const target = a.sections[0].ids[0];
    const s = await call("exam_swap", { set: "A", id: target });
    expect(s.isError).toBeFalsy();
    const na = s.structuredContent.project.papers[0].sections[0].ids;
    expect(na).not.toContain(target);
    expect(na).toHaveLength(5);
    expect(na.filter((x: string) => ib.includes(x))).toEqual([]);
  });
  it("rejects unknown chapters and reports shortfalls", async () => {
    expect((await call("exam_build", { title: "x", sections: [{ type: "single", count: 1 }], chapters: ["微积分"] })).content[0].text).toMatch(/Unknown chapter/);
    const r = await call("exam_build", { title: "x", sections: [{ type: "multi", count: 9 }] });
    expect(r.content[0].text).toMatch(/only \d of 9/);
  });
  it("exports print-ready PDFs and HTML", async () => {
    await call("exam_build", { title: "高一数学期中测试", duration: "90 分钟", sections: [{ type: "single", count: 6 }, { type: "multi", count: 2 }, { type: "tf", count: 3 }, { type: "fill", count: 3 }, { type: "short", count: 2 }], sets: 1, seed: "2026" });
    const r = await call("exam_export", {});
    expect(r.isError).toBeFalsy();
    const files: string[] = r.structuredContent.files;
    expect(files.map((f) => f.split("/").pop()).sort()).toEqual(["paper.json", "高一数学期中测试-A卷-答案.html", "高一数学期中测试-A卷-答案.pdf", "高一数学期中测试-A卷.html", "高一数学期中测试-A卷.pdf"]);
    const pdf = await PDFDocument.load(await readFile(join(workspace, "exams/高一数学期中测试/高一数学期中测试-A卷.pdf")));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
    const html = await readFile(join(workspace, "exams/高一数学期中测试/高一数学期中测试-A卷.html"), "utf8");
    expect(html).toContain("<svg");
    expect(html).toMatch(/一、单项选择题（本题共 6 小题，每小题 5 分，共 30 分）/);
    const key = await readFile(join(workspace, "exams/高一数学期中测试/高一数学期中测试-A卷-答案.html"), "utf8");
    expect(key).toMatch(/答案：[A-D]/);
    await writeFile(join(tmpdir(), "exam-test-paper.pdf"), await readFile(join(workspace, "exams/高一数学期中测试/高一数学期中测试-A卷.pdf")));
  });
});
