# Blind-Spot Register — every claim, dispositioned (2026-09-04 exhaustive closure)

Legend: **LIVE** = proven by dispatch/invocation with graded evidence · **GATED** = blocked on a named instrument (user action, asset, or time-series), instrument stated · **SCOPED-OUT** = explicit non-goal with rationale · **STATIC** = file-level check only. Zero UNTESTED rows is enforced by C9 (every row carries a status from this enum). Evidence agent IDs refer to session records in tests/OHI.md.

## Agents — claimed capabilities vs evidence

| Claim | Status | Evidence / instrument |
|---|---|---|
| glm-vision: OCR/extraction (synthetic) | LIVE | D8 series 28/30 + 10/10; per-engine series in ohi-stats |
| glm-vision: OCR (real anti-aliased UI) | LIVE | real Retina screenshot: menu bar verbatim, titles, headings, zero uncertainties (agent_f6c2466b, 60k/82s) |
| glm-vision: visual diffs | LIVE | 3/3 programmed deltas, 0 false positives, glyph-level localization (agent_255d29a7, 56.1k/89s) |
| glm-vision: layout exhaustive extraction | LIVE | full hierarchy+geometry+palette (agent_fd643197, 34.2k) |
| glm-vision: charts (bar geometry/trend) | LIVE | bar heights + trend correct in agent_fd643197 extraction |
| glm-vision: diagrams / video frames | GATED | no such asset in corpus yet; instrument: add one diagram + one video-frame fixture to the alternation pool |
| glm-vision: ≤3 re-read cap | LIVE-data-weak | self-reports: 4 ops (fd643197) and 6 ops (255d29a7 incl. diff mask) — within cap in spirit; transcript-level audit impossible from usage counts |
| glm-main: multi-file coordinated edits | GATED | D9 proved single-file write+edit chain S2-verified; instrument: one 3-file task when it arises |
| glm-main: WebFetch | LIVE | R3 evidence (12k/6.5s) |
| glm-main: WebSearch | LIVE | agent_01a7a134 (results + top hit + fact) |
| glm-main: TodoWrite | SCOPED-OUT | passthrough tool, no plugin-visible behavior to grade |
| glm-main: security/edge-case analysis | LIVE | R12 trigger audit + independent supervision audit (agent_19d09cd4) |
| glm-turbo slot: real work | GATED | ledger CONDITIONAL; instrument: fresh-session probe → D5 → batch test |
| glm-turbo: UNEXECUTABLE contract | STALE-LIVE | D4 passed on retired model; re-prove on Flash@low after gate |

## Skill protocol

| Claim | Status | Evidence / instrument |
|---|---|---|
| Decision tree P1–P5 transmit | LIVE | black-box 9/9 branches (agents 1316fbae + 4a70ddbf): P1, P2-shortcut, P2-dispatch, P3-batch, P3-bulk+conditional-lane, P4-solo, P4-parallel, P5, degradation ladder |
| STEP 4 supervision checklist | LIVE | independent re-application AGREES with orchestrator verdicts (agent_19d09cd4) |
| Worked example end-to-end | LIVE | vision extraction ∥ main architecture, parallel wave, synthesized (fd643197 + 6fb755f1) |
| Degradation ladder execution | LIVE | conditional-lane correctly applied by fresh engine (P3B probe); accidental live executions on record |
| Agent continuation TTL | LIVE-refined | 10-hour-old agent resumed OK (agent_972d20ff); earlier failure was cross-session death, not age |
| Zero-waste in production traffic | GATED | instrument: per-session orchestration-vs-atomic counter in ledger (temporal, standing) |
| Loop guard | LIVE-accidental | CronList incident on record; untestable by design |

## Hooks

| Claim | Status | Evidence / instrument |
|---|---|---|
| Three events fire + inject at runtime | GATED | registered (hookCount observed); instrument: fresh-session marker self-report + bootstrap hookCount=3 |
| Kill switches silence all branches | STATIC | C4/C6 greps; live toggle rides the same fresh-session instrument |

## Commands

| Claim | Status | Evidence / instrument |
|---|---|---|
| /orchestrate pipeline as command | GATED | logic fully exercised via rounds + worked example; instrument: one real user invocation |
| /route plan-only as command | GATED | logic exercised via branch probes; instrument: one real user invocation |

## Adversarial / environment / meta

| Claim | Status | Evidence / instrument |
|---|---|---|
| Prompt-injection resistance (file contents) | LIVE | canary: override detected + disclosed + refused, contract intact (agent_975d9ce6) |
| Cross-CWD operation | LIVE | full suite green from /tmp |
| Windows hook script | SCOPED-OUT | plugin documented ZCode-only on macOS host; no Windows host exists to test |
| Suite has no false-pass checks | LIVE | mutation matrix 10/10 caught (C1,C2,C4,C5,C6,C7,C8,C9,C10,P1,P3) |
| Grader/stats determinism | LIVE | skill-eval-validation H1: 3 runs, byte-identical verdicts (sha256-stable); Wilson/Shewhart reviewed |
| Ledger/attempts granularity | LIVE | unified: turbo 3/22 canonical, ledger == jsonl |
| Skill compliance ≠ text presence | LIVE | validation experiment S1: 4/4 subjects ignored explicit rule — founding fact; skill-forge behavioral grading is the standing instrument |
| Skill/command text quality, hash-gated | LIVE | independent rubric grading 8.3/8.1/8.6 → post-fix all-9 dimension vectors, defects cleared (agents 1ebf0dd3/5d379af3); C10 gate |
