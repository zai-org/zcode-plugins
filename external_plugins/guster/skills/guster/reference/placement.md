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

The standard skeleton — what `guster hub init` scaffolds:

```text
<hub>/
├── AGENTS.md        # instruction
├── README.md        # index
├── hub.yaml         # manifest (schema 2: knowledge and projects declared, tools optional)
├── register/        # state — project register (projects.yaml, CTX-10)
├── projects/        # state
├── knowledge/
│   ├── README.md    # knowledge index
│   ├── general/     # starter note + knowledge/v1 skeleton; subzones are discovered, not fixed
│   └── projects/    # empty starter subzone
└── tools/           # capability — index only, no tool preinstalled
```

Optional state and evidence directories — `handoff/`, `reports/`, `output/`
and the git-ignored `.agents/plans/` — are added when the workflow needs
them, never by the scaffold; the scanner picks them up when present.

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
