// Shared domain types for the autoresearch plugin (server, hooks, lib, tests).
// Erasable-only syntax: no enums/namespaces so Node can strip types natively.

export type Direction = "lower" | "higher";

/** `config` row written by init_experiment — starts a new segment. */
export interface LedgerConfig {
  type: "config";
  segment: number;
  name: string;
  metricName: string;
  metricUnit?: string;
  direction: Direction;
  createdAt?: string;
}

export type RunStatus = "keep" | "discard" | "crash" | "checks_failed" | "noop";

/** Actionable Side Information — survives rollback. */
export interface Asi {
  hypothesis?: string;
  next_action_hint?: string;
  rollback?: string;
  [key: string]: unknown;
}

/** `run` row written by log_experiment. */
export interface LedgerRun {
  type: "run";
  run: number;
  /** segment is re-derived by rebuildState; kept optional for hand-written rows. */
  segment?: number;
  status: RunStatus;
  metric: number | null;
  metrics?: Record<string, number>;
  description?: string;
  commit?: string | null;
  checksFailed?: boolean;
  failedGuard?: boolean;
  asi?: Asi | null;
  timestamp?: string;
  /** merged in by rebuildState: the config entry this run belongs to. */
  config?: LedgerConfig | null;
}

/** `hook` row written by the iteration-hook logger. */
export interface LedgerHook {
  type: "hook";
  stage: "before" | "after";
  exit_code: number | null;
  duration_ms: number;
  stdout_bytes: number;
  timed_out: boolean;
}

export type LedgerEntry = LedgerConfig | LedgerRun | LedgerHook;

/**
 * Loose run shape consumed by analysis functions (isStopReached,
 * detectDoomLoop, detectPlateau, directionLabel, validateLedger). Callers and
 * tests may pass partial rows; only the fields actually read must be present.
 */
export interface RunLike {
  type?: "run";
  run?: number;
  segment?: number;
  status?: string;
  metric?: number | null;
  description?: string;
  commit?: string | null;
  asi?: Asi | null;
}

export interface Confidence {
  confidence: number;
  level: "red" | "yellow" | "green";
}

/** Session state rebuilt from the ledger (see ledger.rebuildState). */
export interface SessionState {
  config: LedgerConfig | null;
  segment: number;
  runs: LedgerRun[];
  baseline: number | null;
  best: number | null;
  lastRunChecksFailed: boolean;
  lastRun: LedgerRun | null;
  totalExperiments: number;
  consecutiveFailures: number;
  confidence: Confidence | null;
  plateau: boolean;
  maxIterations?: number;
  failureThreshold: number;
}

/** `.auto/config.json` — optional per-session overrides. */
export interface SessionConfig {
  maxIterations?: number;
  consecutiveFailures?: number;
  workingDir?: string;
  auditBypass?: boolean;
  autoresearchOff?: boolean;
  benchmarkHashes?: { measure: string | null; checks: string | null } | null;
  [key: string]: unknown;
}
