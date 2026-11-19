---
description: Clear the autoresearch session by deleting .auto/log.jsonl, then start fresh. All other .auto/ files are kept. Usage: /autoresearch:clear
---

Clear the current autoresearch session.

1. Confirm with the user that they want to wipe the experiment history. This cannot be undone: the ledger is deleted, while all `experiment:` commits remain in git history.
2. Call the `clear_experiments` tool.
3. **Scheduled wakeups**: run `CronList` and `CronDelete` every remaining `[autoresearch wake]` task of this session (scheduled tasks cannot be deleted from automation turns, so this must happen in a user turn).
4. Report the result. A fresh target can now start with `/autoresearch:autoresearch <goal>` or `init_experiment`. If the new target needs a different benchmark or correctness gate, the old frozen files (`.auto/measure.sh`, `.auto/checks.sh`, and the old `goal.md`/`scope.md`) must be removed first — clear keeps them and the write guard still denies rewrites of files that exist (user-deleted, or an explicitly user-approved command).

Note: kept `experiment:` commits remain in git history; only the `.auto/` session ledger is reset.
