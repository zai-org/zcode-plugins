#!/usr/bin/env node
/**
 * Print the current injection status of zcode-context in a human-readable
 * form, plus the recommended next step. Read-only.
 *
 * Usage: node status.mjs [--json]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RUNTIME =
  (process.env.ZCONTEXT_RUNTIME_DIR && process.env.ZCONTEXT_RUNTIME_DIR.trim()) ||
  path.join(os.homedir(), ".zcode", "zcode-context", "runtime");
const STATUS_PATH = path.join(RUNTIME, "status.json");
const ASAR_HINTS = [
  "D:\Program Files\ZCode\resources\app.asar",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "resources", "app.asar"),
];

const GUIDANCE = {
  injected:
    "✅ 已注入：侧边栏入口应已可用。若刚更新过 ZCode/插件，请完全退出并重开 ZCode。",
  "pending-restart":
    "⏳ 等待重启：补丁已备好，但 app.asar 被运行中的 ZCode 占用。请完全退出 ZCode（包括托盘进程）后重新打开，入口即会出现。若重开后仍没有，再重启一次，或运行 /remove-panel 后重新安装。",
  "needs-admin":
    "🔒 需要管理员权限：写入 app.asar 被拒绝。请以管理员身份运行一次 ZCode，或设置 ZCODE_ASAR 环境变量指向实际的 app.asar 路径。",
  "waiting-zusage":
    "⏳ 排队中：token 用量悬浮条正在更新 app.asar，本插件已排定在它完成后自动注入。请稍后重启 ZCode。",
  error: "❌ 出错：详见 status.json 的 message 字段；可尝试完全重启 ZCode 后重新打开会话触发自检。",
  unknown:
    "❓ 未找到 app.asar：请确认 ZCode 安装位置，或设置 ZCODE_ASAR 环境变量后重开会话。",
};

function findAsarState() {
  for (const p of ASAR_HINTS) {
    try {
      if (p && fs.existsSync(p)) {
        const s = fs.readFileSync(p).toString("latin1");
        return { p, injected: s.includes("zcode-context") };
      }
    } catch {
      // ignore unreadable
    }
  }
  return null;
}

async function main() {
  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch {
    console.log("尚未运行过注入自检（status.json 不存在）。请重开一个会话触发 SessionStart 自检，或重新安装插件。");
    return;
  }
  const asar = findAsarState();
  const lines = [];
  lines.push(`状态：${status.state}`);
  lines.push(`说明：${status.message}`);
  lines.push(`插件版本：${status.version}  更新时间：${status.updatedAt}`);
  if (asar) {
    lines.push(`app.asar：${asar.p}${asar.injected ? "（包含 zcode-context 注入）" : "（尚未包含注入）"}`);
  }
  const g = GUIDANCE[status.state] || "请完全重启 ZCode 后再试；问题持续请运行 /remove-panel 并重新安装。";
  lines.push(g);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...status, guidance: g, asar }, null, 2));
  } else {
    console.log(lines.join("\n"));
  }
}

try {
  await main();
} catch (error) {
  console.log(`读取状态失败：${error.message}`);
}
