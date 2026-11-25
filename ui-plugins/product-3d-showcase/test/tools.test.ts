import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/settings.ts";
import { createServer } from "../src/server.ts";

// 真实样本（Khronos WaterBottle.glb、Avocado glTF，CC0）不在仓库里时，用现场生成的同结构模型。
const SAMPLES = process.env.E2E_MODELS ?? "/workspace/zcode-new-plugins/samples/models";
const REAL = existsSync(join(SAMPLES, "WaterBottle.glb"));

/** 一个三角形；textures 个贴图（1×1 PNG）。GLB 内嵌，或 .gltf + 外部 .bin/.png。 */
function model(textures: number) {
  const bin = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const json: any = {
    asset: { version: "2.0", generator: "test" },
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: textures ? { baseColorTexture: { index: 0 } } : {} }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  if (textures) { json.images = Array.from({ length: textures }, (_, i) => ({ uri: `tex${i}.png` })); json.textures = json.images.map((_: unknown, i: number) => ({ source: i })); }
  return { json, bin };
}
function glb() {
  const { json, bin } = model(0);
  const j = Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, " "));
  const head = Buffer.alloc(12); head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const ch = (len: number, type: string) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  return Buffer.concat([head, ch(j.length, "JSON"), j, ch(bin.length, "BIN\0"), bin]);
}
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "p3d-"));
  if (REAL) {
    await cp(join(SAMPLES, "WaterBottle.glb"), join(workspace, "models/bottle.glb"), { recursive: true });
    await cp(join(SAMPLES, "avocado"), join(workspace, "models/avocado"), { recursive: true });
  } else {
    await mkdir(join(workspace, "models/avocado"), { recursive: true });
    await writeFile(join(workspace, "models/bottle.glb"), glb());
    const { json, bin } = model(3);
    json.buffers[0].uri = "Avocado.bin";
    await writeFile(join(workspace, "models/avocado/Avocado.gltf"), JSON.stringify(json));
    await writeFile(join(workspace, "models/avocado/Avocado.bin"), bin);
    for (let i = 0; i < 3; i++) await writeFile(join(workspace, `models/avocado/tex${i}.png`), PNG);
  }
  await writeFile(join(workspace, "models/broken.glb"), "not a model");
  await writeFile(join(workspace, "models/v1.gltf"), JSON.stringify({ asset: { version: "1.0" } }));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("settings", () => {
  it("fills defaults, resolves presets and clamps", () => {
    const s = normalizeSettings({ angles: ["front", "back", { name: "Hero Shot", yaw: 400, pitch: 120, zoom: 9 }, "front"], background: "red", size: 99999, video: { seconds: 100, size: 1081 } }, "models/bottle.glb");
    expect(s.angles.map((a) => a.name)).toEqual(["front", "back", "hero-shot", "front-2"]);
    expect(s.angles[2]).toMatchObject({ yaw: 360, pitch: 89, zoom: 4 });
    expect(s).toMatchObject({ title: "bottle", background: "#ffffff", size: 4096, output: "showcase/bottle", lighting: "studio", shadow: true, viewer: true });
    expect(s.video).toMatchObject({ enabled: true, seconds: 30, size: 1082 });
    expect(normalizeSettings({ background: "transparent" }, "a.glb").background).toBe("transparent");
    expect(normalizeSettings({}, "a.glb").angles).toHaveLength(4);
  });
});

describe("tools", () => {
  it("opens a GLB, reports what is inside and saves settings", async () => {
    const r = await call("showcase_open", { model: "models/bottle.glb", settings: { angles: ["front", "three-quarter-left", "back"], background: "transparent" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.kind).toBe("settings");
    expect(r.structuredContent.info).toMatchObject({ meshes: 1, materials: 1, textures: REAL ? 4 : 0 });
    expect(r.content[0].text).toMatch(/front \(yaw 0°/);
    const saved = JSON.parse(await readFile(join(workspace, "showcase/bottle/showcase.json"), "utf8"));
    expect(saved.background).toBe("transparent");
    // 不传 settings 时沿用已保存的
    const again = await call("showcase_open", { model: "models/bottle.glb" });
    expect(again.structuredContent.settings.angles).toHaveLength(3);
  });

  it("inlines external buffers and textures of a .gltf", async () => {
    let r = await call("model_data", { model: "models/avocado/Avocado.gltf" });
    expect(r.structuredContent.format).toBe("gltf");
    let data = r.structuredContent.data as string;
    while (data.length < r.structuredContent.total) {
      r = await call("model_data", { model: "models/avocado/Avocado.gltf", offset: data.length });
      data += r.structuredContent.data;
    }
    const json = JSON.parse(data);
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    expect(json.images.map((i: any) => i.uri.slice(0, 22))).toEqual(Array(3).fill("data:image/png;base64,"));
    expect(Buffer.from(json.buffers[0].uri.split(",")[1], "base64").length).toBe(json.buffers[0].byteLength);
  });

  it("explains bad models", async () => {
    expect((await call("showcase_open", { model: "models/broken.glb" })).content[0].text).toMatch(/not a binary glTF/);
    expect((await call("showcase_open", { model: "models/v1.gltf" })).content[0].text).toMatch(/glTF 1.0 is not supported/);
    expect((await call("showcase_open", { model: "models/x.obj" })).content[0].text).toMatch(/only glTF 2.0/);
  });

  it("export lists the expected outputs", async () => {
    const r = await call("showcase_export", { settings: { model: "models/bottle.glb", angles: ["front", "side"], video: { enabled: false } } });
    expect(r.structuredContent.kind).toBe("export");
    expect(r.structuredContent.expected).toEqual(["showcase/bottle/front.png", "showcase/bottle/side.png", "showcase/bottle/viewer/index.html"]);
  });

  it("saves only real PNG/WebM files into the output folder", async () => {
    const settings = { model: "models/bottle.glb" };
    const ok = await call("save_output", { settings, name: "front.png", data: PNG.toString("base64") });
    expect(ok.structuredContent.path).toBe("showcase/bottle/front.png");
    expect((await call("save_output", { settings, name: "../../evil.png", data: PNG.toString("base64") })).isError).toBe(true);
    expect((await call("save_output", { settings, name: "x.webm", data: PNG.toString("base64") })).isError).toBe(true);
    expect((await call("save_output", { settings, name: "x.html", data: "PGgxPg==" })).isError).toBe(true);
  });

  it("writes a self-contained web viewer", async () => {
    const r = await call("save_viewer", { settings: { model: "models/avocado/Avocado.gltf", title: "Avocado <3" } });
    expect(r.structuredContent.files).toEqual(["showcase/Avocado/viewer/viewer.js", "showcase/Avocado/viewer/model.js", "showcase/Avocado/viewer/index.html"]);
    const html = await readFile(join(workspace, "showcase/Avocado/viewer/index.html"), "utf8");
    expect(html).toContain("<title>Avocado &lt;3</title>");
    expect(html).toContain('<script src="model.js"></script><script src="viewer.js"></script>');
    const model = await readFile(join(workspace, "showcase/Avocado/viewer/model.js"), "utf8");
    expect(model.startsWith("window.SHOWCASE=")).toBe(true);
    expect(model).not.toMatch(/"uri":"Avocado/);
  });

  it("lists models", async () => {
    const r = await call("workspace_files", {});
    expect(r.structuredContent.models).toEqual(expect.arrayContaining(["models/bottle.glb", "models/avocado/Avocado.gltf"]));
  });
});
