// app-server 桥接器（stage-6 会话隔离生产资产；纯 Node 脚本，无 TS/无依赖）。
// 用途：让 TS 侧以「常量可执行文件 + 参数数组」的合规形态孵化 `zcode app-server`，
// 并把父进程的 stdin/stdout/stderr 直接接到 app-server（NDJSON 双向流）。
// 契约：argv[2] = spec 文件路径（JSON）：{ executable, argv, cwd }（env 经 bridge 进程环境传递，
//   不落盘；旧 spec 仍可带 env）
//   executable 必须为绝对路径（TS 侧已校验；此处复核）。
// 行为：spawn(stdio: inherit) → 转发 SIGTERM/SIGINT/SIGHUP → 以子进程退出码退出；
//       spawn 失败 → 写单行可读错误到 stderr → exit 127（不静默）。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const specPath = process.argv[2];
if (typeof specPath !== "string" || specPath.length === 0) {
  process.stderr.write("app-server-bridge: spec path required\n");
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
} catch (err) {
  process.stderr.write(`app-server-bridge: unreadable spec (${err instanceof Error ? err.message : String(err)})\n`);
  process.exit(2);
}
// spec 仍可能含 env（旧格式）：读入内存后立即删除，缩短明文落盘窗口。
try {
  fs.unlinkSync(specPath);
} catch {
  /* best-effort */
}

if (typeof spec.executable !== "string" || !path.isAbsolute(spec.executable)) {
  process.stderr.write("app-server-bridge: executable must be an absolute path\n");
  process.exit(2);
}
if (!Array.isArray(spec.argv) || spec.argv.some((a) => typeof a !== "string")) {
  process.stderr.write("app-server-bridge: argv must be a string array\n");
  process.exit(2);
}

let child;
try {
  child = spawn(spec.executable, spec.argv, {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    stdio: "inherit",
  });
} catch (err) {
  process.stderr.write(`app-server-bridge: spawn failed (${err instanceof Error ? err.message : String(err)})\n`);
  process.exit(127);
}

const forward = (sig) => {
  try {
    child.kill(sig);
  } catch {
    /* 子进程已退出 */
  }
};
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGHUP", () => forward("SIGHUP"));
process.on("exit", () => forward("SIGKILL"));

child.on("error", (err) => {
  process.stderr.write(`app-server-bridge: child error (${err.message})\n`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
