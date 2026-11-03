# ZCode Pipeline

[English](README.en.md) · [Русский](README.ru.md) · [中文](README_CN.md) · [Back to brief README](README.md)

A multi-agent development conveyor for [ZCode](https://z.ai). Since v2.0 all system prompts and coordinator rules are English (English Core), while agents communicate with users and write project artifacts in the user's language — fixed protocol tokens are never translated. It turns a raw user request into an accepted, verified change through a chain of specialized subagents — with enforced briefs, architecture, decomposition, triple review, QA and a living knowledge base.

## Problems it solves

| LLM agents typically… | The conveyor enforces… |
|---|---|
| guess unclear requirements | **Briefer** asks interactive rounds of questions until the brief is complete; downstream agents refuse to start without it |
| skip design and jump into code | **Architect** produces a design *plus mandatory recommendations* for every following agent |
| produce vague mega-tasks | **Tech Lead** decomposes into bounded tasks with contracts; **Technical Writer** renders self-sufficient task files (inline rules, target shape, acceptance criteria) |
| claim "tests pass" without running them | **Developer** must prove every claim with actual command output; reviewers re-verify independently |
| rubber-stamp their own work | three independent read-only reviews — **Security**, **Goal**, **Code** — with cycles until *full* approval (even NIT-level findings must be fixed) |
| accept half-done work | **QA** runs real tests (and writes its own); **Manager** traces initial data against final artifacts and returns `ACCEPTED`/`REJECTED` |
| forget everything next session | **Summarizer** distills each accepted epic into a living wiki (`.ai/docs/`), which the next epic's agents read |
| ignore project conventions | **Initializer** pulls current best practices per stack into `.ai/guides/` and wires them into the project `AGENTS.md` |

## How it works

```
/init-project (once per project)
      │
      ▼
Initializer → Briefer → Architect → Tech Lead → Tech Writer → Developer
      │                                                        │
      │                            review loop until full approval:
      │                            Security → Goal → Code ──────┤
      │                                                        ▼
      │                     QA (QUALITY_PASSED) → Manager (ACCEPTED) → Summarizer → commit
```

- The **main agent coordinates**: it dispatches subagents, renders their question blocks interactively (multi-select + free input), fixes task statuses, and is the only party allowed to commit.
- The **`pipeline` skill** holds the coordinator's rules and loads on demand ("run the pipeline", mentioning conveyor stages, or working in a project with `.ai/` artifacts).
- **Escalations**: any blocked agent emits a structured `!!! ESCALATION !!!` marker; the coordinator routes it to the Tech Lead consultant and returns the binding resolution. Max one escalation per task per agent — guessing is a process violation.
- **Stage gating** is built into every agent's prompt: no brief → no architecture; no decomposition → no tasks; no approved reviews → no QA; no `ACCEPTED` → no commit.

## The 13 agents

| Agent | Role | Output / verdict |
|---|---|---|
| `initializer` | Stage 0: detect/interview the stack, gather current best practices | `.ai/guides/{tech}.md`, project `AGENTS.md` |
| `briefer` | Turn any raw request into a final brief via interactive questions | `.ai/briefs/{epic}-brief.md` |
| `architect` | Design the solution; recommend constraints to all followers | `.ai/architecture/{epic}-architecture.md` |
| `tech-lead` | Decompose into bounded tasks (never writes task files); resolve escalations | `.ai/decomposition/{epic}-decomposition.md` |
| `tech-writer` | Render self-sufficient task files from the decomposition | `.ai/tasks/{epic}/{NN}-{name}-{date}.md` + `INDEX.md` |
| `developer` | Implement one task exactly as specified; Phase 0 before any edit; honest verification | report + status `implemented` |
| `security-review` | Real, exploitable risks only, with evidence | `PASS / PASS_WITH_WARNINGS / FAIL / NEEDS_MORE_CONTEXT` |
| `goal-review` | Trace every acceptance criterion to proof; catch scope creep | `GOAL_MET / GOAL_PARTIALLY_MET / GOAL_NOT_MET / NEEDS_CONTEXT` |
| `code-review` | Correctness, edge cases, conventions, diff hygiene, test integrity | `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION` |
| `qa` | Review test coverage, run real checks, may add own tests | `QUALITY_PASSED / QUALITY_FAILED / BLOCKED` |
| `manager` | Final acceptance: initial data vs final artifacts, traced evidence | `ACCEPTED / REJECTED` + return stage |
| `summarizer` | After ACCEPTED: distill the epic into the knowledge base | `.ai/docs/` wiki + chronicles + `INDEX.md` |
| `analyst` | Analysis track: synthesize expert audits, verify against code, prioritize | `.ai/analysis/{epic}-{date}/REPORT.md` + bridge |

## Artifacts and statuses

Every project gets a `.ai/` trail: `briefs/ · architecture/ · decomposition/ · tasks/{epic}/ (+INDEX.md) · reviews/ · qa/ · guides/ · docs/` (knowledge base: `wiki/{component}.md`, `epics/{epic}-{date}/REPORT.md`, `INDEX.md`, `manual-checklist.md`).

Task lifecycle: `created → in_progress → implemented → reviewed → tested → accepted | rejected`.

The wiki is authoritative-but-verifiable: pages carry a "verified at commit" stamp, and readers are told to re-check claims against actual code.

## Commands

| Command | What it does |
|---|---|
| `/init-project` | Stage 0 for a project. Empty project: interactive stack selection (popular stacks, multi-select, free-form input). Existing project: stack detected from manifests and linter configs, then confirmed. Pulls current best practices per technology into `.ai/guides/` and generates/updates the project `AGENTS.md` (base rules `source=file\|embedded`, personalization asked interactively). Idempotent re-init. |
| `/analyze "<project or feature>"` | Deep expert analysis **without development**: brief (track: analysis) → parallel expert audits by focus → verified, prioritized synthesis report → optional bridge into the development conveyor. |
| `/self-test` | Regression test of the conveyor itself: 13 agent-contract probes covering every agent (response formats, stage gates, verdicts, analysis track, bridge-brief) → PASS/FAIL report in `.ai/self-test-{date}.md`. |
| `/pipeline-status` | Live conveyor status: active epic(s) from state files, current stage and next step, open review cycles, unfinished tasks, spend vs budget, recent metrics. |
| `/fast "<small change>"` | Fast-track profile: brief → developer → code review (security review added on risk triggers: crypto, user input, file paths, network, dependencies, auth) → commit. For small reversible edits (1–2 files, no new contracts). |

Natural language works too: "initialize the project", "analyze the project for…", "run the pipeline: …".

## Reliability features

- **Epic state file** (`.ai/state.md`): live status — stage, next step, open review cycles, token usage — updated after every step. The plugin's SessionStart hook reminds about unfinished work when a new session opens.
- **Epic branches**: each development epic runs in an `epic/{name}` branch, merged into `main` only after the Manager's ACCEPTED — clean rollbacks and parallel epics.
- **Parallelism where the DAG allows**: independent tasks run concurrently; Security and Goal reviews run in parallel, Code review after both.
- **Prompt linter**: the bundle builder verifies mandatory sections of every agent prompt (escalation protocol, gross violations, verdict formats) — a broken prompt fails the build.
- **Usage metrics and budgets**: per-stage token usage is logged in the state file and accumulated per epic into `.ai/metrics.md`; each epic gets a token budget (default 5M) — warn at 70%, stop-and-ask at 100%.
- **Multi-epic**: per-epic state files (`.ai/state/{epic}.md`) plus a queue; one active epic, switching only at stage boundaries, each epic on its own branch.
- **Analysis → development bridge**: the analyst saves a ready draft-brief (`.ai/briefs/{slug}-draft.md`) for findings that are ready — starting the conveyor after an analysis is a single step.

## Fast track (small changes)

Deliberately **not** a "skip stages" mechanism — arbitrary skips would cascade through the stage gates and erode the discipline the conveyor exists for. Instead, three named flow profiles:

| Profile | Path | When |
|---|---|---|
| full | the whole conveyor (default) | anything touching contracts, architecture, several modules |
| fast-track | Briefer → Developer → Code review (→ Security on risk triggers) → commit | small reversible edits: 1–2 files, no new contracts, no architectural decisions |
| analysis | the analysis track | expert judgment without code changes |

Fast-track guarantees that are never cut: a brief, the developer Phase 0, at least one full review, and a commit only after approval. The Briefer proposes the profile when a request meets the smallness criteria; the user always confirms. If the developer or reviewer smells architectural scale, they escalate and the task moves to the full conveyor with the brief already done.

## Analysis track

For requests that need expert judgment but no code changes: whole-project audits, feature feasibility, risk assessment. The track runs **parallel to the development conveyor** and never modifies code:

```
/analyze "audit the whole project"
        │
        ▼
Briefer (track: analysis; success criteria = questions the report must answer,
         focus: security | architecture | quality | all | feature feasibility)
        │
        ▼   parallel expert audits, by focus:
   architect ── security-review ── code-review ── tech-lead (feature feasibility)
        │
        ▼
analyst — synthesis: re-verifies expert claims against the actual code,
        resolves contradictions by evidence, prioritizes (severity × effort)
        │
        ▼
.ai/analysis/{epic}-{date}/REPORT.md + entry in the knowledge base (.ai/docs)
        │
        ▼
Bridge: "findings N and M are ready to become an epic — run the conveyor?"
```

- Every claim in the report is either verified against the code (`[verified]`) or honestly marked `[hypothesis]` with a way to check it.
- The report is registered in the project knowledge base, so the next development epic reads it through the wiki index.
- No QA / Manager / review cycles in this track — it changes nothing; development starts only if you accept the bridge.

## Install

**From marketplace (primary):**
1. ZCode → Plugin Marketplace → **Add → Add Plugin Marketplace** → paste this repository's URL.
2. **Personal → ZCode Pipeline → Install** → restart the session.
3. Verify: 13 agents, `/init-project`, `pipeline` skill.

## Usage

```
/init-project                                  # once per project
"Run the pipeline: add password-phrase mode"   # any feature/fix/refactor
/analyze "audit the whole project"             # expert analysis, no code changes
```

Then simply answer the interactive question rounds — everything else (stages, reviews, fixes, statuses, commits) is driven by the conveyor.

## Repository layout & contributing

```
marketplace.json            # marketplace catalog (repo root = marketplace)
zcode-pipeline/             # the plugin (dir name == manifest name)
  .zcode-plugin/plugin.json
  agents/                   # 13 subagents
  commands/init-project.md
  skills/pipeline/SKILL.md  # coordinator rules
  assets/AGENTS-template.md # global-rules template with personalization placeholders
scripts/validate_prompts.py  # prompt linter (self-contained from the repo)
zcode-pipeline-bundle.md    # generated artifact — do not edit by hand
```

Update cycle (commits and CHANGELOG in English):
1. Edit only `zcode-pipeline/{agents,commands,skills,assets}`.
2. Bump `version` in `zcode-pipeline/.zcode-plugin/plugin.json` **and** the plugin entry in `marketplace.json`.
3. `python3 scripts/validate_prompts.py` (it fails on missing mandatory sections or personal-data leaks — do not bypass).
   Automatic enforcement: **GitHub Actions CI** runs the linter on every push/PR; a **pre-commit hook** (`scripts/hooks/pre-commit`) blocks broken commits locally — install once with `git config core.hooksPath scripts/hooks`.
4. Commit + CHANGELOG entry; tag milestones; `git push --follow-tags`.
5. Update the plugin in ZCode → Settings → Plugins.
6. Create a GitHub Release for the tag: `gh release create vX.Y.Z --title "vX.Y.Z — Title" --notes "Summary"` — a release without notes looks unfinished.

History: [CHANGELOG.md](CHANGELOG.md)

## License

Copyright © 2026 Mikhail Ilinsky.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more details.
