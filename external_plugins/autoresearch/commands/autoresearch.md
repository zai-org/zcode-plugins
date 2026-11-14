---
description: Enter autoresearch mode. Resumes when .auto/log.jsonl exists (the ledger is the session), otherwise sets one up from your goal. Usage: /autoresearch:autoresearch <goal or resume context>
---

Enter autoresearch mode for this workspace.

1. If `.auto/log.jsonl` exists, **resume** (the tools and hooks treat the ledger as the session — do not re-run setup: the frozen files already exist and the hook will deny rewriting them): first clear `autoresearchOff` if it is set (set it to false in `.auto/config.json`), then read the charter (`.auto/prompt.md`) and the ledger and continue the loop (one focused change → `run_experiment` → `log_experiment`). If `.auto/prompt.md` is missing, reconstruct a minimal charter from the ledger's config rows and the frozen goal/scope files before continuing.
2. Otherwise **set up a new session** from the goal in $ARGUMENTS:
   - Load the skill `autoresearch` (or read `skills/autoresearch/SKILL.md`).
   - Follow `references/setup-guide.md`: pick a mechanical metric, create `.auto/measure.sh` (prints `METRIC name=value`), optional `.auto/checks.sh`, record the user's deep goal verbatim in `.auto/goal.md` and the agreed scope boundary in `.auto/scope.md`, write `.auto/prompt.md` charter (its goal/scope sections quote the two files verbatim). Re-targeting after a `/autoresearch:clear`: the old frozen files still exist and the guard denies their rewrites — remove them first (user-approved) when the new target needs a different benchmark or gate.
   - `init_experiment` with metric name and direction, run a baseline, then start the loop.
3. Remind the user: keep the session anchors frozen (`.auto/measure.sh` / `.auto/checks.sh` / `.auto/goal.md` / `.auto/scope.md` are write-protected by the plugin hook once created), and use `/autoresearch:export` for a dashboard.

$ARGUMENTS
