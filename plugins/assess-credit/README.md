# assess-credit — Fixed Income & Credit

[中文说明](./README_CN.md)

Fixed-income and credit research on onshore bonds: bond profiles with valuation and risk metrics, issuer credit assessment, curve and spread analysis, and credit-risk watchlists.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `assess-credit` agent classifies it and loads the right skill.

## Components

**Agent** — `agents/assess-credit.md` picks the work mode, enforces the data-source priority
order, and applies the output guardrails below.

| Command | What it does |
| --- | --- |
| `/assess-credit:bond` | Single-bond profile — terms, 兑付安排, 估价/溢价, 久期/凸性/利差, issuer identity |
| `/assess-credit:issuer` | Issuer credit assessment — leverage, coverage, liquidity, 担保圈 and 关联占款, disclosures |
| `/assess-credit:curve` | Curve and credit-spread picture across a bond set, segmented by 评级/期限/行业/属性 |
| `/assess-credit:credit-watch` | Credit watch over a window — 到期墙, negative disclosures, 利差走阔, 担保圈 contagion |

| Skill | Role |
| --- | --- |
| `bond-profile` | Issuance terms and 兑付安排, live 估价/溢价, 久期/修正久期/凸性/利差, and the issuer's background |
| `issuer-credit` | Credit assessment of the issuer rather than the bond — leverage, coverage, short-term liquidity, ownership |
| `curve-spread` | Levels and spreads segmented by 评级 / 期限 / 行业 / 属性 (城投 vs 产业), against a benchmark curve |
| `credit-watch` | Window monitoring for one issuer or a name list — 到期墙, adverse media, valuation deterioration |
| `report-render` † | Paginated PDF or editable DOCX deliverables — correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks — formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `hexin-bond` | 同花顺 iFinD — bonds and issuers |
| `wind-bond` | Wind — bonds and valuation |
| `wind-economic` | Wind / EDB — macro and economic series |
| `tianyancha` | 天眼查 — company registry, ownership, litigation and risk records |
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
