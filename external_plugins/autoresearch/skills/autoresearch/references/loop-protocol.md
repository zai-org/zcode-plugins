# Loop protocol

The complete, unambiguous contract for one experiment iteration and its failure modes.

## One iteration

1. **Review**: read the ledger tail (or the memory-inject hook output) and `git log --oneline -5`. If the last iteration was kept, `git diff HEAD~1` shows what changed; that is your prior art. Check `.auto/prompt.md` "What's Been Tried" to avoid repeats. At a fresh segment (`init_experiment` just ran), do the segment cold-start step first (see below) before touching the target code.
2. **Hypothesis**: state it in one line. Prefer `asi.next_action_hint` from the previous `log_experiment` when present.
3. **Modify**: exactly one logical change, inside the agreed scope. No unrelated edits: a mixed diff makes keep/discard meaningless.
4. **Run**: `run_experiment`. Only `.auto/measure.sh` runs when it exists. Timeout default 600s.
5. **Decide**: compare the returned `metric` against the **current best** (the `best` field in the log result — the ratchet line; the segment `baseline` only seeds it before the first keep):
   - **improved (beats the current best)** → `log_experiment` `status:"keep"`. The tool auto-commits (`experiment: <desc>` + Result JSON). The audit enforces this exactly: a keep that does not beat the current best is rejected, and so is a discard whose metric beats it.
   - **equal or worse** → `status:"discard"`. Working tree is reverted, `.auto/` survives. A run between the baseline and the current best is still a discard — it improves on the baseline but not on the champion.
   - **exit_code ≠ 0 / timed_out with nothing measured** → `status:"crash"` (metric null). Same revert. If the benchmark printed a valid `METRIC` line before dying, the tool rejects `crash` ("measured something") — log the observed value as `discard`/`keep` instead.
   - **checks.failed** → `status:"checks_failed"`. Same revert; never keep.
   - **no actual change made** (e.g. only measured) → `status:"noop"` if you want it recorded, else skip logging.
6. **Log**: always pass `asi` on non-keep runs: `{ hypothesis, next_action_hint, rollback }`. This survives the revert and drives the next iteration.
7. **Repeat** until the iteration cap, or until the metric plateaus across several runs.

## Segment cold start (ideation first)

A fresh segment is the moment of maximum freedom — and the easiest to waste on the most familiar path. Before the first `run_experiment` of a segment:

1. **Ideate before reading the code**: skim project docs, related libraries, or the web first, then write a candidate hypothesis list into `.auto/ideas.md` (one per line). Reading the target code first anchors you on the baseline's structure — the documented default failure mode (external evidence: AGENT4SCI found 56% of default agent attempts were hyperparameter tuning under baseline anchoring; see `docs/research/agent4sci-notes.md` in the plugin's source repository — not shipped with the installed plugin).
2. **Tag each hypothesis with a tier prefix** — the prefix goes at the start of `asi.hypothesis` too, so the ledger carries it:
   - `[struct]` — structural or paradigm change: different algorithm, model family, or a replaced component
   - `[tune]` — hyperparameters, schedules, training tricks
   - `[ensemble]` — ensembling, seed sweeps
3. **Calibrate the list** (adapted from AGENT4SCI's research skill):
   - Is any entry a tuning or ensembling move dressed up as a structural change? Demote it and replace it.
   - Which entries are just safe iterations on the existing code? Is at least one `[struct]` credible?

The prefixes are an advisory convention: the tools never validate them, and untagged hypotheses are legal — but they are invisible to the shallow-streak reminder in the `idea-rotator` example hook.

## Noise

- **Re-measure with `repeat`**: if the metric is noisy (variance within ~10% of the delta you're chasing), call `run_experiment` with `repeat: 3` and log the returned `median_metric`. Never judge a change on a single sample when the delta is inside the noise band.
- **Confidence is your calibration**: `log_experiment` returns `confidence` (MAD-based, green/yellow/red). Treat red/yellow improvements as **directional**: you may keep them, but mark them in the description; do not build the next hypothesis on top of a low-confidence gain without re-measuring.
- **Prefer bigger moves**: a change that moves the metric by more than the noise floor beats many marginal ones.
- **Plateau means stop searching this segment**: when `plateau: true` (the last window improved below the threshold — default 5 runs / 1%; calibrate via `init_experiment` `plateau_window` / `plateau_min_improvement`, and `deterministic: true` drops the repeat suggestion), either confirm with `repeat:3`, start a new segment via `init_experiment`, or stop and summarize. Re-litigating a sub-threshold margin on a noisy metric is wasted iterations.

## Failure handling

| Symptom               | Handling                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| benchmark crashes     | fix the script/change; log as `crash` (reverts) — only when nothing was measured; a crash with an observed metric is rejected, discard/keep with the value |
| repeated crashes (>2) | log `crash`, pick a smaller/different hypothesis                                                                                                           |
| checks fail           | log `checks_failed` (reverts), do not keep                                                                                                                 |
| command hangs         | `run_experiment` kills at timeout; log `crash`                                                                                                             |
| iteration cap reached | stop; optionally `init_experiment` for a new segment                                                                                                       |

## Stopping

- Cap reached → summarize wins in `What's Been Tried` and in chat.
- Consecutive failures reach the threshold (`.auto/config.json` `consecutiveFailures`, default 3) → stop, the approach is not working.
- User interrupts → complete the current run+log cycle first, then summarize.
- **Do not** run experiments that change `.auto/measure.sh` or `.auto/checks.sh`; if the target changes, call `init_experiment` again (new segment) instead.
- Clear the ledger with `clear_experiments` (`/autoresearch:clear`; the other `.auto/` files are kept).
- When done, run `export_dashboard` for a live URL + static report, then `/autoresearch:finalize` to split kept experiments into topic branches.

## Harness editing (second-order loop)

The loop optimizes the target code; this step lets the loop revise its **own harness** from ledger evidence, without ever moving the root. Discipline adapted from Harness² (google-research/harness2, arXiv:2610.14224): contrast-first edit rows, confounded-preferring verdicts, experience records that may honestly be `NO_ENTRY`. Surface changes are also traced mechanically: the server hashes the editable files at each accounting checkpoint and appends `harness_edit` rows to the ledger, so a skipped edit row loses the attribution, not the fact.

### Root vs surface

- **Root (immutable)**: `.auto/goal.md` — the user's deep goal, recorded verbatim at setup. The PreToolUse hook denies any write to it. Every surface goal statement is a representation of the root and must not contradict it.
- **Fence (immutable)**: `.auto/scope.md` — the user-agreed scope boundary (files in scope + off limits), frozen the same way. The loop may work inside it, never redraw it: widening or narrowing is the user's edit or a new segment.
- **Surface (revisable with evidence)**: `prompt.md` surface sections (What's Been Tried, metric/proxy wording, strategy notes — never the verbatim goal or scope quotes), `ideas.md`, `.auto/hooks/` config, repeat/segment choices.
- **Not an edit**: replacing the metric proxy, the optimization target, or the scope boundary is a root-level decision — `init_experiment` opens a new segment instead (or the user edits `scope.md`); the frozen scripts never move.

### The edit step

Trigger: `plateau`, `doom_loop`, consecutive-failure threshold, every ~8 runs, or segment end.

1. **Compare executions** in the ledger: which hypothesis families kept failing, whether crashes cluster on one component, whether checks fail on the same class of change, whether the charter's strategy notes are steering away from productive ground. If the evidence points at the scope boundary itself (a needed file is off limits, or in-scope files are dead weight), do not touch it — say so to the user and propose the boundary change; only the user edits `scope.md`, or `init_experiment` opens a re-scoped segment.
2. **Write edit rows before touching anything**:

   ```text
   component: prompt.md/What's Been Tried
   candidates: this edit
   change: <what the edit actually does>
   observed: <the ledger contrast it rests on, with run numbers>
   verdict: helped | hurt | no observed effect | confounded
   ```

   Prefer `confounded` whenever one edit touches several components and no execution isolates one of them. A confounded row is a useful record; an invented attribution poisons every later edit.

3. **Apply small edits** to the editable surfaces only. KEEP_BASE: an edit the evidence does not argue for is a regression — it costs context and buys nothing. No edit is a valid outcome.
4. **Record experience** (segment end): at most one lesson per segment in `.auto/experience.md`:

   ```markdown
   ## <segment N> <date>

   - cue: <the shape of situation this applies to — not this task's facts>
   - lesson: <the transferable operation, naming the component>
   - evidence: <edit rows / run numbers behind it>
   - confidence: high | medium | low, and why
   ```

   Write `NO_ENTRY` when no concrete, reusable behavioral contrast exists — the edit rows above are still worth keeping. Cross-project reuse of a lesson is a hypothesis: re-verify before relying on it.

### Writing discipline

Three kinds of content — label them and keep them out of each other's lanes:

- **workspace fact**: verified in this workspace, labelled as such ("in this repo, the slow path is the sync fs write in src/cache.ts:88"). Facts do not transfer; the label says so.
- **procedure**: the reusable operation ("profile before guessing; move the hot path off the request thread"). Written to transfer.
- **too generic**: "be thorough", "optimize more" — changes no behavior, banned from `ideas.md` and `experience.md`.

A named component beats prose: a rule worth keeping lives in `ideas.md`, a hook, or a skill — not in an always-on paragraph that is paid for on every run.

## Unattended continuation

If the user authorized unattended operation, scheduled wake-up turns re-enter this loop protocol from step 1 (Review) using only `.auto/` facts; when the session is inactive or off, a wake turn idles with one cheap reply. See `references/unattended.md` for the authorization requirement, CronCreate parameters, the wake prompt template, and cleanup.

## Iteration hooks

Optional scripts in `.auto/hooks/` that run around every iteration (fail-open):

| Hook        | When                        | stdin                                                | stdout →       |
| ----------- | --------------------------- | ---------------------------------------------------- | -------------- |
| `before.sh` | before each benchmark       | `{event:"before", cwd, next_run, last_run, session}` | `before_steer` |
| `after.sh`  | after each `log_experiment` | `{event:"after", cwd, run_entry, session}`           | `after_steer`  |

`session` = `{metric_name, direction, baseline_metric, best_metric, run_count, started_at_epoch, goal}` — `started_at_epoch` is the segment start as epoch seconds (`null` when the ledger has no config row), so wall-clock budget hooks read it from stdin instead of parsing `.auto/log.jsonl`. `goal` is the session name from `init_experiment` (pi contract parity). Hooks must exit within 30s and print ≤8KB. Use them for anything the agent shouldn't be trusted to do on its own: external lookups, anti-repetition guards, notifications, journals. `*_steer` is advisory; read it, but the loop is not blocked by it.
