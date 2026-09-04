# yaml-json-convert — weak-spot ledger

Failure notes feed reflective mutation (skill-forge protocol). One entry per
distinct failure mode; resolved entries stay for the record.

## WS-1 (RESOLVED 2026-09-03, promotion 20260903T142152Z) — quoted-numeric normalization

- **Evidence:** trials run1_a_s1 and run2_a_s1 (2026-09-03), plus 2 unguided
  runs: 4/4 subjects emitted `"version": 2.0` (float) for YAML `version: "2.0"`
  (quoted string). Verdict reason: `.app.version: type float != str`.
- **Diagnosis:** rule 4 existed in v1 guidance ("quoted scalars stay strings")
  and was ignored anyway. Skill text presence does not imply compliance —
  the rule must be the FIRST thing read, carry a worked before/after example,
  and be paired with a pre-emit self-check.
- **Mutation:** candidates/v2-quoted-scalar-guard (reflective mutation citing
  this entry — Hermes-port pattern).
- **Resolution (AMENDED 2026-09-03 after replication):** v2 trials r1/r2
  passed and promotion 20260903T142152Z stands — but a same-bytes replication
  of v1 in a later session ALSO passed 2/2 (r3/r4). The morning v1 failures
  are isolated to the morning session: the subject substrate is
  non-stationary across sessions, and the original v1-vs-v2 difference was
  session-confounded, not proven causal. Current honest state: v2 4/4
  overall, v1 2/4 (0/2 legacy session, 2/2 replication session), no
  within-session difference at n=4. v2 retained because it has never failed
  and its pedagogy is strictly stronger; the FIX CLAIM is downgraded to
  "observed once, confounded". Consequence adopted system-wide: comparisons
  must be same-session interleaved (see skill-forge EVALUATE blocking rule);
  ledger rows now carry session stamps and stats warns on outcome flips
  across sessions. Both v2 runs also converged byte-identical — watch for
  divergence in future rounds.

## WS-2 (OPEN — mutation prepared) — YAML 1.1 boolean words uncovered

- **Evidence:** trial `s2-type-edge-cases__v2-quoted-scalar-guard__c1`
  (canary round 8): subject emitted `"flags": ["on", "off"]` (strings);
  oracle expects `[true, false]` per YAML 1.1 semantics (the dialect
  real-world tooling implements). Verdict reason:
  `.service.flags[0]: type str != bool; .service.flags[1]: type str != bool`.
- **Diagnosis:** live v2 guidance covers true/false only — `on`/`off`/
  `yes`/`no` are uncovered edges. Found by canary-ing the least-tested
  scenario (s2 had 2 trials vs s1's 9) instead of the canonical one.
- **Mutation:** candidates/v3-yaml11-booleans (MUTATION.md cites the trial).
  Awaiting same-session interleaved evaluation vs v2 + 5 gates; promotion
  is interactive-only.
