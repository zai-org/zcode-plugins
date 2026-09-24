#!/usr/bin/env node
/**
 * launcher.js — 跨平台 hook 启动器。
 *
 * ZCode 的 process hook command 固定为一个可执行文件名。
 * Windows 上 python3 不存在（通常是 python 或 py），所以用 Node（ZCode 必有）
 * 作为入口，由它找到正确的 Python 解释器并转发。
 *
 * hook.json 配置：
 *   { "type": "process", "command": "node", "args": ["${ZCODE_PLUGIN_ROOT}/hooks/scripts/launcher.js"] }
 */
const { spawn } = require("child_process");
const path = require("path");

const guardPy = path.join(__dirname, "pre_commit_guard.py");

// 候选 Python 解释器（按优先级）
const candidates = ["python3", "python", "py"];

// env 白名单（v1.69，run4 R1）：钩子入口构造洁净环境——RG_*/WECOM_*/GIT_* 等
// 覆盖类变量不透传给守卫子进程（env 缝隙族的入口层根治：宿主进程 env 里任何
// 对守卫行为/信任判定/git 读数的注入在此失效）。键按大写归一比较（Windows 不区分）。
const ENV_KEEP = new Set([
  // 系统基础：找解释器/git、编码、临时区、Windows python 依赖
  "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "TMPDIR", "SYSTEMROOT",
  // 代理（通知外发走系统代理语义）
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  // 宿主契约变量（ZCode 注入的会话/项目/插件根——守卫合法依赖）
  "ZCODE_SESSION_ID", "CLAUDE_SESSION_ID",
  "ZCODE_PROJECT_DIR", "CLAUDE_PROJECT_DIR",
  "ZCODE_HOME", "ZCODE_PLUGIN_ROOT",
]);

function cleanEnv(env) {
  const out = {};
  for (const k of Object.keys(env)) {
    if (ENV_KEEP.has(k) || ENV_KEEP.has(k.toUpperCase())) out[k] = env[k];
  }
  return out;
}

module.exports = { cleanEnv, ENV_KEEP };

function tryPython(idx) {
  if (idx >= candidates.length) {
    console.error("REGRESS-GUARD: ❌ 找不到 Python 3 解释器。");
    console.error("  尝试过: " + candidates.join(", "));
    console.error("");
    console.error("  解决方法：");
    console.error("    Windows: 从 https://python.org 安装，勾选 'Add to PATH'");
    console.error("    macOS:   brew install python3");
    console.error("    Linux:   sudo apt install python3 / sudo yum install python3");
    console.error("");
    console.error("  安装后重启 ZCode 再试。");
    console.error("  如需临时跳过：.regress/config.json 设 \"strict\": false");
    process.exit(2);
  }

  const py = candidates[idx];
  const child = spawn(py, [guardPy], {
    stdio: ["inherit", "inherit", "inherit"],
    env: cleanEnv(process.env),
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      // 这个解释器不存在，试下一个
      tryPython(idx + 1);
    } else {
      console.error(`REGRESS-GUARD: ❌ 启动 ${py} 失败: ${err.message}`);
      console.error("  这通常是权限问题。尝试: chmod +x " + guardPy);
      process.exit(2);
    }
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

// 直接运行才启动；被 require（测试）时只导出 cleanEnv，不 spawn
if (require.main === module) {
  tryPython(0);
}
