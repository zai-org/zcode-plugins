# Guster Placement

## User level

```text
~/.agents/
├── skills/          # shared capabilities
├── wiki/            # local/sensitive knowledge
├── credentials/     # secret root (target)
├── tmp/             # scratch
└── archive/
```

User instructions remain a single canonical file with host symlinks.

## Guster Hub

```text
<hub>/
├── projects/        # state
├── handoff/         # state
├── knowledge/       # knowledge
├── provision/       # state
├── tools/           # capability
├── reports/         # evidence
├── Human Output/    # evidence / deliverables
└── .agents/         # local plans and scratch
```

## Project level

```text
<repo>/.agents/
├── README.md        # required index
├── plans/           # active plans
├── wiki/            # durable project knowledge
├── evidence/        # screenshots, videos, test output
├── skills/          # project-local skills
├── tmp/             # 14-day TTL
└── archive/         # superseded material
```

Topic directories are allowed only under a slot, e.g.
`evidence/brand-report-20261028/`, not at `.agents/` top level.

## Git boundary

- Portable, non-sensitive knowledge → hub `knowledge/` and git.
- Local paths, accounts, production IDs, sensitive pitfalls → `~/.agents/wiki/`.
- Plans, evidence, scratch → project `.agents/`, ignored.
- Credentials → secret root only; never git, docs, reports or chat.
