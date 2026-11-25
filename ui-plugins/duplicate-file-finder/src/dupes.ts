import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface FileRec { path: string; size: number; mtime: string }
export interface Group { hash: string; size: number; files: FileRec[] }

export function hashFile(absolute: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(absolute).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** 先按大小分组，只对大小相同的文件算 SHA-256。 */
export async function findGroups(files: FileRec[], hash: (f: FileRec) => Promise<string>): Promise<Group[]> {
  const bySize = new Map<number, FileRec[]>();
  for (const f of files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const groups: Group[] = [];
  for (const [size, same] of bySize) {
    if (same.length < 2) continue;
    const byHash = new Map<string, FileRec[]>();
    for (const f of same) { const k = await hash(f); byHash.set(k, [...(byHash.get(k) ?? []), f]); }
    for (const [h, fs] of byHash) if (fs.length > 1) groups.push({ hash: h, size, files: fs });
  }
  return groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1) || a.files[0].path.localeCompare(b.files[0].path));
}

const COPY = /(\bcopy\b|副本|拷贝|\(\d+\)|（\d+）|[-_ ]\d$|\s-\s?\d+$)/i;
const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");

/** 选出每组要保留的文件下标。 */
export function pickKeep(files: FileRec[], rule: string, prefer = ""): number {
  const idx = files.map((_, i) => i);
  const by = (f: (x: FileRec) => number | string) => idx.sort((a, b) => { const x = f(files[a]), y = f(files[b]); return x < y ? -1 : x > y ? 1 : 0; })[0];
  if (rule === "oldest") return by((f) => f.mtime);
  if (rule === "newest") return by((f) => -Date.parse(f.mtime));
  if (rule === "folder" && prefer) {
    const hit = idx.find((i) => files[i].path.startsWith(prefer.replace(/\/?$/, "/")));
    if (hit !== undefined) return hit;
  }
  return idx.sort((a, b) => {
    const ca = COPY.test(stem(files[a].path)) ? 1 : 0, cb = COPY.test(stem(files[b].path)) ? 1 : 0;
    return ca - cb || files[a].path.split("/").length - files[b].path.split("/").length || files[a].path.length - files[b].path.length || files[a].mtime.localeCompare(files[b].mtime) || files[a].path.localeCompare(files[b].path);
  })[0];
}

export const human = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
