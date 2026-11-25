import { posix } from "node:path";
import { KitError, type Workspace } from "./kit/workspace.ts";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ktx2: "image/ktx2", bin: "application/octet-stream" };

/** 读模型：GLB 原样（base64）；.gltf 把外部 buffer / 贴图内联成 data URI，得到一个自包含的 JSON。 */
export async function readModel(ws: Workspace, path: string) {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "glb") {
    const buf = await ws.read(path, 300 * 1024 * 1024);
    if (buf.toString("ascii", 0, 4) !== "glTF") throw new KitError("bad_model", `${path} is not a binary glTF (.glb) file.`);
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.toString("utf8", 20, 20 + len));
    return { format: "glb" as const, data: buf.toString("base64"), info: info(json, buf.length) };
  }
  if (ext !== "gltf") throw new KitError("bad_model", `${path}: only glTF 2.0 (.glb / .gltf) is supported. Convert OBJ/FBX/USDZ to glTF first (e.g. Blender → Export → glTF 2.0).`);
  let json: any;
  try {
    json = JSON.parse(await ws.readText(path));
  } catch {
    throw new KitError("bad_model", `${path} is not valid glTF JSON.`);
  }
  const dir = posix.dirname(path);
  let bytes = 0;
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!item.uri || item.uri.startsWith("data:")) continue;
    const rel = posix.normalize(posix.join(dir, decodeURIComponent(item.uri)));
    if (!(await ws.exists(rel))) throw new KitError("missing_resource", `${path} refers to ${item.uri}, which is missing next to it.`);
    const b = await ws.read(rel, 300 * 1024 * 1024);
    bytes += b.length;
    item.uri = `data:${item.mimeType ?? MIME[rel.split(".").pop()!.toLowerCase()] ?? "application/octet-stream"};base64,${b.toString("base64")}`;
  }
  const text = JSON.stringify(json);
  return { format: "gltf" as const, data: text, info: info(json, text.length + bytes) };
}

function info(json: any, bytes: number) {
  const version = String(json?.asset?.version ?? "");
  if (!version.startsWith("2")) throw new KitError("bad_model", `glTF ${version || "?"} is not supported (need 2.0).`);
  const prims = (json.meshes ?? []).reduce((s: number, m: any) => s + (m.primitives?.length ?? 0), 0);
  return { meshes: json.meshes?.length ?? 0, primitives: prims, materials: json.materials?.length ?? 0, textures: json.textures?.length ?? 0, animations: json.animations?.length ?? 0, extensions: json.extensionsUsed ?? [], megabytes: Math.round((bytes / 1048576) * 10) / 10, generator: json.asset?.generator ?? "" };
}
