# OHI — Orchestration Hardening Index

Baseline metric for the zCoder plugin. A round = run `tests/ohi-static.sh` (zero tokens) + the live checklist below, log results, fix regressions, re-run. **Hardened = static suite all-green and no live check regresses below its best recorded value.**

## Layer C/P — Static (scripted, zero tokens)

`bash tests/ohi-static.sh` — agent pins, skill-table parity, stale refs, manifest/hook integrity, ladder-order consistency, command coherence, agent bijection.

## Layer D — Live dispatch checks (per round; session-cached verdicts acceptable, cite evidence)

| ID | Check | Scoring |
|----|-------|---------|
| D1 | glm-turbo probe | OK = pass |
| D2 | glm-main probe | OK = pass |
| D3 | glm-vision probe | pass / expected-fail (env-gated) / FAIL |
| D4 | turbo UNEXECUTABLE contract on missing file | refusal starts `UNEXECUTABLE:` AND every file it cites exists (anti-fabrication) |
| D5 | turbo Write path: scratch file per exact spec | file exists, content matches spec |
| D6 | SendMessage continuation of a completed agent | coherent context-aware reply (note agent age) |
| D7 | ≥2 engines dispatched concurrently | all succeed |
| D8a | Perception accuracy vs ground truth (10-item probe) | 6 clean items verbatim + 4 glyph-dropout reconstructions; score /10 |
| D8b | Perception integrity: zero invented entities, zero false (R) flags, ≤3 asset re-reads | PASS/FAIL — an integrity FAIL voids the result regardless of D8a |

## D8 ground truth

Generate a 10-item pixel-font dashboard mockup plus a ground-truth label table (half the items clean-renderable, half glyph-dropout so reconstruction is required). Alternate at least two artifacts across rounds — single-artifact calibration overfits the perception probe to one layout.

## Layer S — Supervision & model-use discipline (the priority layer)

Scored by the lead orchestrator from the dispatch ledger each round. Probes are exempt from contract checks.

| ID | Check | Target |
|----|-------|--------|
| S1 | Contract-marker compliance (RESULT / GLM_MAIN RESULT / VISUAL FINDINGS on non-probe dispatches) | 100% |
| S2 | Post-Write verification: every engine Write/Edit dispatch followed by orchestrator verification of the touched files | 100% of Write dispatches |
| S3 | Retry discipline: each failure retried at most ONCE, then degrade | no hammering |
| S4 | Failure-shape coverage: errors, cancelled results, and empty results all detected and handled | 100% |
| S5 | Cost sanity: tokens/duration within the task's cost-class control limits; breaches logged with a routing lesson | no unexplained breaches |
| S6 | Ledger completeness: every orchestrated task fully accounted (step/engine/config/tokens/duration/verdict) | 100% |

**Model-use routing rule:** capability floor first, then cheapest class (turbo → vision/main-thread → main). Batch independent mechanical items into one dispatch.

## Layer T — Token efficiency, caching, slop & context-rot gates

Scored from the ledger each round. This layer is the plugin's product quality: zCoder should SAVE tokens versus naive orchestration.

| ID | Check | Target |
|----|-------|--------|
| T1 | Dispatch size ≤300 words; never inlines file contents the engine can Read | 100% of dispatches |
| T2 | Retries byte-identical (backend prefix-cache makes them near-free) | 100% of retries |
| T3 | Follow-ups on minutes-fresh agents use SendMessage continuation, not fresh dispatch | opportunistic; log misses |
| T4 | Slop gate: no preamble, no dispatch restatement, no unrequested alternatives/summaries in results | 100% non-probe dispatches |
| T5 | Zero-waste rate: atomic tasks answered directly on main thread | logged per round |
| T6 | Context-rot guard: state lives in files (ledger/OHI); conversation holds only ledger lines + load-bearing extracts | audit per round |

## Tiered dog-food rounds (token-efficient monitoring)

| Tier | Trigger | Contents | Budget |
|------|---------|----------|--------|
| NOOP | state hash unchanged, no anomaly | static suite + dated log line | ≤2k |
| CANARY | every 4th round, or turbo verdict unknown | NOOP + turbo probe + 3-item main-thread perception check | ≤10k |
| FULL | config/state change, session restart, regression, or every 10th round | CANARY + glm-main probe + full D8a/D8b subagent probe + D5/S2 when turbo healthy | ≤60k |

State hash = `shasum agents/*.md skills/glm-orchestrator/SKILL.md hooks/inject-routing.sh | shasum`, stored in `tests/.ohi-state`. Expected saving vs naive every-round-full: **~75-85%**.

## Cost bands (starting values — recalibrate from your own ledger)

Initial bands from the author's dogfooding; `tests/ohi-stats.py` recomputes Shewhart control limits on log10(tokens) as your `tests/ohi-trials.jsonl` accumulates (costs are log-normal, so limits are log-scale, not fixed multiples).

| Class | Tokens | Duration |
|-------|--------|----------|
| probe | ≤10k | ≤3s |
| mechanical (turbo) | ≤20k | ≤30s |
| deep / perception (glm-main) | ≤35k | ≤90s |
| engine Write+Edit chain (glm-main) | ≤25k | ≤30s |

## Formal metrics (tests/ohi-stats.py — run after each FULL round)

Estimators replace ad-hoc thresholds; results update as trials accumulate in `tests/ohi-trials.jsonl`.

- **D8a/D8b are scored with Wilson 95% score intervals** — a claim of improvement requires the post-fix interval to separate from the pre-fix one or a two-proportion test at p<0.05.
- **Rule of Three (Hanley–Lippman-Hand):** n clean monitor samples with 0 regressions bound the true per-sample regression rate at 3/n (95% confidence). This is the formal hardening claim for the static layer.
- **S5 bands are Shewhart control limits on log10(tokens)** (costs are log-normal). Breach = outside limits, replacing the arbitrary "5×" rule.
- **Retry-once is an EV rule, not a ritual:** compare Laplace-smoothed episode success against the retry/saved cost ratio; when P(success) drops below RETRY_COST/SAVED_COST, degrade without retrying. Update per episode.
- **Measurement integrity:** the main thread that knows the ground truth cannot be a perception subject (self-measurement contamination) — clean D8a samples come from fresh-context subagents only. At realistic budgets D8a operates as a Shewhart-style tripwire (alert on ≤8/10 or integrity fail), not a significance machine.

## Round log

_(empty — record one dated entry per round: static score, tier, dispatch ledger line per dispatch, findings fixed, state hash)_
