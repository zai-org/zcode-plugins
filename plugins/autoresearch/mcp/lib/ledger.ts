// `.auto/` ledger: append-only JSONL source of truth + segment rebuild.
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { computeConfidence, isBetter, detectPlateau } from "./experiment.ts";
import type {
  LedgerEntry,
  LedgerRun,
  SessionConfig,
  SessionState,
} from "./types.ts";

export const AUTO_DIR = ".auto";
export const LOG_FILE = join(AUTO_DIR, "log.jsonl");
export const PROMPT_FILE = join(AUTO_DIR, "prompt.md");
export const MEASURE_FILE = join(AUTO_DIR, "measure.sh");
export const CHECKS_FILE = join(AUTO_DIR, "checks.sh");
export const CONFIG_FILE = join(AUTO_DIR, "config.json");
export const IDEAS_FILE = join(AUTO_DIR, "ideas.md");
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

export function ensureAutoDir(cwd: string): void {
  mkdirSync(join(cwd, AUTO_DIR), { recursive: true });
}

export function appendLedgerEntry(cwd: string, entry: LedgerEntry): void {
  ensureAutoDir(cwd);
  appendFileSync(join(cwd, LOG_FILE), JSON.stringify(entry) + "\n", "utf8");
}

export function readLedger(cwd: string): LedgerEntry[] {
  const log = join(cwd, LOG_FILE);
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as LedgerEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is LedgerEntry => e != null);
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
  } = {},
): SessionState {
  const entries = readLedger(cwd);
  const state: SessionState = {
    config: null,
    segment: 0,
    runs: [],
    baseline: null,
    best: null,
    lastRunChecksFailed: false,
    lastRun: null,
    totalExperiments: 0,
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
    } else if (e.type === "run") {
      const run: LedgerRun = {
        ...e,
        segment: state.segment,
        config: state.config,
      };
      state.runs.push(run);
      state.totalExperiments += 1;
      if (state.baseline == null && run.metric != null)
        state.baseline = run.metric;
      if (run.status === "keep" && run.metric != null) {
        const dir = state.config?.direction ?? "lower";
        if (state.best == null || isBetter(run.metric, state.best, dir))
          state.best = run.metric;
      }
      if (run.status === "keep") state.consecutiveFailures = 0;
      else state.consecutiveFailures += 1;
      if (run.checksFailed) state.lastRunChecksFailed = true;
      state.lastRun = run;
    }
  }
  // Confidence over the current segment's values.
  const values = state.runs
    .map((r) => r.metric)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (state.config && values.length > 0) {
    state.confidence = computeConfidence({
      values,
      baseline: state.baseline,
      best: state.best,
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
    });
  } else {
    state.plateau = false;
  }
  return state;
}

/**
 * Delta of a run's metric against the segment baseline, direction-aware:
 * positive = improvement (lower metric + baseline was higher, or higher metric).
 */
export function deltaFor(
  state: SessionState,
  metric: number | null | undefined,
): number | null {
  if (metric == null || state.baseline == null) return null;
  const dir = state.config?.direction ?? "lower";
  const raw = metric - state.baseline;
  return dir === "higher" ? raw : -raw;
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

export function writeDashboard(cwd: string, html: string): string {
  writeFileSync(join(cwd, DASHBOARD_FILE), html, "utf8");
  return join(cwd, DASHBOARD_FILE);
}
