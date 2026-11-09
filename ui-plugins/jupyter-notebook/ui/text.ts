import type { ErrorOutput, KernelStatus } from "#nb/contract.ts";
import type { Strings } from "#ui/i18n.ts";

// oxlint-disable-next-line no-control-regex -- ANSI / 终端控制字符是有意匹配的
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** 快捷键文字里的 ⌘ 在非 macOS 上写作 Ctrl。 */
export const keys = (text: string) => (isMac ? text : text.replace("⌘", "Ctrl"));

/** “刚刚 / 3 分钟前 / 2 小时前 / 昨天 / 9月28日”。 */
export function relativeTime(at: number, now: number, s: Strings): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 45) return s.justNow;
  if (seconds < 3600) return s.minutesAgo(Math.max(1, Math.round(seconds / 60)));
  const then = new Date(at);
  const today = new Date(now);
  if (then.toDateString() === today.toDateString()) return s.hoursAgo(Math.round(seconds / 3600));
  const yesterday = new Date(now - 86_400_000);
  if (then.toDateString() === yesterday.toDateString()) return s.yesterday;
  return then.toLocaleDateString(s.locale, {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** 运行时长：0.4s、12s、1m 05s。 */
export function duration(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** server URL 的简短写法：`127.0.0.1:8888`，非根路径保留路径。 */
export function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

export type Lamp = "ok" | "busy" | "off" | "bad";
export const lampOf = (status: KernelStatus): Lamp =>
  status === "idle"
    ? "ok"
    : status === "busy" || status === "starting" || status === "restarting"
      ? "busy"
      : status === "none"
        ? "off"
        : "bad";

/**
 * IPython traceback 的简短形式：用户代码所在的那一帧（`Cell In[n], line k` 及箭头附近几行）。
 * 没有这样的帧时取第一帧。frame 保留 ANSI 颜色；total 是完整 traceback 的行数。
 */
export function shortTraceback(output: Pick<ErrorOutput, "traceback" | "ename" | "evalue">): {
  frame: string | null;
  total: number;
} {
  const full = output.traceback.join("\n");
  const total = full ? full.split("\n").length : 0;
  const last = `${output.ename}: ${output.evalue}`;
  const frames = output.traceback.filter((entry) => {
    const plain = stripAnsi(entry).trim();
    return plain && !/^-+$/.test(plain) && !/Traceback \(most recent call last\)/.test(plain) && plain !== last && plain !== output.ename;
  });
  if (!frames.length) return { frame: null, total };
  const chosen = [...frames].reverse().find((entry) => /Cell In\[\d*\]|<ipython-input-/.test(stripAnsi(entry))) ?? frames[0]!;
  // 去掉帧末尾重复的 “Ename: evalue”，并只留箭头附近的几行。
  let lines = chosen.replace(/\n+$/, "").split("\n");
  lines = lines.filter((line) => stripAnsi(line).trim() !== last);
  const arrow = lines.findIndex((line) => /^-+>/.test(stripAnsi(line).trim()));
  if (lines.length > 8) {
    const end = arrow >= 0 ? Math.min(lines.length, arrow + 3) : 8;
    const start = Math.max(1, end - 7);
    lines = [lines[0]!, ...lines.slice(start, end)];
  }
  // SyntaxError 等帧整体缩进；去掉公共缩进。
  const indent = Math.min(
    ...lines.filter((line) => stripAnsi(line).trim()).map((line) => stripAnsi(line).match(/^ */)![0].length),
  );
  if (indent > 0 && Number.isFinite(indent)) lines = lines.map((line) => line.replace(new RegExp(`^((?:\\x1b\\[[0-9;]*m)*) {${indent}}`), "$1"));
  return { frame: lines.join("\n"), total };
}
