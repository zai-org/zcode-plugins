// 跨平台桌面动作适配层（阶段 B）：macOS open / Windows 原生 chrome.exe + explorer.exe
// 纯参数构造：只产出 spawn(cmd, args) 的参数数组，绝不拼接 shell 命令、不经 shell 解释，
// 含中文、空格、&、引号的路径一律以独立参数原样传递（数组元素不转义、不拼接）
// gui 标记（R2/R4）：win32 的 chrome.exe 打开 HTTP(S) 引导页 URL 是 GUI 进程，可能常驻（冷启动成为
// 浏览器主进程）或移交既有实例后退出 0；调用方必须按「spawn 确认已发起打开 + 有界观察 + detached
// 脱离父寿命」处理，绝不因常驻而 kill。chrome:// 管理页地址在 Windows 被 Chromium 命令行拒绝
// （R5），不再经由 chrome.exe 打开，改走 openExtensionsPlan 的人工导航计划。
// mac 的 open 与 win32 的 explorer.exe 是短命命令（explorer 移交外壳后即退出），用退出码语义
// 不支持的平台返回 null，由调用方给出可理解的手动指引（不假装成功）
// Windows Chrome 查找：标准系统安装位置（Program Files / Program Files (x86)）+ 用户安装
// （LOCALAPPDATA）；ONBOARD_CHROME_PATH 显式覆盖时按覆盖值判定（不存在即视为未安装，不悄悄回退）
"use strict";

const fs = require("fs");
const path = require("path");

const EXTENSIONS_URL = "chrome://extensions/";
const UNSUPPORTED_REASON = "自动打开仅支持 macOS 与 Windows；请手动完成此步骤";
const CHROME_MISSING_REASON =
  "未在标准安装位置找到 Google Chrome（如已安装可将其放回默认位置）。" +
  "请手动打开 chrome://extensions/ 并按引导页步骤加载扩展文件夹。";

// exists/isFile 均可注入：单元测试用假文件系统验证候选顺序与覆盖语义
function findChromeWin(env = process.env, stat = (p) => { try { const s = fs.statSync(p); return s.isFile() ? p : null; } catch (e) { return null; } }) {
  const override = env.ONBOARD_CHROME_PATH;
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return stat(String(override)); // 显式覆盖存在才可用；不存在即未安装（不回退扫描）
  }
  const cands = [];
  if (env.ProgramFiles) cands.push(path.join(env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"));
  if (env["ProgramFiles(x86)"]) cands.push(path.join(env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"));
  if (env.LOCALAPPDATA) cands.push(path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"));
  for (const c of cands) { const hit = stat(c); if (hit) return hit; }
  return null;
}

// 打开 chrome://extensions 管理页（R5：按平台真实能力返回计划，不假装能打开）：
//   darwin → {kind:"spawn"} open -a "Google Chrome" chrome://extensions/（LaunchServices 导航；open 短命命令）
//   win32  → {kind:"manual"} Chromium 的 ValidateLaunchUrlWebUnsafe 不允许命令行打开 chrome:// 页面
//            （非 headless 时 chrome://extensions 不在许可表，实机只得到空白新标签页）。绝不再发起
//            无效 Chrome 子进程：返回人工导航计划（固定地址由 UI 复制，用户在新标签页地址栏粘贴回车）
//   其他平台 → null（不支持）
const WIN_MANUAL_NAV_REASON =
  "Chromium 安全限制：Windows 命令行无法直接打开 chrome:// 页面（只会得到空白新标签页）。" +
  "请复制管理页地址，在 Chrome 新标签页地址栏粘贴并回车进入扩展管理页。";
function openExtensionsPlan(platform) {
  if (platform === "darwin") return { kind: "spawn", cmd: "open", args: ["-a", "Google Chrome", EXTENSIONS_URL] };
  if (platform === "win32") return { kind: "manual", url: EXTENSIONS_URL, reason: WIN_MANUAL_NAV_REASON };
  return null;
}

// 定位扩展文件夹：
//   darwin → open -R <dir>（Finder 中选中）
//   win32  → explorer.exe <dir>（资源管理器打开该文件夹；固定路径参数，不拼接命令）
function revealFolderArgs(platform, dir) {
  if (platform === "darwin") return { cmd: "open", args: ["-R", dir] };
  if (platform === "win32") return { cmd: "explorer.exe", args: [dir] };
  return null;
}

// 打开引导页 URL（URL 只能来自本地实际引导服务，调用方负责生成）：
//   darwin → open <url>（默认浏览器；open 为短命命令）
//   win32  → <chrome.exe> --new-window <url>（Chrome 缺失 → null，手动打开）
//            标记 gui:true（常驻主进程/移交退出 0 两种寿命；管理页另走人工导航）
function openUrlArgs(platform, url, chromePath) {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") {
    if (!chromePath) return null;
    return { cmd: chromePath, args: ["--new-window", url], gui: true };
  }
  return null;
}

module.exports = { findChromeWin, openExtensionsPlan, revealFolderArgs, openUrlArgs, EXTENSIONS_URL, UNSUPPORTED_REASON, CHROME_MISSING_REASON, WIN_MANUAL_NAV_REASON };
