#!/usr/bin/env node
// Browser Bridge · ZCode SessionStart 钩子（纯 Node、幂等、有界）
// ---------------------------------------------------------------------------
// 职责：会话建立时「预热」已验收的通用启动核心（<插件根>/server/launcher.js 的 ensureReady）：
//   桥接服务幂等拉起/复用、扩展稳定副本同步、尚未展示且扩展未连接时打开一次图形引导（失败退避/并发去重）。
//
// 与 MCP 主链的准确区别（重要，勿改语义）：
//   - MCP 启动才是主链：宿主激活 server/mcp-stdio.js 时（时机由宿主决定——有的宿主在新会话
//     立即 initialize，有的延迟到首次工具调用），mcp-stdio 进程启动即自动执行同一 ensureReady。
//   - 本钩子只是优化：让支持 SessionStart 的宿主（如 ZCode）在用户发出第一条消息之前
//     就完成准备。本包不假设所有宿主都会在新会话立刻初始化 MCP，也不假设宿主会运行钩子；
//     任一条链先到即完成准备，后到者幂等复用（跨进程锁 + 健康探测 + 完成标记）。
//
// 约束：
//   - stdout 恒为空（不污染宿主输出）；诊断只写 stderr，且不输出引导 URL/token。
//   - 任何失败都不阻塞会话建立：始终以退出码 0 结束。
//   - 纯 Node：不依赖 Bash/Git Bash/WSL/Homebrew；不硬编码任何开发者路径。
//   - 插件根定位：优先宿主注入的 CLAUDE_PLUGIN_ROOT（须含 server/launcher.js），
//     无效或缺失时从本文件位置自定位（hooks/ 的上一级）。
// 运行依赖：PATH 中的 node（与 plugin.json 的 mcpServers.command 一致）；无系统 Node 的
//   机器上钩子不生效但不报错阻塞，主链同样需要 node——该场景须真实客户端验证，见 workbuddy/README-ZH.md。

"use strict";

const fs = require("fs");
const path = require("path");

const HARD_BUDGET_MS = 15000; // 预热自限时限（hooks.json timeoutMs 20000 内留出余量）

function resolvePluginRoot() {
  const self = path.resolve(__dirname, "..");
  const fromEnv = process.env.ZCODE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  const envName = process.env.ZCODE_PLUGIN_ROOT ? "ZCODE_PLUGIN_ROOT" : "CLAUDE_PLUGIN_ROOT";
  if (fromEnv && path.isAbsolute(fromEnv)) {
    const abs = path.resolve(fromEnv);
    if (fs.existsSync(path.join(abs, "server", "launcher.js"))) {
      return { root: abs, via: envName };
    }
    process.stderr.write("[session-start] " + envName + " 无效（缺少 server/launcher.js），已回退自定位\n");
  }
  return { root: self, via: "self" };
}

function summarize(r) {
  if (!r || r.__timeout === true) return "timeout";
  const bridge = r.bridge ? (r.bridge.reused ? "reused" : "launched") : String(r.skipped || "none");
  const ext = r.ext ? ("updated:" + (r.ext.updated === true)) : "none";
  const onb = r.onboarding && r.onboarding.skipped ? ("skipped:" + r.onboarding.skipped)
    : r.onboarding && r.onboarding.triggered ? "triggered" : "none";
  return "bridge=" + bridge + " ext=" + ext + " onboarding=" + onb;
}

async function main() {
  const { root, via } = resolvePluginRoot();
  const launcherPath = path.join(root, "server", "launcher.js");
  if (!fs.existsSync(launcherPath)) {
    process.stderr.write("[session-start] 未找到启动核心 " + launcherPath + "，跳过预热（MCP 激活时会再次尝试）\n");
    return;
  }
  const launcher = require(launcherPath);
  const guard = setTimeout(() => {
    process.stderr.write("[session-start] 预热超过 " + HARD_BUDGET_MS + "ms，提前返回；后续由 MCP 主链接管\n");
    process.exit(0); // 后台进程均已 detached，安全退出
  }, HARD_BUDGET_MS);
  let r;
  try {
    r = await launcher.ensureReady({ layoutRoot: root });
  } catch (e) {
    clearTimeout(guard);
    process.stderr.write("[session-start] 预热异常（不阻塞会话）：" + (e && e.message || e) + "\n");
    return;
  }
  clearTimeout(guard);
  process.stderr.write("[session-start] result rootVia=" + via + " " + summarize(r) +
    (r && r.ok === false ? " reason=" + r.reason : "") + "\n");
}

main().catch((e) => {
  process.stderr.write("[session-start] 未捕获异常（不阻塞会话）：" + (e && e.message || e) + "\n");
  process.exit(0);
});
