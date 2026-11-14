// `.auto/` ledger: append-only JSONL source of truth + segment rebuild.
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { computeConfidence, isBetter, detectPlateau } from "./experiment.ts";
import type {
  Confidence,
  LedgerConfig,
  LedgerEntry,
  LedgerRun,
  SessionConfig,
  SessionState,
} from "./types.ts";

const AUTO_DIR = ".auto";
export const LOG_FILE = join(AUTO_DIR, "log.jsonl");
const PROMPT_FILE = join(AUTO_DIR, "prompt.md");
const MEASURE_FILE = join(AUTO_DIR, "measure.sh");
const CHECKS_FILE = join(AUTO_DIR, "checks.sh");
const CONFIG_FILE = join(AUTO_DIR, "config.json");
const IDEAS_FILE = join(AUTO_DIR, "ideas.md");
export const DASHBOARD_FILE = "autoresearch-dashboard.html";

export function autoPaths(cwd: string): {
  root: string;
  log: string;
  prompt: string;
  measure: string;
  checks: string;
  config: string;
  ideas: string;
  dashboard: string;
} {
  return {
    root: join(cwd, AUTO_DIR),
    log: join(cwd, LOG_FILE),
    prompt: join(cwd, PROMPT_FILE),
    measure: join(cwd, MEASURE_FILE),
    checks: join(cwd, CHECKS_FILE),
    config: join(cwd, CONFIG_FILE),
    ideas: join(cwd, IDEAS_FILE),
    dashboard: join(cwd, DASHBOARD_FILE),
  };
}

function ensureAutoDir(cwd: string): void {
  mkdirSync(join(cwd, AUTO_DIR), { recursive: true });
}

/** Whether the file's last byte is a newline (empty file counts as yes). */
function endsWithNewline(path: string): boolean {
  const size = statSync(path).size;
  if (size === 0) return true;
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function appendLedgerEntry(cwd: string, entry: LedgerEntry): void {
  ensureAutoDir(cwd);
  const log = join(cwd, LOG_FILE);
  // Line-boundary self-heal: a previous write killed mid-line (SIGKILL,
  // ENOSPC) leaves a truncated record without a trailing newline, and a blind
  // append would splice the new entry onto it — corrupting BOTH records. The
  // repair only adds the missing newline; the truncated line stays as-is
  // (append-only ledger, no in-place rewrite) and surfaces via readLedger's
  // corrupt-line diagnostic.
  if (existsSync(log) && !endsWithNewline(log))
    appendFileSync(log, "\n", "utf8");
  appendFileSync(log, JSON.stringify(entry) + "\n", "utf8");
}

export function readLedger(cwd: string): LedgerEntry[] {
  const log = join(cwd, LOG_FILE);
  if (!existsSync(log)) return [];
  const out: LedgerEntry[] = [];
  const lines = readFileSync(log, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as LedgerEntry);
    } catch {
      // Never silent: a dropped run row shifts every later run number and the
      // audit rejects all writes with an error that cannot point here. stderr
      // is the diagnostic channel (stdout belongs to JSON-RPC / hook output).
      process.stderr.write(
        `[autoresearch] ${LOG_FILE} line ${i + 1} is corrupt and was skipped: ${l.slice(0, 120)}\n`,
      );
    }
  }
  return out;
}

/**
 * Rebuild the session state from the ledger file.
 * - segment advances on every `config` entry.
 * - runs after a config entry belong to that config's segment.
 * - baseline = first run's primary metric in the segment.
 * - best = best kept run's metric in the segment (direction-aware).
 */
export function rebuildState(
  cwd: string,
  options: {
    maxIterations?: number;
    consecutiveFailures?: number;
    plateauWindow?: number;
    plateauMinImprovement?: number;
    deterministic?: boolean;
  } = {},
): SessionState {
  const entries = readLedger(cwd);
  const state: SessionState = {
    config: null,
    segment: 0,
    runs: [],
    baseline: null,
    best: null,
    lastRun: null,
    lastRunEver: null,
    consecutiveFailures: 0,
    confidence: null,
    plateau: false,
    failureThreshold: 3,
  };
  for (const e of entries) {
    if (e.type === "config") {
      state.config = e;
      state.segment = e.segment ?? state.segment + 1;
      state.runs = [];
      state.baseline = null;
      state.best = null;
      // A config row is a segment boundary: failure streaks and the previous
      // run's hook payload must not leak into the new segment. The checks
      // verdict lives in config's pendingChecksFailed (cleared wholesale at
      // segment boundaries), not as a derived field here.
      state.consecutiveFailures = 0;
      state.lastRun = null;
    } else if (e.type === "run") {
      const run: LedgerRun = {
        ...e,
        segment: state.segment,
        config: state.config,
      };
      state.runs.push(run);
      // Crash rows measure nothing (ADR-10: metric null; pre-ADR-10 rows carry
      // a 0 placeholder) — they must not become the baseline, or a legacy
      // ledger shows baseline 0 and absurd deltas. Matches validateLedger,
      // which already skips crash rows here.
      if (
        state.baseline == null &&
        run.metric != null &&
        run.status !== "crash"
      )
        state.baseline = run.metric;
      if (run.status === "keep" && run.metric != null) {
        const dir = state.config?.direction ?? "lower";
        if (state.best == null || isBetter(run.metric, state.best, dir))
          state.best = run.metric;
      }
      // Consecutive-failure streak (guardrails spec): only real failures
      // count; keep and noop both break the chain.
      if (run.status === "keep" || run.status === "noop")
        state.consecutiveFailures = 0;
      else state.consecutiveFailures += 1;
      state.lastRun = run;
      // Not reset at segment boundaries: the crash+dirty-tree audit gate reads
      // this, and a dirty tree is physical state init_experiment can't clear.
      state.lastRunEver = run;
    }
  }
  // Confidence over the current segment's values. Crash rows (including
  // legacy 0-placeholder ones) measure nothing and stay out of the value set.
  const values = state.runs
    .filter((r) => r.status !== "crash")
    .map((r) => r.metric)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (state.config && values.length > 0) {
    state.confidence = computeConfidence({
      values,
      baseline: state.baseline,
      best: state.best,
      deterministic: options.deterministic === true,
    });
  } else {
    state.confidence = null;
  }
  if (options.maxIterations != null)
    state.maxIterations = options.maxIterations;
  state.failureThreshold = options.consecutiveFailures ?? 3;
  // Plateau over the current segment's recent runs.
  if (state.config && state.runs.length >= (options.plateauWindow ?? 5)) {
    state.plateau = detectPlateau(state.runs, {
      window: options.plateauWindow ?? 5,
      minImprovement: options.plateauMinImprovement ?? 0.01,
      direction: state.config.direction ?? "lower",
      deterministic: options.deterministic === true,
    });
  } else {
    state.plateau = false;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Full-session history (archive dashboard only; loop control stays on
// rebuildState's segment-scoped view)
// ---------------------------------------------------------------------------

/**
 * Flat whole-ledger view: the session reads as one run sequence. A config row
 * never splits the display — it only refreshes the title/metric/direction
 *口径 (the latest config wins).
 */
export interface SessionHistory {
  config: LedgerConfig | null;
  runs: LedgerRun[];
  totalRuns: number;
  kept: number;
  segmentCount: number;
  firstMetric: number | null;
  bestMetric: number | null;
  lastRunAt: string | null;
  confidence: Confidence | null;
}

/**
 * Pure view over the whole ledger, flattened. Runs keep their ledger order
 * regardless of config rows; the latest config row supplies the display
 *口径 (name, metric, direction, unit). A run before any config row is
 * rendered with the neutral fallbacks (hand-written ledgers).
 */
export function rebuildHistory(entries: LedgerEntry[]): SessionHistory {
  const runs: LedgerRun[] = [];
  let config: LedgerConfig | null = null;
  let firstMetric: number | null = null;
  let lastRunAt: string | null = null;
  for (const e of entries) {
    if (e.type === "config") {
      config = e;
    } else if (e.type === "run") {
      // Hand-written ledgers may omit a run's segment: attribute it to the
      // latest config row seen so far (projection-only normalization; the
      // ledger itself is never rewritten).
      runs.push(
        e.segment === undefined && config
          ? { ...e, segment: config.segment }
          : e,
      );
      // Crash rows measure nothing (see rebuildState): a legacy 0-placeholder
      // must not become the dashboard's global baseline.
      if (
        firstMetric == null &&
        e.metric != null &&
        Number.isFinite(e.metric) &&
        e.status !== "crash"
      )
        firstMetric = e.metric;
      lastRunAt = e.timestamp ?? null;
    }
  }
  // Best over keep runs, direction-aware by the latest config.
  const dir = config?.direction ?? "lower";
  let bestMetric: number | null = null;
  for (const r of runs) {
    if (r.status !== "keep" || r.metric == null || !Number.isFinite(r.metric))
      continue;
    if (bestMetric == null || isBetter(r.metric, bestMetric, dir))
      bestMetric = r.metric;
  }
  // Confidence over all measured values against the global baseline/best.
  // Crash rows (legacy 0 placeholders included) measure nothing.
  const values = runs
    .filter((r) => r.status !== "crash")
    .map((r) => r.metric)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const confidence =
    config && values.length > 0
      ? computeConfidence({
          values,
          baseline: firstMetric,
          best: bestMetric,
        })
      : null;
  return {
    config,
    runs,
    totalRuns: runs.length,
    kept: runs.filter((r) => r.status === "keep").length,
    // Distinct segments among actual runs (config-only segments have no
    // trajectory to bound); drives the trend chart's boundary annotations.
    segmentCount: new Set(runs.map((r) => r.segment)).size,
    firstMetric,
    bestMetric,
    lastRunAt,
    confidence,
  };
}

export function readSessionConfig(cwd: string): SessionConfig {
  const cfg = join(cwd, CONFIG_FILE);
  if (!existsSync(cfg)) return {};
  try {
    return JSON.parse(readFileSync(cfg, "utf8")) as SessionConfig;
  } catch {
    return {};
  }
}

/**
 * Plateau calibration from `.auto/config.json`, sanitized for rebuildState:
 * invalid values fall back to the defaults instead of erroring (calibration
 * is a convenience, not a gate). Shared by the server and the Stop hook so
 * detection and hint wording stay on one口径.
 */
export function plateauCalibration(cwd: string): {
  minImprovement?: number;
  window?: number;
  deterministic: boolean;
} {
  const cfg = readSessionConfig(cwd);
  const minRaw = Number(cfg.plateauMinImprovement);
  const winRaw = Number(cfg.plateauWindow);
  return {
    minImprovement: Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : undefined,
    window: Number.isInteger(winRaw) && winRaw >= 2 ? winRaw : undefined,
    deterministic: cfg.deterministic === true,
  };
}

export function writeDashboard(cwd: string, html: string): string {
  writeFileSync(join(cwd, DASHBOARD_FILE), html, "utf8");
  return join(cwd, DASHBOARD_FILE);
}
