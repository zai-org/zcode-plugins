// 变化监视：仅在存在订阅者时以 1s 间隔对比数据库指纹，变化即回调。
// 数据库被运行中的 ZCode 持有（WAL），轮询读指纹不会阻塞写方。
import { UsageDb } from "./db.js";

export class DbWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFp: string | null = null;

  constructor(
    private readonly db: UsageDb,
    private readonly onChange: () => void,
    private readonly intervalMs = 1000,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.lastFp = null; // 重启后首轮对比不触发通知
    this.timer = setInterval(() => {
      try {
        const fp = this.db.fingerprint();
        if (this.lastFp !== null && fp !== this.lastFp) this.onChange();
        this.lastFp = fp;
      } catch {
        // 库暂时不可读（如 checkpoint 中）时静默重试
      }
    }, this.intervalMs);
    // 避免 timer 阻止进程退出
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
