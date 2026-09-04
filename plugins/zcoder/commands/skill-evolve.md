---
description: Run a skill-forge improvement round — Pareto-targeted, staged eval, trigger-aware, gated promotion (GEPA-style).
argument-hint: "[skill-name]"
---

Run one skill-forge improvement round on $ARGUMENTS (default: the weakest skill by `stats.py --rank`). The round is staged (Hermes/GEPA port): spend small first, expand only on evidence, stop on plateau.

0. **SELECT** (zero tokens):
   `python3 skills/skill-forge/scripts/pareto.py tests/skill-evals/<skill>/trials.jsonl --plateau tests/skill-evals/<skill>/promotions.jsonl`
   - The `NEXT MUTATION TARGET` line names the variant+scenario to mutate against.
   - **If the plateau check says PLATEAU: do NOT write another body mutation.** The frontier is stalled — add one NEW scenario instead (mined from sessions or weak-spots.md), build its oracle, and re-baseline. A stalled frontier on a 1-scenario suite means overfit, not solved.
1. **SELFTEST**: `python3 skills/skill-forge/scripts/oracle_selftest.py tests/skill-evals/<skill>` — GREEN before any dispatch.
2. **STAGE A — budget probe** (mini-batch, hermes GEPA port): write ONE reflective-mutation candidate targeting the selected scenario (MUTATION.md must cite its failing trial id). Dispatch byte-identical incumbent+candidate pairs on **that scenario only** (2 runs each, interleaved, fresh subjects, same session label) and record with `grade.py --record`.
   - Candidate does not fix the target scenario → **STOP. Candidate dies.** No Stage-B spend.
3. **STAGE B — full matrix**: only on a Stage-A fix, dispatch the remaining scenarios (2 runs, interleaved). Then `stats.py` and `pareto.py --frontier`: the candidate must now ENTER the frontier. A candidate that fixes its target but enters no frontier wins nothing.
4. **Description-only mutations are trigger-surface evolution** — task oracles cannot measure them. Instead: `trigger_eval.py --check` (cases must validate and be FROZEN before dispatch) → dispatch ONE fresh metadata-only router subject: give it ONLY every skill's `name:`+`description:` frontmatter (verbatim, no bodies), then the numbered utterances from trigger-cases.jsonl verbatim; it answers exactly `N: <skill-or-none>` per line. Score with `trigger_eval.py --score <answers> --cases tests/skill-evals/trigger-cases.jsonl --run-id <label> --variant <candidate-id> --baseline-run <incumbent-run>` (auto-baseline picks the latest clean run over the same table if omitted). Adjudicate genuine divergences with `--ok/--bad` and record why in `--note`. The score row is the candidate's G7 evidence. **Revising the cases table invalidates baselines** (runs are scoped by table hash): after a revision, run one fresh incumbent round to establish the new baseline before scoring any candidate. Sensitivity note from the 2026-09-04 ablation: names-only routing still scores ~0.92 accuracy — aggregate accuracy is NOT the discriminator; the per-skill regression rule is (it alone flags lost routing capability).
5. **PROMOTE** (7 gates): `python3 skills/skill-forge/scripts/promote.py --skill <skill> --candidate <id> --incumbent-variant <v>` — dry-run shows G1–G7 (incl. growth-limit and trigger-evidence). Show the user the gates + the diff; promote only on explicit user approval (`--approved-by`). Two consecutive candidates without frontier entry = end the round with a plateau report.
