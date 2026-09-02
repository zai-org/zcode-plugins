# pick-funds — Fund Research

[中文说明](./README_CN.md)

Fund and fund-manager research across mutual funds, ETFs and LOFs: multi-criteria screening, fund and manager profiles, holdings and style analysis, and ongoing watch on a shortlist.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `pick-funds` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/pick-funds.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/pick-funds:fund-screen` | Screen funds by performance, risk, size, holdings, or manager criteria |
| `/pick-funds:fund-profile` | Deep-dive profile of a single fund (performance, risk, holdings, manager) |
| `/pick-funds:manager-profile` | Profile a fund manager across all mandates, tenure-true |
| `/pick-funds:holdings` | Holdings analysis — label check, style drift, cross-fund overlap |
| `/pick-funds:fund-watch` | Ongoing watch on held or shortlisted funds — manager, flows, 仓位, drift, rank |

| Skill | Role |
| --- | --- |
| `fund-screen` | Multi-criteria screening by type, performance, risk, size, fees, holdings, manager |
| `fund-profile` | Performance vs benchmark and peers, risk and drawdowns, size and flows, fees, holdings snapshot |
| `manager-profile` | Track record by tenure, style, capacity, and turnover of mandates across a full career |
| `holdings-style` | Holdings vs label, style drift over report dates, concentration, cross-fund overlap |
| `fund-watch` | Manager changes, size and flow shocks, 仓位 shifts, style drift over a window |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `hexin-fund` | 同花顺 iFinD — funds, ETFs, LOFs |
| `hexin-index` | 同花顺 iFinD — indices and constituents |
| `hexin-stock` | 同花顺 iFinD — A/H equities |
| `finance-search` | Finance web and news search |
| `wind-fund` | Wind — funds |
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
