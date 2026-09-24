# Adversarial Defense — Author-Defense Arbitration Protocol

Runs **after all reviewer reports are frozen**, inside the synthesis pass. Purpose: a one-way panel filters out nothing — a concern that survives the strongest honest defense is far more likely to be real, and a concern that collapses under defense was probably a misreading. This is also where `rebuttal`-grade material is born: the surviving defense sketches are exactly the responses an author will need.

## Scope

- Arbitrate **only disputed Major / Blocking concerns** (including red-flag hits). Minor comments and uncontroversial majors skip the defense round.
- One defense round per concern, three moves total (defense → score → judgment). No unlimited back-and-forth.

## The simulated author

An experienced, open-minded author of the manuscript — but with one overriding constraint the original skill lacked:

> **Grounding rule**: the defense may cite only what is actually present in the reviewed material (sections, tables, theorems, reported experiments) or verifiable domain knowledge. A defense that cites a section, experiment, or reference not present in the material **scores ≤2 and fails**. The simulated author is a stress test, not an alibi factory.

Defense principles:

1. **Concede the boundary first**, then explain the consideration (a real author's posture).
2. **Evidence first**: literature, theory, data — never bare assertion.
3. **Strongest argument first**, secondary support after.
4. **Concede carefully**: admit real limitations, explain their reach, propose remedies.
5. **Refuse carefully**: when the concern rests on a misreading, clarify politely but firmly — especially for counter-intuitive results, which are often the contribution.

Strategy library (priority order): theory support → literature benchmarking (verifiable or tagged `未经文献核实`) → logical derivation from stated premises → standard practice in the subfield → reported experiments → measured concession.

## Scoring and judgment

The synthesizer scores the defense 1–5, then rules:

| Score | Meaning | Action |
|---|---|---|
| 5 | New evidence dissolves the concern | Withdraw (Resolved), with thanks |
| 4 | Substantively weakens it | Downgrade one level (Critical → Query Remains → Resolved) |
| 3 | Partial response; core doubt remains | Keep as Query Remains |
| 2 | Evades the core; cites material not present | Restate the concern and name the missing evidence |
| 1 | Assertion without evidence | Uphold; may add a new attack angle |

| Judgment | Condition | Consequence |
|---|---|---|
| **Resolved** | Credible, grounded explanation | No change needed |
| **Query Remains** | Plausible but not fully dispelling | Clarify in the paper or add a bounded experiment |
| **Critical Issue** | Core challenge unanswered, or the answer has a logic hole (check the fatal-flaw criteria) | Must address; rejection-level otherwise |

## Anti-sycophancy rules (LLM panels soften under author persistence — counteract explicitly)

- Defense score <4 → no softening of the judgment, no exceptions.
- **No consecutive downgrades**: after downgrading one concern, the bar for downgrading the next rises to a score of 5.
- If >50% of initial concerns end withdrawn/downgraded, print: 「让步率过高，建议人工复核——是论文确有改进，还是评审在迎合」.

## Worked examples (OR-specific, abridged)

**Low VSS challenged.** Concern: VSS 0.5% means the stochastic model adds nothing. Defense (grounded): VSS magnitude depends on problem structure; where uncertainty acts on feasibility rather than expectation, VSS is low yet the model still pays (Rockafellar & Wets 1991 line of work; our Sec. 4.3 reports constraint satisfaction 78%→95%). → Score 4, downgrade to Query Remains: state the feasibility-driven value proposition in the introduction.

**Counter-intuitive scaling challenged.** Concern: the method does better on small instances, contrary to expectation. Defense (grounded): the search strategy exploits structural similarity; cleaner feasible-region structure at small scale explains it; analogous GNN-on-small-TSP reports exist (Khalil et al. 2017); Sec. 6 develops the explanation. → Score 4, Query Remains with a request to bound the claim to the tested scales.

## Re-review usage

When the user returns with a revised manuscript and responses, run the same protocol against **real** author responses (not simulated): each C/M/N item gets Response → grounding check → score → Resolved / Partially / Unresolved, and a new sweep checks the revision for regressions.
