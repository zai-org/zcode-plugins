---
name: guster
description: Audit and evolve agent context across projects, skills, tools, knowledge and credential references. Use when the user says 上下文治理/项目上下文/上下文结构/上下文格式/格式规范/整理 .agents/归位/搬迁/断链/健康评分/凭据登记, or asks where a fact, file, skill or credential belongs, or wants to reformat scattered legacy context into the standard format, or wants a before/after context health score.
---

# Guster

Guster is the control plane for agent context: it discovers projects,
instruction files, skills, tools, knowledge, state, evidence and credential
references; diagnoses drift; scores health; plans reviewable migrations. The
optional Guster Hub is the data plane (`guster-hub` skill, `guster hub init`).

## When to use

- Inspect or reorganize machine agent context; place a file, skill, tool, register row, note or credential reference.
- Audit drift, duplicates, broken pointers, budgets, stale state; health scores and before/after comparisons.
- Initialize the standard `.agents/` layout; onboard a new project; reformat
  scattered legacy (pre-spec) context into the standard format.
- Install the same context rules on another machine or workspace.
- Not for ordinary code edits, debugging or writing unless the request is about context structure itself.

## Scope

Four levels. `--scope` is inferred from `--root` when omitted.

| Level | Command | Covers | Scored dimensions |
|---|---|---|---|
| machine | `guster doctor` | every repo under the workspace roots, declared `zones` and the hub | SSR RBR PCR ICR FRS PHR SIR |
| hub | `guster doctor --scope hub` | knowledge, the project register, tools, reports, handoffs | SSR ICR FRS PHR |
| group | `guster doctor --root A --root B [--root C]` | a requirement family or any set of related repos | SSR PCR ICR FRS PHR |
| project | `guster doctor --root <repo>` | one repository | SSR PCR ICR FRS PHR |

- Machine level owns resident budgets, skill budgets and credential layout;
  hub level owns knowledge indexing, register freshness and hub pointers.
- Group exposes cross-repo facts (same stem different content, duplicates);
  project shows only that repo plus how many machine findings were hidden.
- Scoped runs write to `~/.agents/guster/scoped/<hash>/`, never the
  machine-wide registry or trend. Pointer checks skip doc templates
  (`draft-NNN.md`, `daily-*.md`, `0X-xxx.md`) and `~/` on `ssh`/`scp`/
  `rsync` command lines.

## Workflow

1. `guster status`
2. `guster scan --json` (add `--root <project>` for a single project)
3. `guster doctor`
4. `guster score`
5. `guster plan findings` or a targeted `guster plan move`
6. Read the plan with the user, then `guster apply <plan> --yes`
7. `guster doctor` again (zero new findings = contract kept), then `guster score --trend`

Workspace writes are gated behind a plan and `--yes`; scans refresh
`registry.json` (`doctor` adds `findings.json`, `score` appends
`metrics.jsonl`) — `--no-write` skips that for `scan`, `doctor`, `score`
and `check`. `guster check` runs the patrol in one pass.

## Commands

```bash
guster status
guster scan --root <project> --json
guster doctor
guster score --trend | --fail-under 80   # --fail-under: exit 2 below target
guster check                              # scan + doctor + score --trend
guster zones list|add <dir>|remove <dir>
guster plan findings
guster plan move --from <src> --to <dst>
guster apply <plan> --yes
guster init
guster init --project <path> --yes
guster hub init --path <hub> --yes
guster hub attach|status|validate
guster export --format md
guster credentials
```

## Gates

- **Never persist or print credential values.** Paths, variable names and redacted forms only.
- **Never auto-commit, auto-push, auto-deploy; never apply a plan without explicit confirmation.**
- **Never treat tracked files you do not own as ordinary migration targets** —
  the test is ownership/authority over them, not the word "company".
- **Fail loud** on an unknown workspace, malformed plan or missing backup.
- Prefer no-focus, CLI-only operation; if the scan finds a credential in
  git, stop structural work and report it as critical.

## Waivers

A finding you knowingly accept is waived in `<hub>/hub.yaml` under `doctor.waivers`, never by deleting the check:

```yaml
doctor:
  waivers:
    - rule: broken-pointer
      path: ~/work/company-repo
      reason: company-tracked doc, owned upstream
```

`path` is optional; without it the whole rule is waived. Every waiver needs
a `reason` — a malformed block fails loud. A waiver greens the gate, not the
score: waived findings stay visible in `doctor --json` and skip the exit
code, but CHI is computed before waivers apply — waive only what you cannot fix.

## Format spec

Context assets follow the versioned contract in `reference/spec.md`
(CTX-01..11): instruction files, llms.txt-shaped indexes, machine-verifiable
pointers and dates, the six `.agents/` slots, one home per fact, skill
budgets, credentials by reference, register/v1, opt-in knowledge/v1 — a doctor
finding names the broken rule; schema contracts live in `schemas/`.

## New project onboarding

Orchestration of existing commands — the user confirms every structural step (conventions: `reference/placement.md`):

1. `guster status --json`: read configured `roots`, `zones`, attached hub.
2. Propose a placement under a root the user governs, per their own naming
   conventions; they confirm the path before anything is created.
3. `mkdir` + `git init` per the user's git conventions (Guster never runs
   git); scaffold with `guster init --project <path>`, then `--yes`.
4. Draft a register/v1 row (`id`/`status`/`as_of`/`name`/`spec.path`) for the
   hub's `register/projects.yaml`; the user pastes it — Guster never edits hub content.
5. `guster scan` + `guster doctor`: zero new findings is done.

## Reformatting legacy context

For an inherited pre-spec mess, run the four-pass playbook in
`reference/reformat.md`: inventory and classify (doctor findings as the
worklist) → placement (`guster init --project <path>` for the slots, `plan
move` or a batch plan) → content (indexes, links, dates, pointer notes) →
verify (`doctor` zero new findings, `score --trend`). Deletions and
distillations are proposed for approval, never silent.

## References

- `reference/spec.md` — format spec v2 (CTX rules and their findings).
- `reference/reformat.md` — four-pass legacy reformat playbook.
- `reference/framework.md` — 1-3-5-8 framework and placement tree.
- `reference/metrics.md` — metric definitions, targets and CHI.
- `reference/placement.md` — directory trees and the git boundary.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success — clean run, or findings no worse than `medium` |
| `1` | tool/config error: malformed or unreadable plan, an apply that failed mid-operation and was rolled back, missing workspace root, invalid `config.json` (non-list `roots`, a bad root/zone/hub path, empty `roots`, no scan candidates — run `guster init`); `hub status` also returns 1 when the attached hub fails its checks |
| `2` | `doctor`/`check` found `high` (but no `critical`) findings; `score --fail-under` below target or CHI not computable; `hub validate` failed the lite contract |
| `3` | `doctor`/`check` found `critical` findings |
| `4` | `apply`, `init` or `hub init` refused the plan at preflight — nothing was touched (missing move source, existing destination, invalid `hub init` target; an `init --project` target that only fails mid-apply exits 1 after rollback) |
