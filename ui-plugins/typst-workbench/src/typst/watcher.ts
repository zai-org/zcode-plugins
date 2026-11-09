import { spawn, type ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Diagnostic } from "#t/contract.ts";
import { WatchLog, parseDeps, type WatchEvent } from "#t/typst/diagnostics.ts";
import { atLeast, run } from "#t/typst/locate.ts";

export interface WatcherOptions {
  typst: string;
  version: string;
  /** typst 的工作目录：工作区根目录（与用户在终端里运行时一致，诊断路径相对它）。 */
  cwd: string;
  /** 主文件，相对 cwd。 */
  main: string;
  /** 本进程私有的构建目录（插件数据目录下）。 */
  buildDir: string;
  env?: NodeJS.ProcessEnv;
  toFile?: (path: string) => string;
  log?: (line: string) => void;
}

export interface WatcherHandlers {
  compiling: (startedAt: number) => void;
  finished: (result: { outcome: "ok" | "warnings" | "error"; durationMs?: number; diagnostics: Diagnostic[] }) => void;
  /** 新的完整 PDF；返回的 Promise 结束后才报告本轮编译结束。 */
  output: (bytes: Uint8Array) => void | Promise<void>;
  fatal: (message: string) => void;
  exit: (info: { code: number | null; signal: NodeJS.Signals | null; tail: string; expected: boolean }) => void;
}

/** 诊断在 “compiled with …” 之后输出；输出静止这么久即视为本轮结束。 */
const QUIET_MS = 25;

/** 文件末尾的 %%EOF 表示 PDF 写完（typst 不是原子写入）。 */
export function isCompletePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString("latin1");
  return head.includes("%PDF-") && tail.includes("%%EOF");
}

/**
 * 一个长期运行的 `typst watch`：typst 自己跟踪依赖并增量编译。
 * 状态来自 stderr 的状态行；PDF 是否更新以文件本身为准（状态行格式变化时仍能更新预览）。
 */
export class Watcher {
  readonly pdfPath: string;
  readonly depsPath: string;
  private child: ChildProcess | null = null;
  private stopping = false;
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private outputCheck: ReturnType<typeof setTimeout> | null = null;
  private lastOutput = "";
  private tail = "";
  private readonly parser: WatchLog;

  constructor(
    private readonly options: WatcherOptions,
    private readonly on: WatcherHandlers,
  ) {
    this.pdfPath = join(options.buildDir, "preview.pdf");
    this.depsPath = join(options.buildDir, "deps.txt");
    this.parser = new WatchLog((event) => this.handle(event), options.toFile);
  }

  get running() {
    return !!this.child && !this.stopping;
  }

  get pid() {
    return this.child?.pid;
  }

  args(): string[] {
    const { main, version } = this.options;
    // 依赖列表：0.14 起为 --deps（JSON），之前为 --make-deps（Makefile）。
    const deps = atLeast(version, [0, 14, 0]) ? ["--deps", this.depsPath, "--deps-format", "json"] : ["--make-deps", this.depsPath];
    return ["watch", main, this.pdfPath, ...deps];
  }

  start() {
    if (this.child) return;
    this.stopping = false;
    // 上一次（可能是另一个主文件）留下的输出不能当作这次的结果。
    for (const path of [this.pdfPath, this.depsPath]) rmSync(path, { force: true });
    this.lastOutput = "";
    const args = this.args();
    this.options.log?.(`starting ${this.options.typst} ${args.join(" ")}`);
    const child = spawn(this.options.typst, args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // 独立进程组：结束时连同子进程一起结束。
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    this.child = child;
    // 记下进程号：server 被强制结束时，下一次启动据此结束遗留的 watch（见 reapOrphans）。
    if (child.pid) writeFileSync(join(this.options.buildDir, PID_FILE), String(child.pid));
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.tail = (this.tail + text).slice(-4000);
      const pending = this.parser.feed(text);
      if (this.quiet) clearTimeout(this.quiet);
      this.quiet = pending ? setTimeout(() => this.parser.finalize(), QUIET_MS) : null;
      this.scheduleOutputCheck(60);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("error", (error) => {
      this.tail += `\n${error.message}`;
    });
    child.on("close", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.parser.feed("\n");
      this.parser.finalize();
      const expected = this.stopping;
      this.stopping = false;
      this.on.exit({ code, signal, tail: this.tail.trim().slice(-1500), expected });
    });
  }

  /** 事件按到达顺序依次处理（读 PDF 是异步的，不能让下一轮的 compiling 抢先）。 */
  private queue: Promise<void> = Promise.resolve();
  private handle(event: WatchEvent) {
    const startedAt = Date.now();
    this.queue = this.queue.then(async () => {
      switch (event.kind) {
        case "compiling":
          this.on.compiling(startedAt);
          break;
        case "finished":
          // 先读 PDF 再报告结束：check 返回时快照已经更新。
          if (event.outcome !== "error") await this.checkOutput().catch(() => undefined);
          this.on.finished(event);
          break;
        case "fatal":
          this.on.fatal(event.message);
          break;
      }
    });
  }

  private scheduleOutputCheck(delay: number) {
    if (this.outputCheck) clearTimeout(this.outputCheck);
    this.outputCheck = setTimeout(() => {
      this.outputCheck = null;
      void this.checkOutput();
    }, delay);
  }

  /** PDF 变了（修改时间或大小）且已写完时读入。 */
  private reading: Promise<void> | null = null;
  checkOutput(): Promise<void> {
    if (this.reading) return this.reading.then(() => this.checkOutput());
    this.reading = (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const info = await stat(this.pdfPath).catch(() => null);
        if (!info) return;
        const stamp = `${info.mtimeMs}:${info.size}`;
        if (stamp === this.lastOutput) return;
        const bytes = new Uint8Array(await readFile(this.pdfPath).catch(() => Buffer.alloc(0)));
        if (isCompletePdf(bytes)) {
          this.lastOutput = stamp;
          await this.on.output(bytes);
          return;
        }
        await new Promise((done) => setTimeout(done, 25));
      }
    })().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  /** 最近一次编译的依赖文件（绝对路径）。 */
  async deps(): Promise<string[]> {
    const text = await readFile(this.depsPath, "utf8").catch(() => "");
    return parseDeps(text).map((path) => (isAbsolute(path) ? path : resolve(this.options.cwd, path)));
  }

  /** 结束 watch 进程（连同进程组）。 */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    if (this.quiet) clearTimeout(this.quiet);
    if (this.outputCheck) clearTimeout(this.outputCheck);
    const closed = new Promise<void>((done) => child.once("close", () => done()));
    killTree(child, "SIGTERM");
    const timer = setTimeout(() => killTree(child, "SIGKILL"), 2_000);
    await closed;
    clearTimeout(timer);
  }

  /** 同步结束（进程退出时）。 */
  killNow() {
    if (this.child) killTree(this.child, "SIGKILL");
  }
}

const PID_FILE = "watch.pid";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 清理构建目录：server 进程已不存在（被强制结束）时，结束它留下的 typst watch 并删除目录；一天以前的目录一律删除。
 * 只结束命令行中含有该构建目录的进程，不会误伤重用了进程号的其他程序。
 */
export async function reapOrphans(base: string, log: (line: string) => void = () => undefined) {
  for (const name of await readdir(base).catch(() => [] as string[])) {
    const dir = join(base, name);
    const owner = Number(/^(\d+)-[0-9a-f]+$/.exec(name)?.[1]);
    const info = await stat(dir).catch(() => null);
    const old = !info || Date.now() - info.mtimeMs > 24 * 3600_000;
    if (owner === process.pid || (owner && alive(owner) && !old)) continue;
    const pid = Number(await readFile(join(dir, PID_FILE), "utf8").catch(() => ""));
    if (pid > 0 && alive(pid) && process.platform !== "win32") {
      const ps = await run("ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 3_000 });
      if (ps.stdout.includes(dir)) {
        log(`stopping typst watch ${pid} left by a previous session`);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // 已经退出。
        }
      }
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 已经退出。
    }
  }
}
