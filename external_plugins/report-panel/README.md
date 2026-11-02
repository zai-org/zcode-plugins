# report-panel (Report Review Panel)

Adversarial deep review for long-form Chinese reports written by AI. It does not address style-level issues (use a humanizer-type tool for that); it addresses content: whether the argumentation survives adversarial reading, whether the structure needs reordering, whether numeric figures contradict each other, and whether there are release-blocking defects. **It only delivers findings — it never edits the manuscript.**

## Components

| Component | Trigger | Purpose |
| --- | --- | --- |
| `/report-panel:review` (command) | explicit command | 3-step pipeline: hard checks → adversarial review → restructure proposals |
| `panel-review` (skill) | adversarial review / red-team / gatekeeping | parallel blind review by multiple reviewers → arbitration → 4-tier verdict |
| `consistency-check` (skill) | check numbers / calibers / contradictions | deterministic Python hard checks, near-zero tokens |
| `dev-edit` (skill) | restructure / refactor outline / outline pre-review | developmental editing: skeleton diagnosis + ≥2 restructure proposals |
| `panel-appeal` (skill) | disagree with a finding / appeal | an independent re-examiner re-checks only the appealed findings |
| `panel-recheck` (skill) | verify revisions / regression check | per-finding reconciliation + fresh-damage scan on changed regions |

## Verdict system

- **4-tier verdict**: APPROVE / REVISE / RESTRUCTURE (local reorder) / REBUILD (rebuild the section structure)
- **3-level severity**: A = hard defect (factual error, numeric contradiction, conclusion unsupported by evidence); B = structural (broken argument chain, missing premise); C = wording
- **release_blockers**: items structural surgery cannot fix and the author or an external party must decide (e.g. unsourced base documents)
- **verify assertions**: every finding carries a "should-appear / should-disappear / recomputable" assertion so revisions can be mechanically verified (the basis for panel-recheck reconciliation)

## Architecture: deterministic layer first, LLM only judges

The `py/` directory is a zero-I/O pure-function layer (Python 3 stdlib only, no third-party dependencies). Review flows run machine gates before any LLM work:

- **Arithmetic re-computation** (X/XP/XS): totals ≠ part sums, same-sentence percentage mismatches, same-metric-different-value clustering — the LLM only adjudicates caliber attribution, never re-does arithmetic
- **Hollow-evidence scan** (XH): "experiments show / negligible" claims with no data anchor in the sentence and no data table within ±40 lines
- **Assertion candidate extraction**: a registry of load-bearing claims where cross-section contradictions surface
- **Freeze hashing**: an external-file manifest with SHA-256 over the review scope, preventing mid-review edits
- **Input validation**: PDF/zip containers and non-UTF-8 input are rejected up front with conversion guidance

The review chain is parallel blind review by sub-agents (logic auditor, devil's advocate, data rigor, finance, compliance seats) → clustering → targeted investigation → final arbitration. Seat instructions and prompt templates are in `skills/panel-review/SKILL.md`.

## Quality & tests

`tests/` ships 6 self-contained suites (196 assertions total; run directly with Python 3, no pytest needed):

```shell
python3 tests/test_extract_l0.py    # ledger / assertion extraction / pre-computation (49)
python3 tests/test_packages_l0.py   # evidence packages / coverage assertion (44)
python3 tests/test_tiering_l0.py    # severity reconciliation gate rules (55)
python3 tests/test_render_l0.py     # review report rendering (24)
python3 tests/test_freeze_l0.py     # freeze manifest / hashing (17)
python3 tests/test_gt_score_l0.py   # injection exam scorer (7)
```

Real-sample smoke sections are optional: set `PANEL_BENCH_DIR` to a sample directory to enable them; they are skipped by default. Historical injection-exam measurement: 20 of 21 planted defects recalled, zero false positives on negative controls.

## Language scope

The rule set (assertion phrasing, numeric patterns, book-title reference marks, full/half-width normalization) is tuned for **Chinese reports**. English reports work but extraction coverage is weaker; double-check consistency findings manually.

## Network access, dependencies & side effects

- The plugin itself makes zero network requests: no external API calls, no downloads, no telemetry, no MCP servers, no hooks; the `py/` deterministic layer runs fully locally.
- Running a review depends on host model inference: review chains execute on in-session sub-agents and generate normal LLM API traffic (same as any skill, billed to the host account; multi-seat parallel review consumes significantly more tokens than a single chat turn).
- Skills contain no WebSearch/WebFetch instructions and never access external websites; online verification of external facts is an investigation-layer capability of a heavy review orchestration, not part of this package.
- Requires: Python 3 (≥3.8) stdlib.
- Side effects: `consistency-check` only reads the report; review output stays in-session. A self-built heavy orchestration (saved workflow) writes review artifacts only into a `materials/` subdirectory next to the report.
- Reviewed text is treated as data, not instructions: every seat prompt embeds an injection fence that ignores instruction-like content inside the reviewed document.

## Third-party components

None. All code and copy are original to this plugin, MIT licensed.
