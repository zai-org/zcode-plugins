---
name: paper-review
description: "科学审稿 (scientific review) — three-blind adversarial review of the SCIENTIFIC merit of papers and experimental results in any technical domain: 3 isolated reviewers (methodology rigor / domain contribution / adversarial attack) + author-defense arbitration + cross-review synthesis, with claim-evidence anchoring and journal-profile axes. Domain-conditional gates are detected per manuscript and composed freely (built-in: mathematical programming, stochastic/robust, decomposition, network/combinatorial, application domains, ML+OR, LLM/agents; extensible). NOT prose quality (use paper-polish). 触发词：\"科学审稿\"、\"学术审稿\"、\"审一下这个模型/结果\"、\"这个结果合理吗\"、\"投稿前自审\"、\"review these results\"、\"pre-submission review\"、\"simulate review\"。"
license: MIT
---

# Paper Review — Three-Blind Adversarial Review

Simulate a referee-side review panel: **3 mutually blind reviewers** work from non-overlapping emphasis briefs, then a **synthesis pass** runs an **author-defense arbitration** on disputed concerns before issuing the final C/M/N issue list that `rebuttal` consumes.

This skill evaluates scientific merit only. For rebuttal drafting route to `rebuttal`; for language polish route to `paper-polish`.

## Default stance

- Ground every concern only in the supplied manuscript/results plus verifiable domain knowledge. Every substantive concern carries a stable ID, a faithful `claim_pointer` (where the paper makes the claim), and an `evidence_pointer` (where the evidence lives or is marked missing). Mark missing locations instead of inventing them.
- **Conservative bias**: when unsure whether a claim is valid, raise it as a query and require resolution — never silently pass it. Missing evidence is an unsupported claim, not the benefit of the doubt.
- **No quota**: if no grounded concern exists at a severity level, say so explicitly instead of inventing one. Natural overlap between reviewers is evidence of independence and must not be edited away.
- **Protect counter-intuitive results**: counter-intuitive findings are often the contribution. The output is a query the author must answer, not a verdict; do not kill innovation to sound rigorous.
- Separate `Major Concerns` from `Minor Comments`. Mark a Major Concern `Blocking: Yes` only when the manuscript cannot establish its central case until the concern is resolved; Minor Comments are never blocking.
- Anchor severity in impact on the manuscript's case, not in hostile wording. Closed verifiable questions ("does the stated complexity in Sec. 3 match the derivation?") beat open-ended impressions.
- Before the final score, run the **ranking calibration**: "among 100 concurrent submissions to this venue (top-tier acceptance 5–15%), does this contribution make the top 10?" If not, cap at Acceptable.
- Domains are detected per manuscript, not fixed: when the material has a clear technical domain, load only the matching sections of `references/domain-gates.md` inside each isolated reviewer context. A multi-domain paper (e.g., OR + ML + LLM) composes several gates; a domain with no built-in gate runs on the general discipline plus the two-track rigor floors, and the gate set is extensible.
- Do not claim the editor's final decision. The panel informs the author; it does not decide for a journal.

## Accepted inputs

- Full manuscript draft (.tex/.md), or excerpts (abstract, model section, results, figures)
- Code and numerical results directories (the panel reviews what the results claim, not code style)
- Author notes in Chinese or English describing the claimed contribution
- Pre-submission positioning notes

If the material is partial, run a bounded review and state the assessment boundary explicitly.

## Workflow

1. **Scope**: identify input scope, target venue (or infer one), and the journal profile (see `references/review-axes.md`). Default: OR-journal profile; switch to Nature-style breadth only when the user targets a general-science venue.
2. **Claims map**: extract explicit and implicit claims (contribution statements, conclusions, figure captions, implied "baseline is strong" / "instances are representative"). Map each to its evidence and support strength (Sufficient / Partial / Missing / Contradicted). Every later concern must attach to a row of this map — or create one.
3. **Immutable packet**: build one review packet containing only the material, the claims map, assessment boundary, and common journal criteria. No analytical conclusions, no suspected concerns.
4. **Emphasis briefs** (defined before any report; they are working lenses, not personas): R1 *methodology rigor* (model validity, math, experimental statistics), R2 *domain contribution* (novelty, literature positioning, use to the field), R3 *adversarial attack* (Fatal-Flaw hunting, red-flag sweep, strongest counter-narrative).
5. **Isolated review**: launch each reviewer in a genuinely separate context (subagent/process/invocation). Each sees only the packet plus its own brief, loads its relevant `references/domain-gates.md` sections, and builds its own concern ledger via `references/concern-taxonomy.md`. If isolation is impossible, one report per invocation and an explicit mutual-blindness limitation notice.
6. **Freeze**: every report is frozen before any comparison. No redistribution of concerns to control overlap, no retroactive rewriting.
7. **Defense arbitration** (synthesis pass): for each disputed Major/Blocking concern, a simulated **author defense** argues the strongest honest rebuttal from material actually present, then the synthesizer scores it 1–5 and rules Resolved / Query Remains / Critical. Protocol: `references/adversarial-defense.md`.
8. **Synthesis + QA**: merge frozen reports, label consensus only when ≥2 reviewers independently raise the same underlying concern, apply anti-sycophancy rules, run the QA gate (`references/qa-checklist.md`) and the numeric consistency sweep (`references/consistency-sweep.md`), then emit the final C/M/N issue list.

## Output format

Unless the user asks otherwise (see `references/report-format.md` for the full contract):

```text
Review setup
- Input scope / assessment boundary
- Journal profile used (OR-journal | Nature-style) and target venue
- Claims-and-evidence map (table: # / claim / evidence / support)

Reviewer 1..3 (one block each, frozen independently)
- Overall assessment / Major strengths
- Major Concerns  (ID Rk-Mn, Blocking Yes/No, axis, claim_pointer, evidence_pointer,
                   concern, why it matters, resolution test)
- Minor Comments   (ID Rk-mn, axis, evidence_pointer, issue, required correction)

Defense & judgment (per disputed concern, post-freeze)
- Concern / author defense (grounded in the material) / defense score 1–5
- Judgment: Resolved | Query Remains | Critical (+ fatal criterion if Critical)

Cross-review synthesis
- Consensus blocking concerns / other consensus majors
- Where emphasis differs across reviewers
- Dimension scores on the profile axes + Confidence (1–5, bound to verification depth)
- Overall assessment (ranking-calibrated; fatal-flaw cap applies)

C/M/N issue list
- C# critical (must address; each cites the fatal criterion it meets)
- M# moderate (should address)   N# minor
- Questions for authors (only those whose answers would change the assessment)
```

The C/M/N numbering is stable across the report and is designed as direct input material for `rebuttal` (each entry already carries Location / Problem / Suggested fix).

## Red lines

- Do not invent experiments, validations, citations, figure details, line numbers, or prior-work distinctions not present in the input; "prior work exists" claims need a verifiable source or an explicit `未经文献核实` tag.
- Do not let one reviewer read, cite, anticipate, or respond to another review before freezing.
- Do not present shared-context drafting as independent peer review; if contexts could not be isolated, say so.
- Do not fabricate an author defense that cites material not present in the manuscript; a defense without verifiable grounding scores ≤2 and fails.
- Do not soften a judgment when the defense scores <4; no consecutive downgrades; a >50% downgrade rate triggers an explicit sycophancy warning for human re-check.
- A confirmed Critical (fatal-flaw criteria in `references/concern-taxonomy.md`) caps the overall assessment at Weak; decorative strengths cannot lift it.
- Do not silently turn reviewer assessment into rebuttal drafting, and do not emit an editorial decision letter.
- Writing/language issues are out of scope except where they obscure meaning (route to `paper-polish`).

## Related files

| File | Open when |
|---|---|
| [references/review-axes.md](references/review-axes.md) | Choosing or switching the journal profile, axis definitions, scoring anchors, confidence binding |
| [references/concern-taxonomy.md](references/concern-taxonomy.md) | Building a reviewer's concern ledger; 12-axis coverage check, fatal-flaw criteria, experimental red flags |
| [references/domain-gates.md](references/domain-gates.md) | The manuscript has a clear OR/ML+OR technical domain; domain-conditioned checklists and INFORMS two-track rigor floors |
| [references/adversarial-defense.md](references/adversarial-defense.md) | Running the defense arbitration: defense strategy library, scoring 1–5, anti-sycophancy rules |
| [references/workflow.md](references/workflow.md) | Orchestration detail: packet construction, briefs, isolation mechanics, freeze and synthesis rules |
| [references/report-format.md](references/report-format.md) | The full output contract and the Concern-ID → C/M/N mapping |
| [references/qa-checklist.md](references/qa-checklist.md) | Finalizing an output: grounding, anchoring, calibration, self-calibration questions |
| [references/consistency-sweep.md](references/consistency-sweep.md) | Checking the manuscript against itself (numbers, precisions, superlatives vs own tables) |
| [references/source-basis.md](references/source-basis.md) | Provenance of the mechanisms and the boundary of local rules |

## Response language

Respond in the language of the user's input. Reviewer reports on English manuscripts are written in English; Chinese input gets a Chinese report with technical terms kept in English.
