---
name: cycle-improve
description: Use when the user asks to improve how ZCode Cycle itself works on this project - analyze accumulated ledger history for failure patterns, wasted repair cycles and gate flakes, then PROPOSE tuned role prompts, thresholds or standards as a versioned diff. Never applies changes itself; every proposal requires explicit user approval.
---

# Improvement Proposals from Ledger History

Read-only analysis. You propose; the user disposes.

## Procedure

1. Pull the evidence: `cycle_history` query with a high limit; `cycle`
   status for the current workflow; the project standards file if present.
2. Look for patterns: workflows that needed repair cycles (what gate
   failed, how often), role outputs the daemon rejected (format or
   protocol mistakes), repeated architecture restarts, verification gates
   that skip for missing attestations, promotion refusals from drifted
   repositories.
3. Draft a proposal document, each item as: observation (with ledger
   sequence numbers), proposed change (exact wording or value), expected
   effect, and what to watch to confirm or roll back.
4. Proposals may target: the project standards file, role dispatch
   prompts, default routing preferences, verification command choices,
   memory entries (`cycle:memory insert` conventions), or this plugin's
   configuration.
5. Never edit the plugin, the daemon, or any project file as part of this
   skill. The user applies approved changes (or asks for them in a
   governed workflow — plugin changes to its own repository are normal
   work under the standard gates).

End with: the proposal document and one line — `NEXT: user review; apply
approved items via the normal flow`.
