import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  LIMITS,
  TypstError,
  type CompileStatus,
  type Diagnostic,
  type Highlight,
  type HostFacts,
  type PanelView,
  type SessionState,
  type SnapshotInfo,
  type Toolchain,
} from "#t/contract.ts";
import { fuzzyFind, lineRange, lineStarts, locateInSources, skeleton, type SourceFile, type SourceMatch } from "#t/domain/match.ts";
import { chooseMain, scanTypFiles } from "#t/domain/project.ts";
import { findQuote, parsePages, rectsFor, textAt, type PageText } from "#t/domain/text.ts";
import { extractPages, pageCount } from "#t/pdf/extract.ts";
import { detectFacts } from "#t/host/facts.ts";
import { locateTypst, searchedDirs, type LocateOptions } from "#t/typst/locate.ts";
import { exportPdf, renderPages } from "#t/typst/oneshot.ts";
import { Watcher, reapOrphans } from "#t/typst/watcher.ts";

export interface SessionOptions {
  workspaceRoot: string;
  /** 插件数据目录（记住的主文件、构建目录）；没有时用系统临时目录。 */
  dataDir: string | null;
  /** 插件设置 typstPath。 */
  typstPath?: string;
  pdfjsDataDir: string | null;
  env?: NodeJS.ProcessEnv;
  /** 测试注入：替换工具链查找。 */
  locate?: (options: LocateOptions) => Promise<Toolchain>;
  /** 测试注入：替换本机事实探测。 */
  facts?: () => Promise<HostFacts>;
  log?: (line: string) => void;
}

interface Snapshot {
  info: SnapshotInfo;
  bytes: Uint8Array;
  pages?: Promise<PageText[]>;
}

/** cargo 也是一种安装方式（cargo install typst-cli）。 */
const cargo = (env: NodeJS.ProcessEnv) => {
  const home = env.HOME ?? env.USERPROFILE ?? "";
  return [{ name: "cargo", bin: "cargo", dirs: [join(home, ".cargo", "bin")] }];
};

const INSTALL_HINT =
  "Install Typst (for example `brew install typst`, `winget install --id Typst.Typst`, `cargo install --locked typst-cli`, or a release from https://github.com/typst/typst/releases), or set its path in the plugin setting “Typst path”.";

/**
 * 会话的唯一 owner：工具链、主文件、`typst watch` 进程、PDF 快照、诊断、面板视图与 Agent 高亮。
 * 工具与资源都经它读写；面板状态可随时由资源重建。
 */
export class TypstSession {
  readonly workspaceRoot: string;
  private realRoot: string | null = null;
  private readonly log: (line: string) => void;
  private readonly env: NodeJS.ProcessEnv;
  private listeners = new Set<() => void>();
  private stateVersion = 0;

  private toolchain: Toolchain = { state: "unknown" };
  private main: string | null = null;
  private candidates: string[] = [];
  private candidatesAt = 0;
  private status: CompileStatus = { phase: "idle", run: 0 };
  private diagnostics: Diagnostic[] = [];

  private watcher: Watcher | null = null;
  private watcherStartedAt = 0;
  private buildDir: string | null = null;
  /** 正在进行的编译开始的时间，与最近一次结束的编译开始的时间（check 用）。 */
  private compilingSince: number | null = null;
  private finishedStartedAt = 0;
  private finishWaiters = new Set<() => void>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  private snapshots = new Map<number, Snapshot>();
  private current: SnapshotInfo | null = null;
  private seq = 0;

  private highlights: Highlight[] = [];
  private highlightSeq = 0;
  private view: PanelView | null = null;
  private viewSeq = 0;

  private activation: Promise<void> | null = null;
  private activated = false;
  private closed = false;

  // 设置页：本机事实、“已交给 Agent”、面板打开期间的重新查找。
  private facts: HostFacts | null = null;
  private factsPending: Promise<void> | null = null;
  private handoffAt: number | null = null;
  private setupTimer: ReturnType<typeof setInterval> | null = null;
  private setupTicks = 0;
  private rechecking: Promise<void> | null = null;

  constructor(private readonly options: SessionOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.log = options.log ?? (() => undefined);
    this.env = options.env ?? process.env;
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.stateVersion += 1;
    for (const listener of this.listeners) listener();
  }

  state(): SessionState {
    return {
      version: this.stateVersion,
      toolchain: this.toolchain,
      workspace: basename(this.workspaceRoot),
      main: this.main,
      candidates: this.candidates,
      status: this.status,
      diagnostics: this.diagnostics,
      snapshot: this.current,
      view: this.view,
      viewSeq: this.viewSeq,
      highlights: this.highlights,
      setup: {
        facts: this.facts,
        searched: searchedDirs(process.platform, this.env, this.env.HOME ?? this.env.USERPROFILE ?? ""),
        handoffAt: this.handoffAt !== null && Date.now() - this.handoffAt < LIMITS.handoffMs ? this.handoffAt : null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // 启动：工具链、主文件、watch
  // -------------------------------------------------------------------------

  /** 第一次调用工具或面板订阅时启动；之后是空操作。 */
  activate(): Promise<void> {
    this.activation ??= (async () => {
      this.realRoot = await realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
      void this.detectFacts();
      await this.detectToolchain();
      await this.refreshCandidates(true);
      if (!this.main) this.main = chooseMain(this.candidates, await this.remembered());
      await this.startWatcher();
      this.activated = true;
      this.emit();
    })().catch((error) => {
      this.activation = null;
      throw error;
    });
    return this.activation;
  }

  private async detectToolchain(shell = true) {
    const locate = this.options.locate ?? locateTypst;
    const before = this.toolchain;
    this.toolchain = await locate({ setting: this.options.typstPath, env: this.env, shell });
    const changed = before.state !== this.toolchain.state || before.path !== this.toolchain.path || before.version !== this.toolchain.version;
    if (!changed) return;
    if (this.toolchain.state === "ready") this.log(`typst ${this.toolchain.version} at ${this.toolchain.path} (${this.toolchain.source})`);
    else this.log(`typst not usable: ${this.toolchain.state} ${this.toolchain.error ?? ""}`);
  }

  /** 本机事实只探测一次（系统、架构、包管理器不会在会话中变化；cargo 可能被装上，设置页重新检查时刷新）。 */
  private detectFacts(force = false): Promise<void> {
    if (this.facts && !force) return Promise.resolve();
    this.factsPending ??= (this.options.facts ?? (() => detectFacts(cargo(this.env))))()
      .then((facts) => {
        if (JSON.stringify(facts) === JSON.stringify(this.facts)) return;
        this.facts = facts;
        this.emit();
      })
      .catch((error) => this.log(`could not detect host facts: ${error}`))
      .finally(() => (this.factsPending = null));
    return this.factsPending;
  }

  // -------------------------------------------------------------------------
  // 设置页：重新查找、交给 Agent
  // -------------------------------------------------------------------------

  /**
   * 重新查找 Typst（Agent 或用户刚装好时）。找到可用的 Typst 就扫描文件、开始预览。
   * shell 为 false 时跳过登录 shell（面板打开期间的定时查找用它，避免频繁启动 shell）。
   */
  recheck(shell = true): Promise<void> {
    this.rechecking ??= (async () => {
      await this.activate();
      const before = this.toolchain;
      await this.detectToolchain(shell);
      const changed = before.state !== this.toolchain.state || before.path !== this.toolchain.path || before.version !== this.toolchain.version;
      if (!changed) return;
      if (this.toolchain.state === "ready") {
        this.handoffAt = null;
        await this.stopWatcher();
        await this.refreshCandidates(true);
        if (!this.main) this.main = chooseMain(this.candidates, await this.remembered());
        await this.startWatcher();
      }
      this.emit();
    })().finally(() => (this.rechecking = null));
    return this.rechecking;
  }

  /** 面板把安装交给了 Agent：设置页据此显示“正在设置”，直到 Typst 就绪。 */
  handoff() {
    if (this.toolchain.state === "ready") return;
    this.handoffAt = Date.now();
    this.emit();
  }

  /** 面板订阅期间，Typst 不可用时每隔几秒重新查找，装好后预览自动开始。 */
  watchSetup(enabled: boolean) {
    if (enabled && !this.setupTimer && !this.closed) {
      this.setupTicks = 0;
      this.setupTimer = setInterval(() => {
        if (this.toolchain.state === "ready" || this.toolchain.state === "unknown" || this.rechecking) return;
        const shell = ++this.setupTicks % LIMITS.setupShellEvery === 0;
        if (shell) void this.detectFacts(true);
        void this.recheck(shell).catch((error) => this.log(`recheck failed: ${error}`));
      }, LIMITS.setupWatchMs);
      this.setupTimer.unref?.();
    } else if (!enabled && this.setupTimer) {
      clearInterval(this.setupTimer);
      this.setupTimer = null;
    }
  }

  /** 重新查找 typst、重新扫描文件并重启 watch（面板的“重新启动”按钮）。 */
  async restart() {
    await this.activate();
    await this.stopWatcher();
    await this.detectToolchain();
    await this.refreshCandidates(true);
    if (!this.main) this.main = chooseMain(this.candidates, await this.remembered());
    await this.startWatcher();
    this.emit();
  }

  /** 工作区内的 .typ 文件；主文件被删除或新建了文件时更新。 */
  async refreshCandidates(force = false) {
    if (!force && Date.now() - this.candidatesAt < 2_000) return;
    this.candidatesAt = Date.now();
    const next = await scanTypFiles(this.workspaceRoot);
    const changed = next.join("\n") !== this.candidates.join("\n");
    this.candidates = next;
    // 启动完成之前由 activate 自己选择主文件。
    if (!this.activated) return;
    if (this.main && !next.includes(this.main)) {
      this.log(`main file ${this.main} disappeared`);
      await this.stopWatcher();
      this.main = chooseMain(next, await this.remembered());
      this.resetPreview();
      await this.startWatcher();
      this.emit();
    } else if (!this.main && next.length && (this.main = chooseMain(next, await this.remembered()))) {
      await this.startWatcher();
      this.emit();
    } else if (changed) this.emit();
  }

  private async startWatcher() {
    if (this.closed || this.watcher || this.toolchain.state !== "ready" || !this.main) {
      if (!this.watcher) this.status = { phase: "idle", run: this.status.run };
      return;
    }
    if (!this.buildDir) this.buildDir = await this.makeBuildDir();
    const watcher: Watcher = new Watcher(
      {
        typst: this.toolchain.path!,
        version: this.toolchain.version!,
        cwd: this.workspaceRoot,
        main: this.main,
        buildDir: this.buildDir,
        env: this.env,
        toFile: (path) => this.displayPath(path),
        log: this.log,
      },
      {
        compiling: (startedAt) => {
          if (this.watcher !== watcher) return;
          this.compilingSince = startedAt;
          this.status = { ...this.status, phase: "compiling", error: undefined };
          this.emit();
        },
        finished: (result) => {
          if (this.watcher !== watcher) return;
          void this.finish(result.outcome, result.diagnostics, result.durationMs);
        },
        output: (bytes): Promise<void> | undefined => (this.watcher === watcher ? this.addSnapshot(bytes) : undefined),
        fatal: (message) => {
          if (this.watcher !== watcher) return;
          void this.finish("error", [{ severity: "error", message, location: null, hints: [], trace: [] }]);
        },
        exit: ({ code, signal, tail, expected }) => {
          if (this.watcher !== watcher) return;
          this.watcher = null;
          if (expected || this.closed) return;
          this.log(`typst watch exited (code ${code}, signal ${signal}): ${tail}`);
          this.status = { ...this.status, phase: "crashed", error: tail.split("\n").filter(Boolean).slice(-6).join("\n") || `typst exited with code ${code}` };
          this.wakeWaiters();
          this.emit();
          // 运行了一段时间后才退出的，自动重启一次；刚启动就退出的等用户或 Agent 处理。
          if (Date.now() - this.watcherStartedAt > 10_000 && !this.restartTimer)
            this.restartTimer = setTimeout(() => {
              this.restartTimer = null;
              void this.startWatcher().then(() => this.emit());
            }, 1_000);
        },
      },
    );
    this.watcher = watcher;
    this.watcherStartedAt = Date.now();
    this.compilingSince = null;
    this.status = { ...this.status, phase: "starting", error: undefined };
    try {
      watcher.start();
    } catch (error) {
      this.watcher = null;
      this.status = { ...this.status, phase: "crashed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async stopWatcher() {
    const watcher = this.watcher;
    this.watcher = null;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    await watcher?.stop();
  }

  private async makeBuildDir(): Promise<string> {
    const base = join(this.options.dataDir ?? join(tmpdir(), "typst-workbench"), "build");
    await mkdir(base, { recursive: true });
    await reapOrphans(base, this.log);
    const dir = join(base, `${process.pid}-${randomBytes(4).toString("hex")}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private async finish(outcome: "ok" | "warnings" | "error", diagnostics: Diagnostic[], durationMs?: number) {
    this.finishedStartedAt = this.compilingSince ?? Date.now();
    this.compilingSince = null;
    this.diagnostics = await Promise.all(diagnostics.map((entry) => this.withExcerpt(entry)));
    this.status = { phase: outcome, run: this.status.run + 1, durationMs, finishedAt: Date.now() };
    this.wakeWaiters();
    this.emit();
    void this.refreshCandidates();
  }

  private wakeWaiters() {
    // wake 会把自己移出集合；Set 迭代时删除当前元素是安全的。
    for (const wake of this.finishWaiters) wake();
  }

  private waitForFinish(ms: number): Promise<boolean> {
    return new Promise((done) => {
      const wake = () => {
        clearTimeout(timer);
        this.finishWaiters.delete(wake);
        done(true);
      };
      const timer = setTimeout(() => {
        this.finishWaiters.delete(wake);
        done(false);
      }, ms);
      this.finishWaiters.add(wake);
    });
  }

  private resetPreview() {
    this.snapshots.clear();
    this.current = null;
    this.diagnostics = [];
    this.highlights = [];
    this.view = null;
    this.status = { phase: "idle", run: this.status.run };
  }

  // -------------------------------------------------------------------------
  // 主文件
  // -------------------------------------------------------------------------

  private get mainsFile() {
    return this.options.dataDir ? join(this.options.dataDir, "main-files.json") : null;
  }

  private async remembered(): Promise<string | null> {
    if (!this.mainsFile) return null;
    try {
      const saved = JSON.parse(await readFile(this.mainsFile, "utf8")) as Record<string, string>;
      return saved[this.realRoot ?? this.workspaceRoot] ?? null;
    } catch {
      return null;
    }
  }

  private async remember(main: string) {
    if (!this.mainsFile) return;
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(await readFile(this.mainsFile, "utf8")) as Record<string, string>;
    } catch {
      // 第一次保存。
    }
    saved[this.realRoot ?? this.workspaceRoot] = main;
    await mkdir(dirname(this.mainsFile), { recursive: true });
    await writeFile(this.mainsFile, JSON.stringify(saved, null, 2));
  }

  async setMain(path: string): Promise<string> {
    await this.activate();
    const absolute = await this.insideWorkspace(path);
    if (extname(absolute) !== ".typ") throw new TypstError("invalid_input", `${path} is not a .typ file.`);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new TypstError("not_found", `${path} does not exist.`);
    const main = this.relativePath(absolute);
    await this.refreshCandidates(true);
    if (!this.candidates.includes(main)) this.candidates = [...this.candidates, main];
    if (main !== this.main || !this.watcher) {
      await this.stopWatcher();
      this.main = main;
      this.resetPreview();
      await this.startWatcher();
    }
    await this.remember(main).catch((error) => this.log(`could not remember the main file: ${error}`));
    this.emit();
    return main;
  }

  // -------------------------------------------------------------------------
  // 检查：等到最新的修改已经编译
  // -------------------------------------------------------------------------

  /** 工具链与主文件都就绪，否则抛出说明。 */
  requireReady() {
    const toolchain = this.toolchain;
    if (toolchain.state === "missing") throw new TypstError("typst_missing", `Typst was not found on this computer. ${INSTALL_HINT}`);
    if (toolchain.state === "too_old") throw new TypstError("typst_too_old", `${toolchain.error} Update Typst (${toolchain.path}).`);
    if (toolchain.state !== "ready") throw new TypstError("typst_error", toolchain.error ?? "Typst is not available.");
    if (!this.main)
      throw new TypstError(
        "no_main",
        this.candidates.length
          ? `Choose the main file with set_main. .typ files in the workspace: ${this.candidates.slice(0, 20).join(", ")}${this.candidates.length > 20 ? ", …" : ""}.`
          : "There are no .typ files in the workspace yet. Create one (for example main.typ), then call set_main or check.",
        { candidates: this.candidates },
      );
  }

  /** 最近修改的输入文件时间（typst 报告的依赖；还没有时取主文件与工作区里的 .typ 文件）。 */
  private async inputsModifiedAt(): Promise<number> {
    let files = (await this.watcher?.deps()) ?? [];
    if (!files.length) files = [this.main!, ...this.candidates].map((path) => resolve(this.workspaceRoot, path));
    let latest = 0;
    await Promise.all(
      files.slice(0, 2_000).map(async (file) => {
        const info = await stat(file).catch(() => null);
        if (info) latest = Math.max(latest, info.mtimeMs);
      }),
    );
    return Math.min(latest, Date.now());
  }

  /** 等到磁盘上的最新修改都已编译（watch 漏掉修改时重启它）。 */
  async settle(timeoutMs: number = LIMITS.checkTimeoutMs) {
    await this.activate();
    // 还没有主文件时重新扫描：Agent 可能刚创建了它。
    if (!this.main) await this.refreshCandidates(true);
    this.requireReady();
    const deadline = Date.now() + timeoutMs;
    let restarted = false;
    for (;;) {
      if (!this.watcher) {
        // watch 退出了（或从未启动）：重启一次；再次失败时报告原因。
        if (restarted) throw new TypstError("typst_error", `typst watch stopped: ${this.status.error ?? "unknown error"}`);
        restarted = true;
        await this.startWatcher();
        this.emit();
        if (!this.watcher) throw new TypstError("typst_error", this.status.error ?? "typst watch could not start.");
        continue;
      }
      const busy = this.status.phase === "starting" || this.status.phase === "compiling";
      const inputs = await this.inputsModifiedAt();
      if (!busy && this.status.run > 0 && this.finishedStartedAt >= inputs) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new TypstError("timeout", `Typst did not finish compiling within ${Math.round(timeoutMs / 1000)} s. The document may be very large or stuck in a loop.`);
      const finished = await this.waitForFinish(busy ? remaining : Math.min(remaining, LIMITS.settleMs));
      if (!finished && !busy && !restarted) {
        this.log("typst watch did not pick up the latest changes; restarting it");
        restarted = true;
        await this.stopWatcher();
        await this.startWatcher();
        this.emit();
      }
    }
  }

  // -------------------------------------------------------------------------
  // 快照
  // -------------------------------------------------------------------------

  private async addSnapshot(bytes: Uint8Array) {
    if (bytes.length > LIMITS.pdfBytes) {
      this.log(`preview PDF is ${bytes.length} bytes; not shown`);
      return;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (this.current?.sha256 === sha256) return;
    let pages: number;
    try {
      pages = await pageCount(bytes);
    } catch (error) {
      this.log(`could not read the preview PDF: ${error}`);
      return;
    }
    const info: SnapshotInfo = {
      seq: ++this.seq,
      bytes: bytes.length,
      parts: Math.max(1, Math.ceil(bytes.length / LIMITS.chunkBytes)),
      pages,
      sha256,
      createdAt: Date.now(),
    };
    this.snapshots.set(info.seq, { info, bytes });
    while (this.snapshots.size > LIMITS.snapshots) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.current = info;
    this.emit();
    if (this.highlights.length) void this.relocateHighlights(info.seq);
  }

  pdfPart(seq: number, part: number): Uint8Array {
    const snapshot = this.snapshots.get(seq);
    if (!snapshot) throw new TypstError("not_found", `Preview ${seq} is no longer available.`);
    if (!Number.isInteger(part) || part < 0 || part >= snapshot.info.parts) throw new TypstError("invalid_input", `No part ${part}.`);
    return snapshot.bytes.subarray(part * LIMITS.chunkBytes, Math.min(snapshot.bytes.length, (part + 1) * LIMITS.chunkBytes));
  }

  private pagesOf(seq: number): Promise<PageText[]> {
    const snapshot = this.snapshots.get(seq);
    if (!snapshot) throw new TypstError("not_found", `Preview ${seq} is no longer available.`);
    snapshot.pages ??= extractPages(snapshot.bytes, this.options.pdfjsDataDir);
    return snapshot.pages;
  }

  /** 需要一份预览（成功编译过）。 */
  private requireSnapshot(): SnapshotInfo {
    if (!this.current)
      throw new TypstError(
        "no_preview",
        this.status.phase === "error" ? "The document has not compiled successfully yet; fix the errors first (see check)." : "There is no preview yet.",
      );
    return this.current;
  }

  // -------------------------------------------------------------------------
  // 面板视图与高亮
  // -------------------------------------------------------------------------

  showPage(pageIndex: number) {
    const snapshot = this.requireSnapshot();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= snapshot.pages)
      throw new TypstError("invalid_input", `The document has ${snapshot.pages} page(s).`);
    this.view = { kind: "page", pageIndex };
    this.viewSeq += 1;
    this.emit();
  }

  /** 在预览中找文字：先按引文匹配（容忍空白、引号、断词），再按骨架近似匹配。 */
  private findText(pages: PageText[], text: string, preferredPage?: number) {
    const exact = findQuote(pages, text, preferredPage);
    if (exact) return { pageIndex: exact.pageIndex, start: exact.start, end: exact.end, score: 1 };
    let best: { pageIndex: number; start: number; end: number; score: number } | null = null;
    for (const page of pages) {
      const [hit] = fuzzyFind(text, skeleton(page.text), { max: 1 });
      if (hit && (!best || hit.score > best.score + 0.05 || (preferredPage === page.index && hit.score >= best.score - 0.05)))
        best = { pageIndex: page.index, ...hit };
    }
    return best;
  }

  async highlight(target: { quote?: string; file?: string; line?: number; endLine?: number }, comment = ""): Promise<{ highlight: Highlight; exact: boolean }> {
    const snapshot = this.requireSnapshot();
    const pages = await this.pagesOf(snapshot.seq);
    let text: string;
    let source: Highlight["source"];
    if (target.quote) text = target.quote;
    else if (target.file && target.line) {
      const absolute = await this.insideWorkspace(target.file);
      const content = await readFile(absolute, "utf8").catch(() => {
        throw new TypstError("not_found", `${target.file} does not exist.`);
      });
      const starts = lineStarts(content);
      const endLine = Math.max(target.line, target.endLine ?? target.line);
      if (target.line > starts.length) throw new TypstError("invalid_input", `${target.file} has ${starts.length} lines.`);
      const range = lineRange(content, starts, target.line, endLine);
      text = content.slice(range.start, range.end);
      source = { file: this.relativePath(absolute), line: target.line, endLine: Math.min(endLine, starts.length) };
    } else throw new TypstError("invalid_input", "Give a quote, or a file and line.");
    const found = this.findText(pages, text);
    if (!found)
      throw new TypstError(
        "quote_not_found",
        source
          ? `No text from ${source.file}:${source.line}${source.endLine !== source.line ? `–${source.endLine}` : ""} was found in the preview. The lines may contain only markup or code, or the preview may be out of date (run check).`
          : "The quote was not found in the preview. Copy the words as they appear in the rendered document (markup is ignored), or point at source lines with file and line.",
      );
    const page = pages[found.pageIndex]!;
    const highlight: Highlight = {
      id: `h${++this.highlightSeq}`,
      quote: textAt(page, found.start, found.end),
      comment,
      ...(source ? { source } : {}),
      seq: snapshot.seq,
      pageIndex: found.pageIndex,
      rects: rectsFor(page, found.start, found.end),
      stale: false,
      createdAt: Date.now(),
    };
    this.highlights.push(highlight);
    this.view = { kind: "highlight", id: highlight.id };
    this.viewSeq += 1;
    this.emit();
    return { highlight, exact: found.score === 1 };
  }

  /** 新快照后按原文重新定位高亮；找不到的标记为 stale（面板不显示）。 */
  private async relocateHighlights(seq: number) {
    let pages: PageText[];
    try {
      pages = await this.pagesOf(seq);
    } catch {
      return;
    }
    if (this.current?.seq !== seq) return;
    this.highlights = this.highlights.map((highlight) => {
      const found = this.findText(pages, highlight.quote, highlight.pageIndex);
      if (!found) return { ...highlight, seq, stale: true, rects: [] };
      const page = pages[found.pageIndex]!;
      return { ...highlight, seq, stale: false, pageIndex: found.pageIndex, rects: rectsFor(page, found.start, found.end) };
    });
    this.emit();
  }

  clearHighlights(ids?: string[]): number {
    const before = this.highlights.length;
    this.highlights = ids?.length ? this.highlights.filter((entry) => !ids.includes(entry.id)) : [];
    if (this.view?.kind === "highlight" && !this.highlights.some((entry) => entry.id === (this.view as { id: string }).id)) this.view = null;
    this.emit();
    return before - this.highlights.length;
  }

  // -------------------------------------------------------------------------
  // 渲染文字 → 源码
  // -------------------------------------------------------------------------

  /** 项目的源文件：typst 报告的依赖中位于工作区的 .typ 文件；还没有依赖列表时取全部候选。 */
  private async sourceFiles(): Promise<SourceFile[]> {
    const deps = ((await this.watcher?.deps()) ?? []).filter((file) => file.endsWith(".typ"));
    const paths = deps.length ? deps : this.candidates.map((path) => resolve(this.workspaceRoot, path));
    const files: SourceFile[] = [];
    for (const absolute of paths.slice(0, 500)) {
      const rel = relative(this.workspaceRoot, absolute);
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info?.isFile() || info.size > 4 * 1024 * 1024) continue;
      files.push({ path: rel.split(sep).join("/"), text: await readFile(absolute, "utf8") });
    }
    // 主文件优先（同分时排在前面）。
    return files.sort((a, b) => Number(b.path === this.main) - Number(a.path === this.main));
  }

  async locateSource(text: string, focus?: string): Promise<SourceMatch[]> {
    await this.activate();
    return locateInSources(await this.sourceFiles(), text, focus);
  }

  // -------------------------------------------------------------------------
  // 一次性编译：渲染图片、导出
  // -------------------------------------------------------------------------

  private oneshot() {
    this.requireReady();
    return {
      typst: this.toolchain.path!,
      cwd: this.workspaceRoot,
      main: this.main!,
      env: this.env,
      toFile: (path: string) => this.displayPath(path),
    };
  }

  async renderPages(spec: string, ppi: number) {
    await this.activate();
    const options = this.oneshot();
    await this.settle().catch(() => undefined);
    const total = this.current?.pages;
    let pages: number[];
    try {
      pages = parsePages(spec, total ?? 10_000).map((index) => index + 1);
    } catch (error) {
      throw new TypstError("invalid_input", error instanceof Error ? error.message : String(error));
    }
    if (!pages.length) throw new TypstError("invalid_input", total ? `The document has ${total} page(s).` : "No pages selected.");
    if (pages.length > LIMITS.renderPages) throw new TypstError("invalid_input", `Render at most ${LIMITS.renderPages} pages at a time.`);
    if (!this.buildDir) this.buildDir = await this.makeBuildDir();
    const result = await renderPages({ ...options, scratch: this.buildDir }, pages, ppi);
    const diagnostics = await Promise.all(result.diagnostics.map((entry) => this.withExcerpt(entry)));
    return { ...result, diagnostics, pages, total };
  }

  async exportPdf(path: string, extra: { pdfStandard?: string; pages?: string }) {
    await this.activate();
    const options = this.oneshot();
    const absolute = await this.insideWorkspace(path);
    if (extname(absolute).toLowerCase() !== ".pdf") throw new TypstError("invalid_input", "The output path must end in .pdf.");
    await mkdir(dirname(absolute), { recursive: true });
    const result = await exportPdf(options, absolute, extra);
    const diagnostics = await Promise.all(result.diagnostics.map((entry) => this.withExcerpt(entry)));
    if (!result.ok) return { ...result, diagnostics, path: this.relativePath(absolute) };
    const bytes = new Uint8Array(await readFile(absolute));
    return { ...result, diagnostics, path: this.relativePath(absolute), bytes: bytes.length, pages: await pageCount(bytes).catch(() => undefined) };
  }

  // -------------------------------------------------------------------------
  // 路径
  // -------------------------------------------------------------------------

  /** 工作区相对路径（/ 分隔）。 */
  private relativePath(absolute: string): string {
    return relative(this.workspaceRoot, absolute).split(sep).join("/");
  }

  /** typst 输出的路径（相对工作区根目录，或绝对路径）→ 显示用路径。 */
  private displayPath(path: string): string {
    if (!isAbsolute(path)) return path.split(sep).join("/");
    for (const root of [this.workspaceRoot, this.realRoot]) {
      if (!root) continue;
      const rel = relative(root, path);
      if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
    }
    return path;
  }

  /** 解析工作区内的路径（含符号链接），越界时拒绝。 */
  async insideWorkspace(path: string): Promise<string> {
    if (!path || path.includes("\0")) throw new TypstError("invalid_input", "Empty path.");
    const absolute = resolve(this.workspaceRoot, path);
    const root = this.realRoot ?? (await realpath(this.workspaceRoot).catch(() => this.workspaceRoot));
    // 找到最近的已存在的上级目录，解析其真实路径。
    let existing = absolute;
    let rest = "";
    for (;;) {
      try {
        const real = await realpath(existing);
        const full = rest ? join(real, rest) : real;
        const rel = relative(root, full);
        if (rel.startsWith("..") || isAbsolute(rel)) break;
        return absolute;
      } catch {
        const parent = dirname(existing);
        if (parent === existing) break;
        rest = rest ? join(basename(existing), rest) : basename(existing);
        existing = parent;
      }
    }
    throw new TypstError("path_outside_workspace", `${path} is outside the workspace.`);
  }

  /** 工作区内文件的出错行。 */
  private async withExcerpt(diagnostic: Diagnostic): Promise<Diagnostic> {
    const location = diagnostic.location;
    if (!location || location.file.startsWith("@") || isAbsolute(location.file)) return diagnostic;
    try {
      const text = await readFile(resolve(this.workspaceRoot, location.file), "utf8");
      const line = text.split("\n")[location.line - 1];
      return line === undefined ? diagnostic : { ...diagnostic, excerpt: line.replace(/\s+$/, "").slice(0, 300) };
    } catch {
      return diagnostic;
    }
  }

  // -------------------------------------------------------------------------

  async close() {
    this.closed = true;
    this.watchSetup(false);
    await this.stopWatcher();
    if (this.buildDir) await rm(this.buildDir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** 进程退出时同步结束 watch。 */
  killNow() {
    this.watcher?.killNow();
  }
}
