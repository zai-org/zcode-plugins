# find-clients — Corporate Client Acquisition

[中文说明](./README_CN.md)

Corporate-banking client acquisition: turn a coverage mandate into a ranked prospect list, map the enterprise population of a territory, scan business-opportunity signals, and assemble client portraits for a coverage conversation.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `find-clients` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/find-clients.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/find-clients:prospects` | Executed prospect screen — turn a coverage mandate into a ranked target-client shortlist |
| `/find-clients:park` | Enterprise-population map of a park, cluster, or region (counts, 划型, 资质, 上市/发债) |
| `/find-clients:opportunities` | Dated business-opportunity signal scan, graded by actionability for a banker |
| `/find-clients:portrait` | Client portrait for a coverage conversation, ending in questions and a vet-companies hand-off |

| Skill | Role |
| --- | --- |
| `prospect-screen` | Reproducible screen by region, industry, 资质标签, 上榜榜单, or listing status |
| `park-cluster-map` | Map the enterprise population of a territory rather than a company |
| `opportunity-scan` | Financing rounds, expansion and capex, listing moves, tenders and awards, over an explicit window |
| `client-portrait` | Registry basics, supply-chain and equity relationships, recent opportunity signals, and risk flags |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `tianyancha` | 天眼查 — company registry, ownership, litigation and risk records |
| `finance-search` | Finance web and news search |
| `wind-docs` | Wind — filings and research documents |

All of these are **remote HTTP MCP servers on ZCode's own gateway** (`${ZCODE_BASE_URL}`),
declared in [`.zcode-plugin/plugin.json`](./.zcode-plugin/plugin.json). Identity is
injected per tool call by the host (`auth: {type: zcode_official, provider: jwt_token}`).

**There is no API key, token, or vendor account for you to configure.** The plugin never
contacts a data vendor directly and carries no credentials.

This plugin is marked `requiresPaidPlan`: the data behind those servers is licensed
commercial data, not a free tier.

## What it does on your machine

| | |
| --- | --- |
| Hooks | none — the plugin installs no hooks and does not intercept your tools |
| Network | only `${ZCODE_BASE_URL}`, the host gateway. No third-party endpoints |
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
