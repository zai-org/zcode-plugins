# read-macro — Macro & Strategy

[中文说明](./README_CN.md)

Top-down macro and strategy work: a five-block read of the macro state, index valuation percentiles with earnings attribution, cross-asset views, and policy and industrial-plan tracking.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `read-macro` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/read-macro.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/read-macro:macro` | Five-block macro state read (增长/通胀/货币与流动性/信用/外部) with release lags |
| `/read-macro:index-val` | Index valuation percentiles (PE/PB/PS) with stated window, plus 盈利 vs 估值 decomposition |
| `/read-macro:allocation` | Cross-asset views with a falsifying signpost each (no weights, no ratings) |
| `/read-macro:policy` | Track policy and industrial plans, map them onto the industry chain, gather implementation signals |

| Skill | Role |
| --- | --- |
| `macro-dashboard` | Five-block read built from EDB series, each with its 口径, release lag, and revision behaviour |
| `index-valuation` | PE/PB/PS historical percentiles over a stated window, plus weighted constituent earnings |
| `asset-allocation` | Equity via valuation percentiles, plus rates, credit and commodities — assembled only from what the data supports |
| `policy-tracker` | Maps a named plan onto the industry-chain nodes it touches and gathers implementation evidence |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `hexin-index` | 同花顺 iFinD — indices and constituents |
| `hexin-stock` | 同花顺 iFinD — A/H equities |
| `finance-search` | Finance web and news search |
| `wind-index` | Wind — indices |
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
