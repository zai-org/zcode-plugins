# End-to-end tests

Browser or full-stack tests that exercise a running system. They are not part of
`checks.test` because they need a live server; run them explicitly once
`scripts/dev.sh` (python/node stacks) is up.

Keep one test per user-visible acceptance criterion from `spec/spec.md`, and
record a run in `wiki/progress/` when it matters.
