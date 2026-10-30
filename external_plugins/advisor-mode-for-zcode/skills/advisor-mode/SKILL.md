---
name: advisor-mode
description: Configure, inspect, or switch models and gates in Advisor Mode for Zcode (advisor-config.json and the agent model line). Use when the user asks to change the Advisor or Executor model, adjust failure thresholds, or check Advisor Mode status.
---

# Advisor Mode Configuration Skill

Manage the Advisor Mode configuration stored in `advisor-config.json` inside the installed plugin directory, and the model line of the advisor agent.

## Roles and how models are chosen

- The Executor agent (`agents/flash-executor.md`) uses `model: inherit`, so it always runs on the model the user selected for the session. Switching the session model is enough to change the executor; no edit is needed.
- The Advisor agent (`agents/advisor-reviewer.md`) pins a frontier model on its `model:` frontmatter line because ZCode resolves subagent models from the agent definition. The line must carry an explicit reasoning level with the `$` suffix (for example `model: account:<plan>/GLM-5.3$max`): ZCode rejects a pinned reasoning-capable model without one. When a new frontier model is released, update that single line and restart the session. This is the only line that pins a concrete model.
- The role of the current session is detected at SessionStart from the session model id matched against `roles.executor.uiModelPatterns` and `roles.advisor.uiModelPatterns` (case-insensitive substrings, executor patterns checked first). An unrecognized model falls back to `roles.unknownModelRole`, which defaults to `executor` so unknown models fail closed under the gates.

## Configuration structure

`advisor-config.json` controls:

- `enabled` (boolean): toggles the lifecycle hook injections without uninstalling the plugin.
- `roles.unknownModelRole`: default role (`executor` or `advisor`) for unrecognized session models.
- `roles.advisor`: `label`, `agentName`, `uiModelPatterns`.
- `roles.executor`: `label`, `agentName`, `uiModelPatterns`.
- `gates.planBeforeComplexTask`: pre-task architecture validation before multi-file edits (default `true`).
- `gates.maxConsecutiveFailures`: identical failures before the Two-Strike Circuit Breaker trips (default `2`, `0` disables).
- `gates.mandatoryFinalReview`: approved final review with file hash verification before task completion (default `true`).
- `gates.maxStopContinuations`: how many times the Stop gate may force the session back to work before it warns instead (default `2`).
- `defaults.simplicityIntensity`, `defaults.actionFirstOutput`: baseline rigor flags reported at session start.

## Lifecycle hooks enforced

The plugin registers hooks on six ZCode events:

1. `SessionStart`: detects the role from the session model and injects the gate directives plus the craft standards.
2. `UserPromptSubmit`: injects a warning while the circuit breaker is active.
3. `PreToolUse` (Bash, Write, Edit): blocks commands and edits while the breaker is tripped; blocks multi-file edits without an approved plan.
4. `PostToolUse` (Bash, Write, Edit, Agent): tracks failure signatures, records modified file hashes, and captures advisor verdicts from completed advisor subagent runs.
5. `PostToolUseFailure` (Bash): counts command failures that report through the failure event.
6. `Stop`: enforces the mandatory final review; forces the session back to work (output `continue: true`) until the advisor approves the current file hashes, then resets the task state.

## Updating configuration and verifying

1. Edit `advisor-config.json` in the installed plugin directory to update labels, agent names, patterns, or gate switches.
2. To change the advisor model, edit the `model:` line in `agents/advisor-reviewer.md`.
3. Run the test suite from the plugin source directory: `node --test tests/advisor-hook.test.mjs`.
4. Dry run a session start: `node ./scripts/advisor-hook.mjs SessionStart` with a stdin payload containing the session model.
