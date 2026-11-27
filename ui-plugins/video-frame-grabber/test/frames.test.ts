import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer, parseScenes, parseTime, pickTimes } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("times", () => {
  it("picks interval and count times and parses scene output", () => {
    expect(pickTimes("interval", 30, { interval: 10, count: 0, skipStart: 0, skipEnd: 0 })).toEqual([0, 10, 20]);
    expect(pickTimes("count", 40, { interval: 0, count: 4, skipStart: 0, skipEnd: 0 })).toEqual([4.99, 14.98, 24.97, 34.96]);
    expect(parseScenes("frame:0 pts:1 pts_time:7\nlavfi.scene_score=1.000000\nframe:1 pts:2 pts_time:13.04\nlavfi.scene_score=0.077\n")).toEqual([{ t: 7, score: 1 }, { t: 13.04, score: 0.077 }]);
    expect(parseTime("1:02.5")).toBe(62.5);
  });
});

describe("tools", () => {
  it("finds slide changes, flags issues and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "frames-"));
    await cp(join(HERE, "samples"), join(root, "v"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("frames_open", { inputs: ["v/茶课第3讲.mp4"], project: "talk" });
    expect(o.text).toMatch(/lower sceneThreshold/);
    const e = await c.call("frames_edit", { project: "talk", settings: { sceneThreshold: 0.03 } });
    const rows = e.data.rows as { time: string }[];
    expect(rows.map((r) => Math.round(parseTime(r.time)))).toEqual([1, 7, 15, 22, 29]);
    await c.call("frames_edit", { project: "talk", set: [{ row: 0, values: { 标签: "封面" } }], add: [{ time: "00:40.00" }] });
    const st = await c.call("frames_status", { project: "talk" });
    expect(st.text).toMatch(/after the end/);
    await c.call("frames_edit", { project: "talk", remove: [5] });
    await c.call("frames_export", { project: "talk" });
    const dir = join(root, "video-frame-grabber/talk");
    const files = (await readdir(join(dir, "frames"))).sort();
    expect(files).toHaveLength(5);
    expect(files[0]).toBe("茶课第3讲-001-00-00.50-封面.jpg");
    expect((await readFile(join(dir, "contact-sheet.png"))).subarray(1, 4).toString()).toBe("PNG");
    expect(await readFile(join(dir, "frames.csv"), "utf8")).toContain("frames/茶课第3讲-001-00-00.50-封面.jpg");
  }, 180_000);
});
