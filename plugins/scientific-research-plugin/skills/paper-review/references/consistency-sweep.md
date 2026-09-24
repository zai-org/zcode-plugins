# Consistency Sweep — The Manuscript Against Itself

Run during synthesis, over the whole material, independent of any reviewer's brief. It catches self-contradictions that per-section review misses. Every hit becomes a concern with two pointers (the contradicting locations) and goes to arbitration.

## Numeric reconciliation

- Headline numbers (abstract, introduction, conclusion) match the tables/methods they summarize.
- One metric reported at two precisions or under two names is reconciled (e.g., "3.2%" in text vs "0.032" and "3.24%" in two tables).
- Percentages, totals, and improvements are internally consistent (improvement directions match raw values; averages match their components).
- Solver gaps, optimality claims, and convergence thresholds match the logs/tables cited.

## Claim-vs-own-evidence

- Superlatives ("significantly outperforms", "scalable to large instances") survive the paper's own tables at the tested scales.
- Overlapping error bars or within-noise gaps are not presented as advantages.
- Stated problem sizes, instance counts, and seed counts match the experimental setup section.
- The conclusion's scope matches the evidence's scope (tested distributions, scales, topologies).
- Limitations acknowledged in the discussion are not contradicted by claims elsewhere.

## Structural

- Notation consistent across model, algorithm, and experiments (same symbol, same meaning).
- Figure captions match what the figures show; axis units consistent.
- Cross-references resolve (equation/table/section numbering), and cited-theorem attributes match their statements.

A hit on this sweep that also meets a fatal-flaw criterion (typically Data–Conclusion Mismatch) escalates directly to a Critical candidate.
