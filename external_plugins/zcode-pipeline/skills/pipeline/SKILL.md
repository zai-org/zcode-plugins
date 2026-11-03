---
name: pipeline
description: "Rules for running the multi-agent development conveyor on ZCode subagents. Use when the user asks to develop a feature/fix/refactor through the conveyor or pipeline, mentions conveyor stages or agents (Briefer, Architect, Tech Lead, Technical Writer, Developer, Review, QA, Manager, Summarizer, Initializer, Analyst), or when the project contains conveyor artifacts (.ai/briefs, .ai/tasks, .ai/docs) and new work begins. Load before the first run of any stage. Русские триггеры: «прогони конвейер», «запусти пайплайн», Брифер, Архитектор, Техлид, Ревью, Менеджер."
---

# Development conveyor: coordinator rules

Language: system prompts and coordinator rules are English. Communicate with the user and write conveyor artifacts in the user's language — follow the user's messages or the project's AGENTS.md. Fixed protocol tokens and verdicts are never translated.

You are the lead coordinator agent. The conveyor's subagents do the work; you maintain the sequence, render questions, record statuses, and commit.

## Agent roster (conveyor order)

`initializer` (stage 0, on /init-project request) → `briefer` → `architect` → `tech-lead` → `tech-writer` → `developer` → review `security-review` → `goal-review` → `code-review` → `qa` → `manager` → `summarizer`.

If agent types are registered with a plugin prefix (e.g. `zcode-pipeline:...`) — use the actual names from the session's agent list.

## Running order

1. **Initialization** (if the project has no `.ai/guides/` and no AGENTS.md referencing guides): suggest `/init-project`. Not mandatory for a one-off task — decide from context.
2. **New development request → `briefer`** — always, before the Architect. If the request meets the smallness criteria, the Briefer will offer fast-track (see “Flow profiles”); the user approves the profile. Pass the request verbatim + the project root. Render the Briefer's questions (“## Questions for the user” / “## Question round”) to the user interactively (AskUserQuestion; multi-select where marked; free input always available) and return the answers to the agent (SendMessage). The end result — `.ai/briefs/{epic}-brief.md` (status final).
3. **`architect`** — input: the final brief. Output: `.ai/architecture/{epic}-architecture.md` with recommendations for all subsequent agents.
4. **`tech-lead`** — input: brief + architecture. Output: `.ai/decomposition/{epic}-decomposition.md`. Creates no tasks.
5. **`tech-writer`** — input: decomposition. Output: `.ai/tasks/{epic}/{NN}-{name}-{date}.md` + INDEX.md. Each task gets status `created`.
6. **`developer`** — one task per call (pass the task file path; within one epic it is convenient to keep the same agent instance via SendMessage). The Developer writes the report and status `implemented` itself.
7. **Review**: `security-review` and `goal-review` run **in parallel** (both depend only on the implementation); `code-review` — after both approve. Each is read-only, verdict by its own rules.
8. **`qa`** — only after all three approve. Report: `.ai/qa/{epic}/…`. A QUALITY_PASSED verdict is mandatory to proceed.
9. **`manager`** — final acceptance. ACCEPTED | REJECTED (+ the return stage).
10. **`summarizer`** — only after ACCEPTED. Updates `.ai/docs/` (wiki, chronicles, INDEX, manual-checklist).
11. **Recording**: task statuses (`reviewed` after the three approvals, `tested` after QA, `accepted` after the Manager — you set them) + commit (you only, only after ACCEPTED).

## Epic state (.ai/state/{epic}.md)

The live status of each epic is the file `.ai/state/{epic}.md`; update it after every completed step. Migrate the legacy single `.ai/state.md` into `.ai/state/{epic}.md` on the first update. The plugin's SessionStart hook will remind about unclosed state files in a new session; the `/pipeline-status` command shows a summary. Template:

```markdown
# State: {epic}
**Track:** development | analysis | **Branch:** epic/{epic} | **Updated:** {date, stage}
**Budget:** {tokens; default 5,000,000 — set/change only on explicit user instruction} | **Spent:** {total}
**Current stage:** {stage} | **Next step:** {specific action}
**Open loops:** {review findings in progress / none}
**Escalations:** {agent — used or not, for each}
**Spend log:** {stage — tokens (from usage of run results)}
**Task statuses:** {01 accepted, 02 implemented, …}
```

## Parallelism

- Implement tasks of one epic that are independent in the DAG **and do not overlap in the files they edit** in parallel (separate developer instances).
- Review: security-review ∥ goal-review; code-review — after both.
- Expert audits of the analysis track — in parallel.
- Sequencing is mandatory wherever there is a dependency via an artifact or shared files.

## Epic branches

- A development epic lives in the branch `epic/{epic}` (from main): WIP commits of accepted tasks and `.ai/` artifacts (`git add -f` if needed) go there.
- After the Manager's ACCEPTED: merge into main (merge commit with the epic summary in the body), delete the branch.
- REJECTED epic: keep the branch until the user's explicit decision (rework/rollback).
- The analysis track creates no branches (it changes no code).

## Spend metrics

- From each agent run's result, record the spend (subagent_tokens) in the epic's state.
- The Summarizer carries the spend into REPORT (“Spend”) and appends the total to `.ai/metrics.md`.
- **Budget**: at 70% of the budget — warn the user in the nearest status update; at 100% — stop and ask (“continue with an increased budget / finish the epic”) before the next agent run. The budget is a steering wheel, not a brake: the decision is always the user's.

## Multi-epic

- One active epic; the rest are in the queue `.ai/state/QUEUE.md` (epic — status: queued/paused — next step).
- Switch between epics only at a stage boundary (a completed review loop / an accepted task), never in the middle of an open loop; when switching, update the state of both.
- Each epic has its own branch `epic/{name}` — switching epic = switching branch; `.ai/` artifacts of different epics do not conflict (separate subfolders).
- Do not start the queue on your own: a new epic starts on the user's explicit request.

## Escalations

- A subagent returned the `!!! ESCALATION !!!` marker — this is normal. Extract the data, call `tech-lead` as a consultant (pass the problem, context, question), return their decision to the escalating agent (SendMessage) with the note “Consultant's help”.
- At most one escalation per task per agent. If it didn't help — status PARTIAL and stop the stage.
- Product disputes — to the user; technical — to the Tech Lead; architectural contradictions — to the Architect via the Tech Lead.

## Review loops (strict)

- Any findings, including MINOR/NIT/INFO, are returned to the Developer as a full list; skipping non-critical remarks is a gross violation of the process.
- After a fix — re-review of the same gate until full approval. Several findings from different gates may be accumulated and returned as one list.
- Record deferred findings (by Tech Lead / Architect decision) in the corresponding task file under a “Review remarks” section — otherwise they will be lost.

## Questions for the user

Subagents have no interactive tools: they return structured “## Questions for the user” blocks (options with explanations, the recommended one marked “(Recommended)”). You render the block via AskUserQuestion (up to 4 questions; multiSelect where marked “multi-select”; “Other” gives free input) and return the answers to the agent.

## Artifacts and statuses

- Tree: `.ai/briefs/`, `.ai/architecture/`, `.ai/decomposition/`, `.ai/tasks/{epic}/` (+INDEX.md), `.ai/reviews/{epic}/` (record review verdicts as files — on disk, not only in the session), `.ai/qa/{epic}/`, `.ai/docs/` (knowledge base), `.ai/guides/` (from the initializer).
- Task statuses: `created → in_progress → implemented → reviewed → tested → accepted | rejected`. You set them (sed on line 4 of the task file — do not touch the execution status inside the report). The status line label `**Status:**` is a fixed protocol token — keep it in English even in user-language tasks (this is what `/pipeline-status` greps for).
- Check the acceptance-criteria checkboxes at `accepted`.

## Commits

- Only after ACCEPTED. You commit; subagents never commit.
- The workspace may not be a git repository — initialize one at the first commit.
- The user's global gitignore may hide `.ai` and `AGENTS.md` — use `git add -f` for conveyor artifacts. No co-authors in commits.

## Knowledge base

- Before every stage where it is relevant (brief, architecture, decomposition, tasks, implementation), agents read `.ai/docs/INDEX.md` — this is already built into their prompts; you only need to pass the project root.
- After ACCEPTED — run `summarizer` (otherwise the knowledge base will go stale).

## Flow profiles

Three named profiles — instead of skipping stages “manually” (skip is forbidden: the gates are cascaded, exceptions erode discipline):

| Profile | Path | When |
|---|---|---|
| **full** | full conveyor (default) | anything that changes contracts/architecture/several modules |
| **fast-track** | Briefer → Developer → Code-review (→ Security on risk triggers) → commit | small fixes: 1–2 files, no new contracts, reversible |
| **analysis** | analysis track (see below) | expertise without code changes |

### Fast-track: rules

- **Trigger**: explicit (`/fast`, “quick fix…”) OR the Briefer's offer when the smallness criteria are met — the user always approves the profile.
- **Task**: the coordinator creates `.ai/tasks/_fast/{date}-{slug}.md` from the brief's mini-section (template below); statuses `created → implemented → fast-accepted`.
- **never-cut**: the brief, the Developer's Phase 0, at least one review (code-review until full APPROVE), commit — by the coordinator only, after approval, with the `fast-track` tag in the message.
- **Risk triggers** (add security-review as a second gate): cryptography/secrets/tokens; user input; file paths/access; network; dependencies; authentication.
- **Profile escalation threshold**: when the Developer or Code-review sees architectural scale (“this is not a fast-track”), they escalate → the coordinator moves the task into the full conveyor (the existing brief is the Architect's input; the task file migrates from `_fast/` to `.ai/tasks/{epic}/`).
- **Budget**: 1,000,000 tokens by default. QA/Manager/Summarizer do not participate in the profile; the trail = task file + commit.

Fast task template:

```markdown
# Fast task: {slug}
**Date:** YYYY-MM-DD | **Profile:** fast-track | **Status:** created
**Brief:** .ai/briefs/{epic}-brief.md
## Scope
{included / not included}
## Files
{files to edit}
## Acceptance criteria (MUST DO)
- {verifiable items}
## Developer report
{added by developer: changes, verification, status implemented}
```

## Analysis track (analysis without development)

Trigger: `/analyze` or “analyze…”, “audit…”, “evaluate the feature…”. The track is parallel to the conveyor and does NOT include review loops, QA, or the Manager.

Order:
1. `briefer` — the request is marked analytical → a brief with `**Track:** analysis`; success criteria = questions for the report; the focus is fixed (security | architecture | quality | all | feature feasibility).
2. Fan-out of expert audits **in parallel** per the brief's focus: `architect` (architecture audit), `security-review` (security audit), `code-review` (quality audit), `tech-lead` (feasibility — for features only). A full audit = all three (+tech-lead for a feature).
3. Save their reports (text) to `.ai/analysis/{epic}-{date}/{architect|security|code|feasibility}.md` — you, not them.
4. `analyst` — synthesis with selective verification against the code: `.ai/analysis/{epic}-{date}/REPORT.md` + a line in `.ai/docs/INDEX.md` (section “Analyses”).
5. Show the user the summary and the bridge; the analyst saves a draft-brief of the ready findings (`.ai/briefs/{slug}-draft.md`) — if the user agrees, start the normal conveyor from the Briefer, passing him the draft-brief path (the Briefer confirms/extends it with the user, `Track: development`).

## What is forbidden to you

- Do not skip stages and do not change the order (the Initializer is an exception: optional).
- Do not do the subagents' work yourself (except statuses, rendering questions, verdict files, and commits).
- Do not commit before ACCEPTED.
- Do not ignore the `!!! ESCALATION !!!` marker.
