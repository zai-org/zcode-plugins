import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer, PREVIEW_URI, STATE_URI } from "../src/server.ts";

function pngWithSize(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1;
  const chunkLen = Buffer.alloc(4);
  chunkLen.writeUInt32BE(13, 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkLen,
    Buffer.from("IHDR"),
    ihdr,
    Buffer.alloc(4),
  ]);
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "wb-"));
  const png = pngWithSize(32, 24);
  const { server } = createServer({
    workspaceRoot: root,
    assetRoot: root, // panel.html is unused in these calls
    fetch: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    }),
  });
  const { call, client } = await connect(server);
  return { root, png, call, client };
}

describe("whitebackground MCP tools", () => {
  it("creates a canvas in the workspace and does not overwrite", async () => {
    const { root, png, call } = await harness();
    const first = await call("canvas_create", { width: 32, height: 24 });
    expect(first.data.path).toBe("whitebackground/white-32x24.png");
    expect(first.data.width).toBe(32);
    expect(first.data.downloadUrl).toContain("width=32");
    expect(Buffer.from(await readFile(join(root, first.data.path))).equals(png)).toBe(true);
    const second = await call("canvas_create", { width: 32, height: 24 });
    expect(second.data.path).toBe("whitebackground/white-32x24-2.png");
  });

  it("rejects path escape, non-png outputs, and bad sizes", async () => {
    const { call } = await harness();
    await expect(call("canvas_create", { width: 32, height: 24, output: "../out.png" })).rejects.toMatchObject({
      code: "outside_workspace",
    });
    await expect(call("canvas_create", { width: 32, height: 24, output: "whitebackground/out.jpg" })).rejects.toMatchObject({
      code: "bad_path",
    });
    await expect(call("canvas_create", { width: 8192, height: 8192 })).rejects.toMatchObject({ code: "too_many_pixels" });
  });

  it("exposes the last canvas on the panel state and preview resources", async () => {
    const { png, call, client } = await harness();
    const textOf = (resource: { contents: Array<Record<string, unknown>> }) => String(resource.contents[0]?.text ?? "");
    const empty = await client.readResource({ uri: STATE_URI });
    expect(JSON.parse(textOf(empty))).toEqual({ canvas: null, editor: null });
    await call("canvas_create", { width: 32, height: 24 });
    await call("editor_open", { workflow: "square" });
    const state = JSON.parse(textOf(await client.readResource({ uri: STATE_URI })));
    expect(state.canvas).toMatchObject({
      path: "whitebackground/white-32x24.png",
      width: 32,
      height: 24,
      previewUri: PREVIEW_URI,
    });
    expect(state.editor).toMatchObject({ workflow: "square", url: "https://whitebackground.app/make-image-square" });
    const preview = await client.readResource({ uri: PREVIEW_URI });
    const blob = (preview.contents[0] as { blob?: string }).blob;
    expect(blob).toBeTruthy();
    expect(Buffer.from(String(blob), "base64").equals(png)).toBe(true);
  });

  it("returns official editor URLs and does not invent cloud tools", async () => {
    const { call, client } = await harness();
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["canvas_create", "editor_open", "panel_open"]);
    const opened = await call("editor_open", { workflow: "square" });
    expect(opened.data.url).toBe("https://whitebackground.app/make-image-square");
    expect(opened.text).toContain("cannot process chat attachments");
    expect(opened.data.pricingUrl).toBe("https://whitebackground.app/pricing");
    await expect(call("editor_open", { workflow: "cloud" })).rejects.toThrow();
  });
});
