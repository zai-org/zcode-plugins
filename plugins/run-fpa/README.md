# run-fpa — Corporate FP&A

[中文说明](./README_CN.md)

Corporate finance and FP&A off the company's own closed ledger: management reporting, rolling cash and P&L forecasts, budget variance attribution, scenario and break-even work, business-case support, and peer benchmarking against listed comparables.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `run-fpa` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/run-fpa.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/run-fpa:mgmt-report` | 管理口径 management report off a closed period, on a stated metric dictionary |
| `/run-fpa:cash-forecast` | 13-week rolling direct cash forecast with an AR-driven collection curve and minimum-balance headroom |
| `/run-fpa:reforecast` | Rolling P&L reforecast — actuals to date plus driver-based forecast, vs budget, stated as a range |
| `/run-fpa:variance` | Actual vs budget with price/volume/mix/FX and rate/usage attribution |
| `/run-fpa:scenario` | What-if off a named base case — 基准/乐观/压力 by parameter values, sensitivity ranked by impact |
| `/run-fpa:profitability` | Segment profitability after shared-cost allocation |
| `/run-fpa:bp-support` | Incremental profit and cash for a business proposal against a modelled 「不做」 base |
| `/run-fpa:benchmark` | Benchmark the company's own metrics against listed comparables, with every 口径 adjustment stated |

| Skill | Role |
| --- | --- |
| `management-report` | Multi-dimensional report by organisation, business, product or region on a stated metric dictionary |
| `cash-forecast` | Opening cash, AR-ageing-driven receipts, disbursements, and minimum-balance headroom over 13 weeks |
| `rolling-forecast` | Actuals-to-date plus a driver-based forecast for remaining periods, reconciled to budget |
| `budget-variance` | Price / volume / mix / FX on revenue, rate / usage on cost, each variance classified timing or permanent |
| `scenario-analysis` | Scenarios defined by parameter values rather than adjectives, with single-variable sensitivity and solved break-even |
| `cost-profitability` | Which product line, customer, channel or region actually makes money after fixed-cost allocation |
| `finance-bp-decision-support` | Option comparison on one basis, peak funding need, and incremental profit and cash |
| `peer-benchmark` | Peer set built and confirmed from listed data, with metric 口径 adjustments stated |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `hexin-stock` | 同花顺 iFinD — A/H equities |
| `wind-economic` | Wind / EDB — macro and economic series |

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
