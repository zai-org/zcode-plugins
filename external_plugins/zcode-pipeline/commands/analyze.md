---
description: Deep analysis of a project or feature via the analysis track — brief → parallel expert audits → synthesis with verification
---

Run the conveyor's analysis track (not the development track):

1. Launch the `briefer` agent with the user's request, explicitly marking: the request is analytical → the brief must get `**Track:** analysis`, and the success criteria become the questions the report is obliged to answer. Render the Briefer's questions to me interactively.
2. Per the focus of the final brief, launch expert audits **in parallel** (pass each one the brief + the project root): `architect` (architecture audit), `security-review` (security audit), `code-review` (quality audit); `tech-lead` (feasibility) — if a feature is being analyzed. Full audit by default — all three (+tech-lead for a feature); a narrow brief focus — only the corresponding ones.
3. Save the experts' responses to `.ai/analysis/{epic}-{date}/{architect|security|code|feasibility}.md` (you are the coordinator, the experts are read-only).
4. Launch the `analyst` agent: brief + paths to the saved reports.
5. Show me the report summary and the bridge (“which findings are ready to become an epic”); with my consent — launch the normal development conveyor for the chosen finding (from the Briefer, `Track: development`).

Call the experts by their actual session registry names (a plugin prefix is possible). QA, the Manager, and review loops do not participate in the analysis track.
