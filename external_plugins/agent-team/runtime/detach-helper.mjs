// 轮次进程脱离孵化器（stage-4 生产资产；纯 Node 脚本，无 TS/无依赖）。
// 用途：以「独立进程组 + stdout 落文件」孵化 teammate 轮次进程——孵化器自身立即退出，
// daemon 不持有轮次进程任何管道（daemon 被宿主回收不连带杀轮次、无 EPIPE 面）。
// 契约：argv[2] = spec 文件路径（JSON）：
//   { command, argv, cwd, stdoutFile, resultFile }（env 默认经本 helper 的进程环境传递，
//   不落盘；persistEnv=true 的旧 spec 仍可带 env）
// 行为：spawn(detached) → unref → 把 { pid } 原子写入 resultFile → exit 0；
//       spawn 抛错 → 写 { error } → exit 0（错误经 resultFile 显式上抛，不静默）。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const specPath = process.argv[2];
if (typeof specPath !== "string" || specPath.length === 0) {
  process.stderr.write("detach-helper: spec path required\n");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
// spec 仍可能含 env（persistEnv 旧格式）：读入内存后立即删除，缩短明文落盘窗口。
try {
  fs.unlinkSync(specPath);
} catch {
  /* best-effort */
}
// 默认使用 helper 自身的进程环境（由 spawnDetached 以 execFile env 注入，不落盘）。
const childEnv = spec.env ?? process.env;

let result;
try {
  fs.mkdirSync(path.dirname(spec.stdoutFile), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(spec.stdoutFile, "w", 0o600);
  try {
    const child = spawn(spec.command, spec.argv, {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: childEnv,
      cwd: spec.cwd,
    });
    child.unref();
    // spawn 失败（ENOENT 等）经 'error' 事件异步上报；成功经 'spawn' 确认——二者先到者定案
    result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: "spawn confirmation timeout" }), 2_000);
      child.once("error", (err) => {
        clearTimeout(timer);
        resolve({ error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      });
      child.once("spawn", () => {
        clearTimeout(timer);
        resolve({ pid: child.pid });
      });
    });
  } finally {
    fs.closeSync(fd);
  }
} catch (err) {
  result = { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
}
const tmp = `${spec.resultFile}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(result), { mode: 0o600 });
fs.renameSync(tmp, spec.resultFile);
process.exit(0);
