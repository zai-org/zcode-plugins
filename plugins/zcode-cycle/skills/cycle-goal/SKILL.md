---
name: cycle-goal
description: Use when creating or managing a persistent goal in ZCode Cycle - objectives that span multiple workflows and sessions, with versioned plans, milestones linked to completed workflows, bounded continuations and completion gated on delivered evidence. Covers the goal lifecycle and the completion rules.
---

# Goal Mode

A goal persists above individual workflows: objective, constraints,
non-goals, success criteria, a versioned plan, linked milestone workflows
and a completion state that only independent evidence can close.

## Lifecycle (via `cycle_goal`)

Draft → (start_planning; save_plan does this automatically) → Planning →
(mark_ready; requires a saved plan) → Ready → (activate) → Active →
(request_completion) → Completing → (approve_completion) → Completed.

## Rules

1. Create with the objective in the user's own words plus constraints,
   non-goals, success criteria and the continuation limit (default five).
   The objective is immutable; amendments append, never rewrite.
2. Plans are versioned: `save_plan` at any time from planning; each
   revision is recorded with its digest.
3. Each implementation milestone is a normal governed workflow
   (`cycle-run` skill); link it with `link_workflow` after it starts.
4. Completion gates: `request_completion` requires at least one linked
   workflow; `approve_completion` requires every linked milestone to have
   a COMPLETED workflow (cancelled does not count) and the arbiter
   receipt digest as `completion_evidence`. No evidence, no completion.
5. Pause/resume/block/abort exist for lifecycle control; abort requires a
   bounded reason.
6. Work must be committed in the project between workflows: promotion is
   fast-forward only (the project HEAD must equal the workflow's base
   revision), so delivered changes are committed before the next workflow
   is armed.

Report goals with: next action first, state (from the daemon), linked
milestones with their workflow states, remaining continuations.
