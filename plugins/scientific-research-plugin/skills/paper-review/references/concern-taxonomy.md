# Concern Taxonomy — 12 Axes, Fatal-Flaw Criteria, Experimental Red Flags

Each isolated reviewer builds a private concern ledger. The 12 axes are an **internal coverage checklist** (did I look at every axis relevant to my brief?), not an output structure — never manufacture a concern to fill an axis.

## The 12 axes

| # | Axis | What it asks | Primary brief |
|---|---|---|---|
| A1 | Model assumptions | Are simplifications justified? Would the model's own output violate them? | R1 |
| A2 | Formulation correctness | Variables/constraints/objective consistent? Derivations check out? | R1 |
| A3 | Theoretical properties | Convergence, complexity, optimality bounds stated and proven? | R1 |
| A4 | Algorithmic novelty | Methodological advance, or tuning / composition of existing parts? | R2 |
| A5 | Experimental design | Instances realistic, diverse, challenging enough to support the claim? | R1 |
| A6 | Statistical validity | Seeds, variance, significance — reported before comparisons are drawn? | R1 |
| A7 | Baseline fairness | Baselines tuned equally, current, implemented honestly? | R1/R3 |
| A8 | Reproducibility | Enough detail (parameters, thresholds, environment) to replicate? | R1 |
| A9 | Data integrity | Data real or defensibly generated? Any leakage in ML+OR pipelines? | R3 |
| A10 | Generalization scope | Do conclusions stay inside the support of the evidence? | R3 |
| A11 | Literature positioning | Prior art cited correctly? Novelty claim survives the citations? | R2 |
| A12 | Presentation consistency | Numbers, tables, captions, and prose tell the same story? | R2/R3 |

## Fatal-flaw criteria (when is a concern Critical, not Moderate)

A concern is Critical **iff** it meets one of four standards (this prevents both inflating minor issues and softening fatal ones):

1. **Foundation Collapse** — a core model assumption is overturned by the material's own results (negative production quantity under non-negativity; assumed conflict-free capacity repeatedly violated).
2. **Logic Chain Break** — evidence is valid but the conclusion does not follow (correlation asserted as causation; a single instance/distribution generalized).
3. **Data–Conclusion Mismatch** — data and conclusion directly contradict ("significant improvement" with the gap inside noise; VSS 0.01%–0.10% framed as value of stochasticity).
4. **Stronger Counter-Narrative** — a simpler explanation fits the data better and was not excluded.

Otherwise the concern is Moderate or Minor. **Cap rule**: any confirmed Critical caps the overall assessment at Weak; decorative strengths cannot lift it.

## Experimental red flags (auto-escalate to Major / Blocking candidates)

Any hit goes to the concern ledger as a Major candidate and enters defense arbitration; merits cannot offset red flags.

| Red flag | Severity |
|---|---|
| Reports only the best over seeds/instances/hyperparameters, no mean±variance or full distribution | High |
| Numbers contradict across text, tables, figures | High |
| Result direction opposite to data (gap within noise) yet phrased as "significant improvement" | High |
| Comparison conclusions for stochastic algorithms without multi-seed variance | High |
| Baseline mistreatment: own method tuned, baselines on defaults or stale implementations | High |
| ML+OR: test/evaluation data leaking into training, calibration, or instance generation | High |
| Optimality claimed without a gap proof or solver log | High |
| Favorable instances/curves shown; unfavorable ones absent without explanation | Med |
| Runtime compared across hardware/languages/implementations without conversion | Med |
| Termination criteria/thresholds self-defined to favor the proposed method | Med |

## Reviewer discipline (applies inside every isolated context)

1. **Anchor everything** — every concern points at a location (page/equation/table/figure/line). Unlocatable concerns are deleted or rewritten as clarification requests.
2. **Name names** — "this exists in the literature" requires a verifiable author/year/source, or an explicit `未经文献核实` tag. Never fabricate citations.
3. **Decide, then verify** — form a provisional rating and "what evidence would change my mind" after the contribution statement, then check the full material against it.
4. **Main problem first** — one dominant issue before the rest; fixable details never precede fatal ones.
5. **Restrained asks** — suggested additional experiments must be limited in scope and verify existing conclusions, not rewrite the submission.
6. **Separate advice from judgment** — nice-to-have improvements are listed apart and do not feed the rating.
7. **Reward honesty** — disclosed limitations are a plus; missing or evaded limitations are a minus.
8. **Worthy questions only** — ask only questions whose answers would move the assessment, and say which answer moves it which way.
