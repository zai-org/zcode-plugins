import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

// A base64-encoded chunk plus its MCP envelope stays below the host's 8 MiB limit.
export const CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 128 * 1024 * 1024;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function chunk(bytes, part) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(part))) throw new Error("Invalid chunk number");
  const index = Number(part);
  if (!Number.isSafeInteger(index) || index >= Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES)))
    throw new Error("Chunk is out of range");
  return bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
}

export async function readWorkspaceFile(workspace, requested) {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0"))
    throw new Error("Provide a workspace-relative file path");
  const root = await realpath(workspace);
  const file = await realpath(resolve(root, requested));
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("The file must be inside the current workspace");
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES)
    throw new Error("Open a regular file no larger than 128 MiB");
  const bytes = await readFile(file);
  if (bytes.length > MAX_FILE_BYTES) throw new Error("The file grew beyond 128 MiB");
  return { bytes, path: rel.split(sep).join("/") };
}

export function createAssetReader(directory, entries) {
  const byId = new Map(entries.map((asset) => [asset.id, asset]));
  // Keep just the last decompressed asset, not every application's assets in memory.
  let cached;
  return async (id) => {
    const asset = byId.get(id);
    if (!asset || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Unknown asset");
    if (cached?.id === id) return cached.bytes;
    const bytes = gunzipSync(await readFile(resolve(directory, `${id}.gz`)), {
      maxOutputLength: Math.max(1, asset.bytes),
    });
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256)
      throw new Error("Asset integrity check failed");
    cached = { id, bytes };
    return bytes;
  };
}
