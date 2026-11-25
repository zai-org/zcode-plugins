import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeNeeds, parseTranscript } from "../src/transcript.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const FEISHU = `访谈 - 记账 App 用户 张女士
2026年11月20日

说话人 1 00:00:02
您好，今天想聊聊您平时怎么记账。

张女士 00:00:06
我一般月底才记，平时都是拍小票。
然后月底对着照片一张张输，特别麻烦。

说话人 1 00:00:15
那最麻烦的是哪一步？

张女士 00:00:18
是分类。每次都要自己选“餐饮”还是“日用”，能自动分就好了。
`;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "interview-"));
  await mkdir(join(workspace, "访谈"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:a", "libmp3lame", join(workspace, "访谈/张女士.mp3")]);
  await writeFile(join(workspace, "访谈/张女士.txt"), FEISHU);
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("transcripts", () => {
  it("parses Feishu-style speaker/time headers with multi-line text", () => {
    const u = parseTranscript(FEISHU, "x");
    expect(u.map((x) => [x.start, x.speaker])).toEqual([[2, "说话人 1"], [6, "张女士"], [15, "说话人 1"], [18, "张女士"]]);
    expect(u[1].text).toBe("我一般月底才记，平时都是拍小票。 然后月底对着照片一张张输，特别麻烦。");
    expect(u[1].end).toBe(15);
  });
  it("parses [time] Name: text lines and SRT/VTT speaker prefixes", () => {
    expect(parseTranscript("[00:01:02] Interviewer: Hi\n[00:01:05] Ana：Hello there\ncontinued", "x").map((u) => [u.start, u.speaker, u.text])).toEqual([[62, "Interviewer", "Hi"], [65, "Ana", "Hello there continued"]]);
    const srt = parseTranscript("1\n00:00:01,000 --> 00:00:03,000\nRupika: How are you?\n\n2\n00:00:03,500 --> 00:00:05,000\nI am well.\n\n3\n00:00:06,000 --> 00:00:07,000\nAbhinav: Thanks\n", "x");
    expect(srt.map((u) => u.speaker)).toEqual(["Rupika", "Rupika", "Abhinav"]);
    const vtt = parseTranscript("WEBVTT\n\n00:01.000 --> 00:02.000\n<v Bob>Hi</v>\n", "x");
    expect(vtt[0]).toMatchObject({ speaker: "Bob", text: "Hi", start: 1, end: 2 });
    expect(() => parseTranscript("no times here", "x")).toThrow(/no timestamped lines/);
  });
  it("validates quotes against the transcript", () => {
    const u = parseTranscript(FEISHU, "x");
    const { needs, warnings } = normalizeNeeds([
      { title: "自动分类", priority: "high", quotes: [{ utterance: "u4", text: "能自动分就好了" }, { utterance: "u99" }] },
      { title: "拍照识别", quotes: [{ at: 10, text: "并不存在的话" }] },
      { title: "无引用" },
    ], u);
    expect(needs[0].quotes).toEqual([{ utterance: "u4", text: "能自动分就好了" }]);
    expect(needs[1].quotes[0]).toEqual({ utterance: "u2", text: u[1].text });
    expect(needs[1].priority).toBe("medium");
    expect(warnings.join("\n")).toMatch(/u99[\s\S]*not in u2[\s\S]*无引用/);
  });
});

describe("tools", () => {
  it("opens, submits, saves panel edits and exports", async () => {
    const open = await call("interview_open", { audio: "访谈/张女士.mp3" });
    expect(open.isError).toBeFalsy();
    expect(open.content[0].text).toContain("[u2 00:06 张女士] 我一般月底才记");
    expect(open.structuredContent.session.transcript).toBe("访谈/张女士.txt");
    const sub = await call("interview_submit", {
      audio: "访谈/张女士.mp3",
      speakers: { "说话人 1": "访谈者" },
      needs: [
        { title: "小票拍照后自动录入", category: "功能需求", priority: "high", detail: "月底集中补记，手动输入小票很麻烦", quotes: [{ utterance: "u2", text: "月底对着照片一张张输，特别麻烦" }] },
        { title: "自动分类", category: "痛点", quotes: [{ utterance: "u4", text: "能自动分就好了" }, { utterance: "u7" }] },
      ],
    });
    expect(sub.content[0].text).toMatch(/Saved 2 need\(s\)[\s\S]*! "自动分类": quote "u7"/);
    const s = sub.structuredContent.session;
    expect(s.speakers["说话人 1"]).toBe("访谈者");
    s.needs[1].status = "confirmed";
    s.utterances[0].speaker = "张女士";
    const saved = await call("interview_save", { session: s });
    expect(saved.structuredContent.session.needs[1].status).toBe("confirmed");
    const merged = await call("interview_save", { session: { ...saved.structuredContent.session, speakers: { "说话人 1": "张女士", 张女士: "张女士" } } });
    expect(Object.keys(merged.structuredContent.session.speakers)).toEqual(["说话人 1"]);
    expect(merged.structuredContent.session.utterances.every((u: any) => u.speaker === "说话人 1")).toBe(true);
    await call("interview_save", { session: { ...merged.structuredContent.session, speakers: { "说话人 1": "访谈者" }, utterances: merged.structuredContent.session.utterances.map((u: any, i: number) => ({ ...u, speaker: i % 2 ? "张女士" : "说话人 1" })) } });
    const ex = await call("interview_export", { audio: "访谈/张女士.mp3" });
    expect(ex.structuredContent.files).toEqual(["interviews/张女士.md", "interviews/张女士.csv", "interviews/张女士.html"]);
    const md = await readFile(join(workspace, "interviews/张女士.md"), "utf8");
    expect(md).toContain("> “月底对着照片一张张输，特别麻烦” — 张女士, 00:06");
    expect(md).toContain("**访谈者** [00:15] 那最麻烦的是哪一步？");
    expect(md).toContain("状态: 已确认");
    const csv = await readFile(join(workspace, "interviews/张女士.csv"), "utf8");
    expect(csv.split("\n")[2]).toBe("2,自动分类,痛点,medium,confirmed,,能自动分就好了,张女士,00:18");
    const html = await readFile(join(workspace, "interviews/张女士.html"), "utf8");
    expect(html).toContain('src="../%E8%AE%BF%E8%B0%88/%E5%BC%A0%E5%A5%B3%E5%A3%AB.mp3"');
    expect(html).toContain('data-t="18" data-u="u4"');
    // resubmitting keeps the user's status for the same title
    const again = await call("interview_submit", { audio: "访谈/张女士.mp3", needs: [{ title: "自动分类", quotes: [{ utterance: "u4" }] }] });
    expect(again.structuredContent.session.needs[0].status).toBe("confirmed");
  });
  it("returns an mp3 clip for playback", async () => {
    const r = await call("audio_clip", { audio: "访谈/张女士.mp3", start: 6, end: 15 });
    const buf = Buffer.from(r.structuredContent.data, "base64");
    expect(buf.length).toBeGreaterThan(5000);
    expect(r.structuredContent.offset).toBeCloseTo(5.7);
  });
  it("explains missing transcripts and bad paths", async () => {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1", join(workspace, "solo.wav")]);
    expect((await call("interview_open", { audio: "solo.wav" })).content[0].text).toMatch(/No transcript found.*does not do speech recognition/);
    expect((await call("interview_open", { audio: "../x.mp3" })).isError).toBe(true);
    expect((await call("interview_submit", { audio: "solo.wav", needs: [] })).content[0].text).toMatch(/Open the interview first/);
  });

  it("reports a corrupt recording as bad audio before looking for a transcript", async () => {
    await writeFile(join(workspace, "broken.wav"), "RIFF");
    const result = await call("interview_open", { audio: "broken.wav" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Cannot decode the recording broken\.wav/);
    expect(result.content[0].text).not.toMatch(/No transcript found/);
    expect(result.structuredContent.error.code).toBe("bad_audio");
  });
});
