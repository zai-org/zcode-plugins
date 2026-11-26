import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { contrast, guess, matrix, payload } from "../src/qr.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("payloads", () => {
  it("builds WiFi, vCard, tel and URL payloads", () => {
    expect(payload("wifi", "Cafe;p@ss;word;WPA").text).toBe("WIFI:T:WPA;S:Cafe;P:p@ss;;")
    expect(payload("wifi", "My;Net;secret").text).toBe("WIFI:T:WPA;S:My;P:Net;;");
    expect(payload("wifi", "Open Net").text).toBe("WIFI:T:nopass;S:Open Net;;");
    expect(payload("vcard", "林小满;+86 138 0000 1234;a@b.co;Penova").text).toBe("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:林小满\r\nN:林小满;;;;\r\nORG:Penova\r\nTEL;TYPE=CELL:+8613800001234\r\nEMAIL:a@b.co\r\nEND:VCARD");
    expect(payload("phone", "+1 (307) 555-0142").text).toBe("tel:+13075550142");
    expect(payload("url", "penova.example/a")).toEqual({ text: "https://penova.example/a", warn: expect.any(String) });
    expect([guess("www.x.com"), guess("a@b.cn"), guess("+86 138 0000"), guess("你好")]).toEqual(["url", "email", "phone", "text"]);
  });
  it("encodes, and rejects content that is too long", () => {
    expect(matrix("https://penova.example/", "M").size).toBe(25);
    expect(() => matrix("x".repeat(3000), "H")).toThrow(/too long/);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("qr tools", () => {
  it("opens the sample list with a logo, flags problems, exports PNG/SVG/PDF", async () => {
    const ws = await mkdtemp(join(tmpdir(), "qr-"));
    await cp(join(HERE, "samples"), join(ws, "门店"), { recursive: true });
    const { call } = await connect(createServer({ workspaceRoot: ws, assetRoot: join(HERE, "..") }));
    const r = await call("qr_open", { inputs: ["门店/qr-list.xlsx", "门店/logo.png"], project: "门店码", settings: { size: "600" } });
    expect(r.data.totalRows).toBe(9);
    expect(r.data.rows[2]._payload).toBe("WIFI:T:WPA;S:Penova-Guest;P:welcome2026;;");
    const kinds = r.data.issues.map((i: any) => `${i.level}:${i.row ?? i.key}`);
    expect(kinds).toEqual(expect.arrayContaining(["warn:ecc", "warn:7", "error:8"]));
    await expect(call("qr_export", { project: "门店码" })).rejects.toMatchObject({ code: "has_errors" });
    await call("qr_edit", { project: "门店码", remove: [8], settings: { ecc: "H" } });
    const out = await call("qr_export", { project: "门店码" });
    const files: string[] = out.data.exported;
    expect(files.filter((f) => f.endsWith(".png"))).toHaveLength(8);
    expect(files.some((f) => f.endsWith("访客 WiFi.svg"))).toBe(true);
    const img = PNG.sync.read(await readFile(join(ws, files.find((f) => f.endsWith("官网首页.png"))!)));
    expect(img.width).toBeGreaterThanOrEqual(500);
    // 左上角定位图案是深色，中心有 Logo 底板（白色）
    const at = (x: number, y: number) => img.data[(y * img.width + x) * 4];
    const unit = img.width / (matrix("https://penova.example/", "H").size + 8);
    expect(at(Math.round(unit * 4.5), Math.round(unit * 4.5))).toBeLessThan(60);
    expect((await readFile(join(ws, files.find((f) => f.endsWith("qr-sheet.pdf"))!))).subarray(0, 4).toString()).toBe("%PDF");
  });
});
