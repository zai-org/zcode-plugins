import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { probe } from "../src/kit/ffmpeg.ts";
import { plan, createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("plan", () => {
  it("overlaps transitions and fits to music", () => {
    const rows = [1, 2, 3].map((i) => ({ include: true, order: i, file: `${i}.jpg`, seconds: i === 2 ? 5 : "", motion: "auto", caption: "" }));
    const p = { name: "x", inputs: [], rows, meta: { musicDuration: 20 }, settings: { perPhoto: 3, transition: "fade", transitionSec: 1 }, created: "", updated: "" };
    const a = plan(p);
    expect(a.items.map((x) => x.start)).toEqual([0, 2, 6]);
    expect(a.total).toBe(9);
    expect(a.items.map((x) => x.motion)).toEqual(["zoom-in", "pan-right", "zoom-out"]);
    const b = plan({ ...p, settings: { ...p.settings, fitToMusic: true } });
    expect(b.total).toBeCloseTo(20, 5);
  });
});

describe("tools", () => {
  it("sorts by date taken, flags problems and renders", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-"));
    await cp(join(HERE, "samples"), join(root, "trip"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("slideshow_open", { inputs: ["trip/茶园一日"], project: "tea", settings: { title: "茶园一日" } });
    const rows = o.data.rows as { file: string; size: string }[];
    expect(rows.map((r) => r.file.split("/").pop())).toEqual(["IMG_2041.jpg", "IMG_2038.jpg", "IMG_2043.jpg", "IMG_2047.jpg", "IMG_2050 copy.jpg", "IMG_2050.jpg", "IMG_2052.jpg", "IMG_2055.jpg", "IMG_2060.jpg"]);
    expect(rows[2].size).toBe("1067×1600");
    expect(o.text).toMatch(/IMG_2047\.jpg is only 480×320/);
    expect(o.text).toMatch(/duplicate of row #4/);
    expect(o.text).toMatch(/longer than the slideshow/);
    await c.call("slideshow_edit", { project: "tea", set: [{ row: 5, values: { include: false } }, { row: 0, values: { 字幕: "清晨的茶园" } }], settings: { fitToMusic: true } });
    const st = await c.call("slideshow_status", { project: "tea" });
    expect(st.text).not.toMatch(/duplicate/);
    expect(st.data.stats).toMatchObject({ photos: 8, seconds: 24.3 });
    await c.call("slideshow_export", { project: "tea" });
    const dir = join(root, "slideshow-video/tea");
    const v = await probe(join(dir, "茶园一日.mp4"));
    expect(v).toMatchObject({ width: 1920, height: 1080, hasAudio: true });
    expect(v.duration).toBeGreaterThan(23.8);
    expect(v.duration).toBeLessThan(24.8);
    expect((await readFile(join(dir, "茶园一日-storyboard.png"))).subarray(1, 4).toString()).toBe("PNG");
  }, 300_000);
});
