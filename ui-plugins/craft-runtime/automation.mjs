import { readFile, realpath, stat, readdir, mkdir, rename, link, open, unlink } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EditorBridge, failure } from "./bridge.mjs";
import { CHUNK_BYTES, MAX_FILE_BYTES, readWorkspaceFile, sha256 } from "./assets.mjs";

const success = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
const pathKeys = new Set(["path", "file", "out", "dir", "directory", "source", "font_path", "folder", "output", "src", "destination", "out_dir", "output_dir", "input_dir", "image"]);
export function argumentPaths(args) {
  const paths = new Set();
  function visit(value, key) {
    if (typeof value === "string" && (pathKeys.has(key) || /_(path|file|dir|directory)$/.test(key)) && value.trim()) paths.add(value);
    else if (Array.isArray(value)) for (const item of value) visit(item, ["paths", "files", "directories"].includes(key) ? "path" : key);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
  }
  visit(args);
  return [...paths];
}

export async function outputPath(workspace, requested, allowDirectory = false) {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) throw new Error("Invalid output path");
  const root = await realpath(workspace);
  const target = resolve(root, requested);
  const within = (path) => {
    const rel = relative(root, path);
    if ((!rel && !allowDirectory) || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Output must be a file inside the workspace");
  };
  within(target);
  let existing = target;
  for (;;) {
    try {
      const canonical = await realpath(existing);
      if (canonical !== root) within(canonical);
      if (existing === target && !(await stat(canonical)).isFile() && !(allowDirectory && (await stat(canonical)).isDirectory())) throw new Error("Output is not a regular file");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  return target;
}

export async function writeOutput(workspace, path, bytes, exclusive = false) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("Output exceeds 128 MiB");
  const target = await outputPath(workspace, path);
  await mkdir(dirname(target), { recursive: true });
  await outputPath(workspace, path);
  const temp = resolve(dirname(target), `.craft-${randomUUID()}.tmp`);
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await outputPath(workspace, path);
    if (exclusive) await link(temp,target); else await rename(temp, target);
  } finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  return relative(await realpath(workspace), target).split(sep).join("/");
}

export async function installAutomation(server, { directory, workspace, name, files }) {
  const catalog = JSON.parse(await readFile(resolve(directory, "tools.json"), "utf8"));
  const bridge = new EditorBridge();
  const outputs = new Map();
  const hidden = { ui: { visibility: ["app"] } };
  const add = (tool, fn) => server.registerTool(tool.name, {
    description: tool.description, title: tool.title,
    inputSchema: z.fromJSONSchema(tool.inputSchema),
    annotations: tool.annotations || { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try { return await fn(args, extra); } catch (error) { return failure(error.message); }
  });
  for (const tool of catalog) {
    if (tool.annotations?.readOnlyHint && tool.inputSchema.properties?.path) tool.annotations = { ...tool.annotations, readOnlyHint: false, destructiveHint: true };
    add(tool, async (args, extra) => {
      // Schemars serializes Rust Option defaults as null; the native facade omits None
      // when constructing engine parameters. Preserve that behavior without stripping
      // intentional null values inside a command's arbitrary params object.
      if (name === "photocraft") {
        const omitNone = value => Object.fromEntries(Object.entries(value).filter(([,v]) => v !== null));
        args = omitNone(args);
        if (tool.name === "command_batch") args.steps = args.steps.map(omitNone);
      }
      const ids = [];
      try { return await bridge.call(tool.name, args, extra.signal, async () => {
        const inputs = [], directories = [], seen = new Set();
        let totalBytes = 0;
        async function stage(path, depth = 0) {
          if (extra.signal?.aborted) throw new Error("Cancelled before dispatch");
          const target = await outputPath(workspace, path, true);
          if (seen.has(target)) return;
          seen.add(target);
          let info;
          try { info = await stat(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
          if (info?.isDirectory()) {
            if (depth > 8) throw new Error("Input directory nesting exceeds 8 levels");
            directories.push(path);
            for (const entry of await readdir(target, { withFileTypes: true })) {
              if (entry.isSymbolicLink()) continue;
              if (entry.isFile() || entry.isDirectory()) await stage(`${path}/${entry.name}`, depth + 1);
            }
            return;
          }
          if (!info?.isFile()) return;
          if (inputs.length >= 256 || totalBytes + info.size > MAX_FILE_BYTES) throw new Error("Operation inputs exceed 256 files / 128 MiB");
          const data = await readWorkspaceFile(workspace, path);
          totalBytes += data.bytes.length;
          const id = randomUUID(); ids.push(id); files.set(id, data.bytes);
          inputs.push({ path, id, uri: `ui://${name}/file/${id}`, bytes: data.bytes.length,
            parts: Math.max(1, Math.ceil(data.bytes.length / CHUNK_BYTES)), sha256: sha256(data.bytes) });
          if (name === "soundcraft" && path.toLowerCase().endsWith(".scraft")) {
            const session = JSON.parse(data.bytes.toString("utf8"));
            for (const dependency of argumentPaths({ sources:session.sources, videos:session.videos })) {
              await stage(isAbsolute(dependency) ? dependency : resolve(dirname(target),dependency), depth + 1);
            }
          }
        }
        for (const path of argumentPaths(args)) await stage(path);
        return { inputs, directories, readOnly: tool.annotations?.readOnlyHint === true };
      }); } finally {
        for (const id of ids) files.delete(id);
        for (const [key, value] of outputs) if (!bridge.requests.has(value.id)) outputs.delete(key);
      }
    });
  }
  const internal = (id, schema, fn) => server.registerTool(id, { inputSchema: schema, _meta: hidden }, async (args) => {
    try { return success(await fn(args)); } catch (error) { return failure(error.message); }
  });
  internal("_editor_attach", {}, async () => ({ token: bridge.attach(), workspace, tools: catalog.map((t) => t.name) }));
  server.registerTool("_editor_poll", { inputSchema: { token: z.string() }, _meta: hidden }, async ({ token }) => {
    try {
      const request = await bridge.poll(token);
      // 只有真实任务续期；空长轮询不能让后台页面永久驻留。
      return { ...success({ request }), ...(request ? { _meta: { "zcode/activity": true } } : {}) };
    } catch (error) { return failure(error.message); }
  });
  internal("_editor_reply", { token: z.string(), id: z.string(), result: z.any() }, async ({ token, id, result }) => ({ accepted: bridge.reply(token, id, result) }));
  internal("_editor_detach", { token: z.string() }, async ({ token }) => { bridge.check(token); bridge.close(); outputs.clear(); return {}; });
  internal("_editor_write", { token: z.string(), id: z.string(), path: z.string(), part: z.number().int().min(0), total: z.number().int().min(1).max(64), data: z.string().max(3 * 1024 * 1024) },
    async ({ token, id, path, part, total, data }) => {
      bridge.check(token);
      const active = bridge.requests.get(id);
      if (!active?.dispatched) throw new Error("Write does not belong to an active operation");
      if (active.request.readOnly) throw new Error("Read-only tool cannot write files");
      await outputPath(workspace, path);
      const key = `${id}:${path}`;
      if (!outputs.has(key) && outputs.size >= 256) throw new Error("Too many outputs");
      const item = outputs.get(key) || { id, parts: [], bytes: 0, total };
      if (part !== item.parts.length || total !== item.total) throw new Error("Out-of-order output chunk");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > CHUNK_BYTES || item.bytes + bytes.length > MAX_FILE_BYTES) throw new Error("Output limit exceeded");
      item.parts.push(bytes); item.bytes += bytes.length; outputs.set(key, item);
      if (part + 1 !== total) return { complete: false };
      const exclusive = name === "photocraft" && ["doc_export_layers","doc_export_data_sets"].includes(active.request.name);
      const saved = await writeOutput(workspace, path, Buffer.concat(item.parts), exclusive);
      item.parts = []; item.total = 0; // Keep a completion tombstone until the operation ends.
      return { complete: true, path: saved, bytes: item.bytes };
    });
  return bridge;
}
