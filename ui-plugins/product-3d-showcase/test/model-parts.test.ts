import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MODEL_CHUNK } from "../src/server.ts";
import { mkclient } from "./_mkclient.ts";

/** A valid GLB with a large BIN chunk (one triangle plus padding bytes). */
function bigGlb(binBytes: number) {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: binBytes }],
  }).padEnd(Math.ceil(400 / 4) * 4, " "));
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.alloc(binBytes, 7);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const head = Buffer.alloc(12); head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonPadded.length, 0); jh.write("JSON", 4, "ascii");
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, jsonPadded, bh, bin]);
}

// ZCode Desktop closes a stdio MCP server whose single message is over 10 MB (the 9 MB WaterBottle.glb
// came back as one 12 MB message and the panel lost its connection). model_data must send large models in parts.
it("model_data sends a large model in parts that stay well under 10 MB and reassemble exactly", async () => {
  const { root, call } = await mkclient("p3d-parts-");
  const glb = bigGlb(9 * 1024 * 1024);
  mkdirSync(join(root, "models"), { recursive: true });
  writeFileSync(join(root, "models/big.glb"), glb);
  const parts: string[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const r = await call("model_data", { model: "models/big.glb", offset });
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r).length).toBeLessThan(6 * 1024 * 1024);
    const s = r.structuredContent;
    expect(s.format).toBe("glb");
    expect(s.offset).toBe(offset);
    expect(s.data.length).toBeLessThanOrEqual(MODEL_CHUNK);
    expect(s.data.length).toBeGreaterThan(0);
    total = s.total;
    parts.push(s.data);
    offset += s.data.length;
  }
  expect(parts.length).toBeGreaterThan(1);
  expect(Buffer.from(parts.join(""), "base64").equals(glb)).toBe(true);
});
