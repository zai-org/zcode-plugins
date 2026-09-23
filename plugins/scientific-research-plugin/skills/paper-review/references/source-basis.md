# Source Basis — Provenance and Boundaries

Where the mechanisms come from, and what this skill does not claim.

## Mechanism provenance (v4, 2026-09)

- **Three-blind panel, emphasis briefs over personas, immutable packet, freeze-then-synthesize, pointer anchoring, no-quota, red lines** — architecture adapted from the `nature-reviewer` skill design (referee-side 3-report + synthesis; reviewer isolation and non-invention rules), re-grounded for OR/ML+OR.
- **Claims-and-evidence mapping, two ICML-style framing questions** — ICML/ICLR reviewer guidance.
- **Two-track rigor (mathematical / empirical), out-of-sample requirement, no-straw-man baselines, off-the-shelf test** — INFORMS *Operations Research* editorial-board statements.
- **Experimental red flags** — adapted from the statistical red-flag list of the archived `academic-paper-reviewer` skill (upstream: academic-research-skills), extended with OR-specific items (optimality-without-gap, cross-hardware runtimes, ML+OR leakage).
- **Fatal-flaw criteria and cap rule; seven-question attack dimensions** — adapted from the Devil's Advocate design of `academic-paper-reviewer`.
- **Defense scoring 1–5, anti-sycophancy rules** — self-developed against documented LLM-reviewer positivity bias and softening-under-persistence; grounding rule (defense may cite only present material) added in v4.
- **Anchored scales with confidence bound to verification depth** — NeurIPS-style confidence levels.
- **Review discipline, ranking calibration, score-inflation self-check** — TRSC 2025 reviewer guidance, ICLR reviewer instructions, and empirical LLM-reviewer bias studies (AgentReview; Thelwall's measured inflation).
- **Domain gates** — self-developed checklists iterated across v1–v4 of this skill; v4 reframed them as an open, extensible set of domain knowledge packs detected per manuscript (OR families, ML+OR, LLM/agents) rather than a fixed specialization of the skill.
- **Consistency sweep** — adapted from the nature-reviewer shared consistency-sweep concept (internal numeric reconciliation).

## What was retired in v4

- The previous single-reviewer + three-round debate script (Reviewer/Author/Judge as one conversation) — replaced by the isolated panel with post-freeze defense arbitration.
- The 7-agent orchestration and reviewer-persona simulation of `academic-paper-reviewer` (archived in `attic/`); its useful mechanisms live on as noted above.
- Static domain-classification tables — replaced by signal-based gate loading.

## Boundaries

- This skill assesses scientific merit; it does not make editorial decisions, does not verify external literature beyond what the user supplies or what is verifiable, and does not draft rebuttals (`rebuttal` consumes this skill's C/M/N output).
- Calibration claims (anti-inflation, anti-sycophancy) counteract documented LLM tendencies; they do not replace human judgment, and the sycophancy warning exists precisely to route borderline cases back to the human.
