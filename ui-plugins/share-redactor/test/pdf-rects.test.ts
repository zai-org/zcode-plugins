import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfFind } from "../src/pdf.ts";

describe("PDF boxes for a hit in the middle of a proportional-font line", () => {
  it("covers the whole email, including its first and last letters", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 12, x = 40, y = 700;
    const pre = "Contact our account manager Wang Xiaoming at ", email = "wang.xiaoming@example.com", post = " or 13800138000.";
    page.drawText(pre + email + post, { x, y, size, font });
    const buf = await doc.save();
    const { found } = await pdfFind(buf, { kinds: ["email", "phone"], keywords: [] }, join(import.meta.dirname, "../dist"));
    const hit = found.find((h) => h.kind === "email")!;
    expect(hit?.value).toBe(email);
    const start = x + font.widthOfTextAtSize(pre, size), end = start + font.widthOfTextAtSize(email, size);
    const left = Math.min(...hit.rects.map((r) => r.x)), right = Math.max(...hit.rects.map((r) => r.x + r.w));
    expect(left).toBeLessThanOrEqual(start);
    expect(right).toBeGreaterThanOrEqual(end);
    const phone = found.find((h) => h.kind === "phone")!;
    const pStart = x + font.widthOfTextAtSize(pre + email + " or ", size), pEnd = pStart + font.widthOfTextAtSize("13800138000", size);
    expect(Math.min(...phone.rects.map((r) => r.x))).toBeLessThanOrEqual(pStart);
    expect(Math.max(...phone.rects.map((r) => r.x + r.w))).toBeGreaterThanOrEqual(pEnd);
  });
});
