---
description: Clear the autoresearch session — delete .auto/log.jsonl and start fresh. Keeps measure.sh / checks.sh / prompt.md. Usage: /autoresearch:clear
---

Clear the current autoresearch session.

1. Confirm with the user that they want to wipe the experiment history (this cannot be undone — the ledger and all `experiment:` commits stay in git history, but the session state is gone).
2. Call the `clear_experiments` tool.
3. Report the result. A fresh target can now start with `/autoresearch:autoresearch <goal>` or `init_experiment`.

Note: kept `experiment:` commits remain in git history — this only resets the `.auto/` session ledger.
