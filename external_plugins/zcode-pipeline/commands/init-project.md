---
description: Conveyor project initialization — stack selection (multi-select), up-to-date best practices in .ai/guides/, project AGENTS.md
---

Launch the `initializer` subagent, passing the root of the current project.

Launch rules:

- Render its “## Questions for the user” blocks to me interactively (AskUserQuestion; where it marked “multi-select” — enable multiSelect; “Other” already gives free input).
- The stack is not confirmed by the user — do not continue.
- After it completes, check the artifacts (`.ai/guides/*.md` with freshness dates and sources; `AGENTS.md` in the root) and show the result.
- If the project is a git repository, offer a commit; the agent itself does not commit.
