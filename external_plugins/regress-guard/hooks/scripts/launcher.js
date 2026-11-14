#!/usr/bin/env node
/**
 * launcher.js — 跨平台 hook 启动器（批191 泛化：全钩子统一入口）。
 *
 * ZCode 的 hook command 串在 Windows 宿主下走 cmd 语义，python3 不存在
 * （通常是 python 或 py），所以用 Node（ZCode 必有）作为入口，由它找到
 * 正确的 Python 解释器并转发。
 *
 * 用法（批191 起全部钩子走此形态）：
 *   node launcher.js <script.py> [args...]
 * 无参默认 pre_commit_guard.py（向后兼容既有已装配置与 dsh 桥）。
 *
 * hook.json 配置形态：
 *   { "type": "command",
 *     "command": "node \"${ZCODE_PLUGIN_ROOT}/hooks/scripts/launcher.js\" boundary_guard.py" }
 *
 * 布局自愈：目标脚本按三种部署布局解析——源码态（__dirname/<script>）、
 * 摊平态（install 轨把脚本拷到已装根）、self_heal 特例（lib/ 子目录）。
 * 依次尝试 __dirname/<script> → __dirname/lib/<script>，绝对路径直用。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_GUARD = "pre_commit_guard.py";
// 拒列策略只对提交门禁生效（历史契约：门禁入口的 env 收紧面）
const WHITELIST_TARGET = "pre_commit_guard.py";

// 候选 Python 解释器（按优先级）
const candidates = ["python3", "python", "py"];

// env 拒列（批215，公网 issue#4）：门禁入口原为白名单 19 项——把工具链管理器
// 变量一并裁掉（JAVA_HOME/MISE_*/ASDF_*…），Windows 上 mise/asdf 管 JDK 的项目
// mvn 起不来→测试没跑被记 fail→提交 100% 误拦（外部用户实证）。反转为拒列式：
// 拒绝族=v1.69 白名单本就拒的覆盖类（RG_*/REGRESS_*/WECOM_*/GIT_*：守卫行为/
// 信任判定/git 读数注入面）+ 批191 防投毒（PYTHON* 剥离+强制 PYTHONUTF8）；
// 其余宿主变量自动放行（旧 19 项无一命中拒列前缀=全保留，向后兼容）。
// 与 deploy/dsh-native/lib/index.js childEnv 同款政策（同步演化）。
// 键按大写归一比较（Windows 不区分）。
const ENV_DENY_PREFIXES = ["PYTHON", "RG_", "REGRESS_", "WECOM_", "GIT_",
  "AWS_", "AZURE_", "GOOGLE_", "GITHUB_", "GITLAB_", "GH_", "NPM_TOKEN", "DOCKER_"];

function cleanEnv(env) {
  const out = {};
  for (const k of Object.keys(env)) {
    const ku = k.toUpperCase();
    if (ENV_DENY_PREFIXES.some((p) => ku.startsWith(p))) continue;
    out[k] = env[k];
  }
  out.PYTHONUTF8 = "1";
  return out;
}

/**
 * 非门禁脚本的 env 策略：全量透传但清洗 PYTHON* 键——严格等价原
 * `python3 -E` 的防投毒语义（PYTHONPATH/PYTHONHOME 注入失效），另注入
 * PYTHONUTF8=1（批191：中文 Windows cp936 下 emoji/中文 IO 的根治）。
 */
function scrubbedEnv(env) {
  const out = {};
  for (const k of Object.keys(env)) {
    if (/^PYTHON/i.test(k)) continue;
    out[k] = env[k];
  }
  out.PYTHONUTF8 = "1";
  return out;
}

/**
 * 解析目标脚本路径（布局自愈）：绝对路径直用；相对名依次尝试
 * __dirname/<s>（源码态/摊平态）→ __dirname/lib/<s>（self_heal 特例）。
 * 都不存在时返回首个候选（由子进程报错，保持可诊断性）。
 */
function resolveTarget(script) {
  if (path.isAbsolute(script)) return script;
  const primary = path.join(__dirname, script);
  if (fs.existsSync(primary)) return primary;
  const inLib = path.join(__dirname, "lib", script);
  if (fs.existsSync(inLib)) return inLib;
  return primary;
}

function envFor(target) {
  return path.basename(target) === WHITELIST_TARGET
    ? cleanEnv(process.env)
    : scrubbedEnv(process.env);
}

module.exports = { cleanEnv, scrubbedEnv, resolveTarget, envFor, ENV_DENY_PREFIXES };

function failNoPython() {
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

function tryPython(idx, target, extraArgs) {
  if (idx >= candidates.length) failNoPython();

  const py = candidates[idx];
  const child = spawn(py, [target, ...extraArgs], {
    stdio: ["inherit", "inherit", "inherit"],
    env: envFor(target),
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      // 这个解释器不存在，试下一个
      tryPython(idx + 1, target, extraArgs);
    } else {
      console.error(`REGRESS-GUARD: ❌ 启动 ${py} 失败: ${err.message}`);
      console.error("  这通常是权限问题。尝试: chmod +x " + target);
      process.exit(2);
    }
  });

  child.on("exit", (code) => {
    // 批135 fail-closed：信号击杀（code=null，如 OOM/外部 kill）从 1 改 2——
    // 非 2 会被宿主当「非阻断错误」放行，门禁在崩溃瞬间不应失守
    process.exit(code ?? 2);
  });
}

// launcher 自身未捕获异常 → fail-closed（批135）
process.on("uncaughtException", (err) => {
  console.error("REGRESS-GUARD: ❌ launcher 内部异常（fail-closed）: "
    + (err && err.message));
  process.exit(2);
});

// 直接运行才启动；被 require（测试）时只导出纯函数，不 spawn
if (require.main === module) {
  const argv = process.argv.slice(2);
  const script = argv.length > 0 ? argv[0] : DEFAULT_GUARD;
  const target = resolveTarget(script);
  tryPython(0, target, argv.slice(1));
}
