import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { parse } from "../src/subs.ts";
import { cjkRatio, pairUp } from "../src/pair.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("pairing", () => {
  it("pairs by overlap, joins split cues and keeps orphans", () => {
    const top = [{ start: 0, end: 3000, text: "甲" }, { start: 3000, end: 6000, text: "乙" }];
    const bottom = [{ start: 100, end: 1500, text: "A1" }, { start: 1500, end: 2900, text: "A2" }, { start: 2950, end: 5800, text: "B" }, { start: 9000, end: 9500, text: "C" }];
    const p = pairUp(top, bottom, { minOverlap: 0.3, timing: "top", orphans: true });
    expect(p.map((x) => [x.start, x.end, x.top, x.bottom])).toEqual([[0, 3000, "甲", "A1 A2"], [3000, 6000, "乙", "B"], [9000, 9500, "", "C"]]);
    expect(pairUp(top, bottom, { minOverlap: 0.3, timing: "union", orphans: false }).map((x) => [x.start, x.end])).toEqual([[0, 3000], [2950, 6000]]);
    // 重叠太少不算
    expect(pairUp([{ start: 0, end: 1000, text: "x" }], [{ start: 900, end: 2000, text: "y" }], { minOverlap: 0.3, timing: "top", orphans: true }).map((x) => x.bottom)).toEqual(["", "y"]);
    expect(cjkRatio([{ start: 0, end: 1, text: "你好 ab" }])).toBe(0.5);
  });
});

describe("tools", () => {
  it("merges zh + en into bilingual SRT, VTT and ASS", async () => {
    const root = await mkdtemp(join(tmpdir(), "bi-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("bilingual_open", { inputs: ["subs/en.srt", "subs/zh.srt"], project: "t" });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.match)).toEqual(["1 : 1", "1 : 2", "仅上行 top only", "1 : 1", "仅上行 top only", "仅下行 bottom only"]);
    expect(rows[1].bottom).toBe("These tea trees were planted over a century ago, and we pick them every spring.");
    // 把孤立的英文挪到“谢谢收看”一行，删掉孤立行和鸟鸣
    await c.call("bilingual_edit", { project: "t", set: [{ row: 4, values: { 下行: "See you next time!" } }, { row: 5, values: { keep: false } }, { row: 2, values: { keep: false } }] });
    const r1 = await c.call("bilingual_edit", { project: "t", settings: { bottomColor: "#FFCC00", name: "tea-garden" } });
    expect((r1.data.rows as Record<string, unknown>[])[4].bottom).toBe("See you next time!");
    expect(r1.data.stats).toMatchObject({ lines: 4, paired: 4 });
    await c.call("bilingual_export", { project: "t" });
    const out = join(root, "bilingual-subtitles", "t");
    const srt = String(await readFile(join(out, "tea-garden.srt")));
    expect(srt).toContain("1\n00:00:01,000 --> 00:00:03,000\n你好，欢迎来到我们的茶园。\nHello, and welcome to our tea garden.\n");
    expect(srt).toContain("4\n00:00:11,500 --> 00:00:13,000\n谢谢收看。\nSee you next time!\n");
    expect(srt).not.toContain("鸟鸣");
    const ass = String(await readFile(join(out, "tea-garden.ass")));
    expect(ass).toContain("Style: Bottom,Noto Sans CJK SC,40,&H0000CCFF");
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:03.00,Top,,0,0,0,,你好，欢迎来到我们的茶园。\\N{\\rBottom}Hello, and welcome to our tea garden.");
    expect(parse("x.ass", ass).cues).toHaveLength(4);
    expect(String(await readFile(join(out, "tea-garden.vtt")))).toMatch(/^WEBVTT/);
    expect(String(await readFile(join(out, "pairs.csv")))).toContain("1 : 2");
    // 改顺序后英文在上，手改的内容仍保留
    const r2 = await c.call("bilingual_edit", { project: "t", settings: { order: "first" } });
    expect((r2.data.rows as Record<string, unknown>[])[0].top).toBe("Hello, and welcome to our tea garden.");
  });
});
