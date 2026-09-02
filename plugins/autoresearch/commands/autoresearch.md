---
description: Enter autoresearch mode. Resumes from .auto/prompt.md when a session exists, otherwise sets one up from your goal. Usage: /autoresearch:autoresearch <goal or resume context>
---

Enter autoresearch mode for this workspace.

1. If `.auto/log.jsonl` and `.auto/prompt.md` exist, **resume**: read the charter and the ledger, then continue the loop (one focused change → `run_experiment` → `log_experiment`).
2. Otherwise **set up a new session** from the goal in $ARGUMENTS:
   - Load the skill `autoresearch` (or read `skills/autoresearch/SKILL.md`).
   - Follow `references/setup-guide.md`: pick a mechanical metric, create `.auto/measure.sh` (prints `METRIC name=value`), optional `.auto/checks.sh`, write `.auto/prompt.md` charter.
   - `init_experiment` with metric name and direction, run a baseline, then start the loop.
3. Remind the user: keep the benchmark frozen (`.auto/measure.sh` / `.auto/checks.sh` are write-protected by the plugin hook), and use `/autoresearch:export` for a dashboard.

$ARGUMENTS
