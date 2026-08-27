import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetricLines,
  isBetter,
  computeConfidence,
  unwrapMeasureCommand,
  isStopReached,
  detectPlateau,
  median,
  normalizeHypothesis,
  directionLabel,
  detectDoomLoop,
} from "../mcp/lib/experiment.mjs";

test("parseMetricLines extracts METRIC name=value lines", () => {
  const out = [
    "some log line",
    "METRIC time_ms=42",
    "METRIC time_ms=43", // last wins
    "METRIC bytes=128",
    "not a metric",
  ].join("\n");
  const { metrics, primary } = parseMetricLines(out, "time_ms");
  assert.equal(metrics.time_ms, 43);
  assert.equal(metrics.bytes, 128);
  assert.equal(primary, 43);
});

test("parseMetricLines rejects dangerous keys and non-numbers", () => {
  const { metrics, primary } = parseMetricLines(
    "METRIC __proto__=1\nMETRIC constructor=2\nMETRIC ok=abc\nMETRIC n=3",
    "n",
  );
  assert.deepEqual(Object.keys(metrics), ["n"]);
  assert.equal(metrics.n, 3);
  assert.equal(primary, 3);
});

test("parseMetricLines returns primary undefined when metric not seen", () => {
  const { primary } = parseMetricLines("METRIC other=1\n", "time_ms");
  assert.equal(primary, undefined);
});

test("isBetter is direction-aware", () => {
  assert.equal(isBetter(41, 42, "lower"), true);
  assert.equal(isBetter(42, 42, "lower"), false);
  assert.equal(isBetter(43, 42, "higher"), true);
  assert.equal(isBetter(41, 42, "higher"), false);
  assert.equal(isBetter(null, 42, "lower"), false);
});

test("computeConfidence uses MAD noise floor", () => {
  // tight cluster -> high confidence in a real delta
  const c = computeConfidence({
    values: [10, 10.1, 9.9, 10, 10.05],
    baseline: 10,
    best: 14,
  });
  assert.ok(c);
  assert.equal(c.level, "green");
  // delta within noise -> red
  const c2 = computeConfidence({
    values: [10, 15, 5, 12, 8],
    baseline: 10,
    best: 10.5,
  });
  assert.ok(c2);
  assert.equal(c2.level, "red");
  // too few points -> null
  assert.equal(
    computeConfidence({ values: [10, 11], baseline: 10, best: 9 }),
    null,
  );
});

test("unwrapMeasureCommand allows the benchmark script with wrappers", () => {
  assert.equal(
    unwrapMeasureCommand(".auto/measure.sh", "measure.sh"),
    ".auto/measure.sh",
  );
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh", "measure.sh"),
    "bash .auto/measure.sh",
  );
  // wrappers and env assignments are stripped; the returned command is the unwrapped core
  assert.equal(
    unwrapMeasureCommand("time bash .auto/measure.sh", "measure.sh"),
    "bash .auto/measure.sh",
  );
  assert.equal(
    unwrapMeasureCommand("FOO=1 bar=2 env nice .auto/measure.sh", "measure.sh"),
    ".auto/measure.sh",
  );
  assert.equal(
    unwrapMeasureCommand("env X=1 bash .auto/measure.sh", "measure.sh"),
    "bash .auto/measure.sh",
  );
});

test("unwrapMeasureCommand rejects non-benchmark or chained commands", () => {
  assert.equal(unwrapMeasureCommand("ls", "measure.sh"), null);
  assert.equal(unwrapMeasureCommand("measure.sh; evil", "measure.sh"), null);
  assert.equal(
    unwrapMeasureCommand("evil; .auto/measure.sh", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("curl http://x | bash", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("bash -c 'measure.sh'", "measure.sh"),
    null,
  );
  assert.equal(unwrapMeasureCommand("", "measure.sh"), null);
  assert.equal(unwrapMeasureCommand(null, "measure.sh"), null);
});

test("isStopReached on cap and consecutive failures", () => {
  const runs = [1, 2, 3].map((n) => ({ run: n, status: "keep" }));
  assert.equal(isStopReached(runs, 3), true);
  assert.equal(isStopReached(runs, 10), false);
  const fails = [
    { status: "discard" },
    { status: "crash" },
    { status: "discard" },
  ];
  assert.equal(isStopReached(fails, 20), true);
  assert.equal(
    isStopReached([{ status: "keep" }, { status: "discard" }], 20),
    false,
  );
  assert.equal(isStopReached([], 20), false);
});

test("detectPlateau flags no net improvement within the window", () => {
  // flat: best 4.08 vs first 4.1 → 0.49% < 1% → plateau
  const flat = [
    { metric: 4.1 },
    { metric: 4.1 },
    { metric: 4.08 },
    { metric: 4.12 },
    { metric: 4.09 },
  ];
  assert.equal(detectPlateau(flat, { window: 5, minImprovement: 0.01 }), true);
  // improving: best 4.0 vs first 4.1 → 2.4% > 1% → not a plateau
  const improving = [
    { metric: 4.1 },
    { metric: 4.1 },
    { metric: 4.0 },
    { metric: 4.0 },
    { metric: 4.0 },
  ];
  assert.equal(
    detectPlateau(improving, { window: 5, minImprovement: 0.01 }),
    false,
  );
});

test("detectPlateau respects direction and short windows", () => {
  // higher, 3% improvement < 5% threshold → plateau
  const small = [
    { metric: 100 },
    { metric: 101 },
    { metric: 102 },
    { metric: 101 },
    { metric: 103 },
  ];
  assert.equal(
    detectPlateau(small, {
      window: 5,
      minImprovement: 0.05,
      direction: "higher",
    }),
    true,
  );
  // higher, 6% improvement > 5% threshold → not plateau
  const big = [
    { metric: 100 },
    { metric: 101 },
    { metric: 102 },
    { metric: 104 },
    { metric: 106 },
  ];
  assert.equal(
    detectPlateau(big, {
      window: 5,
      minImprovement: 0.05,
      direction: "higher",
    }),
    false,
  );
  // fewer than window valid records → not judged
  assert.equal(
    detectPlateau([{ metric: 1 }, { metric: 1 }], { window: 5 }),
    false,
  );
  // zero baseline falls back to absolute difference
  assert.equal(
    detectPlateau(
      [
        { metric: 0 },
        { metric: 0 },
        { metric: 0.001 },
        { metric: 0 },
        { metric: 0 },
      ],
      { window: 5, minImprovement: 0.01 },
    ),
    true,
  );
});

test("median returns the middle value", () => {
  assert.equal(median([42, 44, 41]), 42);
  assert.equal(median([5, 1, 3, 2, 4]), 3);
  assert.equal(median([]), null);
});

test("normalizeHypothesis ignores wording differences", () => {
  assert.equal(
    normalizeHypothesis("Try the sieve of Eratosthenes"),
    normalizeHypothesis("the sieve of eratosthenes, try!"),
  );
  assert.equal(normalizeHypothesis("x"), null); // too little signal
});

test("directionLabel takes hypothesis, else description clause", () => {
  assert.equal(
    directionLabel({
      asi: { hypothesis: "sieve" },
      description: "long description here",
    }),
    "sieve",
  );
  assert.equal(
    directionLabel({ description: "try sqrt cutoff, then measure" }),
    "try sqrt cutoff",
  );
  assert.equal(directionLabel({ status: "keep" }), "keep");
});

test("detectDoomLoop flags repeats and oscillation, not normal progress", () => {
  const run = (d) => ({ description: d });
  // oscillation A→B→A→B
  assert.equal(
    detectDoomLoop([
      run("sieve approach"),
      run("bitpacking"),
      run("sieve approach v2"),
      run("bitpacking v2"),
    ])?.pattern,
    "oscillate",
  );
  // 3 consecutive repeats
  assert.equal(
    detectDoomLoop([
      run("a"),
      run("try the sieve"),
      run("try the sieve again"),
      run("try the sieve once more"),
    ])?.pattern,
    "repeat",
  );
  // normal progression → null
  assert.equal(
    detectDoomLoop([
      run("baseline"),
      run("sqrt cutoff"),
      run("sieve"),
      run("odds-only sieve"),
    ]),
    null,
  );
  // too few runs → null
  assert.equal(detectDoomLoop([run("a"), run("a")]), null);
});
