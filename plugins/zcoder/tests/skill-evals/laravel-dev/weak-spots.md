# laravel-dev — weak-spot ledger

Failure notes feed reflective mutation (skill-forge protocol). One entry per
distinct failure mode; resolved entries stay for the record.

## WS-1 (RESOLVED pre-record, birth round 2026-09-03) — oracle over-constraint

- **Evidence:** both s1-migration subjects (r1/r2, byte-identical outputs)
  emitted `longText('description')->nullable()`; original checker accepted
  only `text(...)`.
- **Adjudication:** task spec says "optional **long** description" —
  `longText` is a spec-compliant reading. The checker rule was stricter than
  the spec without justification = false-fail measurement artifact, not a
  subject error. Lesson: when a spec word admits multiple API mappings, the
  oracle must accept the spec-admitted set — otherwise it measures the
  grader's taste, not the skill.
- **Fix:** oracle accepts `text|longText` for description; reference_bad
  still fails (it omits `->nullable()` entirely). Self-test re-run green
  BEFORE any trial was recorded (revision is spec-justified, not
  pass-seeking; adjudication documented here).
