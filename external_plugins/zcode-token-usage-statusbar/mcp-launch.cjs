/**
 * stdio MCP 解释器回退启动器（issue #234）。
 *
 * .mcp.json 的 command 固定为 node：宿主给 stdio MCP 子进程的 PATH 末尾追加了
 * Electron Node 的 fallback shim（未装 Node 的机器也能解析 node），而 MCP 单命令
 * 配置没有 hooks.json 那样的 shell 回退通道。本脚本按 hooks 同款顺序
 * python3 → python → py -3 探测可用解释器（--version 实测；Windows Store 的
 * python 桩是 PATH 真实文件、存在性检查全过，只有执行能区分），spawn
 * usage_mcp.py 并原样透传 stdio 与信号。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');

const CANDIDATES = [
  { command: 'python3', args: [] },
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
];

function usable(result) {
  if (!result || result.error || result.status !== 0) return false;
  // 只认行首的 Python 3 版本行；Store 桩（退出码 49、广告走 stderr）与 Python 2
  // 残留在这一步被排除。
  return /^Python 3\.\d/.test(String(result.stdout));
}

// 单独导出供测试锁定探测参数（--version 与 windowsHide 必须在位）。
function defaultProbe(candidate, spawnSyncImpl = spawnSync) {
  return spawnSyncImpl(candidate.command, [...candidate.args, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function pickInterpreter(runProbe = defaultProbe) {
  for (const candidate of CANDIDATES) {
    if (usable(runProbe(candidate))) return candidate;
  }
  return undefined;
}

function main(argv, deps) {
  const d = deps || {};
  const spawnImpl = d.spawn || spawn;
  const stdin = d.stdin || process.stdin;
  const stdout = d.stdout || process.stdout;
  const stderr = d.stderr || process.stderr;
  const exit = d.exit || ((code) => process.exit(code));
  const onSignal = d.onSignal || ((signal, handler) => process.on(signal, handler));

  const script = argv[2];
  if (!script) {
    stderr.write('mcp-launch: missing usage_mcp.py path argument\n');
    exit(127);
    return;
  }

  const picked = pickInterpreter(d.runProbe);
  if (!picked) {
    stderr.write('mcp-launch: no usable Python interpreter (tried python3, python, py -3); install Python 3.8+ and reopen ZCode\n');
    exit(127);
    return;
  }

  const child = spawnImpl(picked.command, [...picked.args, script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  stdin.pipe(child.stdin);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  // 宿主在 win32 用 Job Object/taskkill、POSIX 用进程树遍历回收整棵子树；
  // 这里转发信号让 Python 先于强杀优雅退出，最终回收仍由宿主兜底。
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    onSignal(signal, () => { child.kill(signal); });
  }
  child.on('error', (error) => {
    stderr.write(`mcp-launch: failed to start ${picked.command}: ${error && error.message}\n`);
    exit(127);
  });
  child.on('close', (code) => {
    const status = code === null ? 1 : code;
    // 等最后一段 JSON-RPC 响应写完再退出，防止截断在途帧。
    stdout.write('', () => stderr.write('', () => exit(status)));
  });
  // 对端已关闭管道时避免 EPIPE 变成未捕获异常（Python 先死、宿主仍有在途写入
  // 时 child.stdin 同样会 EPIPE）；退出一律由 child close 驱动。
  child.stdin.on('error', () => {});
  stdin.on('error', () => {});
  stdout.on('error', () => {});
  stderr.on('error', () => {});
}

if (require.main === module) main(process.argv);

module.exports = { CANDIDATES, usable, defaultProbe, pickInterpreter, main };
