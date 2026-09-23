# Review Axes — Journal Profiles, Scoring Anchors, Confidence

Two profiles. Pick by target venue (workflow step 1); the user can override. The profile changes the **axes and anchors**, never the workflow or the C/M/N contract.

## Profile B (default) — OR-journal depth

For OR, MS, TS, POM, EJOR, IJOC, Networks, Transportation Research parts B/E, and ML+OR venues. Depth logic: methodological soundness first.

Score each axis 1–4:

| Axis | 4 (Excellent) | 3 (Good) | 2 (Fair) | 1 (Poor) |
|---|---|---|---|---|
| **Soundness** | Assumptions plausible, derivations correct, theoretical properties complete | Minor slips that do not affect conclusions | Derivation/assumption problems affecting conclusions | Core formulation or assumptions fail |
| **Empirical rigor** | Design, statistics, reproducibility, baseline fairness all met | Small gaps (e.g., few seeds) | 1–2 Med red flags, or unfair baselines | High-severity red flag hit |
| **Contribution** | Clear methodological/theoretical increment the community will follow | Increment exists but is under-stated or under-supported | Increment dubious (tuning, composing off-the-shelf parts) | No identifiable increment |
| **Positioning & presentation** | Contribution stated up front, literature correctly placed, insights actionable | Mostly clear with local gaps | Positioning muddled or misleading | Contribution cannot be located |

Overall mapping: Strong / Acceptable / Weak / Reject-level. Two hard rules bind it:

- **Ranking calibration**: "among 100 concurrent submissions to this venue, top 10?" — if not, cap at Acceptable.
- **Fatal-flaw cap**: any confirmed Critical caps at Weak.

## Profile N — Nature-style breadth

For Nature-family and general-science venues. Use only when the user targets one. Breadth logic: who else cares, and can a nonspecialist follow it?

Axes: `originality` / `scientific importance` / `interdisciplinary readership` / `technical soundness` / `readability for nonspecialists`.

- Score each axis and identify **who would be interested in the results and why** (specific communities, not "researchers").
- Technical soundness still uses Profile B's Soundness and Empirical rigor anchors internally — breadth never excuses rigor.
- Do **not** claim the manuscript belongs in the target journal as a settled fact, and do not emit an editorial decision.

## Confidence (both profiles)

Bound to verification depth, not to how the reviewer feels:

- **5** — re-derived key steps / recomputed key numbers line by line
- **4** — checked the main argument, not every detail
- **3** — methodological judgment reliable; math not re-checked
- **2** — willing to defend the assessment but may have misread a core part
- **1** — educated guess (outside expertise)

## Anti-inflation self-check (before finalizing scores)

LLM reviewers drift positive (documented across LLM-review studies; measured inflation in large-scale audits). Before emitting dimension scores:

1. If all axes ≥3 and no Critical was confirmed, **re-audit the weakest axis and the red-flag list** before submitting.
2. If the panel upgraded/downgraded after defense arbitration, recheck that the movement tracked defense scores, not author persistence.
3. Consensus labeling requires ≥2 independent reviewers — agreement manufactured by shared drafting does not count.
