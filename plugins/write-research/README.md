# write-research — Equity Research

[中文说明](./README_CN.md)

End-to-end investment research work product: earnings previews and reviews, sector and thematic primers, competitive landscapes, peer comps, valuation models (DCF / LBO / three-statement), model updates, morning notes, and integrated research reports.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `write-research` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/write-research.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/write-research:earnings` | Analyze quarterly earnings and create an earnings update report |
| `/write-research:earnings-preview` | Build a pre-earnings preview with scenarios |
| `/write-research:sector` | Create a sector overview report |
| `/write-research:competitive-analysis` | Create a competitive landscape analysis |
| `/write-research:comps` | Build a comparable company analysis with trading multiples |
| `/write-research:dcf` | Build a DCF valuation model with comps-informed terminal multiples |
| `/write-research:lbo` | Build an LBO model for a PE acquisition |
| `/write-research:3-statement-model` | Fill out a 3-statement financial model template |
| `/write-research:model-update` | Update a financial model with new data |
| `/write-research:debug-model` | Debug and audit a financial model for errors |
| `/write-research:screen` | Run a stock screen or generate investment ideas |
| `/write-research:morning-note` | Draft a morning meeting note |
| `/write-research:research-report` | Build an integrated investment research report |

| Skill | Role |
| --- | --- |
| `earnings-analysis` | Professional equity-research earnings update reports on quarterly results |
| `earnings-flash` | Short-form A-share reactions across the 业绩预告 → 业绩快报 → 正式报告 sequence |
| `earnings-preview` | Estimate models, scenario frameworks, and the metrics that decide the quarter |
| `sector-overview` | Industry landscape — market dynamics, competitive positioning, key players, outlook |
| `competitive-analysis` | Market positioning, competitor deep-dives, comparative analysis, strategic synthesis |
| `comps-analysis` | Trading-multiple comparable company sets |
| `dcf-model` | DCF equity valuation built from filings and analyst data |
| `lbo-model` | LBO models in Excel for PE transactions and investment-committee materials |
| `3-statement-model` | Integrated income statement, balance sheet and cash flow with proper linkages |
| `model-update` | Carry new prints, guidance, macro changes or revised assumptions into an existing model |
| `research-report` | Company initiation or deep-dive — industry context, financials, comps and valuation in one deliverable |
| `idea-generation` | Quantitative screens, thematic research, and pattern recognition for idea sourcing |
| `morning-note` | Concise morning notes on overnight developments, trade ideas and key events |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |
| `audit-xls` † | Audit a spreadsheet for formula accuracy and common mistakes, scoped to a range, a sheet, or the whole model |
| `pptx-author` † | Professional `.pptx` decks with python-pptx — slide conventions, template handling, and a delivery contract |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `sec-search` | SEC EDGAR full-text search |
| `hexin-stock` | 同花顺 iFinD — A/H equities |
| `hexin-global-stock` | 同花顺 iFinD — global equities |
| `hexin-index` | 同花顺 iFinD — indices and constituents |
| `wind-stock` | Wind — A/H equities |
| `finance-search` | Finance web and news search |
| `wind-economic` | Wind / EDB — macro and economic series |
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
| Python packages | `report-render` needs `reportlab`, `matplotlib`, `pypdf`, `pypdfium2`, `pillow`, `fonttools` (see `skills/report-render/scripts/requirements.txt`); `xlsx-author` needs `openpyxl`; `pptx-author` needs `python-pptx` |
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
