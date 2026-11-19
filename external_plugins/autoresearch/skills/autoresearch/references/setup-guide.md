# Autoresearch setup guide

Turn a vague goal into a loopable experiment. Do this once per target.

## 1. Pick a mechanical metric

The metric must be:

- **Mechanical**: extracted by the tool from `METRIC name=value` lines; no human judgment.
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

`run_experiment` will refuse to run anything else while this file exists, so treat it as frozen — frozen means _immutable once recorded_: the PreToolUse hook denies rewrites, while creating it here is the intended setup step.

## 3. Create `.auto/checks.sh` (optional but recommended)

A correctness gate that exits non-zero when the change broke something:

```bash
#!/usr/bin/env bash
# example: the optimized module must still produce correct output
node test-correctness.ts
```

Checks run automatically after a passing benchmark; failure forbids `keep`. A gate that never produces a verdict (not executable, killed by a signal, exits ≥126) is infrastructure, not failure — it does not veto keeps.

**Calibrate the noise floor first**: before the first real experiment, run `measure.sh` 2-3 times on the unmodified code (or one `run_experiment` with `repeat: 3`) and confirm the numbers sit within a stable band. Record that band in the charter's Metric section — it is the floor every future delta is judged against; a "gain" smaller than the band is noise, not progress.

## 4. Record the deep goal (`.auto/goal.md`)

Write the user's deep goal **verbatim** — their words, not a paraphrase — into `.auto/goal.md`:

```markdown
<the user's goal statement, exactly as they framed it>
```

This file is the root the whole loop serves. It is **frozen** once recorded: the PreToolUse hook denies any rewrite of it — including from the harness-edit step — while the setup-time creation above is the intended exception. Everything else (metric proxy, charter wording, direction pool) is a revisable representation of this root; if evidence shows the representation is wrong, revise the representation — or `init_experiment` for a new segment — never the root.

## 5. Record the scope boundary (`.auto/scope.md`)

Write the user-agreed boundary into `.auto/scope.md` — what may be touched, what may not:

```markdown
# Files in scope

src/**, .auto/prompt.md

# Off limits

.auto/measure.sh, .auto/checks.sh, .auto/goal.md, .auto/scope.md, docs/**
```

This file is the **fence** around the loop, frozen exactly like the root: the hook denies rewrites (setup-time creation is the exception), and the harness-edit step cannot redraw it — widening _or_ narrowing is the user's edit, or a new segment via `init_experiment`. If evidence says the boundary itself is wrong, say so to the user and propose the change.

## 6. Write `.auto/prompt.md` (the charter)

```markdown
# Goal

<verbatim quote of .auto/goal.md — keep it in sync by quoting, not paraphrasing>

# Metric

time_ms (lower is better), from .auto/measure.sh

# Files in scope

<verbatim quote of .auto/scope.md "Files in scope">

# Off limits

<verbatim quote of .auto/scope.md "Off limits">

# What's Been Tried

(baseline) no change, 42ms
(discard) memoize sort keys, 44ms; revisit if the memory cap is lifted
```

Update **What's Been Tried** after every experiment; it is your loop memory along with the ledger. When you discard an idea, also record the conditions under which it would be worth revisiting (as above: "revisit if ..."), so the judgment survives compaction and the `revisit_nudge` from `log_experiment` can be checked against real reasons instead of guesses. Write entries as workspace facts (verified here, labelled here) or transferable procedure — never as "be thorough" filler. The harness-edit step revises everything in this file except the goal and scope quotes.

## 6b. `.auto/experience.md` (cross-segment lessons)

At segment end, the harness-edit step adds **at most one** lesson per segment: `{cue, lesson, evidence, confidence}`, with `evidence` citing run numbers — or `NO_ENTRY` when no behavioral contrast supports one. `experience.md` survives `clear_experiments`; at `/autoresearch:finalize` it is reviewed by the user and folded into the project's AGENTS.md. Lessons imported from other projects are hypotheses: re-verify before relying on them. Format and discipline: `references/loop-protocol.md` → Harness editing.

## 6c. Define secondary-metric constraints (optional)

If optimizing a primary metric must not come at the cost of another dimension (memory, API calls, bundle size), make it a hard constraint: have the benchmark emit `METRIC <name>=<value>` lines for those, then pass `constraints` to `log_experiment`:

```json
{ "constraints": [{ "name": "memory_mb", "maxPct": 105 }] }
```

A keep is rejected if `memory_mb` exceeds 105% of the first run's value; "faster but much heavier" is not a valid keep unless you widen the constraint. Without `constraints`, no secondary check runs.

## 7. Keep session state out of git

`.auto/` and `autoresearch-dashboard.html` are session state, not code, and must never be committed. `log_experiment` excludes both from keep commits, but your project's unrelated dirty files can still ride along; the ignore also keeps session state out of ordinary `git add`/`git status` use. Add to your `.gitignore`:

```gitignore
.auto/
autoresearch-dashboard.html
```

If you already committed them, untrack without deleting:

```bash
git rm -r --cached .auto autoresearch-dashboard.html
git commit -m "chore: stop tracking autoresearch session state"
```

## 8. Kick off

1. Commit a clean baseline first (`git checkout -b autoresearch/<goal>` recommended).
2. `init_experiment` with name / metric_name / direction.
3. Run a baseline pass: `run_experiment` → `log_experiment` with the baseline metric as `status:"noop"` (no code change) or `discard` if it equals/worse; a baseline `keep` is rejected because there is nothing to commit. The baseline row counts toward `maxIterations` like every run row (`runs_left = max − all rows`), so plan the cap as _planned experiments + baseline rows_ (e.g. 10 experiments + 1 noop baseline → `maxIterations: 11`).
4. Then loop: one change → run → log.
