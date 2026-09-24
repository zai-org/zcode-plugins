# QA Checklist — The Gate Before Emitting

Run every item before the final output leaves the skill. Any failure sends the affected part back, not the whole review.

## Grounding and anchoring

- [ ] Every concern has a claim pointer and an evidence pointer (or an explicit `missing`).
- [ ] Every "prior work exists" claim names a verifiable source or carries `未经文献核实`.
- [ ] No invented experiments, citations, figure details, or line numbers anywhere in the output.
- [ ] Every concern attaches to a row of the claims map (or added one).
- [ ] The simulated author defense cites only material present in the input; ungrounded defenses scored ≤2.

## Isolation integrity

- [ ] Reviewer reports were generated in isolated contexts (or the limitation was declared).
- [ ] No report was edited after freezing; overlap and disagreement survived.
- [ ] Consensus labels rest on ≥2 independent reports.

## Severity and calibration

- [ ] Blocking = Yes only where the central case cannot stand until resolved; Minors are never blocking.
- [ ] Criticals each cite a fatal-flaw criterion; concerns not meeting any criterion were not inflated.
- [ ] Red-flag hits entered arbitration and were not offset by merits.
- [ ] Ranking calibration was applied before the overall assessment; fatal-flaw cap respected.
- [ ] Downgrades tracked defense scores; no consecutive downgrades; sycophancy warning printed if downgrade rate >50%.

## Coverage and honesty

- [ ] Each reviewer swept its brief's axes; "no grounded concern at this level" was stated rather than filled.
- [ ] At least one genuine strength appears (an empty strengths list means an unbalanced review).
- [ ] Distinguished throughout: supported / weak / not assessable from the provided material.
- [ ] Boundary conditions of the review (partial material, shared context) are stated in the output.

## Self-calibration questions (answer internally before emitting)

1. If these conclusions were published as-is, would they mislead readers or practitioners? (Yes → at least one Critical exists.)
2. Could the author fix most of the listed issues in a revision or two? (Mostly no → Reject-level overall.)
3. Was I stricter or more lenient than I would be with my own work?
4. Would each remark actually help the author's next version, even at Reject-level?
