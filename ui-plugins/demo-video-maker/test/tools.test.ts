import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeProject, toSrt } from "../src/project.ts";
import { scaleCropExprs } from "../src/render.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const probe = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).toString());
const gen = (file: string, seconds: number, extra: string[] = []) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${seconds}`, ...extra, "-pix_fmt", "yuv420p", file]);

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "demo-"));
  await mkdir(join(workspace, "rec"));
  gen(join(workspace, "rec/login.mp4"), 4);
  gen(join(workspace, "rec/report.mp4"), 3, ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest"]);
  gen(join(workspace, "rec/report-v2.mp4"), 5);
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("project", () => {
  it("clamps times, squares zoom boxes and shortens overlapping zooms", () => {
    const { project, warnings } = normalizeProject(
      { segments: [{ source: "a.mp4", start: 1, end: 99, zooms: [{ at: 0, duration: 3, x: 0.9, y: 0.1, w: 0.3, h: 0.2 }, { at: 2, duration: 2, x: 0, y: 0, w: 0.5, h: 0.5 }], callouts: [{ at: 50, text: "Click Save" }, { at: 1, text: "" }] }] },
      new Map([["a.mp4", 10]]),
    );
    const s = project.segments[0];
    expect([s.start, s.end]).toEqual([1, 10]);
    expect(s.zooms[0]).toMatchObject({ w: 0.3, h: 0.3, x: 0.7, duration: 2 });
    expect(s.callouts).toHaveLength(1);
    expect(s.callouts[0].at).toBeLessThan(9);
    expect(warnings.join("\n")).toMatch(/past the end[\s\S]*overlapped[\s\S]*after the segment ends/);
  });
  it("rejects unknown sources", () => {
    expect(() => normalizeProject({ segments: [{ source: "x.mp4" }] }, new Map())).toThrow(/not a readable video/);
  });
  it("writes SRT offset by the intro and earlier segments", () => {
    const { project } = normalizeProject({ intro: { title: "T", seconds: 2 }, segments: [{ source: "a.mp4", end: 4 }, { source: "a.mp4", start: 0, end: 3, subtitles: [{ at: 1, duration: 1.5, text: "第二段字幕" }] }] }, new Map([["a.mp4", 10]]));
    expect(toSrt(project)).toBe("1\n00:00:07,000 --> 00:00:08,500\n第二段字幕\n");
  });
  it("builds per-frame scale/offset expressions", () => {
    const e = scaleCropExprs({ zooms: [{ at: 1, duration: 2, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] } as any, 1920, 1080);
    expect(e.zoomScale.w).toContain("1.0000*");
    expect(e.offX).toMatch(/^-clip\(/);
    expect(e.offX).not.toContain("iw");
  });
});

describe("tools", () => {
  it("opens recordings as a draft", async () => {
    const r = await call("demo_open", { recordings: ["rec/login.mp4", "rec/report.mp4"] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.project.segments.map((s: any) => [s.id, s.end])).toEqual([["s1", 4], ["s2", 3]]);
    expect(r.content[0].text).toContain("zooms");
  });
  it("renders, then re-renders only the replaced segment", async () => {
    const project = {
      size: "1280x720",
      fps: 30,
      intro: { title: "三步生成月度报表", subtitle: "Penova Reports · 产品演示" },
      segments: [
        { id: "login", source: "rec/login.mp4", start: 0.5, end: 3.5, zooms: [{ at: 0.5, duration: 2, x: 0.1, y: 0.1, w: 0.4, h: 0.4 }], callouts: [{ at: 0.2, duration: 2.5, text: "用工作邮箱登录" }] },
        { id: "report", source: "rec/report.mp4", subtitles: [{ at: 0, duration: 2, text: "点击“生成报表”，等几秒即可下载。" }] },
      ],
      output: "out/demo.mp4",
    };
    const saved = await call("demo_save", { path: "out/demo", project });
    expect(saved.structuredContent.path).toBe("out/demo.demovideo.json");
    const r = await call("demo_render", { path: "out/demo.demovideo.json" });
    expect(r.isError, r.content[0].text).toBeFalsy();
    expect(r.structuredContent.fresh).toEqual(["intro", "login", "report"]);
    const p = probe(join(workspace, "out/demo.mp4"));
    expect(Number(p.format.duration)).toBeCloseTo(3 + 3 + 3, 0);
    expect(p.streams.find((s: any) => s.codec_type === "video")).toMatchObject({ width: 1280, height: 720, codec_name: "h264" });
    expect(p.streams.some((s: any) => s.codec_type === "audio")).toBe(true);
    expect((await stat(join(workspace, "out/demo.srt"))).size).toBeGreaterThan(10);

    const again = await call("demo_render", { path: "out/demo.demovideo.json" });
    expect(again.structuredContent.fresh).toEqual([]);
    const rep = await call("demo_replace_segment", { path: "out/demo.demovideo.json", segment: "report", source: "rec/report-v2.mp4" });
    expect(rep.isError).toBeFalsy();
    const third = await call("demo_render", { path: "out/demo.demovideo.json" });
    expect(third.structuredContent.fresh).toEqual(["report"]);
    expect(third.structuredContent.reused).toEqual(["intro", "login"]);
    expect(Number(probe(join(workspace, "out/demo.mp4")).format.duration)).toBeCloseTo(3 + 3 + 5, 0);
  });
  it("zooms toward the requested area, not the top-left corner", async () => {
    // 左半黑、右半白：放大右侧区域时，中间帧应几乎全白。
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=3", "-vf", "drawbox=x=640:y=0:w=640:h=720:color=white:t=fill", "-pix_fmt", "yuv420p", join(workspace, "rec/halves.mp4")]);
    const project = { size: "1280x720", fps: 30, segments: [{ id: "z", source: "rec/halves.mp4", zooms: [{ at: 0.5, duration: 2, x: 0.6, y: 0.3, w: 0.35, h: 0.35 }] }], output: "out/zoom.mp4" };
    await call("demo_save", { path: "out/zoom", project });
    const r = await call("demo_render", { path: "out/zoom.demovideo.json" });
    expect(r.isError, r.content[0].text).toBeFalsy();
    const gray = execFileSync("ffmpeg", ["-v", "error", "-ss", "1.5", "-i", join(workspace, "out/zoom.mp4"), "-frames:v", "1", "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"]);
    const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
    expect(mean).toBeGreaterThan(200);
  });
  it("gives frames and rejects bad input", async () => {
    const f = await call("frame", { source: "rec/login.mp4", t: 1, width: 1280, height: 720 });
    expect(Buffer.from(f.structuredContent.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect((await call("demo_open", { recordings: ["../x.mp4"] })).structuredContent.error.code).toBe("outside_workspace");
    expect((await call("demo_open", { recordings: ["rec/nope.txt"] })).structuredContent.error.code).toBe("bad_video");
    expect((await call("demo_replace_segment", { path: "out/demo.demovideo.json", segment: "zz", source: "rec/login.mp4" })).structuredContent.error.code).toBe("bad_segment");
  });
});
