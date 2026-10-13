// 最近打开文档：JSON 存插件数据目录（按工作区哈希隔离），去重、限量、防抖落盘。
// 只记录路径与时间戳，不存内容；读取失败不阻塞调用方（最近列表缺失只降级 UI）。
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export interface RecentEntry {
  path: string;
  at: number;
}

const MAX_RECENT = 20;
const WRITE_DEBOUNCE_MS = 1_000;

export class RecentStore {
  private entries: RecentEntry[] = [];
  private loaded = false;
  private timer?: ReturnType<typeof setTimeout>;
  private writing = false;
  private readonly file: string;

  constructor(dataDir: string | undefined, workspaceRoot: string) {
    const base = dataDir || join(tmpdir(), "markdown-plugin-data");
    const scope = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
    this.file = join(base, `recent-${scope}.json`);
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as {
        entries?: RecentEntry[];
      };
      if (Array.isArray(parsed.entries))
        this.entries = parsed.entries.filter(
          (entry) => entry && typeof entry.path === "string" && typeof entry.at === "number",
        );
    } catch {
      // 首次使用或文件损坏：从空列表开始。
    }
  }

  /** 记录一次打开；同路径去重置顶。 */
  async touch(path: string) {
    await this.load();
    this.entries = [
      { path, at: Date.now() },
      ...this.entries.filter((entry) => entry.path !== path),
    ].slice(0, MAX_RECENT);
    this.scheduleWrite();
  }

  /** 最近列表（排除当前文档）。 */
  async list(limit = 6, exclude?: string): Promise<RecentEntry[]> {
    await this.load();
    return this.entries.filter((entry) => entry.path !== exclude).slice(0, limit);
  }

  private scheduleWrite() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  private async flush() {
    if (this.writing) {
      this.scheduleWrite();
      return;
    }
    this.writing = true;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify({ entries: this.entries }, null, 2)}\n`, "utf8");
      await rename(temp, this.file);
    } catch {
      // 持久化失败只影响下次会话的最近列表，不影响当前功能。
    } finally {
      this.writing = false;
    }
  }
}
