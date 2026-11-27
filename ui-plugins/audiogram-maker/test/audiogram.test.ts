import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { parseLrc, parseSrt, parseTime, spreadText } from "../src/captions.ts";
import { createServer } from "../src/server.ts";
import { probe } from "../src/kit/ffmpeg.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("captions", () => {
  it("parses srt, lrc and text", () => {
    expect(parseTime("01:05")).toBe(65);
    expect(parseTime("00:00:12,500")).toBeCloseTo(12.5);
    expect(parseSrt("1\n00:00:01,000 --> 00:00:02,500\nhi <i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nbye\n")).toEqual([{ start: 1, end: 2.5, text: "hi there" }, { start: 3, end: 4, text: "bye" }]);
    expect(parseLrc("[ti:x]\n[00:05.00]二\n[00:01.50]一\n").map((c) => [c.start, c.end, c.text])).toEqual([[1.5, 5, "一"], [5, 9, "二"]]);
    const t = spreadText("短\n这是一个长很多的句子", 0, 10);
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBeGreaterThan(1.2);
    expect(t[1].start).toBeLessThan(3);
  });
});

describe("tools", () => {
  it("opens a clip, flags caption problems and renders the video", async () => {
    const root = await mkdtemp(join(tmpdir(), "audiogram-"));
    await cp(join(HERE, "samples"), join(root, "pod"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("audiogram_open", { inputs: ["pod/茶馆夜话-第12期.mp3", "pod/cover.jpg", "pod/字幕.srt"], project: "ep12", settings: { title: "茶馆夜话 第12期", subtitle: "Penova 播客", clipStart: "00:04", clipEnd: "00:22" } });
    expect(o.text).toMatch(/not after start 00:12\.00/);
    expect(o.text).toMatch(/Overlaps the previous caption/);
    expect(o.data.stats).toMatchObject({ duration: 18, width: 1080, height: 1080 });
    expect(o.data.preview).toContain("data:image/jpeg;base64");
    await c.call("audiogram_edit", { project: "ep12", set: [{ row: 3, values: { 结束: "00:14.80" } }, { row: 5, values: { start: "00:19.00" } }] });
    const st = await c.call("audiogram_status", { project: "ep12" });
    expect(st.text).not.toMatch(/not after start|Overlaps/);
    expect(st.data.stats).toMatchObject({ captions: 5 });
    await c.call("audiogram_export", { project: "ep12" });
    const dir = join(root, "audiogram-maker/ep12");
    const info = await probe(join(dir, "茶馆夜话_第12期.mp4"));
    expect(info.duration).toBeGreaterThan(17.5);
    expect(info.duration).toBeLessThan(18.6);
    expect((await readFile(join(dir, "茶馆夜话_第12期-poster.png"))).subarray(1, 4).toString()).toBe("PNG");
    const srt = await readFile(join(dir, "茶馆夜话_第12期.srt"), "utf8");
    expect(srt).toMatch(/^1\n00:00:00,200 --> 00:00:03,800\n今天我们聊聊茶的起源/);
    expect(srt).not.toContain("片段之外");
    expect((await stat(join(dir, "茶馆夜话_第12期.mp4"))).size).toBeGreaterThan(50_000);
  }, 180_000);
});
