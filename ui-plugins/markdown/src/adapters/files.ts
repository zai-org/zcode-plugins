// 工作区文件 IO：路径校验（双重 realpath 防 symlink 逃逸）、大小上限、原子写。
// 默认用 link 原子拒绝已存在目标。
import { lstat, link, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MarkdownError, MAX_DOC_BYTES } from "../contract.ts";

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

async function pathInWorkspace(workspace: string, input: string, writing: boolean) {
  const root = await realpath(workspace);
  const target = resolve(root, input);
  if (!inside(root, target))
    throw new MarkdownError("path_outside_workspace", "Path is outside this workspace");
  if (writing) {
    // Validate each parent before creating the next directory. A recursive mkdir
    // could otherwise create directories outside the workspace through a symlink.
    let parent = root;
    for (const part of relative(root, dirname(target)).split(sep).filter(Boolean)) {
      parent = join(parent, part);
      try { await mkdir(parent); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      parent = await realpath(parent);
      if (!inside(root, parent))
        throw new MarkdownError("path_outside_workspace", "Symlink points outside workspace");
    }
  }
  const actual = await realpath(writing ? dirname(target) : target).catch((error) => {
    if (error.code === "ENOENT" && !writing)
      throw new MarkdownError("not_found", `No such file: ${input}`);
    throw error;
  });
  if (!inside(root, actual))
    throw new MarkdownError("path_outside_workspace", "Symlink points outside workspace");
  if (writing) {
    const entry = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (entry?.isSymbolicLink())
      throw new MarkdownError("unsafe_path", "Cannot overwrite a symbolic link");
  }
  return writing ? join(actual, relative(dirname(target), target)) : actual;
}

export function assertMarkdownExtension(input: string) {
  if (!/\.markdown$/i.test(input) && !/\.md$/i.test(input))
    throw new MarkdownError("not_markdown", "Only .md / .markdown files are supported");
}

export async function readWorkspaceFile(
  workspace: string,
  input: string,
): Promise<{ path: string; content: string }> {
  const path = await pathInWorkspace(workspace, input, false);
  const stat = await lstat(path).catch((error) => {
    if (error.code === "ENOENT")
      throw new MarkdownError("not_found", `No such file: ${input}`);
    throw error;
  });
  if (stat.size > MAX_DOC_BYTES)
    throw new MarkdownError("doc_too_large", `File exceeds ${MAX_DOC_BYTES} bytes: ${input}`);
  return { path, content: await readFile(path, "utf8") };
}

export async function writeWorkspaceFile(
  workspace: string,
  input: string,
  content: string,
  overwrite: boolean,
): Promise<string> {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES)
    throw new MarkdownError("doc_too_large", "Content exceeds the size limit");
  const target = await pathInWorkspace(workspace, input, true);
  const temp = join(dirname(target), `.markdown-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, "utf8");
    if (overwrite) await rename(temp, target);
    else await link(temp, target);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new MarkdownError("file_exists", `File already exists: ${input}`);
    throw error;
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
