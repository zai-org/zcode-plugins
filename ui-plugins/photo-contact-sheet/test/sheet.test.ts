import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { decodeImage } from "../src/kit/raster.ts";
import { caption, fit, grid, pageSize } from "../src/sheet.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("layout", () => {
  it("builds the grid and fits photos", () => {
    expect(pageSize({ page: "A4", landscape: true }).map(Math.round)).toEqual([842, 595]);
    const g = grid({ page: "A4", landscape: false, cols: 4, rows: 5, margin: 10, gap: 4, header: true, captionLines: 1, captionSize: 7 });
    expect(g.cells).toHaveLength(20);
    expect(Math.round(g.cells[0].x)).toBe(28);
    expect(Math.round(g.cells[0].y)).toBe(56);
    expect(Math.round(g.cells[1].x - g.cells[0].x - g.cells[0].w)).toBe(11);
    expect(Object.values(fit({ w: 600, h: 400 }, { w: 100, h: 100 }, "contain")).map((v) => Math.round(v * 100) / 100)).toEqual([100, 66.67, 0, 33.33]);
    expect(fit({ w: 600, h: 400 }, { w: 100, h: 100 }, "cover")).toMatchObject({ w: 150, h: 100, dx: -25, dy: 0 });
    expect(caption("{n}. {name} ({w}×{h}) {x}", { n: 3, name: "IMG_1", w: 600, h: 400 })).toBe("3. IMG_1 (600×400) {x}");
  });
});

describe("tools", () => {
  it("lays out, reorders, excludes and exports PDF, JPG and CSV", async () => {
    const root = await mkdtemp(join(tmpdir(), "cs-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("contact_open", { inputs: ["shoot"], project: "s", settings: { cols: 4, rows: 2, title: "茶馆拍摄 2026-11-20" } });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => String(r.file).split("/").pop())).toEqual(["IMG_0412.jpg", "IMG_0413.jpg", "IMG_0415.jpg", "IMG_0418.jpg", "IMG_0420.jpg", "IMG_0421.jpg", "IMG_0425.jpg", "IMG_0430.png", "竖拍-门口.jpg", "细节-茶杯.jpg"]);
    expect(r0.data.stats).toMatchObject({ photos: 10, pages: 2 });
    expect(String(r0.data.preview)).toContain("data:image/png;base64,");
    await c.call("contact_edit", { project: "s", set: [{ row: 8, values: { 顺序: 0, caption: "门口（竖拍）" } }, { row: 1, values: { include: false } }, { row: 7, values: { include: false } }], settings: { caption: "{n}. {caption}" } });
    const r1 = await c.call("contact_status", { project: "s" });
    expect(r1.data.stats).toMatchObject({ photos: 8, pages: 1 });
    expect((r1.data.rows as Record<string, unknown>[])[8].page).toBe(1);
    await c.call("contact_export", { project: "s" });
    const out = join(root, "photo-contact-sheet", "s");
    const pdf = await PDFDocument.load(await readFile(join(out, "contact-sheet.pdf")));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("茶馆拍摄 2026-11-20");
    const jpg = decodeImage(new Uint8Array(await readFile(join(out, "contact-sheet-1.jpg"))));
    expect([jpg.width, jpg.height]).toEqual([1240, 1754]);
    const csv = String(await readFile(join(out, "contact-sheet.csv")));
    expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 3)).toEqual(["number,file,page,caption,size", "1,shoot/竖拍-门口.jpg,1,1. 门口（竖拍）,400x600", "2,shoot/IMG_0412.jpg,1,2. IMG_0412,600x400"]);
    expect(csv).not.toContain("IMG_0413");
  }, 60_000);
});
