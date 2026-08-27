// Pure functions for the autoresearch experiment loop.
// No I/O here so they are unit-testable without a workspace.

export const METRIC_RE = /^METRIC\s+([\w.µ]+)=(\S+)$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse `METRIC name=value` lines out of command output.
 * Returns { metrics, primary } where primary is metrics[metricName] if present.
 * Same-name keys: last wins. Dangerous key names are rejected.
 */
export function parseMetricLines(output, metricName) {
  const metrics = {};
  let primary;
  for (const line of String(output ?? "").split("\n")) {
    const m = METRIC_RE.exec(line.trim());
    if (!m) continue;
    const [, name, rawValue] = m;
    if (FORBIDDEN_KEYS.has(name)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    metrics[name] = value;
    if (name === metricName) primary = value;
  }
  return { metrics, primary };
}

/**
 * Direction-aware improvement test.
 * direction: "lower" (default) or "higher".
 */
export function isBetter(current, best, direction = "lower") {
  if (current == null || best == null) return false;
  return direction === "higher" ? current > best : current < best;
}

/**
 * MAD-based noise floor for the current segment.
 * Returns null when there are fewer than 3 data points or MAD is 0.
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeConfidence({ values, baseline, best }) {
  if (values.length < 3 || baseline == null || best == null) return null;
  const med = median(values);
  if (med == null || med === 0) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  if (mad == null || mad === 0) return null;
  const ratio = Math.abs(best - baseline) / mad;
  let level = "red";
  if (ratio >= 2.0) level = "green";
  else if (ratio >= 1.0) level = "yellow";
  return { confidence: ratio, level };
}

/**
 * Enforce that a run_experiment command is (a wrapper around) the benchmark
 * script. Strips leading `FOO=bar` assignments and `env/time/nice/nohup`
 * wrappers, then requires the core command to start with the measure script
 * path. Returns the unwrapped command string, or null when the command is
 * not the benchmark script. Prevents `evil; ./measure.sh` chained injection.
 */
const WRAP_RE = /^(env|time|nice|nohup)\s+/;
// leading env assignment including its value: `FOO=1 ` or `FOO="a b" `
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/;

export function unwrapMeasureCommand(command, measureScript) {
  let cmd = String(command ?? "").trim();
  if (!cmd) return null;
  // Strip leading env assignments and wrapper prefixes, alternating, until
  // stable (`env X=1 bash .auto/measure.sh` needs env→assignment→bash).
  let prev;
  do {
    prev = cmd;
    cmd = cmd.replace(ASSIGN_RE, "").trim();
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
  // 4) no shell metacharacters after the script (rejects `; evil` chaining)
  const rest = cmd.slice(match.length).trim();
  if (/[;&|`]/.test(rest) || rest.includes("$(")) return null;
  return cmd;
}

/**
 * Decide whether the loop has reached a stop condition.
 * Stop when: current segment runs >= maxIterations, or the last N (default 3)
 * results are all failures (discard/crash/checks_failed).
 */
export function isStopReached(runs, maxIterations, consecutiveFailures = 3) {
  if (maxIterations != null && runs.length >= maxIterations) return true;
  if (runs.length === 0) return false;
  const tail = runs.slice(-consecutiveFailures);
  return (
    tail.length >= consecutiveFailures && tail.every((r) => r.status !== "keep")
  );
}

/**
 * Normalize a hypothesis/description for comparison: lowercase, strip
 * non-alphanumerics, sort tokens. Returns null when there is no signal.
 */
export function normalizeHypothesis(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return [...tokens].sort().join(" ");
}

/** Jaccard similarity of two normalized hypotheses (token sets), or subset. */
export function hypothesesSimilar(a, b) {
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
 * leading clause (up to first comma/period/semicolon), capped at 40 chars.
 */
export function directionLabel(run) {
  const raw = run?.asi?.hypothesis || run?.description || "";
  const clause =
    String(raw)
      .split(/[,.;，。；]/)[0]
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
 */
export function detectDoomLoop(runs, { window = 6 } = {}) {
  const norm = runs
    .filter((r) => r.description || r?.asi?.hypothesis)
    .slice(-window)
    .map((r) => normalizeHypothesis(r.asi?.hypothesis || r.description))
    .filter(Boolean);
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
  runs,
  { window = 5, minImprovement = 0.01, direction = "lower" } = {},
) {
  const valid = runs
    .filter((r) => r.metric != null && Number.isFinite(r.metric))
    .slice(-window);
  if (valid.length < window) return false;
  const first = valid[0].metric;
  let best = first;
  for (const r of valid) {
    if (direction === "higher" ? r.metric > best : r.metric < best)
      best = r.metric;
  }
  const improvement =
    first === 0
      ? Math.abs(best - first)
      : Math.abs(best - first) / Math.abs(first);
  return improvement < minImprovement;
}
