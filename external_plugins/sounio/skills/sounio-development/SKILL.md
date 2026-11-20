---
name: sounio-development
description: Use when editing or diagnosing Sounio .sio code, compiler diagnostics, or Sounio test results. Follow the repository's own compiler and evidence contracts.
---

# Sounio Development

Sounio is a language and self-hosted compiler, not a Rust dialect. Read the current project's `AGENTS.md` and relevant Sounio documentation before changing syntax, compiler behavior, or scientific claims. Use existing `.sio` examples rather than translating Rust patterns by analogy.

For a requested source check, use `/sounio:check-sio` or follow its single-file procedure. Prefer the repository's `bin/souc` wrapper when working in Sounio itself; do not guess at a raw compiler binary or silently fall back to a stale artifact. Keep check, native compile, execution, test-suite, remote CI, and scientific acceptance as distinct outcomes.

When a check fails, quote the diagnostic and locate the responsible source construct before proposing a patch. When it succeeds, report only what was actually checked. Do not run numerical experiments, make clinical claims, or treat a successful compiler exit as a proof.
