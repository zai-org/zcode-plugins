---
description: Pause the loop and its hints while keeping the session. Resume anytime with /autoresearch:autoresearch. Usage: /autoresearch:off
---

Pause autoresearch without wiping the session.

1. Set `autoresearchOff: true` in `.auto/config.json` (create the file if missing). Edit the single key — do not rewrite the whole file: server-managed keys (`benchmarkHashes`, `harnessHashes`, `pending*`) live here, and a full-file rewrite silently disarms drift detection and the harness trace. Stop continuation, memory injection and the SessionStart resume hint all stop for this workspace.
2. The ledger and all experiment commits stay intact.
3. **Scheduled wakeups**: if unattended mode was active, run `CronList` and `CronDelete` every remaining `[autoresearch wake]` task of this session (scheduled tasks cannot be deleted from automation turns, so this must happen in a user turn; until deleted or maxRuns is hit, leftover wakes idle with one cheap reply).
4. To resume: run `/autoresearch:autoresearch` (it clears the off marker), or set `autoresearchOff: false` manually.
5. To start completely fresh: `/autoresearch:clear`.
