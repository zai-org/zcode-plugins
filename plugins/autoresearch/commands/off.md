---
description: Stop the auto-resume hints while keeping the session. Resume anytime with /autoresearch:autoresearch. Usage: /autoresearch:off
---

Pause autoresearch without wiping the session.

1. Set `autoresearchOff: true` in `.auto/config.json` (create the file if missing). The SessionStart hook will stop injecting "resume" hints for this workspace.
2. The ledger and all experiment commits stay intact.
3. To resume: run `/autoresearch:autoresearch` (it ignores the off marker), or clear the marker (`autoresearchOff: false`) for hints again.
4. To start completely fresh: `/autoresearch:clear`.
