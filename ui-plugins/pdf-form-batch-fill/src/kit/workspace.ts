import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class KitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "KitError";
  }
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "__pycache__"]);

/** 只允许读写当前工作区内的文件；所有路径都相对工作区根目录。 */
export class Workspace {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(path: string): string {
    if (typeof path !== "string" || !path.trim()) throw new KitError("bad_path", "Path is empty.");
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new KitError("outside_workspace", `Path is outside the workspace: ${path}`);
    return absolute;
  }

  rel(absolute: string): string {
    return relative(this.root, absolute).split(sep).join("/") || ".";
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string, maxBytes = 200 * 1024 * 1024): Promise<Buffer> {
    const absolute = this.resolve(path);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new KitError("not_found", `File not found: ${path}`);
    }
    if (!info.isFile()) throw new KitError("not_a_file", `Not a file: ${path}`);
    if (info.size > maxBytes) throw new KitError("too_large", `File is larger than ${Math.round(maxBytes / 1048576)} MB: ${path}`);
    return readFile(absolute);
  }

  async readText(path: string): Promise<string> {
    return (await this.read(path, 20 * 1024 * 1024)).toString("utf8");
  }

  async write(path: string, data: Uint8Array | string): Promise<string> {
    const absolute = this.resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return this.rel(absolute);
  }

  /** 列出文件（默认递归、跳过依赖与构建目录），按路径排序。 */
  async list({ dir = ".", exts, recursive = true, limit = 2000 }: { dir?: string; exts?: string[]; recursive?: boolean; limit?: number } = {}) {
    const wanted = exts?.map((ext) => ext.toLowerCase());
    const out: { path: string; size: number }[] = [];
    const walk = async (absolute: string, depth: number) => {
      if (out.length >= limit || depth > 8) return;
      let entries;
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
      for (const entry of entries) {
        if (out.length >= limit) return;
        if (entry.name.startsWith(".") && entry.name !== ".") continue;
        const child = join(absolute, entry.name);
        if (entry.isDirectory()) {
          if (recursive && !SKIP.has(entry.name)) await walk(child, depth + 1);
        } else if (entry.isFile() && (!wanted || wanted.includes(extname(entry.name).toLowerCase()))) {
          out.push({ path: this.rel(child), size: (await stat(child)).size });
        }
      }
    };
    await walk(this.resolve(dir), 0);
    return out;
  }
}

/** 把文件名中不适合的字符替换掉，保留中文。 */
export function safeFileName(name: string, fallback = "file"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\p{Cc}+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || fallback).slice(0, 120);
}
