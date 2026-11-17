# Guster Metrics

Every number is a static count: files, bytes, characters, dates, path
resolution and git metadata. Nothing measures runtime token usage.

## Core metrics

| ID | Metric | Target | Numerator / denominator |
|---|---|---:|---|
| SSR | single-source rate | ≥95% | topics with one source / all topics (filename stem + content hash) |
| RBR | resident budget ratio | ≤100% | bytes of existing host entry files + hub `AGENTS.md` over 20 KB; skill descriptions over 6,000 chars |
| PCR | placement compliance rate | ≥90% | `.agents/` dirs with all six slots, a non-empty index and no unknown top-level entry / dirs that have `.agents/` (workspace containers excluded) |
| ICR | index coverage rate | knowledge 100%, `.agents` ≥90% | mean of indexed knowledge files and `.agents/` dirs with an index |
| FRS | state freshness rate | ≥90% | state docs verified within 90 days / state docs |
| PHR | pointer health rate | 100% | resolvable pointers / resolvable-looking pointers |
| SIR | secret isolation rate | ≥95% | credential files that are unregistered, tracked, unverifiable or inline / credential files + inline tokens. Inline means host config, not arbitrary file content |
| GCR | governance complexity ratio | ≤0.5 | governance documents / 8; reported, never scored |

## Targets

- Resident: one ≤20 KB budget for the entry files that exist (deduplicated by
  real path, host symlinks do not double count) plus the hub instruction file.
  Soft line budgets are 150 per user entry and 50 for the hub.
- Skills: ≤6,000 characters of description in total, ≤500 per skill.
- State: one 90-day SLA for every state document — hub `projects/`, `handoff/`,
  `provision/` and `.agents/plans/`. There is no separate 7- or 30-day tier.
  The date is `verified_at`, a `最后更新` line in the first 40 lines, a date that
  opens the filename, or the owning repository's last commit — that last one is
  "touched", not "verified".
- Knowledge: index every durable file; review every 90–180 days.
- Secrets: 0 in git; 1 canonical root; 0 inline tokens. A file kept in place is
  accepted when `registry.md` declares it; an unreadable repository counts as
  unverified, never as clean.

## No evidence means n/a

An empty denominator produces `n/a`, not 1.0: the dimension is dropped and the
remaining weights are renormalized. A scope with no evidence at all reports
`CHI: n/a`. Scores from scopes with different coverage are not comparable.

## CHI

The Context Health Index is a dashboard, not a KPI:

```text
CHI = 0.20 SSR + 0.15 RBR + 0.15 PCR + 0.15 ICR
    + 0.15 FRS + 0.10 PHR + 0.10 SIR
```

Critical findings do not rescale the score. They set the exit code: `doctor`
returns 3 on any critical and 2 on any high finding. `score --fail-under N`
turns the index into an explicit gate.
