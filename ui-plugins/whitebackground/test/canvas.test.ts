import { describe, expect, it } from "vitest";
import { fetchWhiteCanvas, pngSize } from "../src/canvas.ts";
import { KitError } from "../src/kit/workspace.ts";

/** Minimal valid 1-bit 2×1 white PNG (IHDR + empty IDAT is not enough); build a tiny real PNG header fixture. */
function pngWithSize(width: number, height: number, extra = Buffer.alloc(0)): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  const crc = Buffer.alloc(4); // not validated by pngSize
  const chunkLen = Buffer.alloc(4);
  chunkLen.writeUInt32BE(13, 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkLen,
    Buffer.from("IHDR"),
    ihdr,
    crc,
    extra,
  ]);
}

describe("pngSize", () => {
  it("reads IHDR", () => {
    expect(pngSize(pngWithSize(16, 9))).toEqual({ width: 16, height: 9 });
  });

  it("rejects non-PNG", () => {
    expect(() => pngSize(Buffer.from("not a png"))).toThrow(KitError);
  });
});

describe("fetchWhiteCanvas", () => {
  it("calls the official URL and checks dimensions", async () => {
    const calls: string[] = [];
    const png = pngWithSize(16, 16);
    const result = await fetchWhiteCanvas(16, 16, async (url) => {
      calls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    });
    expect(calls).toEqual(["https://whitebackground.app/api/mcp/canvas?width=16&height=16"]);
    expect(result.downloadUrl).toContain("download=1");
    expect(result.png.equals(png)).toBe(true);
  });

  it("fails on HTTP errors and size mismatch", async () => {
    await expect(
      fetchWhiteCanvas(8, 8, async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })),
    ).rejects.toMatchObject({ code: "canvas_fetch_failed" });
    const wrong = pngWithSize(2, 2);
    await expect(
      fetchWhiteCanvas(8, 8, async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => wrong.buffer.slice(wrong.byteOffset, wrong.byteOffset + wrong.byteLength),
      })),
    ).rejects.toMatchObject({ code: "bad_canvas" });
  });
});
