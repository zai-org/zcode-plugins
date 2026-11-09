import {
  realpath,
  readFile,
  writeFile,
  unlink,
  link,
  rename,
  lstat,
  mkdir,
  readdir,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { DesignError } from "#openpencil/contract.ts";

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
/**
 * 把用户/模型给的路径限制在工作区内（realpath + relative 双重检查，与 Excalidraw 插件同款）：
 * 写入时校验父目录的 realpath 且拒绝覆盖符号链接；返回绝对路径。
 */
export async function resolveWorkspacePath(workspace: string, input: string, writing: boolean) {
  const root = await realpath(workspace);
  const target = resolve(root, input);
  if (!inside(root, target))
    throw new DesignError("path_outside_workspace", "路径不在当前工作区内");
  if (writing) await mkdir(dirname(target), { recursive: true });
  const actual = await realpath(writing ? dirname(target) : target);
  if (!inside(root, actual))
    throw new DesignError("path_outside_workspace", "符号链接指向工作区之外");
  if (writing) {
    const entry = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (entry?.isSymbolicLink()) throw new DesignError("unsafe_path", "不能覆盖符号链接");
  }
  return writing ? join(actual, relative(dirname(target), target)) : actual;
}
export async function workspaceRelative(workspace: string, absolute: string) {
  const root = await realpath(workspace);
  return relative(root, absolute).split(sep).join(posix.sep);
}
export async function readWorkspaceBytes(workspace: string, input: string, maxBytes: number) {
  const path = await resolveWorkspacePath(workspace, input, false);
  const stat = await lstat(path);
  if (!stat.isFile()) throw new DesignError("not_a_file", "目标不是文件");
  if (stat.size > maxBytes)
    throw new DesignError("file_too_large", `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MiB`);
  return { path, bytes: await readFile(path) };
}
export async function writeWorkspaceBytes(
  workspace: string,
  input: string,
  bytes: Uint8Array,
  overwrite = false,
): Promise<string> {
  const target = await resolveWorkspacePath(workspace, input, true);
  const temp = join(dirname(target), `.openpencil-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    // 默认通过 link 原子地拒绝已存在目标；不能先 exists 再写而覆盖竞态中新出现的文件。
    if (overwrite) await rename(temp, target);
    else await link(temp, target);
    return target;
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST")
      throw new DesignError("file_exists", "目标文件已存在");
    throw error;
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".zcode"]);
/** 列出工作区内指定扩展名的文件（深度 ≤ maxDepth，跳过依赖与构建目录，上限 limit 条）。 */
export async function listWorkspaceFiles(
  workspace: string,
  extensions: readonly string[],
  { maxDepth = 4, limit = 500 } = {},
): Promise<string[]> {
  const root = await realpath(workspace);
  const found: string[] = [];
  async function walk(dir: string, depth: number) {
    if (found.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= limit) return;
      if (entry.isDirectory()) {
        if (depth < maxDepth && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith("."))
          await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase().split(".").pop() ?? "";
        if (extensions.includes(ext))
          found.push(relative(root, join(dir, entry.name)).split(sep).join(posix.sep));
      }
    }
  }
  await walk(root, 0);
  return found;
}
