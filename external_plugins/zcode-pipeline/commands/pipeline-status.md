---
description: Conveyor status — active epic(s), stages, unclosed tasks, open loops, spend against budget
---

Show the conveyor status in this project (read-only; launch nothing and change nothing):

1. State files: `.ai/state/*.md` (and the legacy `.ai/state.md`, if present) — for each: epic, track, branch, current stage, next step, open loops, escalations, spend vs budget.
2. Epic queue: `.ai/state/QUEUE.md` (if it exists).
3. Unclosed tasks: `grep -l -E '^\*\*(Status|Статус):\*\* \(created\|in_progress\|implemented\|reviewed\|tested\)' .ai/tasks/*/*.md` — as a list with statuses.
4. Manual remainder: open items of `.ai/docs/manual-checklist.md`.
5. Metrics: the last 3 lines of `.ai/metrics.md` (if it exists).

Answer format: a compact summary for each active/queued epic + a common “debts” section (unclosed tasks, manual remainder). If nothing is found — say so (“the conveyor is not active in this project”).
