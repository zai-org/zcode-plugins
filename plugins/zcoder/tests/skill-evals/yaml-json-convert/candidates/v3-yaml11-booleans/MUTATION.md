# MUTATION — v3-yaml11-booleans

- **Target failing trial:** `s2-type-edge-cases__v2-quoted-scalar-guard__c1`
  (canary round 8, 2026-09-04, agent_18b9dfc8, verdict fail, reason
  `.service.flags[0]: type str != bool; .service.flags[1]: type str != bool`,
  artifact sha256 1c23abaf90b6).
- **Weak spot:** WS-2 — YAML 1.1 boolean words (`on`/`off`/`yes`/`no`) are
  not covered by the live guidance. The subject emitted `["on", "off"]`
  (strings) where the scenario oracle — following YAML 1.1 semantics, the
  de-facto dialect of real-world YAML tooling — expects `[true, false]`.
- **Mutation (one, targeted):** rule 2 extended with the YAML 1.1 boolean
  words, a worked WRONG/CORRECT example pair, the tooling rationale (PyYAML,
  Symfony, compose files implement 1.1 booleans), and the quoted-vs-unquoted
  boundary. Nothing else changed — isolation keeps the evidence gate
  interpretable.
- **Pattern:** reflective trace-driven mutation (Hermes port) — authored in
  the same round that observed the fail, per the immediate-reflection rule.
- **Prediction:** subjects under v3 pass `.service.flags` as booleans in both
  s2 runs while s1 behavior is unchanged. If s2 still fails, the next
  mutation must try a different lever, not louder repetition.
- **Promotion path:** needs interactive evaluation of this candidate in a
  same-session interleaved A/B vs v2 (blocking rule), then the 5 gates.
  Idle rounds do NOT promote.
