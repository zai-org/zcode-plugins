import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { assColor, cps, fmtTime, parse, parseTime, width, write } from "../src/subs.ts";
import { applyActions, check, fixOverlaps, syncMap } from "../src/edit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("formats", () => {
  it("parses and formats times", () => {
    expect(parseTime("00:01:02,500")).toBe(62500);
    expect(parseTime("01:02.5")).toBe(62500);
    expect(parseTime("0:00:01.25")).toBe(1250);
    expect(parseTime("-1.5")).toBe(-1500);
    expect(parseTime("200ms")).toBe(200);
    expect(parseTime("abc")).toBe(null);
    expect(fmtTime(3723456)).toBe("01:02:03,456");
    expect(fmtTime(3723456, "vtt")).toBe("01:02:03.456");
    expect(fmtTime(3723456, "ass")).toBe("1:02:03.45");
    expect(assColor("#FFCC00")).toBe("&H0000CCFF");
    expect(width("你好ab")).toBe(6);
  });
  it("reads SRT, VTT and ASS and writes them back", () => {
    const vtt = parse("a.vtt", "WEBVTT\n\nNOTE hi\n\nc1\n00:01.000 --> 00:02.500 align:start\n<b>Hello</b>\n\n00:03.000 --> 00:04.000\n第二行\n");
    expect(vtt.format).toBe("vtt");
    expect(vtt.cues).toEqual([{ start: 1000, end: 2500, text: "<b>Hello</b>" }, { start: 3000, end: 4000, text: "第二行" }]);
    const ass = parse("a.ass", "[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}你好，{\\i0}世界\\N第二行\n");
    expect(ass.cues[0]).toMatchObject({ start: 1000, end: 2500, text: "你好，世界\n第二行", style: "Default" });
    expect(ass.assHeader).toContain("Style: Default,Arial");
    const srt = write([{ start: 0, end: 1000, text: "<i>a</i>\nb" }], "srt");
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\n<i>a</i>\nb\n");
    expect(write([{ start: 0, end: 1000, text: "<i>a</i>\nb" }], "ass")).toContain("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\i1}a{\\i0}\\Nb");
    expect(write([{ start: 0, end: 1000, text: "x" }], "vtt")).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx\n");
  });
});

describe("editing", () => {
  it("merges, splits, retimes and checks", () => {
    const src = [
      { start: 0, end: 1000, text: "所以，", action: "merge" as const, row: 0 },
      { start: 1000, end: 3000, text: "我们出发了。", action: "keep" as const, row: 1 },
      { start: 3000, end: 7000, text: "第一句话说完了，第二句话", action: "split" as const, row: 2 },
      { start: 7000, end: 8000, text: "x", action: "delete" as const, row: 3 },
    ];
    const out = applyActions(src);
    expect(out.map((c) => [c.start, c.end, c.text, c.rows])).toEqual([[0, 3000, "所以，\n我们出发了。", [0, 1]], [3000, 5667, "第一句话说完了，", [2]], [5667, 7000, "第二句话", [2]]]);
    const m = syncMap([[10000, 11000], [20000, 22000]])!;
    expect(m(10000)).toBe(11000);
    expect(m(15000)).toBe(16500);
    expect(syncMap([[1000, 500]])!(3000)).toBe(2500);
    const cues = [{ start: 0, end: 2000, text: "一二三四五六七八九十一二三四五六七八九十一二三", rows: [0] }, { start: 1500, end: 1800, text: "ok", rows: [1] }];
    const f = check(cues, { maxCps: 20, maxWidth: 42, maxLines: 2, minDur: 800, minGap: 80 });
    expect(f.map((x) => `${x.cue}:${x.kind}`)).toEqual(["0:cps", "0:width", "0:overlap", "1:short"]);
    expect(cps(cues[0])).toBe(23);
    expect(fixOverlaps(cues, 80)).toBe(1);
    expect(cues[0].end).toBe(1420);
  });
});

describe("tools", () => {
  it("opens, edits, shifts and exports SRT, VTT and ASS", async () => {
    const root = await mkdtemp(join(tmpdir(), "sub-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("subtitle_open", { inputs: ["episode.srt"], project: "e" });
    expect(r0.data.rows).toHaveLength(9);
    const st = r0.data.stats as Record<string, number>;
    expect([st.overlaps, st.fast, st.long]).toEqual([1, 1, 3]);
    await c.call("subtitle_edit", { project: "e", set: [{ row: 4, values: { action: "split" } }, { row: 5, values: { 操作: "merge" } }, { row: 3, values: { end: "00:00:09,400" } }, { row: 7, values: { text: "Morning, everyone!\n早上好！" } }] });
    const r1 = await c.call("subtitle_edit", { project: "e", settings: { offset: "1.5", fixOverlaps: true, name: "episode-fixed" } });
    const rows = r1.data.rows as Record<string, unknown>[];
    expect(rows[0].newStart).toBe("00:00:02,500");
    expect(rows[6].newStart).toBe("↑ 并入 #7");
    expect(rows[1].newEnd).toBe("00:00:07,420");
    expect((r1.data.stats as Record<string, number>).out).toBe(9);
    await c.call("subtitle_export", { project: "e" });
    const out = join(root, "subtitle-editor", "e");
    const srt = String(await readFile(join(out, "episode-fixed.srt")));
    expect(srt).toContain("6\n00:00:12,969 --> 00:00:15,500\n这样炒出来的茶叶香气最足，也最耐泡。\n");
    expect(srt).toContain("7\n00:00:15,800 --> 00:00:18,000\n所以，\n我们六点就出发了。\n");
    expect(srt).toContain("8\n00:00:18,500 --> 00:00:21,500\nMorning, everyone!\n早上好！\n");
    expect(String(await readFile(join(out, "episode-fixed.vtt")))).toMatch(/^WEBVTT\n\n00:00:02\.500 --> 00:00:04\.700\n/);
    const ass = String(await readFile(join(out, "episode-fixed.ass")));
    expect(ass).toContain("Dialogue: 0,0:00:07.50,0:00:09.50,Default,,0,0,0,,{\\i1}（鸟鸣声）{\\i0}");
    expect(parse("x.ass", ass).cues).toHaveLength(9);
    expect(String(await readFile(join(out, "episode-fixed-checks.csv")))).toContain("读速过快");
  });
});
