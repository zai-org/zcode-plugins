# Advisor Mode for Zcode

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A dual-tier engineering workflow for ZCode. Advisor Mode pairs a high-reasoning frontier Advisor and Reviewer with a fast Executor that follows the session model, guided by built-in minimalist engineering, clean prose, action-first communication, and UI craft standards. Hard lifecycle gates enforce the workflow at the tool level, so the discipline holds even when the session model forgets it.

## Architecture

The plugin classifies the session at startup from the session model id and switches behavior accordingly.

### 1. Executor Session (Fast Model)

When the session runs on the fast model tier, the session acts as the Executor and must consult the `advisor-reviewer` subagent (frontier model) at three mandatory gates:

- **Architecture, Planning and Pre-Task Gate**: fires when planning or designing a product, system, architecture, specification, or roadmap, and before multi-file or sensitive edits. The hook denies a second distinct file edit until the advisor validates the plan.
- **Two-Strike Circuit Breaker**: fires when the same command fails twice with a normalized identical signature (timestamps, hashes, and counts ignored). Commands and edits stay blocked until an advisor consultation releases the breaker.
- **Mandatory Final Task Review Gate**: before the task can stop, every modified file needs an approved advisor review whose recorded SHA-256 hash still matches the file on disk. The Stop hook forces the session back to work (up to twice), then warns explicitly if the review is still missing.

### 2. Advisor Session (Frontier Model)

When the session runs on the frontier model tier, the session acts directly as Architect, Advisor, and Final Reviewer. It delegates implementation to the `flash-executor` subagent and audits the diff and the command exit codes before closing the task.

## Model Selection and Future Models

- `flash-executor` uses `model: inherit`, so it always runs on whatever model the user selected for the session. Switching the session model is the only step needed to move the executor to a new release.
- `advisor-reviewer` pins the frontier model on a single `model:` line of its agent file, because ZCode resolves subagent models from the agent definition. The line carries an explicit reasoning level through the `$` suffix (for example `model: account:<plan>/GLM-5.3$max`); ZCode rejects a pinned reasoning-capable model without one. When a new frontier model is released, that one line is the whole migration.
- Role detection matches the session model id against configurable patterns in `advisor-config.json` (executor patterns first, unknown models fail closed to executor).

## Built-In Craft Standards

The plugin injects four non-negotiable disciplines into every session:

1. **Minimalist Engineering**: comprehension before brevity, the 7-rung simplicity ladder, surgical edits, root-cause fixes, and failing-first acceptance checks.
2. **Clean Prose**: active voice, concrete subjects, no filler phrases, and zero em dashes.
3. **Action-First Cognitive Ergonomics**: the answer or action on line 1, bounded steps, errors reported strictly as cause and fix.
4. **UI Direction**: local brand tokens and palettes first, no unapproved CDN assets.

## Installation

Requirements: ZCode with plugin support and a `node` runtime on the PATH (the hooks run a small Node script).

Install from the ZCode plugin marketplace. After installation, start a new session: the SessionStart hook announces the detected role and the active gates. To run the fast-tier executor workflow, select a flash session model; to run as the architect, select a frontier session model.

## Configuration

Settings live in `advisor-config.json` inside the installed plugin directory:

```json
{
  "enabled": true,
  "roles": {
    "unknownModelRole": "executor",
    "advisor": {
      "label": "Frontier Advisor",
      "agentName": "advisor-reviewer",
      "uiModelPatterns": ["glm-5.3"]
    },
    "executor": {
      "label": "Fast Executor",
      "agentName": "flash-executor",
      "uiModelPatterns": ["flash"]
    }
  },
  "gates": {
    "planBeforeComplexTask": true,
    "maxConsecutiveFailures": 2,
    "mandatoryFinalReview": true,
    "maxStopContinuations": 2
  },
  "defaults": {
    "simplicityIntensity": "full",
    "actionFirstOutput": true
  }
}
```

## Side Effects and Dependencies

- Runtime requirement: a `node` executable on the PATH. Six lifecycle hooks run a small Node script (10 second timeout each); they read a JSON payload on stdin and write state under the ZCode plugin data directory.
- File writes: per-session state files and an error log inside the plugin data directory only. The hooks never write into project files.
- Command execution: the `advisor-reviewer` agent may run read-only verification commands such as `git status` and `git diff`; the `flash-executor` agent runs the commands needed by its task.
- Model and service dependencies: uses the ZCode session model and one pinned frontier model resolved through the user's own configured Z.ai account. No other network access, no MCP servers, no third-party code, assets, or services.

## Lifecycle Hooks

The plugin registers hooks on six ZCode events:

| Event | Purpose |
| --- | --- |
| `SessionStart` | Detects the session role from the model id and injects gate directives plus craft standards |
| `UserPromptSubmit` | Injects a warning while the circuit breaker is active |
| `PreToolUse` | Denies commands and edits while the breaker is tripped; denies multi-file edits without an approved plan |
| `PostToolUse` | Tracks failure signatures, records file hashes, captures advisor verdicts |
| `PostToolUseFailure` | Counts command failures reported through the failure event |
| `Stop` | Enforces the mandatory final review with hash verification, forces continuation when missing |

## Plugin Structure

- `.zcode-plugin/plugin.json`: plugin manifest.
- `hooks/hooks.json`: hook definitions.
- `scripts/advisor-hook.mjs`: cross-platform Node.js lifecycle hook runner and gate validator.
- `tests/advisor-hook.test.mjs`: automated test suite covering roles, gates, signatures, and hash verification.
- `rules/craft.md`: craft standards injected at session start.
- `agents/advisor-reviewer.md`: frontier advisor, architect, and reviewer agent.
- `agents/flash-executor.md`: fast executor agent.
- `skills/advisor-mode/SKILL.md`: configuration skill.

## Testing the Hooks

```bash
# Run the unit and integration test suite
node --test tests/advisor-hook.test.mjs

# Dry run a session start hook (payload on stdin)
echo '{"session_id":"demo","source":"startup","model":"your-session-model-id"}' | node ./scripts/advisor-hook.mjs SessionStart
```

## Author and Developer

Created and maintained by **Gianluca Iannotta**. Source repository: https://github.com/jannotix/advisor-mode-for-zcode

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.

## Disclaimer

Advisor Mode for Zcode is an independent open-source project created and maintained by Gianluca Iannotta. It is not affiliated with, endorsed by, sponsored by, or officially connected to Z.ai or the ZCode team. All product and company names are trademarks or registered trademarks of their respective holders; their use does not imply any affiliation with or endorsement by them.
