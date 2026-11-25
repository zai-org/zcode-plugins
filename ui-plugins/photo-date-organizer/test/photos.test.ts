import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dateFromName, normalizeDate } from "../src/dates.ts";
import { mp4Created, readExif } from "../src/exif.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = join(HERE, "samples/手机相册");

describe("dates", () => {
  it("reads EXIF, video and file-name dates", async () => {
    const ex = readExif(await readFile(join(S, "PXL_0001.jpg")));
    expect(ex).toMatchObject({ dateTaken: "2026-10-02 09:15:00", make: "Google", model: "Pixel 8" });
    expect(ex.gps!.lat).toBeCloseTo(30.26, 2);
    expect(readExif(await readFile(join(S, "IMG_20261103_101522.jpg"))).dateTaken).toBeUndefined();
    expect(mp4Created(await readFile(join(S, "VID_A.mp4")))!.toISOString()).toBe("2026-09-20T07:30:00.000Z");
    expect(dateFromName("IMG_20261103_101522.jpg")).toBe("2026-11-03 10:15:22");
    expect(dateFromName("Screenshot 2026-11-05 at 10.22.31.png")).toBe("2026-11-05 10:22:31");
    expect(dateFromName("微信图片_20261106.jpg")).toBe("2026-11-06 00:00:00");
    expect(dateFromName("PXL_0001.jpg")).toBeUndefined();
    expect(dateFromName("IMG_20261399_000000.jpg")).toBeUndefined();
    expect(normalizeDate("2024年2月2日 12:00")).toBe("2024-02-02 12:00:00");
    expect(normalizeDate("昨天")).toBeUndefined();
  });
});

describe("photos tools", () => {
  it("plans, organizes and undoes", async () => {
    const root = await mkdtemp(join(tmpdir(), "photos-"));
    await cp(S, join(root, "相册"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("photos_open", { inputs: ["相册"], project: "phone" });
    const by = Object.fromEntries(o.data.rows.map((r: { path: string; source: string; _to: string }) => [r.path.split("/").pop(), [r.source, r._to]]));
    expect(by["PXL_0001.jpg"]).toEqual(["exif", "2026/2026-10/PXL_0001.jpg"]);
    expect(by["DSC_4410.JPG"]).toEqual(["exif", "2025/2025-12/DSC_4410.JPG"]);
    expect(by["Screenshot 2026-11-05 at 10.22.31.png"]).toEqual(["name", "2026/2026-11/Screenshot 2026-11-05 at 10.22.31.png"]);
    expect(by["VID_A.mp4"][0]).toBe("video");
    expect(by["mmexport1762750000000.jpg"]).toEqual(["name", "2025/2025-11/mmexport1762750000000.jpg"]);
    expect(by["无日期.png"][0]).toBe("file");
    expect(o.data.issues.filter((i: { level: string }) => i.level === "warn")).toHaveLength(1);
    const row = o.data.rows.findIndex((r: { path: string }) => r.path.endsWith("无日期.png"));
    const e = await c.call("photos_edit", { project: "phone", settings: { naming: "date" }, set: [{ row, values: { date: "2024年2月2日 12:00" } }] });
    expect(e.data.rows[row]).toMatchObject({ source: "manual", _to: "2024/2024-02/20240202_120000.png" });
    expect(e.data.issues).toHaveLength(0);
    const p1 = e.data.rows.find((r: { path: string }) => r.path.endsWith("PXL_0001.jpg"));
    expect(p1._to).toBe("2026/2026-10/20261002_091500.jpg");
    const x = await c.call("photos_export", { project: "phone" });
    expect(x.text).toMatch(/Moved 8/);
    expect((await stat(join(root, "相册/2026/2026-10/20261002_184012.jpg"))).size).toBeGreaterThan(0);
    expect(await readFile(join(root, "photo-date-organizer/phone/organize-plan.csv"), "utf8")).toMatch(/exif/);
    const again = await c.call("photos_status", { project: "phone" });
    expect(again.data.stats.moves).toBe(0);
    await c.call("photos_export", { project: "phone", formats: ["undo"] });
    expect((await stat(join(root, "相册/PXL_0002.jpg"))).size).toBeGreaterThan(0);
  });
});
