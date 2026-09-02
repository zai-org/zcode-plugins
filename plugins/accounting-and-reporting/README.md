# accounting-and-reporting — Accounting & Reporting

[中文说明](./README_CN.md)

Accounting close and statutory reporting driven off the company's own ledger. Everything starts from a trial balance or a ledger export that you provide — this plugin reads no market data and calls no external service.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `accounting-and-reporting` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/accounting-and-reporting.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/accounting-and-reporting:close-review` | Pre-close sweep over the trial balance and close checklist — blockers vs warnings, abnormal balances |
| `/accounting-and-reporting:map-accounts` | Map one chart of accounts to another with balance conservation proved, and 1:N / N:1 mismatches surfaced |
| `/accounting-and-reporting:reconcile` | Reconcile two populations down to the transactions that explain the difference, each classified by cause |
| `/accounting-and-reporting:statements` | Build statutory-basis financial statements and note working papers from a trial balance, every tie a live formula |
| `/accounting-and-reporting:tie-out` | Review a statement set someone else prepared — within-statement, cross-statement, prior-period, and notes |

| Skill | Role |
| --- | --- |
| `month-end-close-review` | Pre-close sweep: blockers separated from warnings, abnormal balances by direction, missing accruals |
| `ledger-reconciliation` | Reconciliation carried to root cause — GL against subledger, book against operational log, report against report |
| `account-mapping` | Mapping between two charts of accounts for consolidation, migration, or a presentation change, with balance conservation proved |
| `financial-reporting` | Statutory-basis statements and note working papers built from a trial balance |
| `statement-consistency-check` | Three-statement consistency review of a set someone else prepared |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |
| `audit-xls` † | Audit a spreadsheet for formula accuracy and common mistakes, scoped to a range, a sheet, or the whole model |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

This plugin declares **no MCP servers**. It works entirely off the ledger, trial balance,
or statement set you provide, so it needs no market-data entitlement and no paid plan, and
it is not marked `requiresPaidPlan`.

## What it does on your machine

| | |
| --- | --- |
| Hooks | none — the plugin installs no hooks and does not intercept your tools |
| Network | none — no MCP servers and no outbound calls |
| Writes files | report, workbook and deck deliverables (`.pdf`, `.docx`, `.xlsx`, `.pptx`) plus build intermediates, in the working directory the skills pick per their own rules |
| Executes | `python3` for the authoring skills; **headless LibreOffice (`soffice` / `libreoffice`)** for xlsx formula recalculation and DOCX→PDF verification; `fc-list` for font checks |
| Python packages | `report-render` needs `reportlab`, `matplotlib`, `pypdf`, `pypdfium2`, `pillow`, `fonttools` (see `skills/report-render/scripts/requirements.txt`); `xlsx-author` needs `openpyxl` |
| Degrades gracefully | without LibreOffice, `xlsx-author` reports `recalc_unavailable` and runs a static lint only — which it explicitly does **not** treat as a pass |

## Scope and review

Output is **draft work product, staged for a qualified professional to review and sign
off**. It is not investment advice, not a rating or price target issued as a firm view,
and not a credit or compliance decision. Material claims are source-tagged so a reviewer
can check them; what could not be sourced is reported as a gap rather than smoothed over.

## Provenance

Vendored from an upstream Z.ai project; `agents/`, `commands/` and `skills/` are produced
there and must not be edited here. The ZCode adaptation layer (manifests, this README, the
marketplace entry) is owned by this repository. Open publishing gates are recorded in
[`UPSTREAM.md`](./UPSTREAM.md).
