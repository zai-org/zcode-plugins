# Delegation and handoff contract

Read this only after deciding that delegation has a concrete benefit.

## Assignment

Give the worker the minimum complete brief. Include the fields that matter:

- **Objective:** the exact outcome required.
- **Scope:** the subsystem, files, directories, service, or concepts in bounds.
- **Non-scope:** adjacent work and files it must not touch.
- **Current context:** relevant architecture, decisions, constraints, errors, and evidence.
- **Dependencies:** upstream decisions or outputs this task consumes.
- **Ownership:** what it may read and exactly what it may modify.
- **Deliverable:** the result or report the primary agent needs.
- **Validation:** tests, commands, checks, or evidence expected.
- **Constraints:** compatibility, invariants, APIs, style rules, and prohibited changes.

For a codebase exploration assignment, prefer a concrete request such as:

> Trace the authentication request path from the HTTP entry point through middleware and persistence. Do not modify files or spawn agents. Return the concrete call chain, relevant files and symbols, shared contracts, observed risks, and evidence for every conclusion.

Do not use a vague task such as "look at the backend." Do not paste the complete parent context when a targeted brief and a few paths or decisions are enough.

Tell every child that it is not alone in the workspace, must preserve unrelated user and agent edits, and must not revert work it did not create. For write work, name the child's exclusive write set and the primary agent's retained integration surface.

Unless bounded nested orchestration was explicitly authorized, include: "Do not spawn subagents."

## Handoff

Ask for a compact, integration-ready return. Use only relevant fields:

- status;
- findings and supporting evidence;
- files and symbols inspected;
- files changed;
- decisions and assumptions;
- dependencies and risks discovered;
- tests or checks executed and their results;
- failures or unresolved questions;
- recommended next action.

The worker should not bury the result in a long narrative or return raw logs when a concise summary plus precise evidence is sufficient.

## Primary-agent acceptance

Before accepting a handoff:

1. Check that the result stayed within scope and ownership.
2. Verify load-bearing claims against current source, diffs, tests, or runtime evidence.
3. Reconcile shared contracts and assumptions across workers.
4. Run integration and final validation from the primary context.
5. Keep responsibility for the final answer; do not forward child summaries uncritically.

