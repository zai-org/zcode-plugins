// Pure functions for the autoresearch experiment loop.
// No I/O here so they are unit-testable without a workspace.
import type { Confidence, Direction, RunLike } from "./types.ts";

// Metric name charset includes `-` (p95-style names) — an over-tight class
// would silently drop the primary metric and keep would then fail with a
// confusing "metric must be a finite number" (worth-fix 2026-11-06).
const METRIC_RE = /^METRIC\s+([\w.µ-]+)=(\S+)$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse `METRIC name=value` lines out of command output.
 * Returns { metrics, primary } where primary is metrics[metricName] if present.
 * Same-name keys: last wins. Dangerous key names are rejected.
 */
export function parseMetricLines(
  output: unknown,
  metricName?: string,
): {
  metrics: Record<string, number>;
  primary: number | undefined;
  nearMisses: string[];
} {
  const metrics: Record<string, number> = {};
  let primary: number | undefined;
  // Near-miss diagnostics: a line that looks like a METRIC row but fails the
  // parse (bad name charset, non-numeric value) must not vanish silently — a
  // silently dropped primary metric only surfaces later as a confusing
  // "metric must be a finite number" on keep. Same never-silent principle as
  // the ledger's corrupt-line diagnostic.
  const nearMisses: string[] = [];
  for (const line of String(output ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!/^METRIC\s/.test(trimmed)) continue;
    // Every METRIC-looking line must land in metrics or in nearMisses — the
    // silent middle (regex passes, Number() fails; name charset rejects) is
    // where primary metrics used to vanish (never-silent principle, same as
    // the ledger's corrupt-line diagnostic).
    const m = METRIC_RE.exec(trimmed);
    const name = m?.[1];
    const value =
      name != null && !FORBIDDEN_KEYS.has(name) ? Number(m?.[2]) : NaN;
    if (name != null && Number.isFinite(value)) {
      metrics[name] = value;
      if (name === metricName) primary = value;
    } else if (nearMisses.length < 10) {
      nearMisses.push(trimmed);
    }
  }
  return { metrics, primary, nearMisses };
}

/**
 * Direction-aware improvement test.
 * direction: "lower" (default) or "higher".
 */
export function isBetter(
  current: number | null | undefined,
  best: number | null | undefined,
  direction: Direction = "lower",
): boolean {
  if (current == null || best == null) return false;
  return direction === "higher" ? current > best : current < best;
}

/** Median of the values (null for an empty list); the noise floor lives in computeConfidence. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeConfidence({
  values,
  baseline,
  best,
  deterministic = false,
}: {
  values: number[];
  baseline: number | null;
  best: number | null;
  /** Bitwise-reproducible benchmark: the noise floor is a single point, so no MAD ratio exists — any delta is exact signal, not a directional hint. */
  deterministic?: boolean;
}): Confidence | null {
  if (values.length < 3 || baseline == null || best == null) return null;
  if (deterministic) return null;
  const med = median(values);
  if (med == null || med === 0) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  if (mad == null || mad === 0) return null;
  const ratio = Math.abs(best - baseline) / mad;
  let level: Confidence["level"] = "red";
  if (ratio >= 2.0) level = "green";
  else if (ratio >= 1.0) level = "yellow";
  return { confidence: ratio, level };
}

/**
 * Enforce that a run_experiment command is (a wrapper around) the benchmark
 * script. Strips leading `FOO=bar` assignments and `env/time/nice/nohup`
 * wrappers (assignment values pass the same character whitelist as script
 * args — a prefix is not a smuggling channel for `$(…)`/backticks), then
 * requires the core command to start with the measure script path. Returns
 * the unwrapped command string, or null when the command is not the
 * benchmark script. Prevents `evil; ./measure.sh` chained injection.
 */
const WRAP_RE = /^(env|time|nice|nohup)\s+/;
// leading env assignment including its value: `FOO=1 ` or `FOO=a=b `
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*=)(\S*)\s*/;
// The assignment VALUE goes through the same whitelist idea as the args below:
// bash executes a prefix assignment before the script runs, so `X=$(id)` or
// backticks would smuggle arbitrary commands past the lock. Values are
// restricted to the arg character class minus separators (`\S*` already
// excludes whitespace).
const ASSIGN_VALUE_RE = /^[\w./:+=-]*$/;

export function unwrapMeasureCommand(
  command: unknown,
  measureScript: string,
): string | null {
  let cmd = String(command ?? "").trim();
  if (!cmd) return null;
  // Strip leading env assignments and wrapper prefixes, alternating, until
  // stable (`env X=1 bash .auto/measure.sh` needs env→assignment→bash).
  let prev: string;
  do {
    prev = cmd;
    const assign = ASSIGN_RE.exec(cmd);
    if (assign) {
      if (!ASSIGN_VALUE_RE.test(assign[2])) return null;
      cmd = cmd.slice(assign[0].length).trim();
    }
    cmd = cmd.replace(WRAP_RE, "").trim();
  } while (cmd !== prev);
  if (!cmd) return null;
  // 3) core must be the measure script itself (optional ./ and .auto/ prefix,
  //    optional bash wrapper)
  const variants = [
    measureScript,
    `./${measureScript}`,
    `.auto/${measureScript}`,
    `./.auto/${measureScript}`,
    `bash ${measureScript}`,
    `bash ./${measureScript}`,
    `bash .auto/${measureScript}`,
    `bash ./.auto/${measureScript}`,
  ];
  const match = variants.find((v) => cmd === v || cmd.startsWith(v + " "));
  if (!match) return null;
  // 4) args after the script must be plain tokens — whitelist characters only.
  //    A blacklist cannot enumerate the shell injection surface (newlines, CR,
  //    redirection, quotes, backticks, $, globs, ...), so anything outside
  //    [word chars . / : = + - space tab] is rejected.
  const rest = cmd.slice(match.length);
  if (!/^[\w./:=+ \t-]*$/.test(rest)) return null;
  return cmd;
}

/**
 * Decide whether the loop has reached a stop condition.
 * Stop when: current segment runs >= maxIterations, or the trailing run of
 * real failures (discard/crash/checks_failed) reaches consecutiveFailures.
 * noop neither counts as a failure nor keeps the streak alive — it breaks
 * the chain, like keep does.
 */
export function isStopReached(
  runs: RunLike[],
  maxIterations: number | undefined,
  consecutiveFailures = 3,
): boolean {
  if (maxIterations != null && runs.length >= maxIterations) return true;
  if (runs.length === 0) return false;
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const s = runs[i].status;
    if (s === "discard" || s === "crash" || s === "checks_failed") streak += 1;
    else break;
  }
  return streak >= consecutiveFailures;
}

/**
 * Normalize a hypothesis/description for comparison: lowercase, strip
 * non-alphanumerics, sort tokens. Returns null when there is no signal.
 */
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * A long CJK token is a compound ("试埃氏筛变体"), so treating it as one
 * whitespace-delimited word makes every variant look unrelated. Bigrams keep
 * the shared prefix/suffix signal without a segmentation dependency; English
 * tokens keep their existing word-level behavior.
 */
function hypothesisTokens(token: string): string[] {
  if (!CJK_RE.test(token) || token.length <= 2) return [token];
  const out: string[] = [];
  for (let i = 0; i < token.length - 1; i++) out.push(token.slice(i, i + 2));
  return out;
}

export function normalizeHypothesis(text: unknown): string | null {
  const tokens = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .flatMap(hypothesisTokens);
  if (tokens.length === 0) return null;
  return [...tokens].sort().join(" ");
}

/** Jaccard similarity of two normalized hypotheses (token sets), or subset. */
export function hypothesesSimilar(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  const inter = [...A].filter((t) => B.has(t)).length;
  const union = new Set([...A, ...B]).size;
  if (inter === Math.min(A.size, B.size)) return true; // one is a subset
  return union > 0 && inter / union >= 0.5;
}

/**
 * Direction label for a run: prefer asi.hypothesis, else description; take the
 * leading clause (up to first comma/semicolon), capped at 40 chars. The half
 * width period is deliberately NOT a clause boundary: decimals ("lambda_l2
 * 1.0", "bagging_fraction 0.8") would otherwise be cut at the dot and the
 * memory injection would present "lambda_l2 1" / "bagging_fraction 0" as the
 * tried direction (evidence 2026-11-05, ml-auto dota2-wave1).
 */
export function directionLabel(run: RunLike): string {
  const raw = run?.asi?.hypothesis || run?.description || "";
  const clause =
    String(raw)
      .split(/[,;，。；]/)[0]
      ?.trim() || "";
  return clause.length > 40
    ? clause.slice(0, 40) + "…"
    : clause || (run?.status ?? "?");
}

/**
 * Doom-loop detection (ml-intern idea, text-layer): repeated or oscillating
 * hypotheses. Returns { doomLoop, pattern } or null.
 * - repeat: last 3 runs have similar normalized hypotheses.
 * - oscillate: last 4 runs are [X, Y, X, Y] (X~X, Y~Y, X!~Y).
 * Rows annotated `asi.infra: true` (infrastructure failure: network outage,
 * missing dependency, platform throttling) are dropped before the window is
 * taken — a hypothesis interrupted repeatedly by a broken environment is not
 * the agent thrashing between ideas.
 */
export function detectDoomLoop(
  runs: RunLike[],
  { window = 6 } = {},
): { doomLoop: boolean; pattern: "repeat" | "oscillate" } | null {
  const norm = runs
    .filter((r) => r?.asi?.infra !== true)
    .filter((r) => r.description || r?.asi?.hypothesis)
    .slice(-window)
    .map((r) => normalizeHypothesis(r.asi?.hypothesis || r.description))
    .filter((n): n is string => n != null);
  if (norm.length < 3) return null;

  // 3+ consecutive repeats (needs 3)
  const last3 = norm.slice(-3);
  if (
    hypothesesSimilar(last3[0], last3[1]) &&
    hypothesesSimilar(last3[1], last3[2])
  ) {
    return { doomLoop: true, pattern: "repeat" };
  }

  // A→B→A→B oscillation (needs 4)
  if (norm.length >= 4) {
    const [a, b, c, d] = norm.slice(-4);
    if (
      hypothesesSimilar(a, c) &&
      hypothesesSimilar(b, d) &&
      !hypothesesSimilar(a, b)
    ) {
      return { doomLoop: true, pattern: "oscillate" };
    }
  }

  return null;
}

/**
 * Plateau detection: within the last `window` runs with a valid metric, the
 * best direction-aware improvement relative to the window's first metric is
 * below `minImprovement`. Returns false when there are fewer than `window`
 * valid records (not enough data to judge).
 */
export function detectPlateau(
  runs: RunLike[],
  {
    window = 5,
    minImprovement = 0.01,
    direction = "lower",
  }: {
    window?: number;
    minImprovement?: number;
    direction?: Direction;
  } = {},
): boolean {
  const valid = runs
    .filter(
      (r) =>
        // Crash rows measure nothing (ADR-10; legacy rows carry a 0
        // placeholder) — they are not data points for the plateau window.
        // Noop rows DO count: a noop re-measures the metric on unchanged
        // code, so it is a legitimate trend data point (the repeat:3
        // confirmation flow relies on it keeping the window flat).
        r.status !== "crash" && r.metric != null && Number.isFinite(r.metric),
    )
    .slice(-window);
  if (valid.length < window) return false;
  const first = valid[0].metric;
  if (first == null) return false;
  let best = first;
  for (const r of valid) {
    if (r.metric == null) continue;
    if (direction === "higher" ? r.metric > best : r.metric < best)
      best = r.metric;
  }
  const improvement =
    first === 0
      ? Math.abs(best - first)
      : Math.abs(best - first) / Math.abs(first);
  return improvement < minImprovement;
}
