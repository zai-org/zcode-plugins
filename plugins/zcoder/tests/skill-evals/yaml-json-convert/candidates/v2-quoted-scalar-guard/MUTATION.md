# MUTATION — v2-quoted-scalar-guard

- **Target failing trials:** `s1-yaml-to-json__v1__r1`, `s1-yaml-to-json__v1__r2`
  (verdict fail, reason `.app.version: type float != str`; artifact sha256
  b4b80df7cec5). Context: 4/4 observed subjects — including 2 with no guidance
  at all — made the identical error.
- **Weak spot:** WS-1 in weak-spots.md — quoted-numeric normalization.
- **Mutation (one, targeted):** elevated the quoted-scalar rule from position 4
  to position 1, added a worked before/after example with the wrong answer
  shown explicitly, explained WHY quotes are type information (explain-why
  style — models comply better with reasons than louder enforcement), and
  appended a mandatory pre-emit self-check that walks every scalar.
- **Not changed:** every other rule (isolation of the mutation makes the
  evidence gate interpretable).
- **Pattern:** reflective trace-driven mutation, ported from
  NousResearch/hermes-agent-self-evolution (MIT) — read why it failed, propose
  the targeted fix, cite the trial.
- **Prediction:** subjects under v2 pass `.app.version` as string `"2.0"` in
  both runs; if either still normalizes, WS-1 stays open and the next mutation
  must try a different lever (e.g., asking the subject to echo quoted values
  first), not louder repetition.
