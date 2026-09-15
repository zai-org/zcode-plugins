---
description: Split kept experiments into clean topic branches you can PR. Usage: /autoresearch:finalize
---

Finalize the experiment session into clean, PR-able topic branches.

1. Read `.auto/log.jsonl`, collect the **kept** experiments (status=keep with a commit).
2. Group them by file dependency: two experiments may share a branch only if their changed files overlap; group small, keep order.
3. Write `groups.json` at the project root:
   ```json
   {
     "base": "<trunk branch, e.g. main>",
     "goal": "<short goal slug>",
     "groups": [
       {
         "title": "perf: sieve",
         "body": "...",
         "last_commit": "<full hash>",
         "slug": "sieve"
       }
     ]
   }
   ```
   `last_commit` must be the full kept commit hash (`git rev-parse <short>`).
4. Run `bash ${ZCODE_PLUGIN_ROOT}/scripts/finalize.sh <project dir> <path to groups.json>`.
5. Report: the created branches (`autoresearch/<goal>/NN-<slug>`), the overall metric improvement, and cleanup notes (`git branch -D` + `rm -r .auto` when done).

If the script reports a file appearing in multiple groups, merge those groups or re-split and rerun.
