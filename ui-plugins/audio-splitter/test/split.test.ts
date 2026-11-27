import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { parseChapters, parseHms, tracksFromSilences } from "../src/split.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("cuts", () => {
  it("merges short tracks and parses chapter lists", () => {
    const sil = [{ start: 10, end: 12 }, { start: 14, end: 16 }, { start: 40, end: 42 }];
    const t = tracksFromSilences(sil, 60, { minLen: 5, maxLen: 1000, trim: false, pad: 0.3 });
    expect(t.map((x) => [x.start, x.end])).toEqual([[0, 15], [15, 41], [41, 60]]);
    expect(parseChapters("00:00 开场\n1:02:03 结束\n问答")).toEqual([{ at: 0, title: "开场" }, { at: 3723, title: "结束" }, { title: "问答" }]);
    expect(parseHms("01:30.5")).toBe(90.5);
  });
});

describe("tools", () => {
  it("splits at silences, names tracks from the list and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "as-"));
    await cp(join(HERE, "samples"), join(root, "rec"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("split_open", { inputs: ["rec/茶艺讲座.mp3", "rec/章节.txt"], project: "talk", settings: { album: "茶艺讲座" } });
    expect(o.data.stats).toMatchObject({ tracks: 4 });
    const rows = o.data.rows as { start: string; end: string; title: string }[];
    expect(rows.map((r) => r.title)).toEqual(["开场：茶的起源", "绿茶与红茶", "冲泡的水温与时间", "问答环节"]);
    expect(Math.round(parseHms(rows[2].start))).toBe(30);
    const bad = await c.call("split_edit", { project: "talk", set: [{ row: 2, values: { 开始: "00:25.00" } }] });
    expect(bad.text).toMatch(/overlap/);
    await c.call("split_edit", { project: "talk", set: [{ row: 2, values: { start: "00:30.00" } }, { row: 3, values: { title: "问答" } }] });
    await c.call("split_export", { project: "talk" });
    const dir = join(root, "audio-splitter/talk");
    expect((await readdir(join(dir, "tracks"))).sort()).toEqual(["01 开场：茶的起源.mp3", "02 绿茶与红茶.mp3", "03 冲泡的水温与时间.mp3", "04 问答.mp3"]);
    expect(await readFile(join(dir, "chapters.txt"), "utf8")).toMatch(/^00:00 开场：茶的起源\n00:1\d 绿茶与红茶\n00:30 冲泡的水温与时间/);
    expect(await readFile(join(dir, "album.cue"), "utf8")).toContain('TRACK 04 AUDIO\n    TITLE "问答"');
    expect(await readFile(join(dir, "tracks.csv"), "utf8")).toContain("04 问答.mp3");
  }, 60_000);
});
