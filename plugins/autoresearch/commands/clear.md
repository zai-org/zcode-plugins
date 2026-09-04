---
description: Clear the autoresearch session by deleting .auto/log.jsonl, then start fresh. Keeps measure.sh / checks.sh / prompt.md. Usage: /autoresearch:clear
---

Clear the current autoresearch session.

1. Confirm with the user that they want to wipe the experiment history. This cannot be undone: the session state is gone, though the ledger and all `experiment:` commits remain in git history.
2. Call the `clear_experiments` tool.
3. Report the result. A fresh target can now start with `/autoresearch:autoresearch <goal>` or `init_experiment`.

Note: kept `experiment:` commits remain in git history; only the `.auto/` session ledger is reset.
