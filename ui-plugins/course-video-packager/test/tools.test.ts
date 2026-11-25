import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeProject } from "../src/course.ts";
import { digest, gaps, parseSubtitles, sliceCues, toSrt } from "../src/subs.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const dur = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const SRT = `1
00:00:01,000 --> 00:00:04,000
欢迎来到第一课。

2
00:00:05,000 --> 00:00:08,500
今天讲电路的基本概念。

3
00:00:12,000 --> 00:00:15,000
第二部分：欧姆定律。

4
00:00:16,000 --> 00:00:19,500
电压等于电流乘以电阻。
`;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "course-"));
  await mkdir(join(workspace, "lec"));
  // 20 秒：0–9 有声，9–11.5 静音，11.5–20 有声
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=20", "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-af", "volume='if(between(t,9,11.5),0,1)':eval=frame", "-shortest", "-pix_fmt", "yuv420p", join(workspace, "lec/第1讲.mp4")]);
  await writeFile(join(workspace, "lec/第1讲.srt"), SRT);
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("subtitles", () => {
  it("parses SRT and VTT, slices and re-times", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(4);
    const vtt = parseSubtitles("WEBVTT\n\nNOTE x\n\n00:01.000 --> 00:02.500 align:start\n<v Bob>Hi</v>\n");
    expect(vtt).toEqual([{ start: 1, end: 2.5, text: "Hi" }]);
    const part = sliceCues(cues, 10, 20);
    expect(part.map((c) => c.start)).toEqual([2, 6]);
    expect(toSrt(part)).toContain("00:00:02,000 --> 00:00:05,000\n第二部分：欧姆定律。");
    expect(gaps(cues)).toEqual([{ at: 10.3, length: 3.5 }]);
    expect(digest(cues, 10)).toMatch(/^\[00:01\] 欢迎来到第一课。 今天讲电路的基本概念。\n\[00:12\]/);
  });
  it("normalizes chapters", () => {
    const { project, warnings } = normalizeProject({ video: "v.mp4", chapters: [{ title: "B", start: "0:12" }, { title: "A", start: 0 }, { title: "C", start: 14 }, { title: "D", start: 99 }] }, 20);
    expect(project.chapters.map((c) => [c.title, c.start, c.end])).toEqual([["A", 0, 12], ["B", 12, 20]]);
    expect(warnings.join("\n")).toMatch(/after the video ends[\s\S]*merged/);
  });
});

describe("tools", () => {
  it("opens with silences, subtitle gaps and a transcript digest", async () => {
    const r = await call("course_open", { video: "lec/第1讲.mp4" });
    expect(r.isError, r.content[0].text).toBeFalsy();
    expect(r.structuredContent.project.subtitles).toBe("lec/第1讲.srt");
    expect(r.content[0].text).toMatch(/00:10 \(silence 2\.5s\)/);
    expect(r.content[0].text).toContain("[00:01] 欢迎来到第一课。");
  });
  it("builds chapters, subtitles, covers, index and zip", async () => {
    const project = { video: "lec/第1讲.mp4", subtitles: "lec/第1讲.srt", title: "电路基础", author: "Penova 学院", chapters: [{ title: "课程介绍", start: 0, summary: "这门课讲什么" }, { title: "欧姆定律", start: "0:10.3" }], output: "发布包" };
    const r = await call("course_build", { project });
    expect(r.isError, r.content[0].text).toBeFalsy();
    const rows = r.structuredContent.rows;
    expect(rows.map((x: any) => x.file)).toEqual(["chapters/01-课程介绍.mp4", "chapters/02-欧姆定律.mp4"]);
    expect(dur(join(workspace, "发布包/chapters/01-课程介绍.mp4"))).toBeCloseTo(10.3, 0);
    expect(dur(join(workspace, "发布包/chapters/02-欧姆定律.mp4"))).toBeCloseTo(9.7, 0);
    const srt2 = await readFile(join(workspace, "发布包/chapters/02-欧姆定律.srt"), "utf8");
    expect(srt2).toMatch(/^1\n00:00:01,700 --> 00:00:04,700\n第二部分：欧姆定律。/);
    const md = await readFile(join(workspace, "发布包/index.md"), "utf8");
    expect(md).toContain("```\n00:00 课程介绍\n00:10 欧姆定律\n```");
    expect(md).toContain("这门课讲什么");
    const zip = unzipSync(new Uint8Array(await readFile(join(workspace, "发布包/电路基础.zip"))));
    expect(Object.keys(zip).sort()).toEqual(["chapters.csv", "chapters.json", "chapters/01-课程介绍.mp4", "chapters/01-课程介绍.srt", "chapters/01-课程介绍.vtt", "chapters/02-欧姆定律.mp4", "chapters/02-欧姆定律.srt", "chapters/02-欧姆定律.vtt", "cover.jpg", "covers/01-课程介绍.jpg", "covers/02-欧姆定律.jpg", "index.md"]);
    expect(zip["cover.jpg"].subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
    const saved = JSON.parse(await readFile(join(workspace, "发布包/course.json"), "utf8"));
    expect(saved.chapters[1].start).toBe(10.3);
    const reopen = await call("course_open", { project: "发布包/course.json" });
    expect(reopen.structuredContent.project.chapters).toHaveLength(2);
  });
  it("fast copy mode and errors", async () => {
    const r = await call("course_build", { project: { video: "lec/第1讲.mp4", title: "快", mode: "copy", chapters: [{ title: "全部", start: 0 }], output: "fast" } });
    expect(r.isError, r.content[0].text).toBeFalsy();
    expect((await call("course_open", { video: "../a.mp4" })).structuredContent.error.code).toBe("outside_workspace");
    expect((await call("course_open", { video: "lec/第1讲.srt" })).structuredContent.error.code).toBe("bad_video");
  });
});
