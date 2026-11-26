import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
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
    this.assertRealInside(absolute, path);
    return absolute;
  }

  private realRoot?: string;

  /**
   * 符号链接不能把读写带出工作区：从目标往上找到第一个已存在的路径，取它的真实路径，
   * 必须仍在工作区根目录的真实路径之下。还不存在的写入目标按其已存在的上级目录判断；
   * 指向不存在位置的悬空链接一律拒绝（否则 writeFile 会顺着它在外部建文件）。
   */
  private assertRealInside(absolute: string, path: string) {
    let realRoot: string;
    try {
      realRoot = this.realRoot ??= realpathSync(this.root);
    } catch {
      return; // 根目录本身不存在时，没有可逃出的链接
    }
    const outside = (real: string) => {
      const rel = relative(realRoot, real);
      return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    };
    let probe = absolute;
    for (;;) {
      let real: string | undefined;
      try {
        real = realpathSync(probe);
      } catch {
        let link = false;
        try {
          link = lstatSync(probe).isSymbolicLink();
        } catch {}
        if (link) {
          const target = resolve(dirname(probe), readlinkSync(probe));
          throw new KitError("outside_workspace", outside(target) ? `Path leaves the workspace through a link: ${path}` : `Path goes through a broken link: ${path}`);
        }
      }
      if (real !== undefined) {
        if (outside(real)) throw new KitError("outside_workspace", `Path leaves the workspace through a link: ${path}`);
        return;
      }
      const parent = dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
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

  /** 在工作区内移动 / 重命名文件；目标已存在时拒绝，不覆盖。 */
  async move(from: string, to: string): Promise<string> {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (!(await this.exists(from))) throw new KitError("not_found", `File not found: ${from}`);
    if (await this.exists(to)) throw new KitError("exists", `Target already exists: ${to}`);
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
    return this.rel(target);
  }

  async size(path: string): Promise<number> {
    return (await stat(this.resolve(path))).size;
  }

  async mtime(path: string): Promise<Date> {
    return (await stat(this.resolve(path))).mtime;
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
