# Report Format — Full Output Contract and the C/M/N Mapping

The default structure (SKILL.md shows the outline; this file is the contract). Deviate only on explicit user request.

## Section 1 — Review setup

- **Input scope** — what was provided (full draft / excerpts / code+results)
- **Assessment boundary** — what could not be assessed and why
- **Journal profile** — OR-journal (default) or Nature-style; target venue if known
- **Claims-and-evidence map**

| # | Claim | Evidence (where) | Support |
|---|---|---|---|
| C1 | [claim text] | [Thm 1 / Table 3 / Fig 5 / none] | Sufficient / Partial / Missing / Contradicted |

Every concern below attaches to a row of this map (or adds one). The weakest claim and any Contradicted claim are called out here.

## Section 2 — Reviewer 1..3 (frozen blocks)

Per reviewer:

- **Overall assessment** (2–4 sentences) / **Major strengths** (genuine ones; absence signals an unbalanced review)
- **Major Concerns**, each:

  - **Concern ID** Rk-Mn · **Blocking** Yes/No · **Axis** (A1–A12)
  - **Claim pointer** / **Evidence pointer** (or `missing`)
  - **Concern** · **Why it matters** · **Resolution test** (a concrete pass/fail check)

- **Minor Comments** Rk-mn: axis, evidence pointer, issue, required correction.

## Section 3 — Defense & judgment (per arbitrated concern)

- Concern (with originating IDs) · **Author defense** (grounded excerpt or `ungrounded`)
- **Defense score** 1–5 · **Judgment** Resolved / Query Remains / Critical (+ fatal criterion)

## Section 4 — Cross-review synthesis

- Consensus blocking concerns / other consensus majors (≥2 independent reports each)
- Where emphasis differs across reviewers, and what the difference implies
- **Dimension scores** on the profile axes + **Confidence** (1–5, verification-bound)
- **Overall assessment** — Strong / Acceptable / Weak / Reject-level, with ranking calibration stated and the fatal-flaw cap applied
- Sycophancy warning if the downgrade rate exceeded 50%

## Section 5 — C/M/N issue list

Merge all surviving concerns into one stable, deduplicated list. Each entry's Location / Problem / Why it matters / Suggested fix fields are exactly what `rebuttal` needs to draft point-by-point responses (it consumes the list as review comments; it does not parse the numbering itself).

| List slot | Source | Meaning |
|---|---|---|
| **C1, C2, …** | Major + Blocking = Yes, or any judgment = Critical | Must address; each cites the fatal criterion it meets |
| **M1, M2, …** | Major + Blocking = No (incl. downgraded Query-Remains majors) | Should address |
| **N1, N2, …** | Minor comments | Correct if convenient |

Each C/M/N entry keeps: Location (page/equation/table/line) · Problem · Why it matters · Suggested fix · (C only) Fatal criterion. Reviewer-internal IDs (R1-M2) are preserved in parentheses for traceability back to the frozen reports.

**Questions for authors**: only questions whose answers would change the assessment; each states which answer raises and which lowers it.
