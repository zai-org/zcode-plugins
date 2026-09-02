#!/usr/bin/env node
// zcode-autoresearch MCP server (stdio, newline-delimited JSON-RPC).
// Tools: init_experiment / run_experiment / log_experiment / export_dashboard.
// Design: experiment/autoresearch + ADR-1 (MCP tools carry mechanism).
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMetricLines,
  unwrapMeasureCommand,
  median,
  detectDoomLoop,
} from "./lib/experiment.ts";
import {
  autoPaths,
  appendLedgerEntry,
  rebuildState,
  readSessionConfig,
  writeDashboard,
} from "./lib/ledger.ts";
import {
  commitExperiment,
  rollbackWorkingTree,
  isGitRepo,
  isDirty,
  currentBranch,
} from "./lib/git.ts";
import { renderDashboard } from "./lib/dashboard.ts";
import { resolveWorkCwd } from "./lib/paths.ts";
import { validateLedger } from "./lib/validate.ts";
import {
  ensureDashboardServer,
  broadcastDashboardUpdate,
} from "./lib/dashboard-server.ts";
import type {
  Direction,
  LedgerRun,
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
// Effective research directory: `.auto/config.json` may set workingDir.
const cwd = resolveWorkCwd(projectCwd);
const paths = autoPaths(cwd);

const envMax = Number(process.env.AR_MAX_ITERATIONS);
const DEFAULT_MAX_ITERATIONS =
  Number.isFinite(envMax) && envMax > 0 ? envMax : 20;
const BENCHMARK_TIMEOUT_MS =
  Number(process.env.AR_BENCHMARK_TIMEOUT_MS) || 600_000;
const CHECKS_TIMEOUT_MS = Number(process.env.AR_CHECKS_TIMEOUT_MS) || 300_000;

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

function sessionState() {
  return rebuildState(cwd, {
    maxIterations: maxIterations(),
    consecutiveFailures: consecutiveFailures(),
  });
}

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
const MAX_METRIC_LINES = 1000;
const KILL_GRACE_MS = 5_000;

function runCommand(command: string, timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn("bash", ["-c", command], {
      cwd,
      detached: true, // own process group so we can kill the tree
      stdio: ["ignore", "pipe", "pipe"],
    });
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
            `pi-experiment-${process.pid}-${Date.now()}.log`,
          );
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
        if (metricLines.length < MAX_METRIC_LINES && line.startsWith("METRIC "))
          metricLines.push(line);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    let didTimeout = false;
    let killTimer: NodeJS.Timeout | null = null;
    const kill = () => {
      didTimeout = true;
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
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
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
    });
  });
}

async function runChecks(checksFile: string) {
  const res = await runCommand(`bash ${checksFile}`, CHECKS_TIMEOUT_MS);
  return {
    failed: res.exitCode !== 0,
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
  try {
    return (statSync(file).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// --- benchmark drift detection (frozen-file hashes) -------------------------
function sha256File(file: string): string | null {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

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
  const cfgPath = join(projectCwd, ".auto", "config.json");
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  } catch {
    /* start fresh */
  }
  Object.assign(cfg, patch);
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

function writeBenchmarkHashes(hashes: {
  measure: string | null;
  checks: string | null;
}): void {
  patchSessionConfig({ benchmarkHashes: hashes });
}

/**
 * Persist the checks outcome of the latest run_experiment so log_experiment's
 * keep gate works even across an MCP server restart (pi `runtime.lastRunChecks`
 * equivalent, but on disk). `failed` is true only when checks ran and failed.
 */
function setPendingChecksFailed(failed: boolean): void {
  patchSessionConfig({ pendingChecksFailed: failed });
}

function pendingChecksFailed(): boolean {
  return readSessionConfig(projectCwd).pendingChecksFailed === true;
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
    const proc = spawn("bash", [scriptPath], { cwd });
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
      try {
        proc.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, HOOK_TIMEOUT_MS);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut: didTimeout,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: stderrTail,
        durationMs: Date.now() - started,
      });
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
  return {
    metric_name: state.config?.metricName ?? null,
    direction: state.config?.direction ?? "lower",
    baseline_metric: state.baseline ?? null,
    best_metric: state.best ?? null,
    run_count: state.runs.length,
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
  // The loop's keep/discard semantics (commit + rollback) need git; a non-git
  // research dir would only fail later at log time, in a half-initialized state.
  if (!isGitRepo(cwd)) {
    return {
      ok: false,
      error: `research directory is not a git repository — the experiment loop needs git commit/rollback semantics. Run git init there (or point .auto/config.json workingDir at a repo) first.`,
    };
  }
  const state = sessionState();
  const segment = (state.segment ?? 0) + 1;
  appendLedgerEntry(cwd, {
    type: "config",
    segment,
    name,
    metricName,
    metricUnit,
    direction,
    createdAt: new Date().toISOString(),
  });
  // Record frozen-file hashes as the benchmark baseline for this session.
  writeBenchmarkHashes(currentBenchmarkHashes());
  // New segment: any pending checks outcome from a previous session is stale.
  setPendingChecksFailed(false);
  broadcastDashboardUpdate();
  const branch = currentBranch(cwd);
  return {
    ok: true,
    segment,
    message:
      `experiment session "${name}" initialized (segment ${segment}). metric=${metricName} direction=${direction}` +
      (branch && branch.startsWith("autoresearch/")
        ? ""
        : `\nnote: on branch "${branch || "no git repo"}"; consider a dedicated branch (git checkout -b autoresearch/<tag>)`),
  };
}

async function toolRunExperiment(
  args: RunToolArgs,
): Promise<Record<string, unknown>> {
  const state = sessionState();
  const maxIter = state.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (state.config && state.runs.length >= maxIter) {
    return {
      ok: false,
      error: `iteration cap (${maxIter}) reached for segment ${state.segment}; start a new segment with init_experiment or stop`,
    };
  }
  // Audit: a crash with unrolled-back working tree must not start a new run.
  const lastRun = state.lastRun;
  if (lastRun && lastRun.status === "crash" && isDirty(cwd)) {
    return {
      ok: false,
      error: `audit: last run was ${lastRun.status} with unrolled-back working-tree changes — revert first (or /autoresearch:clear) before starting a new experiment`,
    };
  }
  // Benchmark drift: frozen files changed since the session baseline.
  const drift = checkBenchmarkDrift();
  const driftWarn = drift.drift
    ? `benchmark_drift: ${drift.reason === "measure" ? "measure.sh" : "checks.sh"} ${drift.deleted ? "was deleted" : "changed"} since session start — metrics are no longer comparable. Start a new segment (init_experiment) or confirm the change.`
    : null;
  const rawCommand = String(args.command ?? "");
  if (!rawCommand.trim()) return { ok: false, error: "command is required" };

  // Benchmark script lock: when .auto/measure.sh exists, only it may run.
  if (existsSync(paths.measure)) {
    const unwrapped = unwrapMeasureCommand(rawCommand, "measure.sh");
    if (!unwrapped) {
      return {
        ok: false,
        error: `.auto/measure.sh exists — run_experiment only executes the benchmark script (e.g. "bash .auto/measure.sh"). The command you gave is not the benchmark script.`,
      };
    }
  }

  const repeat = Math.min(Math.max(Number(args.repeat) || 1, 1), 10);
  const timeoutMs =
    Number(args.timeout_seconds ?? 0) > 0
      ? Number(args.timeout_seconds) * 1000
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
    const { metrics, primary } = parseMetricLines(last.output, metricName);
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
          failed: checks.failed,
          exit_code: checks.exitCode,
          output_tail: checks.outputTail,
        }
      : { ran: false },
    output_tail: truncateTail(last.outputTail),
    log_file: last.logFile ?? null,
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
  const state = sessionState();
  if (!state.config) {
    return {
      ok: false,
      error: "no active experiment session — call init_experiment first",
    };
  }
  const status = String(args.status ?? "keep");
  const description = String(args.description ?? "");
  const metric = args.metric != null ? Number(args.metric) : null;
  if (!Number.isFinite(metric) && status !== "crash") {
    return {
      ok: false,
      error: "metric must be a finite number (or use status=crash)",
    };
  }
  const metrics =
    args.metrics && typeof args.metrics === "object" ? args.metrics : undefined;
  const asi = args.asi && typeof args.asi === "object" ? args.asi : undefined;
  const constraints = Array.isArray(args.constraints)
    ? args.constraints.filter(
        (c) => c && typeof c.name === "string" && Number(c.maxPct) > 0,
      )
    : [];

  // keep gate: the just-run benchmark's checks failed → refuse keep. The
  // outcome is persisted by run_experiment (pendingChecksFailed), because the
  // ledger cannot know about a run that has not been logged yet.
  if (status === "keep" && pendingChecksFailed()) {
    return {
      ok: false,
      error:
        "the previous run failed correctness checks — you cannot keep it. use status=checks_failed or discard.",
    };
  }
  // keep gate: metric must be present.
  if (status === "keep" && metric == null) {
    return { ok: false, error: "keep requires a metric value" };
  }
  // Secondary-metric constraints: keep only if secondary metrics stay within
  // maxPct% of the segment's first run (opt-in; skipped by auditBypass).
  const constraintResults = [];
  if (status === "keep" && constraints.length > 0) {
    const baselineRuns = state.runs[0]?.metrics ?? {};
    for (const c of constraints) {
      const value = metrics?.[c.name];
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
  const cfgAudit = readSessionConfig(projectCwd);
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
            ? "this metric beats the retained value — only status=checks_failed may discard it"
            : v.code === "event_order"
              ? "run numbering/segment is inconsistent — consider /autoresearch:clear"
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
  if (status === "keep") {
    const hash = commitExperiment(cwd, {
      description: description || "(no description)",
      result: { metric, metrics: metrics ?? null, asi: asi ?? null },
    });
    if (hash) {
      commit = hash;
    } else {
      // keep produced no commit (no working-tree changes) — that is not a real keep
      return {
        ok: false,
        error:
          "audit: keep with no changes to commit — there is nothing to retain. Make a real change first, or use status=noop.",
      };
    }
  } else if (status !== "noop") {
    // roll back the experiment's working-tree changes (keep .auto/ intact);
    // noop means nothing was changed, so there is nothing to roll back
    rollbackWorkingTree(cwd);
  }

  const entry: LedgerRun = {
    type: "run",
    run: state.runs.length + 1,
    segment: state.segment,
    status: status as RunStatus,
    metric: status === "crash" ? null : metric,
    metrics,
    asi,
    description,
    commit,
    // audit trail: a checks_failed row carries the flag explicitly
    ...(status === "checks_failed" ? { checksFailed: true } : {}),
    timestamp: new Date().toISOString(),
  };

  appendLedgerEntry(cwd, entry);
  // The pending run is now accounted for — clear the keep-gate state.
  setPendingChecksFailed(false);
  broadcastDashboardUpdate();

  // Iteration hook: .auto/hooks/after.sh runs after the record (fail-open).
  const after = await runAfterHook(entry);

  const nextState = rebuildState(cwd, {
    maxIterations: state.maxIterations,
    consecutiveFailures: state.failureThreshold,
  });
  const baseline = nextState.baseline;
  const best = nextState.best;
  const conf = nextState.confidence;
  const delta =
    metric != null && baseline != null
      ? (metric - baseline) *
        (nextState.config?.direction === "higher" ? 1 : -1)
      : null;

  return {
    ok: true,
    logged: true,
    run: entry.run,
    segment: nextState.segment,
    status,
    commit,
    metric,
    baseline,
    best,
    delta: delta != null ? Number(delta.toFixed(6)) : null,
    confidence: conf
      ? { level: conf.level, value: Number(conf.confidence.toFixed(2)) }
      : null,
    plateau: nextState.plateau === true,
    doom_loop: detectDoomLoop(nextState.runs)?.doomLoop ?? false,
    ...(constraintResults.length > 0 ? { constraints: constraintResults } : {}),
    ...(after ? { after_steer: after.steer } : {}),
    next_action_hint:
      nextState.runs.length >=
      (nextState.maxIterations ?? DEFAULT_MAX_ITERATIONS)
        ? "iteration cap reached — run init_experiment for a new segment, or /autoresearch off"
        : detectDoomLoop(nextState.runs)
          ? "doom loop detected (repeated/oscillating hypotheses) — stop repeating, try a structurally different direction"
          : nextState.consecutiveFailures >= nextState.failureThreshold
            ? `consecutive failures reached (${nextState.consecutiveFailures}/${nextState.failureThreshold}) — consider a different approach or stopping`
            : nextState.plateau
              ? `plateau detected (last 5 runs improved < 1%) — consider rerunning with repeat:3 to confirm, opening a new segment, or stopping`
              : "pick the next hypothesis and run_experiment again",
  };
}

async function toolClearExperiments() {
  setPendingChecksFailed(false);
  if (!existsSync(paths.log))
    return { ok: true, message: "no active session to clear" };
  const { rmSync } = await import("node:fs");
  rmSync(paths.log, { force: true });
  return {
    ok: true,
    message: "cleared .auto/log.jsonl; start fresh with init_experiment",
  };
}

async function toolExportDashboard() {
  const state = sessionState();
  const html = renderDashboard(state);
  writeDashboard(cwd, html);
  const info = await ensureDashboardServer(cwd);
  return {
    ok: true,
    file: paths.dashboard,
    url: info?.url ?? null,
    experiments: state.runs.length,
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
      },
      required: ["metric_name"],
    },
  },
  {
    name: "run_experiment",
    description:
      "Run the benchmark command (repeat times when repeat>1, returns the median metric), time it, and parse `METRIC name=value` lines from its output. If .auto/measure.sh exists, ONLY that script may be run. If .auto/checks.sh exists it runs once after the last run (correctness backpressure). Returns a compact output tail (10 lines / 4KB) plus a log file path when output overflows. For noisy metrics use repeat:3 and log the returned median_metric.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "shell command to run (or .auto/measure.sh when it exists)",
        },
        timeout_seconds: {
          type: "number",
          description: "override timeout in seconds (default 600)",
        },
        repeat: {
          type: "number",
          description:
            "run the benchmark N times and return the median metric (1-10, default 1)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "log_experiment",
    description:
      "Record the experiment outcome. keep → auto-commit with `experiment:` prefix and structured Result in the message; discard/crash/checks_failed → drop working-tree changes while keeping .auto/ intact. Returns baseline/best/delta/confidence and a next-action hint.",
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
            "primary metric value from run_experiment (omit for crash — the ledger row records null)",
        },
        description: {
          type: "string",
          description: "one-line summary of the hypothesis and change",
        },
        metrics: { type: "object", description: "optional secondary metrics" },
        constraints: {
          type: "array",
          description:
            'optional hard limits on secondary metrics when keeping, e.g. [{name: "memory_mb", maxPct: 105}] — keep is rejected if the secondary metric exceeds maxPct% of the first run\'s value',
        },
        asi: {
          type: "object",
          description:
            "Actionable Side Information — survives revert, e.g. {hypothesis, next_action_hint, rollback}",
        },
        commit: {
          type: "string",
          description:
            "optional 7-char short hash; ignored on keep (real hash is filled in)",
        },
      },
      required: ["status", "description"],
    },
  },
  {
    name: "export_dashboard",
    description:
      "Render .auto/log.jsonl into a self-contained static HTML dashboard at autoresearch-dashboard.html. Call after experiments to get a human-readable progress report.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clear_experiments",
    description:
      "Delete .auto/log.jsonl and reset the session state (segment back to 0). Keeps .auto/measure.sh, checks.sh and prompt.md. Use to start a fresh experiment target.",
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
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
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
        serverInfo: { name: "autoresearch", version: "0.1.0" },
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
}
