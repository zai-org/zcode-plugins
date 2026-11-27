import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { args, estimate, outSize, targetKbps, type Plan, type Src } from "../src/plan.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const S: Src = { width: 1920, height: 1080, fps: 30, duration: 60, bytes: 200 * 1048576, hasAudio: true };
const P: Plan = { preset: "balanced", targetMB: 10, maxHeight: 720, audio: "aac128", speed: "medium" };
const info = (f: string) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "csv=p=0", f]).toString().trim();

describe("plan", () => {
  it("sizes, bitrates and ffmpeg arguments", () => {
    expect(outSize(S, 720)).toEqual({ w: 1280, h: 720 });
    expect(outSize({ ...S, width: 1279, height: 721 }, 0)).toEqual({ w: 1278, h: 720 });
    expect(outSize(S, 2160)).toEqual({ w: 1920, h: 1080 });
    expect(targetKbps(S, { ...P, targetMB: 10 })).toEqual({ video: 1242, audio: 128 });
    expect(Math.round(estimate(S, P) / 1048576)).toBe(16);
    expect(estimate(S, { ...P, preset: "target" })).toBe(10 * 1048576);
    const a = args("in.mov", "out.mp4", S, P);
    expect(a.join(" ")).toBe("-i in.mov -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -pix_fmt yuv420p -vf scale=-2:720:flags=lanczos -crf 23 -c:a aac -b:a 128k -movflags +faststart -map_metadata 0 out.mp4");
    const p1 = args("in.mov", "out.mp4", S, { ...P, preset: "target" }, { n: 1, log: "/tmp/x" });
    expect(p1.join(" ")).toContain("-b:v 1242k -maxrate 1863k -bufsize 2484k -pass 1 -passlogfile /tmp/x -an -f null -");
    expect(args("a", "b", { ...S, hasAudio: false }, { ...P, maxHeight: 0 }).join(" ")).toContain("-vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -crf 23 -an");
  });
});

describe("tools", () => {
  it("compresses a folder with per-file presets and a report", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("vcompress_open", { inputs: ["videos"], project: "v", settings: { speed: "veryfast" } });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => String(r.file))).toEqual(["videos/screen.mov", "videos/产品演示.mp4"]);
    expect(rows[1].info).toMatch(/^960×540 · 0:03\.0 · 0\.68 MB · 1\.\d Mbps$/);
    await c.call("vcompress_edit", { project: "v", set: [{ row: 0, values: { preset: "target", targetMB: 1 } }, { row: 1, values: { 方案: "target", targetMB: 0.25, maxHeight: "360", audio: "aac64", name: "demo-small" } }] });
    const r1 = await c.call("vcompress_status", { project: "v" });
    expect((r1.data.rows as Record<string, unknown>[])[1].estimate).toBe("640×360 · 0.25 MB (−63%)");
    const r = await c.call("vcompress_export", { project: "v" });
    const out = join(root, "video-compressor", "v", "compressed");
    const small = join(out, "demo-small.mp4");
    expect(info(small)).toBe("h264,640,360");
    const size = (await stat(small)).size;
    expect(size).toBeGreaterThan(0.25 * 1048576 * 0.6);
    expect(size).toBeLessThan(0.25 * 1048576 * 1.25);
    // 已经很小的录屏：保留原文件
    expect((await stat(join(out, "screen.mov"))).size).toBe((await stat(join(root, "videos/screen.mov"))).size);
    expect(r.text).toContain("already well compressed");
    const csv = String(await readFile(join(root, "video-compressor", "v", "compress-report.csv")));
    expect(csv).toMatch(/videos\/产品演示\.mp4,demo-small\.mp4,target,0\.25,960x540,640x360,aac64,0\.68,0\.\d\d,\d+%/);
    expect(csv).toContain("kept original (already small)");
  }, 120_000);
});
