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
  /** Mechanical fact: the tree (session state excluded) at log time. */
  treeDirty?: boolean;
  /** Working-tree residue a rollback could not restore (absent = clean). */
  residual?: string[];
  /** confidence snapshot at record time (log_experiment); absent on legacy
   *  rows and whenever the computation had too little data to judge. */
  confidence?: ConfidenceSnapshot | null;
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

/** `harness_edit` row written by the mandatory harness trace (server-side). */
export interface LedgerHarnessEdit {
  type: "harness_edit";
  ts: string;
  segment: number;
  file: string;
  digest_before: string | null;
  digest_after: string | null;
}

/** `frozen_attempt` row written by guard-frozen on a denied frozen rewrite. */
export interface LedgerFrozenAttempt {
  type: "frozen_attempt";
  ts: string;
  file: string;
  tool: string | null;
}

export type LedgerEntry =
  | LedgerConfig
  | LedgerRun
  | LedgerHook
  | LedgerHarnessEdit
  | LedgerFrozenAttempt;

/**
 * Observation snapshot persisted by run_experiment (config.json
 * `pendingObservation`) and consumed by log_experiment: run_experiment is the
 * loop's only observer, and this snapshot is what makes every quantitative
 * claim in the ledger a transcription of a measured fact instead of a free
 * declaration. Overwritten by the next run; consumed by each successful log.
 */
export interface PendingObservation {
  metric: number | null;
  metrics: Record<string, number>;
  exit_code: number | null;
  timed_out: boolean;
  at: string;
}

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

/** Confidence snapshot persisted on run rows by log_experiment. */
export interface ConfidenceSnapshot {
  level: Confidence["level"];
  value: number;
}

/** Session state rebuilt from the ledger (see ledger.rebuildState). */
export interface SessionState {
  config: LedgerConfig | null;
  segment: number;
  runs: LedgerRun[];
  baseline: number | null;
  best: number | null;
  /** Segment-scoped: reset by config rows (before-hook payload, checks marker). */
  lastRun: LedgerRun | null;
  /**
   * Ledger-wide last run row, NOT reset at segment boundaries: the
   * crash+dirty-tree audit gate reads this, because an unrolled-back working
   * tree is physical state that init_experiment must not launder.
   */
  lastRunEver: LedgerRun | null;
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
  /** Server-managed: editable-surface digests baseline for the harness trace. */
  harnessHashes?: Record<string, string | null> | null;
  /**
   * `pending` prefix convention: keys named `pending…` are server cross-call
   * mechanism state, cleared wholesale at segment boundaries (init_experiment
   * / clear_experiments — resetPendingState). Never store user intent or a
   * session baseline under this prefix; future keys are covered by the
   * boundary reset automatically.
   */
  /** Server-managed: checks outcome of the latest run_experiment (keep gate). */
  pendingChecksFailed?: boolean;
  /** Server-managed: observation snapshot consumed by log_experiment's binding gates. */
  pendingObservation?: PendingObservation | null;
  /**
   * Loop calibration: plateau window in runs (integer ≥2, default 5) and the
   * minimum relative improvement over that window (≥0, default 0.01). Set
   * near the metric's real step size — the default 1% misfires on metrics
   * that move in the 4th decimal (e.g. AUC).
   */
  plateauWindow?: number;
  plateauMinImprovement?: number;
  /** Benchmark is deterministic (bitwise reproducible): hints skip repeat re-measurement suggestions. */
  deterministic?: boolean;
  [key: string]: unknown;
}
