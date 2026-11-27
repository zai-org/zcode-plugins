import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { count, fmtMinutes, minutes } from "../src/count.ts";
import { fromMarkdown, fromText, sections } from "../src/extract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("counting", () => {
  it("counts Chinese and English separately like Word", () => {
    expect(count("你好，world! 123")).toEqual({ cjk: 2, punct: 1, latin: 2, numbers: 1, chars: 12, charsWithSpaces: 13, words: 5, paragraphs: 1 });
    expect(count("你好，world! 123", { numbers: false })).toMatchObject({ latin: 1, words: 4 });
    expect(count("“一芽一叶最好。”")).toMatchObject({ cjk: 6, punct: 3, words: 9 });
    expect(count("约 0.7 斤；don't-stop e-mail")).toMatchObject({ cjk: 2, punct: 1, latin: 3, numbers: 1 });
    expect(count("こんにちは 안녕하세요")).toMatchObject({ cjk: 10, latin: 0 });
    expect(fmtMinutes(minutes({ ...count(""), cjk: 4000, latin: 2300 }))).toBe("20 min");
    expect(fmtMinutes(125)).toBe("2 h 5 min");
  });
  it("splits Markdown and text into chapters", () => {
    const md = fromMarkdown("---\ntitle: x\n---\n# A\n\nintro [link](http://x) ![img](a.png)\n```\ncode here\n```\n## B\n| a | b |\n|---|---|\n| 1 | 2 |\n### C\ntext");
    expect(md.map((p) => `${p.k}:${p.t}`)).toEqual(["heading:A", "text:intro link", "code:code here", "heading:B", "table:a b", "table:1 2", "heading:C", "text:text"]);
    expect(sections("x.md", md, 2).map((s) => s.title)).toEqual(["A", "B"]);
    expect(fromText("前言\n正文\n第十二章 归来\nChapter 3 Home\n1. 不是章节").filter((p) => p.k === "heading").map((p) => p.t)).toEqual(["前言", "第十二章 归来", "Chapter 3 Home"]);
  });
});

describe("tools", () => {
  it("counts a folder of manuscripts by chapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "wc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("wordcount_open", { inputs: ["manuscripts"], project: "book", settings: { rate: 120 } });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => `${String(r.file).split("/").pop()}|${r.chapter}`)).toEqual([
      "field-notes.pdf|Chapter 1", "field-notes.pdf|Chapter 2",
      "notes.md|冲泡笔记", "notes.md|绿茶", "notes.md|白茶",
      "story.txt|序章", "story.txt|第一章 出发", "story.txt|第二章 到达",
      "tea-book.docx|第一章 茶山", "tea-book.docx|1.1 采茶", "tea-book.docx|第二章 制茶", "tea-book.docx|参考文献（不计 · not counted）",
    ]);
    expect(rows[0]).toMatchObject({ latin: 8, cjk: 0 });
    expect(rows[1]).toMatchObject({ latin: 2, cjk: 11, punct: 1, words: 14 });
    expect(rows[5]).toMatchObject({ cjk: 13, punct: 2, words: 15 });
    expect(rows[11]).toMatchObject({ _off: true, fee: "" });
    const total = rows.filter((r) => !r._off).reduce((a, r) => a + Number(r.words), 0);
    expect(o.data.stats).toMatchObject({ files: 4, sections: 12, words: total });
    expect(o.data.stats.fee).toBeCloseTo((total / 1000) * 120, 2);
    // 统计代码块后，绿茶一节变多
    const before = rows[3].words as number;
    const e = await c.call("wordcount_edit", { project: "book", settings: { code: true, exclude: "/^\\s*参考/" }, set: [{ row: 0, values: { 计入: false } }] });
    const er = e.data.rows as Record<string, unknown>[];
    expect(er[3].words as number).toBeGreaterThan(before);
    expect(e.data.stats.words).toBe(er.filter((r) => !r._off).reduce((a, r) => a + Number(r.words), 0));
    expect(er[0]._off).toBe(true);
    await c.call("wordcount_export", { project: "book" });
    const out = join(root, "word-count-report", "book");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(out, "word-count.xlsx"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["按章节 By chapter", "按文件 By file", "汇总 Totals"]);
    expect(wb.getWorksheet("按文件 By file")!.rowCount).toBe(5);
    expect(wb.getWorksheet("汇总 Totals")!.getCell("B3").value).toBe(e.data.stats.words);
    const csv = String(await readFile(join(out, "word-count.csv"))).trim().split(/\r?\n/);
    expect(csv).toHaveLength(13);
    expect(csv[1]).toMatch(/^no,/);
  }, 60_000);
  it("counts per file and flags bad rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "wc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("wordcount_open", { inputs: ["manuscripts/story.txt", "manuscripts/tea-book.docx"], project: "f", settings: { split: "file", exclude: "/[/" } });
    expect((o.data.rows as unknown[]).length).toBe(2);
    expect(o.data.issues.some((i: { level: string; message: string }) => i.level === "error" && /regular expression/.test(i.message))).toBe(true);
  });
});
