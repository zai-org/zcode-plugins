import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { args, filters, parseSec, shrink, type Job } from "../src/gif.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const J: Job = { start: 1, end: 3, fps: 12, width: 641, speed: 2, format: "gif", colors: 64, dither: "bayer", quality: 70, loop: true, reverse: false };
const frames = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width", "-of", "csv=p=0", f]).toString().trim().split(",")[1]);
const width = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", f]).toString().trim());

describe("parameters", () => {
  it("parses times and builds ffmpeg arguments", () => {
    expect(parseSec("2.5")).toBe(2.5);
    expect(parseSec("1:05.5")).toBe(65.5);
    expect(parseSec("")).toBe(null);
    expect(parseSec("abc")).toBe(null);
    expect(filters(J, 1920)).toEqual({ chain: "setpts=PTS/2,fps=12,scale=640:-2:flags=lanczos", width: 640 });
    expect(filters({ ...J, width: 4000 }, 640).width).toBe(640);
    const a = args("in.mp4", "out.gif", J, 1920);
    expect(a.slice(0, 6)).toEqual(["-ss", "1.000", "-t", "2.000", "-i", "in.mp4"]);
    expect(a.join(" ")).toContain("palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4");
    expect(args("in.mp4", "o.webp", { ...J, format: "webp", loop: false }, 1920).join(" ")).toContain("-c:v libwebp_anim -lossless 0 -q:v 70 -compression_level 6 -loop 1");
    expect(shrink(J, 2)).toMatchObject({ fps: 8 });
    expect(shrink({ ...J, fps: 8 }, 1.5)).toMatchObject({ width: 523 });
  });
});

describe("tools", () => {
  it("trims, resizes and encodes GIF and WebP with ffmpeg", async () => {
    const root = await mkdtemp(join(tmpdir(), "gif-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("gif_open", { inputs: ["clips"], project: "g" });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].info).toBe("640×360 · 0:06.0 · 24 fps");
    expect(String(r0.data.preview)).toContain("data:image/jpeg;base64,");
    const r1 = await c.call("gif_edit", { project: "g", set: [{ row: 0, values: { start: "1", end: "0:03", 宽度: 320, fps: 10 } }], settings: { colors: 64 } });
    expect((r1.data.rows as Record<string, unknown>[])[0].estimate).toBe("320×180 · 20f · ≈0.3MB");
    await c.call("gif_edit", { project: "g", add: [{ start: 0, end: 2, speed: 2, format: "webp", name: "demo-fast", reverse: true }] });
    const bad = await c.call("gif_edit", { project: "g", set: [{ row: 1, values: { end: "x" } }] });
    expect(JSON.stringify(bad.data.issues)).toContain("结束时间格式不对");
    await c.call("gif_edit", { project: "g", set: [{ row: 1, values: { end: "2" } }] });
    await c.call("gif_export", { project: "g" });
    const out = join(root, "gif-maker", "g");
    expect(frames(join(out, "demo.gif"))).toBe(20);
    expect(width(join(out, "demo.gif"))).toBe(320);
    expect((await stat(join(out, "demo.gif"))).size).toBeLessThan(1024 * 1024);
    const webp = await readFile(join(out, "demo-fast.webp"));
    expect(webp.subarray(0, 4).toString()).toBe("RIFF");
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");
    expect(webp.includes(Buffer.from("ANIM"))).toBe(true);
    const csv = String(await readFile(join(out, "gif-report.csv")));
    expect(csv).toMatch(/clips\/demo\.mp4,demo\.gif,0:01\.0,0:03\.0,1,10,320,64,\d+,1/);
    // 体积上限：自动降帧率重来
    await c.call("gif_edit", { project: "g", set: [{ row: 1, values: { format: "gif", width: 640, speed: 1, end: "6" } }], settings: { maxMB: 0.4, fps: 15 } });
    const r = await c.call("gif_export", { project: "g" });
    expect((await stat(join(out, "demo-fast.gif"))).size).toBeLessThanOrEqual(0.4 * 1048576);
    expect(r.text).toMatch(/re-encoded at|still/);
  }, 120_000);
});
