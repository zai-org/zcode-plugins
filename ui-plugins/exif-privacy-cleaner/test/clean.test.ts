import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clean, inspect } from "../src/clean.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = join(HERE, "samples/要发出去的照片");
const read = (f: string) => readFile(join(S, f));

describe("clean", () => {
  it("finds metadata in JPEG, PNG and WebP", async () => {
    const j = inspect(await read("客厅.jpg"));
    expect(j).toMatchObject({ kind: "jpeg", model: "iPhone 15", dateTaken: "2026-11-01 20:10:00", comment: true });
    expect(j.gps!.lat).toBeCloseTo(31.23, 2);
    const p = inspect(await read("截图.png"));
    expect(p.gps!.lon).toBeCloseTo(121.47, 2);
    expect(p.text).toEqual(["Author", "Comment"]);
    expect(inspect(await read("海报.webp")).model).toBe("Pixel 8");
  });
  it("removes everything but keeps orientation and pixels' bytes", async () => {
    const src = await read("rotated.jpg");
    const { data, removed } = clean(src, { mode: "all", keepOrientation: true });
    expect(removed).toEqual(expect.arrayContaining(["EXIF", "comment"]));
    const after = inspect(data);
    expect(after).toMatchObject({ orientation: 6, tags: 1, comment: false });
    expect(after.gps).toBeUndefined();
    expect(Buffer.from(data).includes(Buffer.from("iPhone"))).toBe(false);
    const sos = (b: Uint8Array) => Buffer.from(b).subarray(Buffer.from(b).indexOf(Buffer.from([0xff, 0xda])));
    expect(sos(data).equals(sos(src))).toBe(true);
    expect(inspect(clean(src, { mode: "all", keepOrientation: false }).data).tags).toBe(0);
  });
  it("gps-only keeps camera info", async () => {
    for (const f of ["客厅.jpg", "截图.png", "海报.webp"]) {
      const { data, removed } = clean(await read(f), { mode: "gps", keepOrientation: true });
      expect(removed).toContain("GPS");
      const x = inspect(data);
      expect(x.gps).toBeUndefined();
      expect(x.model).toBeTruthy();
    }
    const png = clean(await read("截图.png"), { mode: "all", keepOrientation: true });
    expect(inspect(png.data)).toMatchObject({ tags: 0, text: [] });
    const webp = clean(await read("海报.webp"), { mode: "all", keepOrientation: true });
    expect(inspect(webp.data).tags).toBe(0);
    expect(new DataView(webp.data.buffer).getUint32(4, true)).toBe(webp.data.length - 8);
  });
});

describe("exifclean tools", () => {
  it("reports and writes cleaned copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "exifclean-"));
    await cp(S, join(root, "分享"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("exifclean_open", { inputs: ["分享"], project: "share" });
    expect(o.data.stats).toMatchObject({ photos: 5, withGps: 4, withMetadata: 5 });
    const row = o.data.rows.findIndex((r: { path: string }) => r.path.endsWith("截图.png"));
    const e = await c.call("exifclean_edit", { project: "share", set: [{ row, values: { clean: false } }] });
    expect(e.data.issues[0].message).toMatch(/still contains its GPS/);
    const x = await c.call("exifclean_export", { project: "share" });
    expect(x.text).toMatch(/Cleaned 4/);
    const cleaned = await readFile(join(root, "exif-privacy-cleaner/share/clean/分享/客厅.jpg"));
    expect(inspect(cleaned).gps).toBeUndefined();
    expect(await readFile(join(root, "exif-privacy-cleaner/share/privacy-report.csv"), "utf8")).toMatch(/客厅\.jpg,31\.23/);
    expect(inspect(await readFile(join(root, "分享/客厅.jpg"))).gps).toBeDefined();
  });
});
