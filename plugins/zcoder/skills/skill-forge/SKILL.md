---
name: skill-forge
description: Build and continuously improve skills through a measured lifecycle — scan a project for missing skills (Laravel, React, Django, other stacks), author them, score them with deterministic oracle-graded eval scenarios and a Wilson-scored trials ledger, and improve them via reflective mutation and gated candidate promotion. Use whenever creating or improving a skill, evaluating skill effectiveness, scanning a project for needed skills, dogfooding skills, or running skill-evolve rounds.
---

# skill-forge — measured skill lifecycle

Core empirical fact (validated 2026-09-03, trials ledger on record): **skill text
presence does not imply compliance** — 4/4 subjects ignored an explicit rule.
Skills are measured, not trusted. Every number below comes from a deterministic
Python grader; no verdict is ever an LLM's opinion.

## Principles

1. **No oracle, no scenario.** Every eval scenario ships a machine-checkable
   oracle (`oracle/checker.py`) plus known-good and known-bad references.
2. **Validate the validator first.** `oracle_selftest.py` must be green before
   any dispatch. (It once caught a checker that counted silent False as pass.)
3. **Fresh-context subjects only.** The context that wrote or scored a skill
   must never execute its trials — self-measurement contamination.
4. **Oracle secrecy.** Subjects see the task and the guidance. Never the
   oracle, the expected output, or the hypothesis.
5. **Byte-identical dispatches** per variant across runs (prefix-cacheable,
   reproducible conditions). Record tokens and agent id per trial.
6. **Honest stats.** Wilson intervals describe; ~300 items/arm would be needed
   for significance on small effects (uneconomical) → gates are discriminative
   (tripwire philosophy), `stats.py --compare` refuses significance claims at
   n<20.

## Directory contract

```
tests/skill-evals/<skill>/
  scenarios/<id>/task.md        # dispatch template; frontmatter declares output_ext;
                                # body contains {{SKILL_GUIDANCE}} placeholder + task
  scenarios/<id>/fixture/...    # inputs referenced by task.md
  scenarios/<id>/oracle/checker.py      # prints VERDICT pass|fail + REASON; exit 0 iff pass
  scenarios/<id>/oracle/reference_good.*  # must PASS self-test
  scenarios/<id>/oracle/reference_bad.*   # must FAIL self-test (prefer REAL observed failures)
  trials.jsonl                  # the ledger (grade.py --record appends)
  artifacts/                    # extracted subject outputs
  weak-spots.md                 # failure notes, one entry per failure mode
  candidates/<id>/SKILL.md      # improved skill draft
  candidates/<id>/MUTATION.md   # which failing trial, what changed, why
  promotions.jsonl              # promotion audit trail
skills/<skill>/SKILL.md         # the live (incumbent) skill
skills-archive/<skill>/<ts>/    # archived incumbents (promote.py)
tests/skill-evals/trigger-cases.jsonl   # golden routing set, PRE-REGISTERED
                                # before any dispatch: {id, utterance, expected: skill|none, note}
tests/skill-evals/trigger-evals.jsonl   # router-probe run ledger (trigger_eval.py; read by G7)
```

## Lifecycle

### 1. RESEARCH (zero tokens)
`python3 skills/skill-forge/scripts/scan_project.py [root]` — manifest-based
stack detection + gap report against installed skills. Present gaps to the
user; creation is user-confirmed by default.

### 2. CREATE
Author per skill-creator conventions: pushy description (20–500 chars) naming
trigger phrasings; body ≤15360 bytes; imperative rules that explain *why*;
worked examples over MUSTs. Stack recipes (starting points, then measured):
**laravel** — artisan generators, migrations schema builder, Eloquent
conventions, form requests/validation, policy gates, phpunit+feature tests.
**react** — component structure, hooks rules, state colocation, testing
library. **django** — apps/models, migrations, DRF serializers, pytest.
Then immediately build the eval suite: ≥1 scenario with oracle + references
(reference_bad = a realistic wrong output), self-test green.

### 3. EVALUATE
For each scenario × variant × run (2 runs default):
1. Build the dispatch: task.md with `{{SKILL_GUIDANCE}}` replaced by the
   variant's SKILL.md body. Byte-identical across runs of the same variant.
2. Dispatch a fresh subagent (glm-main; glm-turbo if alive). Subject never
   sees oracles/ledger/hypotheses.
3. Save the raw final message to `raws/<scenario>__<variant>__<run>.txt`.
4. `python3 skills/skill-forge/scripts/grade.py --record tests/skill-evals <skill> <scenario> <variant> <run> <rawfile> --tokens N --agent ID --session <label>`
5. `python3 skills/skill-forge/scripts/stats.py tests/skill-evals/<skill>/trials.jsonl`

**Blocking rule (hard-won, 2026-09-03):** variant comparisons are valid
WITHIN one session only, run interleaved (A,B,A,B in the same dispatch wave).
Byte-identical v1 dispatches scored 0/2 in one session and 2/2 in another —
the subject substrate is non-stationary across sessions, so cross-session
pooling is confounded. Always pass `--session <label>` when recording; stats
warns when a variant's outcomes flip across sessions. Baselines are per
(oracle hash, task hash, session) — the ledger stamps all three.

### 4. IMPROVE (reflective mutation + staged eval — Hermes/GEPA port)
Select the target zero-token: `pareto.py <ledger> --plateau <promotions.jsonl>`
names the weakest scenario of the best frontier variant. If the plateau check
says PLATEAU (last 2 promotions added no frontier member), write a NEW SCENARIO
mined from sessions/weak-spots — not another body mutation; a stalled frontier
on a 1-scenario suite is overfit, not solved. Otherwise mine the failing
trials' artifacts + reasons: a candidate mutation MUST cite the failing trial
id in MUTATION.md (G4). One targeted mutation per candidate; explain-why style;
add a worked before/after example; prefer restructuring over louder enforcement.
Mutations stay LOCAL (minimal diff) — unrelated rewrites violate semantic
preservation and waste the growth allowance G6 grants. Evaluate staged:
Stage A = target scenario only (2 interleaved runs); a candidate that doesn't
fix its target dies there, before any full-matrix spend. Stage B = remaining
scenarios; the candidate must then ENTER the Pareto frontier.

### 5. PROMOTE (gated)
`python3 skills/skill-forge/scripts/promote.py --skill <s> --candidate <id> --incumbent-variant v1 [--approved-by NAME]`
Gates: G1 static caps (placeholders scanned in FULL raw text, frontmatter included) ·
G2 oracle self-test · G3 same-session paired evidence — dominance computed ONLY
over sessions where BOTH variants were tried on the scenario; a fix assembled
from disjoint sessions is rejected, and a candidate failing an incumbent-untried
scenario is rejected as an unmeasured regression surface · G4 mutation citation ·
G5 differs-from-incumbent · G6 growth limit (Hermes port: body ≤ incumbent +20%,
768B floor) · G7 trigger evidence (a changed description needs a baseline-
REFERENCED trigger run: effective ≥0.75, zero cross-skill regressions;
baseline-free runs are vacuous and rejected). Dry-run by default; **only an
interactive user passes --approved-by** — idle rounds never promote.

Gate regression locks live in `tests/skill-forge-smoke.sh` (32 adversarial
fixtures; born 2026-09-04 from an audit that caught cross-session fix claims,
candidate-only scenario fails, and baseline-free trigger runs passing gates).

### 6. TRIGGER EVOLUTION (Hermes Phase-2 port)
A skill's `description:` is trigger surface — what the router matches, the
analog of hermes' tool descriptions. Evolving it is a different measurement:
task oracles can't see routing. Protocol: `trigger_eval.py --check` (validates
+ hashes the golden case table — freeze BEFORE any dispatch) → dispatch ONE
fresh metadata-only router subject (skill name+description frontmatter only,
never bodies) → `trigger_eval.py --score <answers> --run-id <label> --variant
<candidate> --baseline-run <prior>` scores it deterministically, including the
cross-skill rule: improving one description must not STEAL selections from
another (per-target rate drops = REGRESSIONS → G7 rejects). Schema stays
frozen: name and frontmatter structure don't evolve; only description text.

## Idle dogfood tiers (automation; budgets are hard)

| Tier | Trigger | Work | Budget |
|---|---|---|---|
| NOOP | state hash unchanged | `tests/skill-forge-static.sh` + log line | ≤2k |
| CANARY | every 4th round or weakest skill unknown | NOOP + `stats.py --rank` + 1 fresh trial on weakest skill's incumbent | ≤10k |
| FULL | skill/trials file changed, regression, or every 10th round | CANARY + full scenario × variant matrix (2 runs) + stats + one reflective-mutation candidate if new fails | ≤60k |

State hash = sha256 of live SKILL.md files + trials.jsonl tail, stored in
`tests/skill-evals/.forge-state`. Idle rounds prepare candidates only.

## Math layer

- **Wilson 95% intervals** per variant — wide intervals are honest ignorance.
- **Thompson sampling** (`stats.py --thompson`): Beta(1+k, 1+n−k) posterior,
  ledger-hash-seeded (same data → same recommendation) — decides which
  variant deserves the next trial.
- **Pareto frontier** (`pareto.py`, GEPA port): a candidate is accepted when
  it EXPANDS the per-scenario dominance frontier, never on scalar averages —
  dominance survives mixed profiles that averaging destroys. Also emits the
  next mutation target and the plateau stop-rule.
- **Tripwires** over significance: alert on any fail / integrity violation.
- **`--rank`**: weakest skill by Wilson lower bound — idle-loop target order.
