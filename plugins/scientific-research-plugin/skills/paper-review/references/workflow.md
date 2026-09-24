# Workflow — Orchestration, Isolation, Freeze, Synthesis

Mechanics behind SKILL.md's 8 steps. The non-negotiable core: reviewers are independent; everything adversarial happens after freezing.

## The immutable packet

One packet, built before any reviewer launches:

- The supplied material (manuscript / results / notes) — unmodified
- The claims-and-evidence map
- Assessment boundary (what is and is not assessable)
- Common journal criteria (the chosen profile from `review-axes.md`)

Never in the packet: analytical conclusions, suspected concerns, draft syntheses, or any hint of what to find.

## Emphasis briefs

Working lenses, never personas — no invented names, institutions, temperaments, or selection histories. Each brief states focus, axes owned (from `concern-taxonomy.md`), and the domain gates it may load:

| Reviewer | Brief | Owns primarily | Loads |
|---|---|---|---|
| R1 | Methodology rigor — model validity, math correctness, experimental statistics | A1–A3, A5–A8 | Gates matching domain |
| R2 | Domain contribution — novelty, positioning, usefulness to the field | A4, A11, A12 | Gates matching domain |
| R3 | Adversarial attack — fatal-flaw hunt, red-flag sweep, strongest counter-narrative | A9, A10, + red flags & fatal-flaw criteria | Gates matching domain |

Overlapping axes are fine — overlap is evidence, and duplication must survive freezing.

## Isolation levels (declare which one you achieved)

1. **True isolation** (preferred): each reviewer is a separate subagent/process receiving only the packet + brief.
2. **Sequential invocation**: one reviewer per conversation turn/invocation, no shared working state.
3. **Shared context** (last resort): must be declared in the output — "mutual blindness cannot be guaranteed" — and the report must not claim independence it did not have.

## Freeze rules

- A report is frozen once its author context ends. No post-hoc edits.
- Overlap between frozen reports is kept, not redistributed.
- Disagreement between frozen reports is kept and surfaced in synthesis, not reconciled away.

## Synthesis pass (after freezing)

1. Reconcile independently created concerns to shared keys (same underlying concern, raised twice).
2. Consensus label requires **≥2 independent reports** raising the same underlying concern.
3. Run defense arbitration (`adversarial-defense.md`) on disputed Major/Blocking concerns.
4. Apply the profile axes, confidence binding, ranking calibration, and fatal-flaw cap (`review-axes.md`).
5. Run the QA gate (`qa-checklist.md`) and the consistency sweep (`consistency-sweep.md`).
6. Emit the final C/M/N list under `report-format.md`.

## Skill boundaries

| Scenario | Use |
|---|---|
| Language, grammar, flow polish | `paper-polish` (this skill touches language only where it obscures meaning) |
| Point-by-point response writing | `rebuttal` (consumes this skill's C/M/N list directly) |
| Novelty claims needing literature verification | fetch and verify via `zotero-paper-fetch`; this skill does not fabricate citations |
