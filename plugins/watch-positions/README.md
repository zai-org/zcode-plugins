# watch-positions — Position Monitoring

[中文说明](./README_CN.md)

Watchlist and portfolio monitoring for A/H/US names: persistent watchlists, after-close recaps with move attribution, position-relevant event alerts, and an intraday view while the session is open.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `watch-positions` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/watch-positions.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/watch-positions:watchlist` | Manage a persistent watchlist (create, add, remove, show) |
| `/watch-positions:recap` | After-close recap of a watchlist with move attribution |
| `/watch-positions:events` | Scan watchlist names for announcements, pledges, lockups, and risk events |
| `/watch-positions:intraday` | Intraday snapshot of a watchlist with move-vs-benchmark |

| Skill | Role |
| --- | --- |
| `watchlist` | Create, update, inspect and validate persistent watchlists stored as JSON files |
| `close-recap` | Per-name moves, market and sector context, and move attribution against disclosed events |
| `event-monitor` | Announcements, earnings pre-announcements, share pledges, lockup expiries over a window |
| `intraday-watch` | Live quotes, move-vs-benchmark, and which names are moving beyond their usual range |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `hexin-stock` | 同花顺 iFinD — A/H equities |
| `hexin-index` | 同花顺 iFinD — indices and constituents |
| `finance-search` | Finance web and news search |
| `wind-stock` | Wind — A/H equities |
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
