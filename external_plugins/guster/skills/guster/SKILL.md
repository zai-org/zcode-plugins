---
name: guster
description: Audit and evolve agent context across projects, skills, tools, knowledge and credential references. Use when the user says 上下文治理/项目上下文/上下文结构/上下文格式/格式规范/整理 .agents/归位/搬迁/断链/健康评分/凭据登记, or asks where a fact, file, skill or credential belongs, or wants to reformat scattered legacy context into the standard format, or wants a before/after context health score.
---

# Guster

Guster is the control plane for agent context. It discovers projects, instruction files, skills, tools, knowledge, state, evidence and credential references; diagnoses drift; computes a health score; and produces reviewable migration plans.

Guster Hub is the data plane: the optional local repository that holds knowledge, project cards, tools and reports. Guster the plugin does not replace the hub.

For a new data plane, use the companion `guster-hub` skill or `guster hub init`.

## When to use

Use Guster when the user asks:

- to inspect or reorganize the machine's agent context structure;
- where a file, skill, tool, project card, knowledge note or credential reference belongs;
- to audit drift, duplicates, broken pointers, budgets or stale state;
- to initialize a project with the standard `.agents/` layout;
- to migrate task folders into `plans/`, `wiki/`, `evidence/`, `tmp/` or `archive/`;
- to make context documents machine-verifiable under the context format spec;
- to reformat scattered, legacy (pre-spec) context into the standard format;
- for a context health score or a before/after comparison;
- to install the same context rules on another machine or workspace.

Do not use Guster for ordinary code edits, runtime debugging or content writing unless the request is about the context structure itself.

## Scope

Four levels. `--scope` is inferred from `--root` when omitted.

| Level | Command | Covers | Scored dimensions |
|---|---|---|---|
| machine | `guster doctor` | every repo under the workspace roots plus the hub | SSR RBR PCR ICR FRS PHR SIR |
| hub | `guster doctor --scope hub` | knowledge, project cards, tools, reports, handoffs | SSR ICR FRS PHR |
| group | `guster doctor --root A --root B [--root C]` | a requirement family or any set of related repos | SSR PCR ICR FRS PHR |
| project | `guster doctor --root <repo>` | one repository | SSR PCR ICR FRS PHR |

Rules:

- Machine level owns resident budgets, skill budgets and credential layout.
- Hub level owns knowledge indexing, project-card freshness and hub pointers.
- Group level exposes cross-repo facts: the same file name with different content,
  duplicated copies, and per-repo placement gaps.
- Project level shows only that repo's findings and states how many machine-level
  findings were hidden.
- Every scoped run writes to `~/.agents/guster/scoped/<hash>/`, so it never
  overwrites the machine-wide registry or trend.
- Pointer checks skip documentation templates (`draft-NNN.md`,
  `daily-YYYY-MM-DD.md`, `0X-xxx.md`) and `~/` paths that sit on an
  `ssh`/`scp`/`rsync` command line, because those name a remote home.

## Workflow

1. `guster status`
2. `guster scan --json` (add `--root <project>` for a single project)
3. `guster doctor`
4. `guster score`
5. `guster plan findings` or a targeted `guster plan move|init`
6. Read the plan with the user.
7. `guster apply <plan> --yes`
8. `guster doctor` again — zero new findings means the edit kept the format contract
9. `guster score --trend`

Workspace writes are gated behind a plan and `--yes`. Reading is not fully
read-only: every scanning command refreshes `~/.agents/guster/registry.json`,
`doctor` also writes `findings.json`, and `score` appends `metrics.jsonl`.
`--no-write` skips that command's own state file for `scan`, `doctor` and `score`.

## Commands

```bash
guster status
guster scan --root ~/Projects --json
guster doctor
guster score --trend
guster score --fail-under 80   # optional gate: exit 2 when CHI is below the target
guster plan findings
guster plan move --from <src> --to <dst>
guster plan init --project <path>
guster apply <plan> --yes
guster init
guster init --project <path> --yes
guster hub init --path <hub> --yes
guster hub attach --path <hub>
guster hub status
guster hub validate
guster link
guster export --format md
guster credentials
guster upgrade
```

## Gates

- **Never persist or print credential values.** Paths, variable names and redacted forms only.
- **Never auto-commit, auto-push or auto-deploy.**
- **Never apply a plan without explicit confirmation.**
- **Never treat a company repository's tracked files as ordinary migration targets.**
- **Fail loud** on an unknown workspace, malformed plan or missing backup.
- Prefer no-focus, CLI-only operation. Do not activate apps or switch Spaces.
- If the scan finds a credential in git, stop structural work and report it as critical.

## Waivers

A finding you knowingly accept is waived in `<hub>/hub.yaml` under `doctor.waivers`,
never by deleting the check:

```yaml
doctor:
  waivers:
    - rule: broken-pointer
      path: ~/work/company-repo
      reason: company-tracked doc, owned upstream
```

`path` is optional; without it the whole rule is waived. Every waiver needs a
`reason` — a malformed block fails loud. Waived findings still appear in
`doctor --json` and in the report's `Waived` section, so the decision stays
visible. Use a waiver only when the fix is outside your authority (company
tracked files, host limitations), not to skip ordinary work.

## Format spec

Context assets follow the versioned format contract in `reference/spec.md`
(CTX-01..09): `AGENTS.md` instruction files, llms.txt-shaped indexes,
machine-verifiable pointers, machine-readable dates, the six `.agents/` slots,
one home per fact, skill metadata budgets, credentials by reference. When
writing or moving a context asset, follow the spec; when a doctor finding
fires, it names the rule that was broken.

## Reformatting legacy context

When the target is not a new asset but an inherited mess — a project or hub
whose context predates the spec — run the playbook in
`reference/reformat.md`: **inventory and classify** every artifact (doctor
findings as the worklist, one destination class each) → **placement**
(`plan init` for the slots, one `plan move` or one batch plan for moves —
paths final before pointers are written) → **content** (index lines, naked
paths to links, date lines, duplicates to pointer cards, per the CTX table) →
**verify** (`doctor` zero new findings, `score --trend` before/after). The
pass is meaning-preserving; deletions and distillations are proposed in the
classification table for the user to approve, never silent.

## References

- `reference/spec.md` — context format spec v1 (CTX rules and their findings).
- `reference/reformat.md` — legacy context reformat playbook (four passes, classify-before-touch).
- `reference/framework.md` — 1-3-5-8 framework and placement tree.
- `reference/metrics.md` — metric definitions, targets and CHI.
- `reference/placement.md` — user/hub/project directory trees and the git boundary.

## Exit codes

- `0`: success (including `doctor` with no high/critical findings).
- `1`: tool error — unreadable or malformed plan, missing workspace root, unreadable
  or non-object config; `hub status` also returns 1 when the hub is invalid.
- `2`: `doctor` found high (but no critical) findings; `hub validate` failed the
  lite contract; `link` found broken pointers; `upgrade` found disagreeing versions.
- `3`: `doctor` found critical findings.
- `4`: `apply`, `init` or `hub init` could not apply the plan (preflight errors, or `FAILED`).
