import type { Diagnostic, SourceLocation } from "#t/contract.ts";

/**
 * 解析 typst 的 human 诊断格式（short 格式不含 hint）：
 *
 *   error: unknown variable: a-b
 *     ┌─ main.typ:3:1
 *     │
 *   3 │ #a-b
 *     │  ^^^
 *     │
 *     = hint: if you meant to use subtraction, try adding spaces around the minus sign: `a - b`
 *
 *   help: error occurred in this call of function `f`
 *     ┌─ main.typ:4:1
 *
 * `help:` 是前一条诊断的调用栈。路径相对 typst 的工作目录（插件以工作区根目录启动 typst）。
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const HEADER = /^(error|warning|help)(?:\[[^\]]*\])?: (.*)$/;
const LOCATION = /^\s*[┌╭]─+\s*(.+):(\d+):(\d+)\s*$/;
const NOTE = /^\s*= (?:(hint|note|help): )?(.*)$/;

export const stripAnsi = (text: string) => text.replace(ANSI, "");

export function parseDiagnostics(text: string, toFile: (path: string) => string = (path) => path): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let target: { location: SourceLocation | null } | null = null;
  let current: Diagnostic | null = null;
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const header = HEADER.exec(line);
    if (header) {
      const [, kind, message] = header as unknown as [string, "error" | "warning" | "help", string];
      if (kind === "help") {
        if (current) {
          const point = { message, location: null };
          current.trace.push(point);
          target = point;
        } else target = null;
      } else {
        current = { severity: kind, message, location: null, hints: [], trace: [] };
        diagnostics.push(current);
        target = current;
      }
      continue;
    }
    const location = LOCATION.exec(line);
    if (location && target && !target.location) {
      target.location = { file: toFile(location[1]!), line: Number(location[2]), column: Number(location[3]) };
      continue;
    }
    const note = NOTE.exec(line);
    if (note && current && /^\s*=/.test(line)) current.hints.push(note[2]!.trim());
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// typst watch 的状态行
// ---------------------------------------------------------------------------

export type WatchEvent =
  | { kind: "compiling" }
  | { kind: "finished"; outcome: "ok" | "warnings" | "error"; durationMs?: number; diagnostics: Diagnostic[] }
  /** 编译之外的错误（如找不到输入文件）。 */
  | { kind: "fatal"; message: string };

const STAMP = String.raw`^(?:\[[^\]]*\]\s*)?`;
const COMPILING = new RegExp(`${STAMP}compiling\\b`);
const FINISHED = new RegExp(`${STAMP}compiled (successfully|with warnings|with errors)(?: in ([\\d.]+)\\s*(µs|us|ms|s))?`);

function duration(value: string | undefined, unit: string | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return unit === "s" ? number * 1000 : unit === "ms" ? number : number / 1000;
}

/**
 * 逐块读取 `typst watch` 的 stderr：状态行（compiling … / compiled …）与其后的诊断。
 * 诊断紧跟在“compiled with …”之后，直到下一轮的 “watching …” 或调用方在输出静止后 finalize()。
 */
export class WatchLog {
  private buffer = "";
  private pending: { outcome: "ok" | "warnings" | "error"; durationMs?: number; lines: string[] } | null = null;

  constructor(
    private readonly emit: (event: WatchEvent) => void,
    private readonly toFile: (path: string) => string = (path) => path,
  ) {}

  /** 喂入一段输出。返回是否有待 finalize 的诊断。 */
  feed(chunk: string): boolean {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = stripAnsi(this.buffer.slice(0, newline)).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
    }
    return this.pending !== null;
  }

  private line(line: string) {
    const trimmed = line.trim();
    if (COMPILING.test(trimmed)) {
      this.finalize();
      this.emit({ kind: "compiling" });
      return;
    }
    const finished = FINISHED.exec(trimmed);
    if (finished) {
      this.finalize();
      const outcome = finished[1] === "successfully" ? "ok" : finished[1] === "with warnings" ? "warnings" : "error";
      this.pending = { outcome, durationMs: duration(finished[2], finished[3]), lines: [] };
      if (outcome === "ok") this.finalize();
      return;
    }
    if (/^watching\s/.test(trimmed) || /^writing to\s/.test(trimmed)) {
      this.finalize();
      return;
    }
    if (this.pending) {
      this.pending.lines.push(line);
      return;
    }
    // 编译之外的错误：typst 以 "error: …" 开头且没有位置，如输入文件不存在。
    if (trimmed.startsWith("error: ")) this.emit({ kind: "fatal", message: trimmed.slice(7) });
  }

  /** 结束当前一轮的诊断（下一轮开始、或输出静止一段时间后）。 */
  finalize() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.emit({
      kind: "finished",
      outcome: pending.outcome,
      durationMs: pending.durationMs,
      diagnostics: parseDiagnostics(pending.lines.join("\n"), this.toFile),
    });
  }
}

/** `--deps` 的 JSON（0.14+）或 `--make-deps` 的 Makefile 格式（更早的版本）。 */
export function parseDeps(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) {
    try {
      const value = JSON.parse(trimmed) as { inputs?: unknown };
      return Array.isArray(value.inputs) ? value.inputs.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
      return [];
    }
  }
  // Makefile：target: dep1 dep2 \<newline> dep3；空格以 "\ " 转义，"$" 写作 "$$"。
  const body = trimmed.replace(/\\\r?\n/g, " ");
  const colon = body.search(/(?<!\\):(?=\s|$)/);
  if (colon < 0) return [];
  const deps: string[] = [];
  let currentDep = "";
  const rest = body.slice(colon + 1);
  for (let index = 0; index < rest.length; index++) {
    const char = rest[index]!;
    if (char === "\\" && index + 1 < rest.length && /[\s#\\:]/.test(rest[index + 1]!)) {
      currentDep += rest[++index];
    } else if (char === "$" && rest[index + 1] === "$") {
      currentDep += "$";
      index++;
    } else if (/\s/.test(char)) {
      if (currentDep) deps.push(currentDep);
      currentDep = "";
    } else currentDep += char;
  }
  if (currentDep) deps.push(currentDep);
  return deps;
}
