import { KitError } from "./kit/workspace.ts";
import { assertDimensions, canvasUrl } from "./workflows.ts";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBufferLike>;
}>;

/** Read IHDR width/height from a PNG buffer. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIG)) {
    throw new KitError("bad_canvas", "The official canvas endpoint did not return a PNG.");
  }
  const type = png.toString("ascii", 12, 16);
  if (type !== "IHDR") throw new KitError("bad_canvas", "The PNG is missing an IHDR chunk.");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Fetch a pure #FFFFFF PNG from the official public canvas API. Does not use Cloud or credits. */
export async function fetchWhiteCanvas(
  width: number,
  height: number,
  fetcher: FetchLike = fetch,
): Promise<{ png: Buffer; officialUrl: string; downloadUrl: string }> {
  const size = assertDimensions(width, height);
  const officialUrl = canvasUrl(size.width, size.height);
  const downloadUrl = canvasUrl(size.width, size.height, true);
  let response;
  try {
    response = await fetcher(officialUrl, { headers: { Accept: "image/png" } });
  } catch (error) {
    throw new KitError(
      "canvas_fetch_failed",
      `Could not reach WhiteBackground (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    throw new KitError("canvas_fetch_failed", `WhiteBackground canvas request failed (HTTP ${response.status}).`);
  }
  const png = Buffer.from(await response.arrayBuffer());
  const got = pngSize(png);
  if (got.width !== size.width || got.height !== size.height) {
    throw new KitError(
      "bad_canvas",
      `Expected a ${size.width}×${size.height} PNG, got ${got.width}×${got.height}.`,
    );
  }
  return { png, officialUrl, downloadUrl };
}
