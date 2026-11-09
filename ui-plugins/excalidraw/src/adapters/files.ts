import { realpath, readFile, writeFile, unlink, link, rename, lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DiagramError, MAX_SCENE_BYTES } from "#excalidraw/contract.ts";

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
async function pathInWorkspace(workspace: string, input: string, writing: boolean) {
  const root = await realpath(workspace);
  const target = resolve(root, input);
  if (!inside(root, target))
    throw new DiagramError("path_outside_workspace", "Path is outside this workspace");
  const actual = await realpath(writing ? dirname(target) : target);
  if (!inside(root, actual))
    throw new DiagramError("path_outside_workspace", "Symlink points outside workspace");
  if (writing) {
    const entry = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (entry?.isSymbolicLink())
      throw new DiagramError("unsafe_path", "Cannot overwrite a symbolic link");
  }
  return writing ? join(actual, relative(dirname(target), target)) : actual;
}
export async function readWorkspaceFile(workspace: string, input: string): Promise<string> {
  const path = await pathInWorkspace(workspace, input, false);
  const stat = await lstat(path);
  // 原生 JSON 的缩进和元数据会增加文件体积；解析后的 scene 仍按 6 MiB 校验。
  if (stat.size > MAX_SCENE_BYTES * 2)
    throw new DiagramError("scene_too_large", "Import file exceeds 12 MiB");
  return readFile(path, "utf8");
}
export async function writeWorkspaceFile(
  workspace: string,
  input: string,
  bytes: Uint8Array,
  overwrite = false,
): Promise<string> {
  if (bytes.length > 12 * 1024 * 1024)
    throw new DiagramError("export_too_large", "Export exceeds 12 MiB");
  const target = await pathInWorkspace(workspace, input, true);
  const temp = join(dirname(target), `.excalidraw-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    // 默认通过 link 原子地拒绝已存在目标；不能先 exists 再写而覆盖竞态中新出现的文件。
    if (overwrite) await rename(temp, target);
    else await link(temp, target);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new DiagramError("file_exists", `File already exists: ${input}`);
    throw error;
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
