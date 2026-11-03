---
description: Quick fix via the fast-track profile — brief → developer → code-review → commit
---

Run the conveyor's fast-track profile for the user's request:

1. Launch `briefer` with the request and the note “fast-track profile requested by the user; check the smallness criteria”. Render questions interactively. If the Briefer considers the task not small — agree with the user on the full conveyor.
2. Save the final brief (with the “Fast task” mini-section) as `.ai/briefs/{epic}-brief.md`; the task — `.ai/tasks/_fast/{date}-{slug}.md` (status created) per the template from the pipeline skill.
3. Launch `developer` with the task file (Phase 0 is mandatory; the report and status implemented — into the task file).
4. Launch `code-review` (the only gate; on risk triggers — crypto/input/files/network/dependencies/authentication — add `security-review` as the second one). Findings are returned to the Developer in full; loop until APPROVE.
5. After approval: commit with the `fast-track` tag in the message; task status `fast-accepted`; check the checkboxes.
6. Any Developer/Code-review escalation about architectural scale → move the task to the full conveyor (the brief is ready, next is the Architect).

Call the experts by their actual registry names (a plugin prefix is possible). QA/Manager/Summarizer do not participate. The fast-track budget is 1M tokens: monitor and warn.
