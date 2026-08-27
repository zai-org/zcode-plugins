# Autoresearch setup guide

Turn a vague goal into a loopable experiment. Do this once per target.

## 1. Pick a mechanical metric

The metric must be:

- **Mechanical**: extracted by the tool from `METRIC name=value` lines — no human judgment.
- **Stable**: deterministic inputs, low variance. If noisy, run 3× and use the median.
- **Directional**: lower or higher is strictly better.

Examples: wall-clock runtime of a command, bundle size, test pass count (higher), loss (lower).

## 2. Create `.auto/measure.sh`

```bash
#!/usr/bin/env bash
# must print: METRIC <name>=<value>
start=$(date +%s%N)
# ... run the thing being optimized ...
end=$(date +%s%N)
ms=$(( (end - start) / 1000000 ))
echo "METRIC time_ms=$ms"
```

`run_experiment` will refuse to run anything else while this file exists — treat it as frozen.

## 3. Create `.auto/checks.sh` (optional but recommended)

A correctness gate that exits non-zero when the change broke something:

```bash
#!/usr/bin/env bash
# example: the optimized module must still produce correct output
node test-correctness.mjs
```

Checks run automatically after a passing benchmark; failure forbids `keep`.

## 4. Write `.auto/prompt.md` (the charter)

```markdown
# Goal

Make the startup faster.

# Metric

time_ms (lower is better), from .auto/measure.sh

# Files in scope

src/**, .auto/prompt.md

# Off limits

.auto/measure.sh, .auto/checks.sh, docs/**

# What's Been Tried

(baseline) no change — 42ms
```

Update **What's Been Tried** after every experiment — it is your loop memory along with the ledger.

## 4b. Define secondary-metric constraints (optional)

If optimizing a primary metric must not come at the cost of another dimension (memory, API calls, bundle size), make it a hard constraint: have the benchmark emit `METRIC <name>=<value>` lines for those, then pass `constraints` to `log_experiment`:

```json
{ "constraints": [{ "name": "memory_mb", "maxPct": 105 }] }
```

A keep is rejected if `memory_mb` exceeds 105% of the first run's value — "faster but much heavier" is not a valid keep unless you widen the constraint. Without `constraints`, no secondary check runs.

## 5. Keep session state out of git

`.auto/` and `autoresearch-dashboard.html` are session state, not code — they must never be committed (`git add -A` in `log_experiment` would otherwise drag the ledger into every experiment commit). Add to your `.gitignore`:

```gitignore
.auto/
autoresearch-dashboard.html
```

If you already committed them, untrack without deleting:

```bash
git rm -r --cached .auto autoresearch-dashboard.html
git commit -m "chore: stop tracking autoresearch session state"
```

## 6. Kick off

1. Commit a clean baseline first (`git checkout -b autoresearch/<goal>` recommended).
2. `init_experiment` with name / metric_name / direction.
3. Run a baseline pass: `run_experiment` → `log_experiment` with the baseline metric.
4. Then loop: one change → run → log.
