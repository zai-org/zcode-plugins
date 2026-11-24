---
description: Split kept experiments into clean topic branches you can PR. Usage: /autoresearch:finalize
---

Finalize the experiment session into clean, PR-able topic branches.

1. Read `.auto/log.jsonl`, collect the **kept** experiments (status=keep with a commit).
2. Group experiments that touch the same files into the same branch; separate branches must have disjoint file sets (the script rejects overlap). Keep groups small and in commit order. The script verifies that the union of the group branches equals **every** change between the trunk merge-base and HEAD (session files excluded) — manual, non-experiment commits included — so either fold ungrouped commits into a group or the verify step fails and rolls everything back.
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
5. **Scheduled wakeups**: run `CronList` and `CronDelete` every remaining `[autoresearch wake]` task of this session (scheduled tasks cannot be deleted from automation turns, so this must happen in a user turn).
6. **Experience review (before any cleanup)**: if `.auto/experience.md` exists, read it with the user and fold the surviving lessons into the project's `AGENTS.md` (drop `NO_ENTRY` stubs and lessons the user rejects). This step MUST complete before deleting the session directory — `experience.md` only lives in `.auto/` and is lost otherwise.
7. Report: the created branches (`autoresearch/<goal>/NN-<slug>`), the overall metric improvement, and cleanup notes (`git branch -D` + `rm -r .auto`) — cleanup runs **only after** the experience review above is done.

If the script reports a file appearing in multiple groups, merge those groups or re-split and rerun.
