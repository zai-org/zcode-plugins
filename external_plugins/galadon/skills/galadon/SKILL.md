---
name: galadon
description: Initialize and run an agent-ready engineering workspace with the five-stage Galadon loop and its layout/stack scaffold generator. Use when the user says Galadon/工程阵地/初始化工程/项目模板/一键部署/下一步做什么, or wants a new project scaffolded with spec, build, verify, ship and learn gates.
---

# Galadon

Galadon is a five-stage engineering loop:

```text
Spec -> Build -> Verify -> Ship -> Learn
```

The core depends on three ports: `RolePort`, `TemplatePort` and `DeployPort`.
The bundled implementations are references, not the framework.

## When to use

- The user wants to initialize a new engineering project.
- The user asks "下一步做什么" or wants an agent to follow a standard loop.
- The user wants a project that can build, verify, ship and keep evidence.
- The user wants to swap deployment style without changing the workflow.

## Workflow

1. Run `galadon next` and read `galadon.yaml`.
2. Do only the current phase; write its artifact.
3. Run `galadon check`; repeat until the loop reaches `learn`.

## Running the CLI

Resolve it in this order and stop at the first hit:

1. `galadon` on `PATH`.
2. `../../bin/galadon` relative to this skill directory (the plugin ships the CLI).
3. `PYTHONPATH=<plugin>/src python3 -m galadon`.

The CLI only needs Python 3.10+ and `PyYAML`.

## Commands, layouts and ports

Do not restate the lists; ask the CLI and read the bundled `README.md` (two
levels up from this skill):

- `galadon --help` lists every command and flag.
- `galadon init --list-layouts` prints the shipped layouts, stacks and the
  exact build/test commands each stack runs.
- `README.md` covers what each layout creates, the layout contract and the
  ports: `RolePort` picks who works, `TemplatePort` only chooses which
  `docs/profile.md` is written (the code skeleton comes from `--layout` and
  `--stack`), and `DeployPort` builds, ships, probes and rolls back.

Defaults stay `layout=none`, `stack=python`; `--layout none` ignores the stack
and keeps the 0.2.x shape. A non-`none` layout with `--stack python|node` ships
real checks and a passing test, so `galadon check` is green right after `init`;
`--stack none` fails loudly with "no checks configured — declare
checks.build/checks.test". `galadon check` also enforces the layout contract and
names every missing item: report those instead of creating empty stubs.

## Rules

- Never skip `Verify` or `Ship`.
- Never report ship success without a version probe match.
- A failed probe rolls back to the previous release and the run exits non-zero.
- Production release requires explicit confirmation in the current session.
- Never write secret values into `galadon.yaml` or git.
- If an adapter is not implemented, say so; do not fake a deployment.
- Keep `AGENTS.md` short. The current phase lives in the managed block.
- Every remote write prints its target first; `teardown` refuses a remote root
  that was not created by `bootstrap`.
