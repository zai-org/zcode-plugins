import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { qrText } from "../src/cards.ts";
import { checkChar, generate, verify } from "../src/codes.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("codes", () => {
  it("generates unique, verifiable codes from a seed", () => {
    const a = generate({ seed: "s", batch: "b", prefix: "D12", pattern: "XXXX-XXXX", charset: "safe", checksum: true, count: 500, taken: new Set() });
    const b = generate({ seed: "s", batch: "b", prefix: "D12", pattern: "XXXX-XXXX", charset: "safe", checksum: true, count: 500, taken: new Set() });
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(500);
    for (const c of a) {
      expect(c).toMatch(/^D12-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{5}$/);
      expect(verify(c, { prefix: "D12", pattern: "XXXX-XXXX", charset: "safe" })).toBe(true);
    }
    expect(verify(a[0].slice(0, -1) + (a[0].endsWith("2") ? "3" : "2"), { prefix: "D12", pattern: "XXXX-XXXX", charset: "safe" })).toBe(false);
  });
  it("uses Luhn for digits and refuses tiny patterns", () => {
    expect(checkChar("7992739871", "digits")).toBe("3");
    expect(() => generate({ seed: "s", batch: "b", prefix: "", pattern: "XX", charset: "digits", checksum: false, count: 50, taken: new Set() })).toThrow(/longer pattern/);
  });
  it("builds QR text", () => {
    expect(qrText("https://shop.example/r?c={code}", "A B")).toBe("https://shop.example/r?c=A%20B");
    expect(qrText("", "X1")).toBe("X1");
  });
});

describe("coupon tools", () => {
  it("makes codes and cards", async () => {
    const root = await mkdtemp(join(tmpdir(), "coupon-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("coupon_open", { inputs: ["campaign.csv", "used-codes.txt"], project: "c", settings: { seed: "winter-2026", brand: "青禾小馆" } });
    expect(o.data.stats).toMatchObject({ codes: 72, excluded: 2 });
    expect(o.text).toContain("72 codes in 3 batches");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ batch: "双十二满减", prefix: "D12", count: 40, value: "满200减30", expiry: "2026-12-31" });
    await c.call("coupon_edit", { project: "c", settings: { qr: "https://shop.example/redeem?code={code}" }, set: [{ row: 2, values: { count: 8 } }] });
    await c.call("coupon_export", { project: "c" });
    const csv = await readFile(join(root, "coupon-code-generator/c/codes.csv"), "utf8");
    const lines = csv.trim().split(/\r\n/);
    expect(lines).toHaveLength(69);
    expect(lines[1]).toMatch(/^\ufeff?D12-/);
    expect(lines[1]).toContain("https://shop.example/redeem?code=D12-");
    expect(csv).toContain("全场通用，不与其他优惠同享");
    const codes = lines.slice(1).map((l) => l.split(",")[0]);
    expect(new Set(codes).size).toBe(68);
    const pdf = join(root, "coupon-code-generator/c/coupon-cards.pdf");
    expect((await PDFDocument.load(await readFile(pdf))).getPageCount()).toBe(7);
    const txt = execFileSync("pdftotext", ["-layout", pdf, "-"]).toString();
    expect(txt).toContain(codes[0]);
    expect(txt).toContain("满200减30");
    // 同一种子重新打开 → 同样的码
    const again = await c.call("coupon_open", { inputs: ["campaign.csv", "used-codes.txt"], project: "c2", settings: { seed: "winter-2026" } });
    await c.call("coupon_export", { project: "c2", formats: ["csv"] });
    const csv2 = await readFile(join(root, "coupon-code-generator/c2/codes.csv"), "utf8");
    expect(csv2.split(/\r\n/)[1].split(",")[0]).toBe(codes[0]);
    void again;
  });
});
