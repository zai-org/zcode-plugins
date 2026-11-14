#!/usr/bin/env node
// zcode-autoresearch MCP server (stdio, newline-delimited JSON-RPC).
// Tools: init_experiment / run_experiment / log_experiment / export_dashboard / clear_experiments.
// Design: experiment/autoresearch + ADR-1 (MCP tools carry mechanism).
import { spawn } from "node:child_process";
import type {
  ChildProcessByStdio,
  ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { Readable } from "node:stream";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMetricLines,
  unwrapMeasureCommand,
  median,
  detectDoomLoop,
  computeConfidence,
  isBetter,
} from "./lib/experiment.ts";
import {
  resolveBash,
  killTreeOrWrapper,
  quoteShellArg,
  spawnEnv,
} from "./lib/bash.ts";
import {
  autoPaths,
  appendLedgerEntry,
  plateauCalibration,
  readLedger,
  rebuildHistory,
  rebuildState,
  readSessionConfig,
  writeDashboard,
} from "./lib/ledger.ts";
import {
  commitExperiment,
  commitFoundingState,
  rollbackWorkingTree,
  dirtyFiles,
  isGitRepo,
  hasCommit,
  ensureSessionStateIgnored,
  isDirty,
  currentBranch,
  safeShortHash,
  headSha,
  undoCommitTo,
} from "./lib/git.ts";
import { renderDashboard } from "./lib/dashboard.ts";
import { resolveWorkCwd } from "./lib/paths.ts";
import { validateLedger } from "./lib/validate.ts";
import {
  currentHarnessHashes,
  diffHarnessEdits,
  sha256File,
} from "./lib/harness.ts";
import {
  ensureDashboardServer,
  broadcastDashboardUpdate,
} from "./lib/dashboard-server.ts";
import { sweepStaleSpillFiles } from "./lib/spill.ts";
import type {
  Confidence,
  Direction,
  LedgerRun,
  PendingObservation,
  RunStatus,
  SessionState,
} from "./lib/types.ts";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

interface RunOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  /** Metric-parseable text: the full output, or just the METRIC lines when the output spilled to a file. */
  output: string;
  /** Display-tail source: the full output, or a bounded tail when spilled. */
  outputTail: string;
  logFile: string | null;
  timedOut: boolean;
  /** Set when the command could not be spawned at all (missing bash, resolveBash throw). */
  spawnError?: string;
}

interface HookOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  spawnError?: string;
}

interface InitToolArgs {
  name?: unknown;
  metric_name?: string;
  metricName?: string;
  metric_unit?: string;
  metricUnit?: string;
  direction?: string;
  plateau_min_improvement?: unknown;
  plateauMinImprovement?: unknown;
  plateau_window?: unknown;
  plateauWindow?: unknown;
  deterministic?: unknown;
  founding_commit?: unknown;
  foundingCommit?: unknown;
}

interface RunToolArgs {
  command?: unknown;
  timeout_seconds?: number;
  repeat?: number;
}

interface LogToolArgs {
  status?: string;
  description?: unknown;
  metric?: unknown;
  metrics?: Record<string, number>;
  asi?: Record<string, unknown>;
  constraints?: Array<{ name: string; maxPct: number }>;
  commit?: string;
}

const projectCwd = process.cwd();
// Effective research directory: `.auto/config.json` may set workingDir. An
// invalid workingDir throws here on purpose — the server must fail loudly at
// startup rather than point destructive git operations at the project root.
const cwd = resolveWorkCwd(projectCwd);
const paths = autoPaths(cwd);

// Single source of truth for the reported version: read the plugin manifest
// instead of hardcoding a third copy (plugin.json and marketplace.json are
// the other two, guarded by tests/marketplace-contract.test.ts).
const PLUGIN_VERSION = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../.zcode-plugin/plugin.json", import.meta.url),
        "utf8",
      ),
    ) as { version?: string };
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// Numeric env vars are convenience overrides (manifest userConfig seeded via
// env by the host is the primary channel): an invalid value falls back to the
// default with a stderr diagnostic instead of silently taking effect — a
// negative timeout would pass the `||` chain and SIGTERM every run instantly.
function envPositive(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env[name] !== undefined && process.env[name] !== "") {
    process.stderr.write(
      `[autoresearch] ${name}=${process.env[name]} is not a positive finite number; using default ${fallback}\n`,
    );
  }
  return fallback;
}

const DEFAULT_MAX_ITERATIONS = envPositive("AR_MAX_ITERATIONS", 20);
const BENCHMARK_TIMEOUT_MS = envPositive("AR_BENCHMARK_TIMEOUT_MS", 600_000);
// Node's setTimeout treats delays above 2^31-1 ms as 1ms: an unclamped huge
// timeout_seconds would SIGTERM the benchmark immediately instead of never.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const CHECKS_TIMEOUT_MS = envPositive("AR_CHECKS_TIMEOUT_MS", 300_000);

// LLM-facing output budget (mirrors pi-autoresearch): tight truncation.
const LLM_MAX_LINES = 10;
const LLM_MAX_BYTES = 4096;

// ---------------------------------------------------------------------------
// JSON-RPC transport (newline-delimited on stdout; logs on stderr)
// ---------------------------------------------------------------------------

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function result(id: unknown, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function error(id: unknown, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function log(...args: unknown[]) {
  process.stderr.write(`[autoresearch] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function maxIterations() {
  const cfg = readSessionConfig(projectCwd);
  const v = Number(cfg.maxIterations);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_ITERATIONS;
}

function consecutiveFailures() {
  const cfg = readSessionConfig(projectCwd);
  const v = Number(cfg.consecutiveFailures);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

/** Loop calibration (sanitized in ledger.plateauCalibration) for rebuildState. */
function plateauOpts() {
  const cal = plateauCalibration(projectCwd);
  return {
    plateauWindow: cal.window,
    plateauMinImprovement: cal.minImprovement,
    deterministic: cal.deterministic,
  };
}

/**
 * Plateau hint wording reflecting the configured window/threshold. A
 * deterministic benchmark (bitwise reproducible) cannot be confirmed by
 * re-measurement, so the repeat suggestion is dropped for it — and its
 * plateau is no-progress counting, not a magnitude threshold, so the
 * wording reflects that instead of a percentage.
 */
function plateauHintText(): string {
  const cal = plateauCalibration(projectCwd);
  const window = cal.window ?? 5;
  if (cal.deterministic) {
    return `plateau detected (no run beat the current best in the last ${window} runs), opening a new segment, or stopping`;
  }
  const min = cal.minImprovement ?? 0.01;
  const pct = `${(min * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  const confirm = "; consider rerunning with repeat:3 to confirm";
  return `plateau detected (last ${window} runs improved < ${pct})${confirm}, opening a new segment, or stopping`;
}

function sessionState() {
  return rebuildState(cwd, {
    maxIterations: maxIterations(),
    consecutiveFailures: consecutiveFailures(),
    ...plateauOpts(),
  });
}

/**
 * Confidence over a segment's runs (design D4): the same aggregation
 * rebuildState performs (baseline = first valid metric, best = best keep,
 * MAD over the finite values), kept next to the server so the ledger snapshot
 * and the returned confidence share a single computation. A deterministic
 * benchmark (bitwise reproducible) has no noise floor to divide by — the
 * pooled outcome spread across experiments is effect size, not noise — so
 * the delta is exact and no confidence ratio is reported.
 */
function confidenceForSegment(
  runs: LedgerRun[],
  direction: Direction,
  deterministic: boolean,
): Confidence | null {
  let baseline: number | null = null;
  let best: number | null = null;
  const values: number[] = [];
  for (const r of runs) {
    // Crash rows measure nothing (ADR-10; legacy rows carry a 0 placeholder):
    // stay out of baseline and the value set, same as rebuildState.
    if (baseline == null && r.metric != null && r.status !== "crash")
      baseline = r.metric;
    if (r.status === "keep" && r.metric != null) {
      if (best == null || isBetter(r.metric, best, direction)) best = r.metric;
    }
    if (r.metric != null && Number.isFinite(r.metric) && r.status !== "crash")
      values.push(r.metric);
  }
  if (values.length === 0) return null;
  return computeConfidence({ values, baseline, best, deterministic });
}

// Revisit nudge (design D2): the standing check that keeps a discard from
// being forever. Advisory only, so a single fixed string covers every trigger.
const REVISIT_NUDGE =
  "revisit check: before choosing the next experiment, check whether the latest result invalidates a previous discard's rollback reason (see the asi.rollback field on the discard/checks_failed rows in the ledger); if yes: name what changed and weigh a targeted retry of that discard (annotate it with asi.revisits_run: <run number>); if no: move on; verification reruns for measurement noise are separate and do not carry the annotation.";

// noop rolls nothing back by design, so a dirty tree would silently ride into
// the next measurement. Advisory (the dirt may be legitimate user files):
// surface it, let the agent decide.
const NOOP_DIRTY_WARNING =
  "working tree has uncommitted changes outside session state; noop rolls nothing back, so these changes will be part of the next measurement. Restore them (or log them as an experiment) if they are not meant to be measured.";

function truncateTail(
  text: unknown,
  maxLines = LLM_MAX_LINES,
  maxBytes = LLM_MAX_BYTES,
): string {
  if (text == null) return "";
  const lines = String(text).split("\n");
  let out = lines.slice(-maxLines).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = Buffer.from(out, "utf8").subarray(0, maxBytes).toString("utf8");
  }
  return out;
}

// Output accounting: under the spill threshold the full output stays in
// memory; once it spills, data streams straight to the spill file and only
// the METRIC lines (scanned incrementally, position-independent) plus a
// bounded tail survive in memory.
const SPILL_THRESHOLD_BYTES = 2 * 1024 * 1024;
const TAIL_CAP_BYTES = 64 * 1024;
// Spilled logs are read at most until the tool call returns its tail; past
// this age they are only temp-dir litter (and whatever the benchmark printed).
const SPILL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_METRIC_LINES = 1000;
const KILL_GRACE_MS = 5_000;

function runCommand(command: string, timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    let proc: ChildProcessByStdio<null, Readable, Readable>;
    try {
      const bashPath = resolveBash();
      proc = spawn(bashPath, ["-c", command], {
        cwd,
        detached: true, // own process group so we can kill the tree
        stdio: ["ignore", "pipe", "pipe"],
        env: spawnEnv(bashPath),
      });
    } catch (err) {
      // resolveBash throws when no usable bash exists (e.g. Windows without
      // Git Bash) — surface it instead of leaving the tool call hanging.
      resolve({
        exitCode: null,
        signal: null,
        durationMs: 0,
        output: "",
        outputTail: "",
        logFile: null,
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const chunks: Buffer[] = []; // full output, only while under the threshold
    let totalBytes = 0;
    let logFile: string | null = null;
    const tail: Buffer[] = [];
    let tailBytes = 0;
    const metricLines: string[] = [];
    let carry = ""; // partial line carried between data events
    const onData = (d: Buffer) => {
      totalBytes += d.length;
      if (!logFile) {
        chunks.push(d);
        if (totalBytes > SPILL_THRESHOLD_BYTES) {
          logFile = join(
            tmpdir(),
            `autoresearch-experiment-${process.pid}-${Date.now()}.log`,
          );
          sweepStaleSpillFiles(tmpdir(), SPILL_MAX_AGE_MS, Date.now());
          writeFileSync(logFile, Buffer.concat(chunks));
          chunks.length = 0;
          log("output overflowed, spilling to", logFile);
        }
      } else {
        try {
          appendFileSync(logFile, d);
        } catch {
          /* ignore */
        }
      }
      tail.push(d);
      tailBytes += d.length;
      while (tailBytes > TAIL_CAP_BYTES && tail.length > 0) {
        const excess = tailBytes - TAIL_CAP_BYTES;
        const first = tail[0];
        if (first.length <= excess) {
          tailBytes -= first.length;
          tail.shift();
        } else {
          tail[0] = first.subarray(excess);
          tailBytes -= excess;
        }
      }
      carry += d.toString("utf8");
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      if (carry.length > TAIL_CAP_BYTES) carry = carry.slice(-TAIL_CAP_BYTES);
      for (const line of lines) {
        // Trim before matching: the non-spill path (parseMetricLines) accepts
        // indented "  METRIC x=1" lines, and the two paths must agree or a
        // >2MB output silently loses a primary metric a small output kept.
        const trimmed = line.trim();
        if (
          metricLines.length < MAX_METRIC_LINES &&
          trimmed.startsWith("METRIC ")
        )
          metricLines.push(trimmed);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    // "close" waits for stdio to drain; a detached descendant holding the
    // pipes delays it indefinitely — an MSYS binary that survived the Windows
    // tree walk (taskkill kills the bash wrapper but not every forked child),
    // or a daemonized grandchild outside the process group the POSIX kill
    // addresses. The buffer already holds everything needed to judge the
    // run, so exit arms a bounded fallback in ALL cases (timeout-kill and
    // normal exit alike); close pre-empts when it fires and resolve is
    // idempotent, so a late close is a no-op.
    let didTimeout = false;
    let killTimer: NodeJS.Timeout | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    const kill = () => {
      didTimeout = true;
      if (process.platform === "win32") {
        // Windows cannot address process groups via negative pids (ESRCH);
        // taskkill /T /F walks and kills the whole child tree instead. If the
        // walk fails, kill the wrapper so the timeout still settles.
        killTreeOrWrapper(proc.pid, () => proc.kill());
        return;
      }
      try {
        if (proc.pid != null) process.kill(-proc.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      // A benchmark that traps/ignores SIGTERM must not hang the tool call:
      // escalate to SIGKILL (uncatchable) on the whole process group.
      killTimer = setTimeout(() => {
        try {
          if (proc.pid != null) process.kill(-proc.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
    };
    const timer = setTimeout(kill, timeoutMs);
    // A spawn failure (bash missing, cwd gone) otherwise never fires
    // "close" and would hang the tool call — resolve it as spawnError.
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve({
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        output: "",
        outputTail: "",
        logFile: null,
        timedOut: false,
        spawnError: err.message,
      });
    });
    const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      const elapsed = Date.now() - started;
      const full = Buffer.concat(chunks).toString("utf8");
      resolve({
        exitCode: code,
        signal,
        durationMs: elapsed,
        output: logFile ? metricLines.join("\n") : full,
        outputTail: logFile ? Buffer.concat(tail).toString("utf8") : full,
        logFile,
        timedOut: didTimeout,
      });
    };
    proc.on("close", (code, signal) => finalize(code, signal));
    proc.on("exit", (code, signal) => {
      // Bounded settle: give close a short grace to deliver the drained
      // output, then finalize from the exit facts. Without this, an
      // exit-then-no-close process (pipes held by a detached descendant)
      // hangs the tool call forever — the kill timer fires into nothing and
      // no further event ever re-arms finalize.
      if (fallbackTimer) return;
      fallbackTimer = setTimeout(() => finalize(code, signal), KILL_GRACE_MS);
    });
  });
}

async function runChecks(checksFile: string) {
  // The path goes through `bash -c`, where backslashes are escape characters —
  // a Windows absolute path would be eaten into a nonexistent one (exit 127,
  // read as "checks failed"). Forward slashes are valid on both platforms;
  // quoteShellArg keeps apostrophes in the project path from ending the quote.
  const posix = checksFile.replaceAll("\\", "/");
  const res = await runCommand(
    `bash ${quoteShellArg(posix)}`,
    CHECKS_TIMEOUT_MS,
  );
  // A verdict exists only when the script ran to completion: exit 0 = pass,
  // 1..125 = deliberate fail. 126/127 (not executable / not found), null
  // (killed by signal) and large fatal codes (Windows 0xC000013A) mean the
  // gate never produced a judgment. Those are infra, not correctness
  // failures, and must not block keeps — a broken interpreter would
  // otherwise turn every checks run into a veto (evidence 2026-10-28).
  const verdict = res.exitCode !== null && res.exitCode < 126;
  return {
    verdict,
    failed: verdict && res.exitCode !== 0,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    outputTail: truncateTail(res.outputTail, 80, 4096),
  };
}

// ---------------------------------------------------------------------------
// Iteration hooks (.auto/hooks/before.sh / after.sh) — pi-gap M1 (#23)
// ---------------------------------------------------------------------------

const HOOK_TIMEOUT_MS = 30_000;
const HOOK_MAX_BYTES = 8 * 1024;

function isExecutable(file: string): boolean {
  if (!existsSync(file)) return false;
  // NTFS carries no Unix exec bits: Node's stat mode is always 0666, so the
  // bit test below would make iteration hooks unreachable on Windows. The
  // spawn goes through bash anyway, so existence is the opt-in there.
  if (process.platform === "win32") return true;
  try {
    return (statSync(file).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// --- benchmark drift detection (frozen-file hashes) -------------------------
function currentBenchmarkHashes(): {
  measure: string | null;
  checks: string | null;
} {
  return {
    measure: sha256File(paths.measure),
    checks: sha256File(paths.checks),
  };
}

function readBenchmarkHashes() {
  try {
    return readSessionConfig(projectCwd).benchmarkHashes ?? null;
  } catch {
    return null;
  }
}

/** Merge a patch into the project's `.auto/config.json` (creates if missing). */
function patchSessionConfig(patch: Record<string, unknown>): void {
  const cfgDir = join(projectCwd, ".auto");
  const cfgPath = join(cfgDir, "config.json");
  mkdirSync(cfgDir, { recursive: true });
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    // ENOENT → start fresh. A file that exists but is not valid JSON must fail
    // loudly: silently starting fresh would make the write below wipe
    // workingDir, harnessHashes and the off flag along with the corruption.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new Error(
        `.auto/config.json exists but is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix or remove it — refusing to overwrite the session config.`,
      );
    }
  }
  Object.assign(cfg, patch);
  writeSessionConfigAtomic(cfgPath, cfg);
}

/**
 * config.json is the cross-call state family (calibration keys, maxIterations,
 * auditBypass sit next to server-managed keys) and readSessionConfig degrades
 * a corrupt file to `{}` — an in-place writeFileSync truncated by a crash
 * mid-write would silently reset every override on next read. Write to a
 * sibling temp file and rename: rename is atomic on POSIX, so readers only
 * ever see the old or the new complete file.
 */
function writeSessionConfigAtomic(
  cfgPath: string,
  cfg: Record<string, unknown>,
): void {
  const tmpPath = `${cfgPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cfg, null, 2));
  // rename(2) replaces the target regardless of its permission bits — carry
  // the existing mode over, or a chmod-restricted config silently gains
  // default permissions on every update.
  try {
    chmodSync(tmpPath, statSync(cfgPath).mode);
  } catch {
    // ENOENT (first write) → keep the tmp file's default mode.
  }
  renameSync(tmpPath, cfgPath);
}

function writeBenchmarkHashes(hashes: {
  measure: string | null;
  checks: string | null;
}): void {
  patchSessionConfig({ benchmarkHashes: hashes });
}

/**
 * Clear every `pending*` key from `.auto/config.json` (the server cross-call
 * state family: pendingChecksFailed, pendingObservation). Segment boundaries
 * (init_experiment / clear_experiments) reset the whole prefix instead of a
 * per-field list: pendingObservation was added later and both hand-maintained
 * lists missed it, letting a previous session's unconsumed observation attest
 * run #1 of the new segment (red test 2026-11-07). The `pending` prefix is
 * the contract (SessionConfig in types.ts); future keys are covered
 * automatically. A missing or unparsable config clears nothing and is not
 * created: unparsable JSON cannot carry a consumable snapshot anyway
 * (readSessionConfig treats it as empty), and clear must not gain a new
 * failure mode.
 */
function resetPendingState(): void {
  const cfgPath = join(projectCwd, ".auto", "config.json");
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  let touched = false;
  for (const key of Object.keys(cfg)) {
    if (key.startsWith("pending")) {
      delete cfg[key];
      touched = true;
    }
  }
  if (touched) writeSessionConfigAtomic(cfgPath, cfg);
}

/**
 * Persist the checks outcome of the latest run_experiment so log_experiment's
 * keep gate works even across an MCP server restart (pi `runtime.lastRunChecks`
 * equivalent, but on disk). `failed` is true only when checks produced a verdict and it was negative; a checks script that never produced a verdict (not executed / killed) is infra and must not veto keeps.
 */
function setPendingChecksFailed(failed: boolean): void {
  patchSessionConfig({ pendingChecksFailed: failed });
}

function pendingChecksFailed(): boolean {
  return readSessionConfig(projectCwd).pendingChecksFailed === true;
}

/**
 * Observation snapshot of the latest run_experiment (see PendingObservation):
 * run_experiment is the loop's only observer, and before this snapshot its
 * observation died with the response — everything quantitative in the ledger
 * was agent transcription. Same persistence mechanics as pendingChecksFailed
 * (config.json, restart-survivable); overwritten by the next run, consumed by
 * every successful log.
 */
function setPendingObservation(o: PendingObservation | null): void {
  patchSessionConfig({ pendingObservation: o });
}

function readPendingObservation(): PendingObservation | null {
  return readSessionConfig(projectCwd).pendingObservation ?? null;
}

/**
 * Compare current frozen-file hashes against the session's recorded ones.
 * Returns { drift, reason, deleted } where drift is true when a recorded hash
 * changed (deleted=false) or a recorded file was deleted (deleted=true).
 * First sighting (recorded null but file exists) records the hash without
 * warning.
 */
function checkBenchmarkDrift() {
  const recorded = readBenchmarkHashes();
  const current = currentBenchmarkHashes();
  if (!recorded) {
    writeBenchmarkHashes(current);
    return {
      drift: false,
      reason: "recorded",
      deleted: false,
      hashes: current,
    };
  }
  const merged = { ...recorded };
  let firstSeen = false;
  for (const key of ["measure", "checks"] as const) {
    if (recorded[key] == null && current[key] != null) {
      merged[key] = current[key]; // first sighting: record, no warning
      firstSeen = true;
      continue;
    }
    // changed (hash mismatch) or deleted (current null) → drift
    if (recorded[key] != null && current[key] == null) {
      return { drift: true, reason: key, deleted: true, hashes: current };
    }
    if (recorded[key] != null && recorded[key] !== current[key]) {
      return { drift: true, reason: key, deleted: false, hashes: current };
    }
  }
  if (firstSeen) writeBenchmarkHashes(merged);
  return {
    drift: false,
    reason: firstSeen ? "recorded" : null,
    deleted: false,
    hashes: current,
  };
}

// --- mandatory harness trace (editable-surface hashes) -----------------------
// The edit step's discipline (edit rows, verdicts) is advisory; the FACT of a
// surface change is not. Each accounting checkpoint diffs the editable
// surface against the config baseline and appends one harness_edit row per
// moved file — including hand edits, which no tool hook could see. Sessions
// without a baseline (pre-trace config.json) get one silently, no rows.
function recordHarnessEdits(segment?: number): void {
  try {
    const current = currentHarnessHashes(cwd);
    const baseline = readSessionConfig(projectCwd).harnessHashes;
    if (!baseline) {
      patchSessionConfig({ harnessHashes: current });
      return;
    }
    const seg = segment ?? sessionState().segment;
    for (const file of diffHarnessEdits(baseline, current)) {
      appendLedgerEntry(cwd, {
        type: "harness_edit",
        ts: new Date().toISOString(),
        segment: seg,
        file,
        digest_before: baseline[file] ?? null,
        digest_after: current[file] ?? null,
      });
    }
    patchSessionConfig({ harnessHashes: current });
  } catch (err) {
    // Tracing is bookkeeping, not a gate: a failed trace must never block
    // the run/log/export it rides on — but it must not fail silently either
    // (never-silent rule).
    process.stderr.write(
      `[autoresearch] harness trace recording failed (bookkeeping only, not blocking): ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * Run an iteration hook: bash <script>, JSON payload on stdin, 30s timeout,
 * stdout capped at 8KB. Returns the raw outcome; the loop stays fail-open
 * (errors surface as steer text, never block).
 */
function runHookRaw(
  scriptPath: string,
  payload: unknown,
): Promise<HookOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    let proc: ChildProcessWithoutNullStreams;
    try {
      const bashPath = resolveBash();
      proc = spawn(bashPath, [scriptPath], {
        cwd,
        env: spawnEnv(bashPath),
        detached: true, // own process group: the timeout kill must reach the hook's children too
      });
    } catch (err) {
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: 0,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let stderrTail = "";
    proc.stdout.on("data", (d) => {
      if (total < HOOK_MAX_BYTES)
        chunks.push(d.subarray(0, HOOK_MAX_BYTES - total));
      total += d.length;
    });
    proc.stderr.on("data", (d) => {
      if (stderrTail.length < 1024)
        stderrTail += d.toString("utf8").slice(0, 1024 - stderrTail.length);
    });
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      if (process.platform === "win32") {
        // proc.kill cannot reach the hook's child tree on Windows; walk it,
        // falling back to the wrapper if the walk fails.
        killTreeOrWrapper(proc.pid, () => proc.kill("SIGKILL"));
        return;
      }
      // Kill the whole process group (same discipline as the benchmark
      // timeout): a hook that forks background children must not leave them
      // alive to skew the next run's timing.
      try {
        if (proc.pid != null) process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }
    }, HOOK_TIMEOUT_MS);
    const finalize = (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut: didTimeout,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: stderrTail,
        durationMs: Date.now() - started,
      });
    };
    proc.on("close", (code) => finalize(code));
    proc.on("exit", (code) => {
      if (!didTimeout) return;
      setTimeout(() => finalize(code), 1_000);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        spawnError: err.message,
      });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.write(JSON.stringify(payload) + "\n");
    proc.stdin.end();
  });
}

// pi-style steer formatting: failures are steered back to the agent as text;
// a healthy silent hook stays silent.
function steerFor(stage: string, r: HookOutcome): string | null {
  if (r.spawnError) return `[${stage} hook failed to start: ${r.spawnError}]`;
  if (r.timedOut)
    return `[${stage} hook timed out after ${HOOK_TIMEOUT_MS / 1000}s]`;
  if (r.exitCode !== 0) {
    const parts = [`[${stage} hook exited ${r.exitCode}]`];
    if (r.stderr.trim()) parts.push(r.stderr.trim());
    return parts.join("\n");
  }
  const text = r.stdout.trim();
  return text || null;
}

function logHookEntry(stage: "before" | "after", r: HookOutcome): void {
  appendLedgerEntry(cwd, {
    type: "hook",
    stage,
    exit_code: r.exitCode,
    duration_ms: r.durationMs,
    stdout_bytes: Buffer.byteLength(r.stdout, "utf8"),
    timed_out: r.timedOut === true,
  });
}

function hookSessionPayload(state: SessionState) {
  // Wall-clock hooks (budget fuses etc.) need the segment start; handing it
  // over here spares them from parsing the ledger's internal row format.
  const createdMs = state.config?.createdAt
    ? Date.parse(state.config.createdAt)
    : NaN;
  return {
    metric_name: state.config?.metricName ?? null,
    direction: state.config?.direction ?? "lower",
    baseline_metric: state.baseline ?? null,
    best_metric: state.best ?? null,
    run_count: state.runs.length,
    // pi contract parity: pi's SessionSnapshot exposes the session name as
    // `goal`; its shipped example hooks (qmd-search, external-search) read it.
    goal: state.config?.name ?? null,
    started_at_epoch:
      Number.isFinite(createdMs) && createdMs > 0
        ? Math.floor(createdMs / 1000)
        : null,
  };
}

async function runBeforeHook(state: SessionState, nextRun: number) {
  const hook = join(cwd, ".auto", "hooks", "before.sh");
  if (!isExecutable(hook)) return null;
  const last = state.lastRun
    ? {
        run: state.lastRun.run,
        status: state.lastRun.status,
        metric: state.lastRun.metric,
        description: state.lastRun.description ?? null,
        asi: state.lastRun.asi ?? null,
      }
    : null;
  const r = await runHookRaw(hook, {
    event: "before",
    cwd,
    next_run: nextRun,
    last_run: last,
    session: hookSessionPayload(state),
  });
  logHookEntry("before", r);
  const steer = steerFor("before", r);
  return steer ? { steer } : null;
}

async function runAfterHook(runEntry: LedgerRun) {
  const hook = join(cwd, ".auto", "hooks", "after.sh");
  if (!isExecutable(hook)) return null;
  const r = await runHookRaw(hook, {
    event: "after",
    cwd,
    run_entry: {
      run: runEntry.run,
      status: runEntry.status,
      metric: runEntry.metric,
      description: runEntry.description ?? null,
      commit: runEntry.commit ?? null,
      asi: runEntry.asi ?? null,
    },
    session: hookSessionPayload(sessionState()),
  });
  logHookEntry("after", r);
  const steer = steerFor("after", r);
  return steer ? { steer } : null;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function toolInitExperiment(
  args: InitToolArgs,
): Promise<Record<string, unknown>> {
  const name = String(args.name ?? "autoresearch");
  const metricName = String(args.metric_name ?? args.metricName ?? "");
  if (!metricName) return { ok: false, error: "metric_name is required" };
  const metricUnit = args.metric_unit || args.metricUnit || undefined;
  const direction = (args.direction ?? "lower") as Direction;
  if (direction !== "lower" && direction !== "higher") {
    return { ok: false, error: "direction must be lower or higher" };
  }
  // Loop calibration (optional). Rejected at this boundary; config-side reads
  // (ledger.plateauCalibration) fall back to defaults instead of erroring.
  const calibMinRaw =
    args.plateau_min_improvement ?? args.plateauMinImprovement;
  let calibMin: number | undefined;
  if (calibMinRaw != null) {
    const v = Number(calibMinRaw);
    if (!Number.isFinite(v) || v < 0) {
      return {
        ok: false,
        error:
          "plateau_min_improvement must be a number ≥ 0 (min relative improvement over the plateau window; set near the metric's real step size, e.g. 0.0002)",
      };
    }
    calibMin = v;
  }
  const calibWinRaw = args.plateau_window ?? args.plateauWindow;
  let calibWindow: number | undefined;
  if (calibWinRaw != null) {
    const v = Number(calibWinRaw);
    if (!Number.isInteger(v) || v < 2) {
      return {
        ok: false,
        error: "plateau_window must be an integer ≥ 2 (runs)",
      };
    }
    calibWindow = v;
  }
  const calibDet =
    args.deterministic == null ? undefined : args.deterministic === true;
  // Opt-in folding of pre-existing uncommitted work into a founding commit
  // (see the dirtyNote branch below): commit is an outward action, so the
  // host's "no commit without explicit approval" discipline maps to an
  // explicit init argument rather than a default.
  const foundingRaw = args.founding_commit ?? args.foundingCommit;
  const foundingArg = foundingRaw == null ? undefined : foundingRaw === true;
  // The loop's keep/discard semantics (commit + rollback) need git; a non-git
  // research dir would only fail later at log time, in a half-initialized state.
  let repo = false;
  try {
    repo = isGitRepo(cwd);
  } catch (err) {
    return {
      ok: false,
      error: `git is required for the experiment loop: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!repo) {
    return {
      ok: false,
      error: `research directory is not a git repository; the experiment loop needs git commit/rollback semantics. Run git init there (or point .auto/config.json workingDir at a repo) first.`,
    };
  }
  // An unborn HEAD (git init, no commit) passes isGitRepo but the first
  // discard/crash rollback cannot resolve HEAD — reject it before recording
  // a half-initialized session.
  if (!hasCommit(cwd)) {
    return {
      ok: false,
      error:
        "research directory is a git repository but has no commits; commit a baseline first (git add -A && git commit -m baseline) so discard/crash rollback has a HEAD to restore.",
    };
  }
  // Best-effort local ignore for the host session dir: untracked .zcode files
  // then never reach add -A / status / clean -fd (session-state exclusion is
  // enumerated in git.ts either way — this is recurrence prevention, and a
  // failed declaration must not block initialization).
  ensureSessionStateIgnored(cwd);
  // Founding commit (opt-in): re-establish "after init, tree == HEAD" before
  // anything else in the segment runs. Must precede the config write — a git
  // failure here returns before a config row lands (no half-initialized
  // session), mirroring the corrupt-config ordering above.
  let foundingHash: string | null = null;
  if (foundingArg === true) {
    try {
      foundingHash = commitFoundingState(cwd, name);
    } catch (err) {
      return {
        ok: false,
        error: `foundingCommit failed before the session was initialized: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const state = sessionState();
  const segment = (state.segment ?? 0) + 1;
  // Config write precedes the ledger row: a corrupt config.json fails init
  // before a config row lands in the ledger (no half-initialized session).
  // The new segment must not inherit the previous one's cross-call state:
  // stale pending* keys are cleared wholesale (resetPendingState), then the
  // config patch re-baselines what init owns.
  resetPendingState();
  patchSessionConfig({
    benchmarkHashes: currentBenchmarkHashes(),
    harnessHashes: currentHarnessHashes(cwd),
    autoresearchOff: false,
    // Calibration keys are stored only when provided: re-init without them
    // keeps the previous segment's calibration.
    ...(calibMin !== undefined ? { plateauMinImprovement: calibMin } : {}),
    ...(calibWindow !== undefined ? { plateauWindow: calibWindow } : {}),
    ...(calibDet !== undefined ? { deterministic: calibDet } : {}),
  });
  appendLedgerEntry(cwd, {
    type: "config",
    segment,
    name,
    metricName,
    metricUnit,
    direction,
    createdAt: new Date().toISOString(),
  });
  broadcastDashboardUpdate();
  const branch = currentBranch(cwd);
  const branchNote = branch
    ? branch.startsWith("autoresearch/")
      ? ""
      : `\nnote: on branch "${branch}"; consider a dedicated branch (git checkout -b autoresearch/<tag>)`
    : "\nnote: detached HEAD; check out a branch (git checkout -b autoresearch/<tag>) before experimenting";
  // ADR-11 (help-first): a discard reverts the whole working tree (git.ts
  // rollbackWorkingTree), and work that was already uncommitted at session
  // start is indistinguishable from experiment changes later on — the only
  // observable moment is init. With foundingCommit opted in, the warning's
  // advice has already been executed mechanically (founding commit above), so
  // the warning is replaced by the fold report; the default path keeps the
  // warning verbatim so existing flows see exactly the same message.
  const preDirty = dirtyFiles(cwd);
  let dirtyNote = "";
  if (foundingArg === true) {
    dirtyNote = foundingHash
      ? `\nfounding commit ${foundingHash}: pre-existing uncommitted work folded in before the loop starts (keeps no longer ride along, discards restore it)`
      : "\nfoundingCommit: nothing to fold (tree clean or only gitignored content)";
  } else if (preDirty.length > 0) {
    dirtyNote = `\nwarning: working tree is dirty (${preDirty.length} files: ${preDirty.slice(0, 5).join(", ")}${preDirty.length > 5 ? " …" : ""}); these pre-existing changes are outside the experiment's control — a discard before the first keep will revert or delete them too, and uncommitted content is unrecoverable. Commit or stash unrelated work first`;
  }
  const calibrationEcho =
    calibMin !== undefined ||
    calibWindow !== undefined ||
    calibDet !== undefined
      ? {
          ...(calibMin !== undefined
            ? { plateau_min_improvement: calibMin }
            : {}),
          ...(calibWindow !== undefined ? { plateau_window: calibWindow } : {}),
          ...(calibDet !== undefined ? { deterministic: calibDet } : {}),
        }
      : undefined;
  return {
    ok: true,
    segment,
    message:
      `experiment session "${name}" initialized (segment ${segment}). metric=${metricName} direction=${direction}` +
      branchNote +
      dirtyNote,
    ...(foundingArg === true ? { foundingCommit: foundingHash } : {}),
    ...(calibrationEcho ? { calibration: calibrationEcho } : {}),
  };
}

async function toolRunExperiment(
  args: RunToolArgs,
): Promise<Record<string, unknown>> {
  const state = sessionState();
  if (!state.config) {
    return {
      ok: false,
      error:
        "no active experiment session; call init_experiment first (run_experiment will not execute outside a session)",
    };
  }
  const maxIter = state.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (state.runs.length >= maxIter) {
    return {
      ok: false,
      error: `iteration cap (${maxIter}) reached for segment ${state.segment}; start a new segment with init_experiment or stop`,
    };
  }
  // Audit: a crash with unrolled-back working tree must not start a new run.
  // lastRunEver (not lastRun): a dirty tree is physical state, and a config
  // row from init_experiment must not launder it into a fresh segment.
  const lastRun = state.lastRunEver;
  if (lastRun && lastRun.status === "crash") {
    // Fail closed: an unreadable status is an unknown tree, and this gate
    // exists to keep physical state honest — isDirty's swallow-to-false
    // would open it exactly when git is broken (e.g. index.lock contention).
    let treeDirty: boolean;
    try {
      treeDirty = dirtyFiles(cwd).length > 0;
    } catch (err) {
      return {
        ok: false,
        error: `audit: cannot verify working-tree state (git status failed: ${err instanceof Error ? err.message : String(err)}); resolve git before starting a new experiment`,
      };
    }
    if (treeDirty) {
      return {
        ok: false,
        error: `audit: last run was ${lastRun.status} with unrolled-back working-tree changes; revert first (or /autoresearch:clear) before starting a new experiment`,
      };
    }
  }
  // Benchmark drift: frozen files changed since the session baseline.
  const drift = checkBenchmarkDrift();
  const driftWarn = drift.drift
    ? `benchmark_drift: ${drift.reason === "measure" ? "measure.sh" : "checks.sh"} ${drift.deleted ? "was deleted" : "changed"} since session start, so metrics are no longer comparable. Start a new segment (init_experiment) or confirm the change.`
    : null;
  // Residual advisory (evidence nano-jev V1 run 6): a rollback that left the
  // tree dirty poisons later reads. The fact is persisted on the run row at
  // log time; surfaced here while it still matters. Advisory — the residue
  // may have been legitimately edited or cleaned since.
  const lastResidual = state.lastRunEver?.residual;
  const residualWarn =
    lastResidual && lastResidual.length > 0 && isDirty(cwd)
      ? `the last rollback left working-tree residue (${lastResidual.slice(0, 5).join(", ")}${lastResidual.length > 5 ? ", …" : ""}) and the tree is still dirty — later reads would sit on un-rolled-back inputs`
      : null;
  // Harness trace: record editable-surface changes before they can influence
  // this run (the trace precedes the run it may have shaped).
  recordHarnessEdits(state.segment);
  // command omitted defaults to the benchmark script when it exists — after
  // the freeze it is the only legal value anyway, so demanding it again is
  // pure friction (agents routinely hit the required-field error on first
  // call). Free-form mode (no measure.sh) still requires an explicit command.
  let rawCommand = String(args.command ?? "");
  if (!rawCommand.trim()) {
    if (!existsSync(paths.measure)) {
      return {
        ok: false,
        error: "command is required (no .auto/measure.sh to default to)",
      };
    }
    rawCommand = "bash .auto/measure.sh";
  }

  // Benchmark script lock: when .auto/measure.sh exists, only it may run.
  if (existsSync(paths.measure)) {
    const unwrapped = unwrapMeasureCommand(rawCommand, "measure.sh");
    if (!unwrapped) {
      return {
        ok: false,
        error: `.auto/measure.sh exists; run_experiment only executes the benchmark script (e.g. "bash .auto/measure.sh"). The command you gave is not the benchmark script.`,
      };
    }
  }

  const repeat = Math.min(
    Math.max(Math.trunc(Number(args.repeat)) || 1, 1),
    10,
  );
  const requestedMs = Number(args.timeout_seconds ?? 0) * 1000;
  const timeoutMs =
    requestedMs > 0
      ? Math.min(requestedMs, MAX_TIMEOUT_MS)
      : BENCHMARK_TIMEOUT_MS;

  // Iteration hook: .auto/hooks/before.sh runs before the benchmark (fail-open).
  const before = await runBeforeHook(state, state.runs.length + 1);

  const metricName = state.config?.metricName;
  const runs: Array<{
    run: number;
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    duration_ms: number;
    timed_out: boolean;
    metrics: Record<string, number>;
    metric: number | null;
  }> = [];
  let last: RunOutcome | null = null;
  for (let i = 0; i < repeat; i++) {
    last = await runCommand(rawCommand, timeoutMs);
    if (last.spawnError) {
      // Nothing executed, but the attempt is still an observation ("tried
      // and failed") — persist it so an honest crash can be attested.
      setPendingObservation({
        metric: null,
        metrics: {},
        exit_code: null,
        timed_out: false,
        at: new Date().toISOString(),
      });
      // Sibling write, same pairing as the normal path below: no checks ran,
      // so no verdict exists — a stale failed verdict from the previous run
      // must not attest this run's ledger entry.
      setPendingChecksFailed(false);
      return {
        ok: false,
        error: `run_experiment could not start the benchmark: ${last.spawnError}`,
      };
    }
    const { metrics, primary, nearMisses } = parseMetricLines(
      last.output,
      metricName,
    );
    for (const near of nearMisses) {
      log("METRIC-like line failed to parse (not counted):", near);
    }
    runs.push({
      run: i + 1,
      exit_code: last.exitCode,
      signal: last.signal ?? null,
      duration_ms: last.durationMs,
      timed_out: last.timedOut,
      metrics,
      metric: primary ?? null,
    });
  }
  if (last == null)
    return { ok: false, error: "internal: no benchmark run completed" };

  // Correctness backpressure: .auto/checks.sh runs once, after the last run.
  let checks: {
    verdict: boolean;
    failed: boolean;
    exitCode: number | null;
    durationMs: number;
    outputTail: string;
  } | null = null;
  if (existsSync(paths.checks) && last.exitCode === 0) {
    checks = await runChecks(paths.checks);
  }
  // Persist the checks outcome for log_experiment's keep gate (see
  // setPendingChecksFailed). No checks.sh / benchmark crashed → not failed.
  setPendingChecksFailed(checks?.failed === true);

  // Benchmark failure must never be silent: when any repetition exited
  // non-zero or timed out, the metrics' reliability is in question — and when
  // the failure skipped checks.sh, no correctness verdict backs them at all.
  // Advisory only (the keep-gate policy is unchanged): the agent decides what
  // a failed run is worth, but it decides with the fact on the table.
  const failedReps = runs.filter(
    (r) => r.timed_out || r.exit_code !== 0,
  ).length;
  let benchmarkWarning: string | null = null;
  if (failedReps > 0) {
    benchmarkWarning = `${failedReps} of ${runs.length} benchmark run(s) exited non-zero or timed out; metrics may be unreliable.`;
    if (!checks && existsSync(paths.checks))
      benchmarkWarning +=
        " checks.sh was NOT executed (it only runs after a passing benchmark), so no correctness verdict backs these numbers.";
  }

  const values = runs
    .map((r) => r.metric)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const medianMetric =
    repeat > 1 && values.length > 0
      ? median(values)
      : (runs[0]?.metric ?? null);
  // Secondary metrics aggregate to per-name medians across the repetitions,
  // the same source as median_metric (the primary is not special-cased).
  const metricNames = new Set<string>();
  for (const r of runs) {
    for (const n of Object.keys(r.metrics)) metricNames.add(n);
  }
  const aggMetrics: Record<string, number> = {};
  for (const n of metricNames) {
    const vs = runs
      .map((r) => r.metrics[n])
      .filter((v): v is number => v != null && Number.isFinite(v));
    const m = vs.length > 0 ? median(vs) : null;
    if (m != null) aggMetrics[n] = m;
  }

  // Observation snapshot: what this run actually measured is now the only
  // quantitative story log_experiment can tell (binding gates below).
  setPendingObservation({
    metric: medianMetric,
    metrics: aggMetrics,
    exit_code: last.exitCode,
    timed_out: last.timedOut,
    at: new Date().toISOString(),
  });

  const ret = {
    ok: true,
    repeat,
    runs: repeat > 1 ? runs : undefined,
    exit_code: last.exitCode,
    signal: last.signal ?? null,
    duration_ms: last.durationMs,
    timed_out: last.timedOut,
    metrics: aggMetrics,
    metric: medianMetric,
    median_metric: repeat > 1 ? medianMetric : undefined,
    checks: checks
      ? {
          ran: true,
          verdict: checks.verdict,
          failed: checks.failed,
          exit_code: checks.exitCode,
          output_tail: checks.outputTail,
        }
      : { ran: false },
    output_tail: truncateTail(last.outputTail),
    log_file: last.logFile ?? null,
    ...(benchmarkWarning ? { benchmark_warning: benchmarkWarning } : {}),
    ...(residualWarn ? { residual_warning: residualWarn } : {}),
    ...(before ? { before_steer: before.steer } : {}),
    ...(driftWarn ? { benchmark_drift: true, warning: driftWarn } : {}),
    ...(medianMetric != null && state.config
      ? {
          suggestion: `Use these values directly in log_experiment (metric: ${medianMetric})`,
        }
      : {}),
  };
  return ret;
}

async function toolLogExperiment(
  args: LogToolArgs,
): Promise<Record<string, unknown>> {
  // The read→append stretch below is fully synchronous (the only await is the
  // after-hook once the row is written), so pipelined JSON-RPC calls cannot
  // interleave it. Inserting an await between sessionState() and
  // appendLedgerEntry would reintroduce a duplicate-run race.
  const state = sessionState();
  if (!state.config) {
    return {
      ok: false,
      error: "no active experiment session; call init_experiment first",
    };
  }
  // Harness trace before the gates: the edit happened regardless of whether
  // this log passes validation, so the fact is recorded either way.
  recordHarnessEdits(state.segment);
  const status = String(args.status ?? "keep");
  const description = String(args.description ?? "");
  const metric = args.metric != null ? Number(args.metric) : null;
  if (!Number.isFinite(metric) && status !== "crash") {
    return {
      ok: false,
      error:
        "metric must be a finite number for every status except crash (crash measures nothing) — pass the metric run_experiment returned, including for a noop baseline",
    };
  }
  const metrics =
    args.metrics && typeof args.metrics === "object" ? args.metrics : undefined;
  const asi = args.asi && typeof args.asi === "object" ? args.asi : undefined;
  // Constraints are the secondary-metric hard gate: a malformed entry must be
  // rejected loudly, not silently dropped — a dropped constraint fakes
  // protection while the agent believes it is in place (never-silent rule).
  // Runtime shape is untrusted (JSON args), so each entry is validated here
  // instead of trusting the declared type.
  const constraints: Array<{ name: string; maxPct: number }> = [];
  if (args.constraints !== undefined) {
    if (!Array.isArray(args.constraints)) {
      return {
        ok: false,
        error: "constraints must be an array of {name, maxPct} entries",
      };
    }
    for (const c of args.constraints) {
      const entry = c as { name?: unknown; maxPct?: unknown } | null;
      const name = entry?.name;
      const maxPct = entry?.maxPct;
      if (
        typeof name !== "string" ||
        name === "" ||
        typeof maxPct !== "number" ||
        !Number.isFinite(maxPct) ||
        maxPct <= 0
      ) {
        return {
          ok: false,
          error: `malformed constraint entry ${JSON.stringify(c) ?? String(c)}: each constraint needs a non-empty string name and a positive finite number maxPct`,
        };
      }
      constraints.push({ name, maxPct });
    }
  }
  const cfgAudit = readSessionConfig(projectCwd);

  // keep gate: the just-run benchmark's checks failed → refuse keep. The
  // outcome is persisted by run_experiment (pendingChecksFailed), because the
  // ledger cannot know about a run that has not been logged yet.
  if (status === "keep" && pendingChecksFailed()) {
    return {
      ok: false,
      error:
        "the previous run failed correctness checks, so you cannot keep it. use status=checks_failed or discard.",
    };
  }
  // keep gate: metric must be present.
  if (status === "keep" && metric == null) {
    return { ok: false, error: "keep requires a metric value" };
  }
  // Attestation gate: checks_failed claims the correctness gate failed on the
  // latest run, and that claim must be backed by the persisted verdict state —
  // otherwise it is the only escape from the discarded_improvement audit, and
  // a self-serving declaration would pass (red test 2026-11-06: checks_failed
  // with no verdict on record landed and stamped checksFailed: true). Same
  // layer as the keep gate: before the audit, not subject to auditBypass.
  if (status === "checks_failed" && !pendingChecksFailed()) {
    return {
      ok: false,
      error:
        "no failed-checks verdict on record for the latest run_experiment; status=checks_failed must be attested by a failing .auto/checks.sh run. Use status=discard (metric does not beat the retained value) or status=crash (the benchmark itself failed).",
    };
  }
  // Observation binding: the ledger's quantitative story must be transcribed
  // from what run_experiment actually observed (red tests 2026-11-06: a
  // no-run log, a retyped metric and a post-observation fake crash all
  // landed). Fact gate — same layer as the keep gates, not subject to
  // auditBypass; the decision space (keep/discard/noop) is untouched.
  const obs = readPendingObservation();
  if (!obs) {
    return {
      ok: false,
      error:
        "no run_experiment observation to attest this log — run the benchmark first; every successful log consumes the latest observation (one log per run)",
    };
  }
  if (status === "crash") {
    if (obs.metric != null && Number.isFinite(obs.metric)) {
      return {
        ok: false,
        error: `the latest run observed a valid metric (${obs.metric}); a crash attests "measured nothing" — log the observed value as discard/keep instead, or fix the benchmark to fail without emitting METRIC lines`,
      };
    }
  } else if (metric !== obs.metric) {
    return {
      ok: false,
      error: `metric ${metric} does not match the value run_experiment observed (${obs.metric}); log what was measured, or run the benchmark again for a new observation`,
    };
  }
  // Secondary transcription: an explicitly provided metrics dict must be a
  // full transcription of the observed aggregation (same key set, same
  // values) — the row records the observation either way, so a diverging dict
  // would be a false claim about what was measured. Omitting the parameter is
  // always legal. Same fact-gate layer as the primary binding above.
  if (metrics !== undefined) {
    const observed: Record<string, number> = obs.metrics ?? {};
    const given = metrics as Record<string, unknown>;
    const givenKeys = Object.keys(given);
    const observedKeys = Object.keys(observed);
    const unknown = givenKeys.filter((k) => !(k in observed));
    const diverged = givenKeys.filter((k) => {
      const v = given[k];
      return typeof v !== "number" || !Number.isFinite(v) || v !== observed[k];
    });
    if (
      unknown.length > 0 ||
      diverged.length > 0 ||
      givenKeys.length !== observedKeys.length
    ) {
      return {
        ok: false,
        error: `metrics ${JSON.stringify(given)} do not match the aggregation run_experiment observed (${JSON.stringify(observed)}); omit the parameter to record the observation as-is, or transcribe it exactly (available: ${observedKeys.join(", ") || "none"})`,
      };
    }
  }
  // Secondary-metric constraints: keep only if secondary metrics stay within
  // maxPct% of the segment's first run (opt-in; auditBypass unlocks both this
  // and the ledger audit, per ADR-5's single escape hatch).
  const constraintResults = [];
  if (
    status === "keep" &&
    constraints.length > 0 &&
    cfgAudit.auditBypass !== true
  ) {
    const baselineRuns = state.runs[0]?.metrics ?? {};
    for (const c of constraints) {
      // The gate reads the observed aggregation, not the agent's transcription
      // (which may be absent): omitting metrics cannot skip a constraint, and
      // a fabricated value cannot pass one.
      const value = obs.metrics?.[c.name];
      const base = baselineRuns[c.name];
      const limit =
        base != null && Number.isFinite(base)
          ? (base * Number(c.maxPct)) / 100
          : null;
      if (value == null || !Number.isFinite(value) || limit == null) {
        constraintResults.push({
          name: c.name,
          status: "skipped",
          reason: "no baseline or value",
        });
        continue;
      }
      const pass = value <= limit;
      constraintResults.push({
        name: c.name,
        status: pass ? "pass" : "fail",
        value,
        limit,
      });
      if (!pass) {
        return {
          ok: false,
          error: `constraint violation: secondary metric ${c.name}=${value} exceeds limit ${limit} (maxPct ${c.maxPct} of baseline ${base}). Widen the constraint or use status=discard.`,
        };
      }
    }
  }

  // Audit: validate the would-be ledger (existing runs + this row) BEFORE any
  // git operation or file write. auditBypass: true in config skips this.
  const entryPrelim: LedgerRun = {
    type: "run",
    run: state.runs.length + 1,
    segment: state.segment,
    status: status as RunStatus,
    // null (not a 0 placeholder): a crash measured nothing and must not
    // pollute baseline/best/confidence downstream.
    metric: status === "crash" ? null : metric,
    commit: args.commit ?? null,
  };
  if (cfgAudit.auditBypass !== true) {
    const violations = validateLedger(
      [...state.runs, entryPrelim],
      state.config,
    );
    if (violations.length > 0) {
      const v = violations[0];
      const hint =
        v.code === "keep_without_improvement"
          ? "use status=discard (or checks_failed) instead of keep for a non-improving metric"
          : v.code === "discarded_improvement"
            ? "this metric beats the retained value; only status=checks_failed may discard it"
            : v.code === "event_order"
              ? "run numbering/segment is inconsistent; consider /autoresearch:clear"
              : v.code === "commit_field"
                ? "keep rows need a commit, non-keep rows must not have one"
                : "see message";
      return {
        ok: false,
        error: `audit violation (${v.code}): ${v.message}. ${hint}.`,
      };
    }
  }

  let commit = args.commit ?? null;
  // Mechanical tree-state fact at accounting time (session state excluded):
  // recorded on the row regardless of status — post-hoc analysis should see
  // the physical state the claim was made against, not re-derive it. Fail
  // closed before any git step: a row claiming "clean" on an unreadable
  // status would launder exactly the state this fact exists to record.
  let treeDirtyAtLog: boolean;
  try {
    treeDirtyAtLog = dirtyFiles(cwd).length > 0;
  } catch (err) {
    return {
      ok: false,
      error: `cannot verify working-tree state (git status failed: ${err instanceof Error ? err.message : String(err)}); no row written`,
    };
  }
  // Rollback bookkeeping for non-keep rows: what the restore disposed of
  // (rolledBack), where it landed (restoredTo), and what it could not restore
  // (rollbackResidual). Empty for noop — nothing was changed, so there is
  // nothing to roll back.
  let rolledBack: string[] = [];
  let restoredTo: string | null = null;
  let rollbackResidual: string[] = [];
  // HEAD before the keep commit: the rollback target if the ledger append
  // fails after the commit succeeded (see the append guard below). null on
  // an unborn branch — init_experiment rejects those, so this is defensive.
  const preCommitHead = status === "keep" ? headSha(cwd) : null;
  if (status === "keep") {
    const hash = commitExperiment(cwd, {
      description: description || "(no description)",
      result: { metric, metrics: obs.metrics, asi: asi ?? null },
    });
    if (hash) {
      commit = hash;
    } else {
      // keep produced no commit (no working-tree changes) — that is not a real keep
      return {
        ok: false,
        error:
          "audit: keep with no changes to commit; there is nothing to retain. Make a real change first, or use status=noop. (Any pre-staged files outside the experiment were unstaged while attempting the keep — re-stage them if needed.)",
      };
    }
  } else if (status !== "noop") {
    // roll back the experiment's working-tree changes (keep .auto/ intact);
    // noop means nothing was changed, so there is nothing to roll back
    const rb = rollbackWorkingTree(cwd);
    rolledBack = rb.rolledBack;
    restoredTo = rb.restoredTo;
    rollbackResidual = rb.residual;
  }

  const entry: LedgerRun = {
    type: "run",
    run: state.runs.length + 1,
    segment: state.segment,
    status: status as RunStatus,
    metric: status === "crash" ? null : metric,
    // The row records the observation itself, not the agent's transcription:
    // every quantitative claim in the ledger is a measured fact (the
    // transcription gate above only verifies an explicitly provided dict).
    metrics: obs.metrics,
    asi,
    description,
    commit,
    // audit trail: a checks_failed row carries the flag explicitly
    ...(status === "checks_failed" ? { checksFailed: true } : {}),
    treeDirty: treeDirtyAtLog,
    ...(rollbackResidual.length > 0 ? { residual: rollbackResidual } : {}),
    timestamp: new Date().toISOString(),
  };
  // Confidence snapshot (design D4): computed once over "existing runs + this
  // entry" before the ledger write; the return value below reuses the same
  // computation so the row and the response can never disagree. A crash row
  // carries metric null and simply contributes nothing to the values.
  const confSnapshot = confidenceForSegment(
    [...state.runs, entry],
    state.config?.direction ?? "lower",
    plateauOpts().deterministic === true,
  );
  if (confSnapshot) {
    entry.confidence = {
      level: confSnapshot.level,
      value: Number(confSnapshot.confidence.toFixed(2)),
    };
  }

  // Ledger append is the second half of a keep's two-step write (commit →
  // row). If it fails, the commit must not survive as an orphan: a commit
  // without its ledger row silently diverges from the audit chain, and the
  // naive retry dead-ends (the tree is clean, so the next keep finds nothing
  // to commit). Undo the commit (changes return to the tree unstaged) and
  // leave the observation pending — the retry then looks like the first
  // attempt. Non-keep rows have no commit to undo; the rollback above already
  // restored the tree.
  try {
    appendLedgerEntry(cwd, entry);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (status === "keep" && commit != null) {
      if (preCommitHead != null) {
        try {
          undoCommitTo(cwd, preCommitHead);
          return {
            ok: false,
            error: `ledger append failed after the keep commit (commit undone; working tree back to uncommitted changes): ${reason}. No row was written and the observation is still pending — fix the filesystem issue and log again.`,
          };
        } catch (resetErr) {
          return {
            ok: false,
            error: `ledger append failed (${reason}) AND the orphan commit ${commit} could not be undone (${resetErr instanceof Error ? resetErr.message : String(resetErr)}); commit ${commit} has no ledger row — inspect git log and the ledger before proceeding`,
          };
        }
      }
      return {
        ok: false,
        error: `ledger append failed (${reason}); the keep commit ${commit} has no ledger row (no pre-keep HEAD to undo to) — inspect git log and the ledger before proceeding`,
      };
    }
    return {
      ok: false,
      error: `ledger append failed: ${reason}; no row was written and the observation is still pending`,
    };
  }
  // The pending run is now accounted for — clear the keep-gate state and the
  // observation snapshot (one log per run). Clearing is bookkeeping, not the
  // ledger write itself: a failed clear must NOT fail the call — the row is
  // committed, and an error would invite a retry that the still-pending
  // snapshot would attest (a duplicate run row the audit cannot catch). Warn
  // loudly instead; the stale snapshot is overwritten by the next run.
  let pendingResetError: string | null = null;
  try {
    setPendingChecksFailed(false);
  } catch (err) {
    pendingResetError = `pendingChecksFailed: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    setPendingObservation(null);
  } catch (err) {
    const detail = `pendingObservation: ${err instanceof Error ? err.message : String(err)}`;
    pendingResetError = pendingResetError
      ? `${pendingResetError}; ${detail}`
      : detail;
  }
  if (pendingResetError) {
    process.stderr.write(
      `[autoresearch] log_experiment: ledger row was written, but clearing the .auto/config.json pending state failed (${pendingResetError}); do not log again before the next run_experiment\n`,
    );
  }
  broadcastDashboardUpdate();

  // Iteration hook: .auto/hooks/after.sh runs after the record (fail-open).
  const after = await runAfterHook(entry);

  const nextState = rebuildState(cwd, {
    maxIterations: state.maxIterations,
    consecutiveFailures: state.failureThreshold,
    ...plateauOpts(),
  });
  const baseline = nextState.baseline;
  const best = nextState.best;
  // Single source (design D4): the same snapshot written into the ledger row,
  // not a second computation over the rewritten state.
  const conf = confSnapshot;
  // A crash measured nothing; mirror the ledger's null instead of echoing a
  // caller-supplied placeholder into the response/delta.
  const reportedMetric = status === "crash" ? null : metric;
  // Delta anchors to the decision gate: the pre-log retained value (the
  // ratchet line this run was judged against — state predates the append).
  // Anchoring to the baseline instead made a candidate between the baseline
  // and the current best report a POSITIVE delta on a discard — the headline
  // number inverted the verdict (bank-seg2 run15: +0.002044 shown, -0.004942
  // real). The baseline remains the fallback anchor before the first keep,
  // where the two coincide anyway (the first keep must not be worse than the
  // baseline).
  const deltaAnchor = state.best ?? baseline;
  const delta =
    reportedMetric != null && deltaAnchor != null
      ? (reportedMetric - deltaAnchor) *
        (nextState.config?.direction === "higher" ? 1 : -1)
      : null;

  // Revisit nudge trigger: fires at the decision moment — when THIS run is a
  // discard/checks_failed and the segment (including this row) holds reasoned
  // discard/checks_failed rows to re-check. Advisory; omitted on keep/noop/
  // crash landings and when there is nothing reasoned to revisit (standing
  // visibility of discard reasons is the memory inject's job, not this nudge).
  const revisitWorthy =
    (status === "discard" || status === "checks_failed") &&
    [...state.runs, entry].some(
      (r) =>
        (r.status === "discard" || r.status === "checks_failed") &&
        typeof r.asi?.rollback === "string" &&
        r.asi.rollback.trim() !== "",
    );

  // A non-empty rollback residual means later reads would sit on un-rolled-back
  // inputs — that outranks every other hint, because acting on them poisons the
  // segment. Verification itself lives in rollbackWorkingTree (git.ts).
  const maxIterNow = nextState.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const runsLeft =
    nextState.maxIterations != null
      ? Math.max(nextState.maxIterations - nextState.runs.length, 0)
      : null;
  // Computed once for both the hint chain and the doom_loop response field.
  const doom = detectDoomLoop(nextState.runs);
  const baseHint =
    nextState.runs.length >= maxIterNow
      ? "iteration cap reached; run init_experiment for a new segment, or /autoresearch off"
      : runsLeft != null && runsLeft > 0 && runsLeft <= 2
        ? `approaching iteration cap (${nextState.runs.length}/${nextState.maxIterations}); ${runsLeft} run(s) left — plan the closing experiment(s)`
        : doom
          ? "doom loop detected (repeated/oscillating hypotheses); stop repeating: do a research pass first (re-read prompt.md What's Been Tried, related docs, prior near-misses), then pick a structurally different direction"
          : nextState.consecutiveFailures >= nextState.failureThreshold
            ? `consecutive failures reached (${nextState.consecutiveFailures}/${nextState.failureThreshold}); consider a different approach or stopping`
            : nextState.plateau
              ? plateauHintText()
              : "pick the next hypothesis and run_experiment again";

  return {
    ok: true,
    logged: true,
    run: entry.run,
    segment: nextState.segment,
    status,
    commit,
    metric: reportedMetric,
    baseline,
    best,
    delta: delta != null ? Number(delta.toFixed(6)) : null,
    confidence: conf
      ? {
          level: conf.level,
          value: Number(conf.confidence.toFixed(2)),
          unit: "× noise",
        }
      : null,
    plateau: nextState.plateau === true,
    doom_loop: doom?.doomLoop ?? false,
    consecutive_failures: nextState.consecutiveFailures,
    runs_left: runsLeft,
    ...(constraintResults.length > 0 ? { constraints: constraintResults } : {}),
    ...(after ? { after_steer: after.steer } : {}),
    ...(revisitWorthy ? { revisit_nudge: REVISIT_NUDGE } : {}),
    ...(status === "noop" && treeDirtyAtLog
      ? { warning: NOOP_DIRTY_WARNING }
      : {}),
    ...(pendingResetError
      ? {
          pending_reset_warning: `the run row was written, but the cross-call state in .auto/config.json could not be cleared (${pendingResetError}); do not log again before the next run_experiment — the stale snapshot is overwritten by the next run`,
        }
      : {}),
    ...(rolledBack.length > 0
      ? {
          rolled_back: {
            restored_to: restoredTo,
            files: rolledBack.slice(0, 20),
            total_files: rolledBack.length,
          },
        }
      : {}),
    ...(rollbackResidual.length > 0
      ? { rollback_residual: rollbackResidual }
      : {}),
    next_action_hint:
      rollbackResidual.length > 0
        ? `rollback left working-tree changes (${rollbackResidual.join(", ")}); restore them before the next trial — later reads would sit on un-rolled-back inputs`
        : baseHint,
  };
}

async function toolClearExperiments() {
  // Pending state is mechanism state, not user intent: reset it
  // unconditionally — including on the early-exit path below — so a stale
  // observation cannot attest the next session's first log (red test
  // 2026-11-07). autoresearchOff stays reset only on the active path: it is
  // user intent (/autoresearch:off), outside the pending* contract.
  resetPendingState();
  if (!existsSync(paths.log))
    return { ok: true, message: "no active session to clear" };
  // Clearing is a fresh start: a paused loop must not survive into the next
  // session. A corrupt config must not block the reset (clear must not gain
  // a new failure mode): the ledger deletion proceeds; the config itself
  // stays broken and needs the user's hand either way.
  try {
    patchSessionConfig({ autoresearchOff: false });
  } catch (err) {
    process.stderr.write(
      `[autoresearch] clear_experiments: could not reset autoresearchOff in .auto/config.json (${err instanceof Error ? err.message : String(err)}); ledger deletion proceeds\n`,
    );
  }
  const { rmSync } = await import("node:fs");
  rmSync(paths.log, { force: true });
  return {
    ok: true,
    message: "cleared .auto/log.jsonl; start fresh with init_experiment",
  };
}

async function toolExportDashboard() {
  // Harness trace closes the tail: edits made after the last log_experiment
  // still reach the ledger before this archive is rendered.
  recordHarnessEdits();
  const history = rebuildHistory(readLedger(cwd));
  const html = renderDashboard(history, { pin: safeShortHash(cwd) });
  writeDashboard(cwd, html);
  let info: Awaited<ReturnType<typeof ensureDashboardServer>> | null = null;
  try {
    info = await ensureDashboardServer(cwd);
  } catch (err) {
    // The static export already succeeded; a sandboxed host may refuse to
    // bind a socket — degrade to static-only instead of masking the written
    // file behind a tool error.
    log(
      "live dashboard unavailable:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return {
    ok: true,
    file: paths.dashboard,
    url: info?.url ?? null,
    experiments: history.totalRuns,
    message: info
      ? `live dashboard at ${info.url} (auto-refreshes on each experiment); static copy at ${paths.dashboard}`
      : `static dashboard written to ${paths.dashboard}`,
  };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "init_experiment",
    description:
      "Start or restart an autoresearch experiment segment. Call once per optimization target: name the session, the primary metric (parsed from `METRIC name=value` lines of the benchmark), optional unit and direction (lower/higher, default lower). Writes the session config to .auto/log.jsonl and advances the segment.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "session name" },
        metric_name: {
          type: "string",
          description: "primary metric name, e.g. time_ms",
        },
        metric_unit: {
          type: "string",
          description: "optional unit: ms, s, kb, mb, ...",
        },
        direction: {
          type: "string",
          enum: ["lower", "higher"],
          description: "lower is better (default) or higher is better",
        },
        plateau_min_improvement: {
          type: "number",
          description:
            "optional plateau threshold: minimum relative improvement over the window (default 0.01 = 1%); set near the metric's real step size (e.g. 0.0002 for an AUC moving in the 4th decimal) to avoid false plateaus",
        },
        plateau_window: {
          type: "number",
          description: "optional plateau window in runs (default 5, min 2)",
        },
        deterministic: {
          type: "boolean",
          description:
            "benchmark is deterministic (bitwise reproducible); plateau switches to no-progress counting (a window with no run beating the current best) and hints will not suggest repeat re-measurement",
        },
        founding_commit: {
          type: "boolean",
          description:
            "when true and the working tree is dirty, commit pre-existing uncommitted work as a segment founding commit (segment: prefix) before the loop starts; keeps then cannot ride along and discards restore it. Default false: dirty tree only warns (advisory)",
        },
      },
      required: ["metric_name"],
    },
  },
  {
    name: "run_experiment",
    description:
      "Run the benchmark command (repeat times when repeat>1, returns the median metric), time it, and parse `METRIC name=value` lines from its output. If .auto/measure.sh exists, ONLY that script may be run. If .auto/checks.sh exists it runs once after the last run (correctness backpressure). Returns a compact output tail (10 lines / 4KB) plus a log file path when output overflows. The per-repetition `runs` array (repeat>1) is numbered 1..repeat — a repetition index, not the ledger run number. For noisy metrics use repeat:3 and log the returned median_metric.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "shell command to run; optional when .auto/measure.sh exists (defaults to it), required in free-form mode",
        },
        timeout_seconds: {
          type: "number",
          description:
            "override timeout in seconds (default 600, capped at 2147483)",
        },
        repeat: {
          type: "number",
          description:
            "run the benchmark N times and return the median metric (1-10, default 1)",
        },
      },
    },
  },
  {
    name: "log_experiment",
    description:
      "Record the experiment outcome. keep → auto-commit with `experiment:` prefix and structured Result in the message; discard/crash/checks_failed → drop working-tree changes while keeping .auto/ intact. Returns baseline/best/delta/confidence and a next-action hint. delta is direction-adjusted improvement vs the current best (the pre-log retained value; the baseline anchors before the first keep) — the same gate the keep audit enforces.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["keep", "discard", "crash", "checks_failed", "noop"],
        },
        metric: {
          type: "number",
          description:
            "primary metric value from run_experiment (omit for crash; the ledger row records null)",
        },
        description: {
          type: "string",
          description: "one-line summary of the hypothesis and change",
        },
        metrics: { type: "object", description: "optional secondary metrics" },
        constraints: {
          type: "array",
          description:
            'optional hard limits on secondary metrics when keeping, e.g. [{name: "memory_mb", maxPct: 105}]. Keep is rejected if the secondary metric exceeds maxPct% of the first run\'s value',
        },
        asi: {
          type: "object",
          description:
            "Actionable Side Information that survives revert, e.g. {hypothesis, next_action_hint, rollback}",
        },
        commit: {
          type: "string",
          description:
            "optional 7-char short hash; ignored on keep (the real hash is filled in); rejected on non-keep statuses (audit: commit_field)",
        },
      },
      required: ["status", "description"],
    },
  },
  {
    name: "export_dashboard",
    description:
      "Render .auto/log.jsonl into a self-contained static HTML dashboard at autoresearch-dashboard.html, and host a live SSE page (auto-refreshing) on a local port. Call after experiments to get a human-readable progress report.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clear_experiments",
    description:
      "Delete .auto/log.jsonl and reset the session state (segment back to 0). All other .auto/ files are kept: measure.sh, checks.sh, prompt.md, goal.md, scope.md, ideas.md, experience.md and config.json. Use to start a fresh experiment target.",
    inputSchema: { type: "object", properties: {} },
  },
];

const handlerFor: Record<
  string,
  (args: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  init_experiment: toolInitExperiment,
  run_experiment: toolRunExperiment,
  log_experiment: toolLogExperiment,
  export_dashboard: toolExportDashboard,
  clear_experiments: toolClearExperiments,
};

// ---------------------------------------------------------------------------
// Transport loop
// ---------------------------------------------------------------------------

let buffer = "";
// Line-framed JSON-RPC: input without a newline is invalid framing and would
// otherwise grow the buffer without bound (broken or hostile client).
const STDIN_BUFFER_CAP = 10 * 1024 * 1024;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (buffer.length > STDIN_BUFFER_CAP) {
    process.stderr.write(
      `[autoresearch] stdin exceeded ${STDIN_BUFFER_CAP} bytes without a newline; dropping buffered input\n`,
    );
    buffer = "";
  }
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // JSON-RPC requires a -32700 for unparseable frames; silent skipping
      // would leave the caller waiting on a response that never comes.
      process.stderr.write(
        `[autoresearch] unparseable JSON-RPC line: ${line.slice(0, 120)}\n`,
      );
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }
    dispatch(msg);
  }
});

async function dispatch(msg: JsonRpcRequest) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "autoresearch", version: PLUGIN_VERSION },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") {
    result(msg.id, { tools: TOOLS });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name ?? "";
    const args = msg.params?.arguments ?? {};
    const handler = handlerFor[name];
    if (!handler) {
      error(msg.id, -32601, `unknown tool: ${name}`);
      return;
    }
    try {
      const out = await handler(args);
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      result(msg.id, { content: [{ type: "text", text }] });
    } catch (err) {
      error(msg.id, -32000, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (msg.method === "exit") {
    process.exit(0);
  }
  // Unknown method with an id must not hang the caller: JSON-RPC requires a
  // -32601 response. Notifications (no id) stay silent.
  if (msg.id != null) {
    error(msg.id, -32601, `method not found: ${msg.method}`);
  }
}
