# Loop protocol

The complete, unambiguous contract for one experiment iteration and its failure modes.

## One iteration

1. **Review** — read the ledger tail (or the memory-inject hook output) and `git log --oneline -5`. If the last iteration was kept, `git diff HEAD~1` shows what changed; that is your prior art. Check `.auto/prompt.md` "What's Been Tried" to avoid repeats.
2. **Hypothesis** — state it in one line. Prefer `asi.next_action_hint` from the previous `log_experiment` when present.
3. **Modify** — exactly one logical change, inside the agreed scope. No unrelated edits: a mixed diff makes keep/discard meaningless.
4. **Run** — `run_experiment`. Only `.auto/measure.sh` runs when it exists. Timeout default 600s.
5. **Decide** — compare the returned `metric` against the segment `baseline`:
   - **improved** → `log_experiment` `status:"keep"`. The tool auto-commits (`experiment: <desc>` + Result JSON).
   - **equal or worse** → `status:"discard"`. Working tree is reverted, `.auto/` survives.
   - **exit_code ≠ 0 / timed_out** → `status:"crash"` (metric 0). Same revert.
   - **checks.failed** → `status:"checks_failed"`. Same revert; never keep.
   - **no actual change made** (e.g. only measured) → `status:"noop"` if you want it recorded, else skip logging.
6. **Log** — always pass `asi` on non-keep runs: `{ hypothesis, next_action_hint, rollback }`. This survives the revert and drives the next iteration.
7. **Repeat** until the iteration cap, or until the metric plateaus across several runs.

## Noise

- **Re-measure with `repeat`**: if the metric is noisy (variance within ~10% of the delta you're chasing), call `run_experiment` with `repeat: 3` and log the returned `median_metric`. Never judge a change on a single sample when the delta is inside the noise band.
- **Confidence is your calibration**: `log_experiment` returns `confidence` (MAD-based, green/yellow/red). Treat red/yellow improvements as **directional** — you may keep them, but mark them in the description; do not build the next hypothesis on top of a low-confidence gain without re-measuring.
- **Prefer bigger moves**: a change that moves the metric by more than the noise floor beats many marginal ones.
- **Plateau means stop searching this segment**: when `plateau: true` (last 5 runs improved < 1%), either confirm with `repeat:3`, start a new segment via `init_experiment`, or stop and summarize. Re-litigating the last 1% of a noisy metric is wasted iterations.

## Failure handling

| Symptom               | Handling                                             |
| --------------------- | ---------------------------------------------------- |
| benchmark crashes     | fix the script/change; log as `crash` (reverts)      |
| repeated crashes (>2) | log `crash`, pick a smaller/different hypothesis     |
| checks fail           | log `checks_failed` (reverts), do not keep           |
| command hangs         | `run_experiment` kills at timeout; log `crash`       |
| iteration cap reached | stop; optionally `init_experiment` for a new segment |

## Stopping

- Cap reached → summarize wins in `What's Been Tried` and in chat.
- Consecutive failures reach the threshold (`.auto/config.json` `consecutiveFailures`, default 3) → stop, the approach is not working.
- User interrupts → complete the current run+log cycle first, then summarize.
- **Do not** run experiments that change `.auto/measure.sh` or `.auto/checks.sh`; if the target changes, call `init_experiment` again (new segment) instead.
- Reset everything with `clear_experiments` (`/autoresearch:clear`).
- When done, run `export_dashboard` for a live URL + static report, then `/autoresearch:finalize` to split kept experiments into topic branches.

## Iteration hooks

Optional scripts in `.auto/hooks/` that run around every iteration (fail-open):

| Hook        | When                        | stdin                                                | stdout →       |
| ----------- | --------------------------- | ---------------------------------------------------- | -------------- |
| `before.sh` | before each benchmark       | `{event:"before", cwd, next_run, last_run, session}` | `before_steer` |
| `after.sh`  | after each `log_experiment` | `{event:"after", cwd, run_entry, session}`           | `after_steer`  |

`session` = `{metric_name, direction, baseline_metric, best_metric, run_count}`. Hooks must exit within 30s and print ≤8KB. Use them for anything the agent shouldn't be trusted to do on its own: external lookups, anti-repetition guards, notifications, journals. `*_steer` is advisory — read it, but the loop is not blocked by it.
