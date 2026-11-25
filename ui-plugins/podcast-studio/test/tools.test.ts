import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { afterCuts, keptSegments, normalizeProject } from "../src/project.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 })) as any;
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const dur = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(workspace, f)]).toString());
const ebur = (f: string) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", join(workspace, f), "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  return Number([...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()![1]);
};

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "podcast-"));
  await mkdir(join(workspace, "ep12"));
  // 主持人：40 秒断续的粉噪声（像说话，30–35 秒静音）；嘉宾：主持人声音的串音（晚 1.23 秒、-15 dB）+ 自己的断续声音
  const gate = "volume='if(between(t,30,35),0,if(lt(mod(t*1.7,3),1.1),1,0.03))':eval=frame";
  ff("-f", "lavfi", "-i", "anoisesrc=d=40:c=pink:a=0.25:seed=7", "-af", `lowpass=f=3000,${gate}`, "-ar", "44100", join(workspace, "ep12/host.wav"));
  ff("-i", join(workspace, "ep12/host.wav"), "-f", "lavfi", "-i", "anoisesrc=d=42:c=brown:a=0.3:seed=3", "-filter_complex",
    "[0:a]adelay=1230:all=1,volume=-15dB[a];[1:a]volume='if(between(t,31,36.5),0,if(lt(mod(t*1.3+1,3),0.9),1,0.02))':eval=frame[b];[a][b]amix=inputs=2:normalize=0:duration=longest", "-ar", "48000", join(workspace, "ep12/guest.m4a"));
  ff("-f", "lavfi", "-i", "sine=frequency=660:duration=3", "-ac", "2", join(workspace, "intro.mp3"));
  ff("-f", "lavfi", "-i", "sine=frequency=440:duration=2", join(workspace, "outro.wav"));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("project", () => {
  const d = { "a.wav": 100, "b.wav": 98 };
  it("normalises offsets, times and cuts", () => {
    const { project, warnings } = normalizeProject({ tracks: [{ file: "a.wav", offset: 1.5 }, { file: "b.wav", offset: "0:02.25", gain: 99 }], cuts: [{ start: "1:00", end: "0:50" }, { start: 55, end: 70, note: "x" }, { start: 200, end: 300 }, { start: 10, end: 12 }], loudness: -40, format: "nope" }, d);
    expect(project.tracks.map((t) => [t.offset, t.gain])).toEqual([[0, 0], [0.75, 20]]);
    expect(project.cuts).toEqual([{ start: 10, end: 12, note: "" }, { start: 50, end: 70, note: "x" }]);
    expect(project).toMatchObject({ loudness: -30, format: "mp3", denoise: "light", output: "podcast", title: "Episode" });
    expect(warnings).toHaveLength(1);
    expect(() => normalizeProject({ tracks: [{ file: "a.wav" }], cuts: [{ start: 0, end: 100 }] }, d)).toThrow(/whole episode/);
    expect(() => normalizeProject({ tracks: [{ file: "c.wav" }] }, d)).toThrow(/was not opened/);
  });
  it("maps recording time to episode time", () => {
    const cuts = [{ start: 10, end: 12, note: "" }, { start: 50, end: 70, note: "" }];
    expect(keptSegments(cuts, 100)).toEqual([[0, 10], [12, 50], [70, 100]]);
    expect([afterCuts(5, cuts), afterCuts(11, cuts), afterCuts(60, cuts), afterCuts(80, cuts)]).toEqual([5, 10, 48, 58]);
  });
});

describe("tools", () => {
  let project: any;
  it("opens and aligns the tracks, finds the pause", async () => {
    const r = await call("podcast_open", { tracks: ["ep12/host.wav", "ep12/guest.m4a"], title: "第12期 播客" });
    expect(r.isError).toBeFalsy();
    project = r.structuredContent.project;
    const [host, guest] = project.tracks;
    expect(host.offset - guest.offset).toBeCloseTo(1.23, 2);
    expect(r.structuredContent.confidences[1]).toBeGreaterThan(1.25);
    expect(r.structuredContent.pauses.some((p: any) => p.start <= 32.5 && p.end >= 35)).toBe(true);
    expect(r.content[0].text).toMatch(/guest: -1\.23\d s vs host/);
    expect(await readFile(join(workspace, "podcast/第12期 播客.podcast.json"), "utf8")).toContain("ep12/guest.m4a");
  });
  it("renders with cuts, intro/outro and loudness normalisation", async () => {
    const saved = await call("podcast_save", { project: { ...project, cuts: [{ start: "0:05", end: "0:10", note: "跑题" }, { start: 31.5, end: 35.5 }], intro: "intro.mp3", outro: "outro.wav", format: "both", denoise: "strong" } });
    expect(saved.content[0].text).toMatch(/2 cut\(s\) removing 0:09\.0/);
    const r = await call("podcast_render", { project: saved.structuredContent.project });
    expect(r.isError).toBeFalsy();
    const total = saved.structuredContent.total;
    expect(r.structuredContent.files).toEqual(["podcast/第12期 播客.mp3", "podcast/第12期 播客.wav", "podcast/第12期 播客.cuts.md"]);
    expect(dur("podcast/第12期 播客.wav")).toBeCloseTo(3 + total - 9 + 2, 0);
    expect(Math.abs(ebur("podcast/第12期 播客.wav") + 16)).toBeLessThan(1);
    expect(Math.abs(r.structuredContent.loudness + 16)).toBeLessThan(1);
    const md = await readFile(join(workspace, "podcast/第12期 播客.cuts.md"), "utf8");
    expect(md).toContain("| 0:05.0 – 0:10.0 | 5.0 s | 0:08.0 | 跑题 |");
    const tags = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags=title", "-of", "csv=p=0", join(workspace, "podcast/第12期 播客.mp3")]).toString().trim();
    expect(tags).toBe("第12期 播客");
  });
  it("previews and reports errors", async () => {
    const p = await call("preview", { project, start: 3, length: 5 });
    expect(Buffer.from(p.structuredContent.data, "base64").length).toBeGreaterThan(20000);
    const w = await call("waveform", { file: "ep12/host.wav" });
    expect(Buffer.from(w.structuredContent.data, "base64").length).toBe(400);
    expect((await call("podcast_open", { tracks: ["nope.wav"] })).content[0].text).toMatch(/file not found/);
    expect((await call("podcast_save", { project: { ...project, tracks: project.tracks.map((t: any) => ({ ...t, mute: true })) } })).content[0].text).toMatch(/All tracks are muted/);
  });
});
