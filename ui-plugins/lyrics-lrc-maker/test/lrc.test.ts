import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { fitLines, parseLyrics, parseTime } from "../src/timing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("timing", () => {
  it("parses times and lrc files", () => {
    expect(parseTime("01:23.45")).toBeCloseTo(83.45);
    expect(parseTime("12.5")).toBe(12.5);
    expect(parseTime("1:02:03,4")).toBeCloseTo(3723.4);
    expect(Number.isNaN(parseTime("abc"))).toBe(true);
    const l = parseLyrics("[ti:歌]\n[00:10.00][00:30.00]副歌\n[00:05.00]主歌\n");
    expect(l.tags.ti).toBe("歌");
    expect(l.lines).toEqual([{ text: "主歌", start: 5 }, { text: "副歌", start: 10 }, { text: "副歌", start: 30 }]);
  });
  it("fits lines to phrases", () => {
    const segs = [{ start: 1, end: 3 }, { start: 4, end: 6 }, { start: 7, end: 8 }, { start: 8.5, end: 9.5 }];
    expect(fitLines([10, 10, 5], segs).map((x) => x.start)).toEqual([1, 4, 8.5]);
    expect(fitLines([5, 5, 10, 5, 5], segs).map((x) => x.start)).toEqual([1, 2, 4, 7, 8.5]);
  });
});

describe("tools", () => {
  it("times lyrics from audio, nudges and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "lrc-"));
    await cp(join(HERE, "samples"), join(root, "music"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("lrc_open", { inputs: ["music/晚风茶馆.txt", "music/晚风茶馆.mp3"], project: "song", settings: { title: "晚风茶馆", artist: "Penova Demo" } });
    expect(o.data.stats).toMatchObject({ lines: 8, phrases: 8 });
    const rows = o.data.rows as { start: string; text: string }[];
    expect(rows.map((r) => Math.round(parseTime(r.start)))).toEqual([3, 7, 11, 15, 21, 24, 26, 28]);
    const bad = await c.call("lrc_edit", { project: "song", set: [{ row: 5, values: { 开始: "00:20.00" } }] });
    expect(bad.text).toMatch(/before the previous line/);
    await c.call("lrc_edit", { project: "song", set: [{ row: 5, values: { start: "00:23.40" } }], settings: { offset: 200 } });
    await c.call("lrc_export", { project: "song" });
    const dir = join(root, "lyrics-lrc-maker/song");
    const l = await readFile(join(dir, "晚风茶馆.lrc"), "utf8");
    expect(l).toContain("[ti:晚风茶馆]\n[ar:Penova Demo]");
    expect(l).toContain("[00:03.20]晚风吹过街角的茶馆");
    expect(l).toContain("[00:23.60]一盏灯光");
    expect(await readFile(join(dir, "晚风茶馆.enhanced.lrc"), "utf8")).toMatch(/\[00:03\.20\]<00:03\.20>晚<00:03\.\d\d>风/);
    expect(await readFile(join(dir, "晚风茶馆.srt"), "utf8")).toMatch(/^1\n00:00:03,200 --> 00:00:06,\d{3}\n晚风吹过街角的茶馆/);
  }, 60_000);
});
