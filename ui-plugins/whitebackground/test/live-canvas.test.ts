import { describe, expect, it } from "vitest";
import { fetchWhiteCanvas, pngSize } from "../src/canvas.ts";

// Hits the official public canvas API only (no account, no credits). Skip when offline.
describe("live official canvas API", () => {
  it("returns a 16×16 white PNG", async () => {
    try {
      const { png, officialUrl } = await fetchWhiteCanvas(16, 16);
      expect(officialUrl).toBe("https://whitebackground.app/api/mcp/canvas?width=16&height=16");
      expect(pngSize(png)).toEqual({ width: 16, height: 16 });
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    } catch (error) {
      if (String(error).includes("Could not reach WhiteBackground")) {
        console.warn("skipping live canvas test:", error);
        return;
      }
      throw error;
    }
  });
});
