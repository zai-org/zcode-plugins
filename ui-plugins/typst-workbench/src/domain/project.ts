import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { LIMITS } from "#t/contract.ts";

/** 扫描时跳过的目录：隐藏目录与常见的依赖、构建目录。 */
const SKIP = new Set(["node_modules", "target", "__pycache__", "venv"]);

/** 工作区内的 .typ 文件（工作区相对路径，/ 分隔），按深度再按名称排序。 */
export async function scanTypFiles(root: string, depth: number = LIMITS.scanDepth, limit: number = LIMITS.scanFiles): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  const queue: { dir: string; rel: string; level: number }[] = [{ dir: root, rel: "", level: 0 }];
  while (queue.length && visited < limit) {
    const { dir, rel, level } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > limit) break;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (level + 1 < depth && !entry.name.startsWith(".") && !SKIP.has(entry.name)) queue.push({ dir: join(dir, entry.name), rel: path, level: level + 1 });
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".typ")) found.push(path);
    }
  }
  return found.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/**
 * 选择主文件：记住的选择 → 根目录的 main.typ → 根目录唯一的 .typ → 最浅一层唯一的 main.typ → 全部只有一个 .typ。
 * 都不满足时返回 null，由用户或 Agent 选择。
 */
export function chooseMain(candidates: string[], remembered?: string | null): string | null {
  if (remembered && candidates.includes(remembered)) return remembered;
  if (candidates.includes("main.typ")) return "main.typ";
  const top = candidates.filter((path) => !path.includes("/"));
  if (top.length === 1) return top[0]!;
  const mains = candidates.filter((path) => posix.basename(path) === "main.typ");
  if (mains.length) {
    const shallowest = Math.min(...mains.map((path) => path.split("/").length));
    const atDepth = mains.filter((path) => path.split("/").length === shallowest);
    if (atDepth.length === 1) return atDepth[0]!;
  }
  if (candidates.length === 1) return candidates[0]!;
  return null;
}
