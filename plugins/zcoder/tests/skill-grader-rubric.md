# zCoder Skill Grader Rubric (v1)

Grade each target file 0–10 per dimension, with one line of evidence per score. You are an independent grader: you did not write these files; judge only what the file says against the dimension and against verified reality you can check in-repo. No politeness inflation — a 7 means good, a 5 means mediocre, below 5 means defective.

Dimensions:

1. **Trigger precision** — the description fires on exactly the requests it should: no over-trigger (atomic/meta questions matching), no under-trigger (delegatable work escaping), anti-triggers explicit.
2. **Description economy** — ≤~80 words, every clause load-bearing, commands/anchors last; no clause piles that dilute matching.
3. **Instruction quality** — imperative form; non-obvious rules carry their why; examples where structured output is expected; no ALL-CAPS crutches substituting for explanation.
4. **Structural fit** — progressive disclosure: short metadata, body <500 lines, detail pushed to load-on-demand references; nothing the reader must hold before acting.
5. **Factual accuracy** — every checkable claim (pins, model catalog, capabilities, states) matches the repo's verified reality (agents/*.md frontmatter, tests/capability-ledger.json).
6. **Internal consistency** — no contradictions between the file's own sections or with sibling surfaces (hook text, agent descriptions).
7. **Testability** — rules are predicate-shaped and concrete (numbers, first-match ordering), not judgment calls; an executor can decide without taste.
8. **Negative scope** — explicit do-NOT boundaries for the failure modes that matter.

Output contract (per file):

```
GRADE <file>
scores: d1..d8 each "n/10 — evidence"
overall: weighted mean to 1 decimal (d1,d5,d7 count double — trigger, truth, testability are the product)
top_fixes: ≤3 concrete textual changes, ranked by expected score gain, each a replacement snippet or precise edit instruction
```

Grading targets: skills/glm-orchestrator/SKILL.md (primary), commands/orchestrate.md, commands/route.md (command-skill equivalents).
