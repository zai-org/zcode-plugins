# vet-companies — Company Due Diligence

[中文说明](./README_CN.md)

Counterparty and company due diligence on Chinese enterprises, listed or private:
structured DD reports, related-party and supply-chain mapping, and fast risk-record
screens. Built for credit, primary-market, vendor-onboarding, and compliance teams.

## Quick start

Install the plugin from the ZCode plugin manager, then either run a command or just
describe the task — the `vet-companies` agent classifies it and loads the right skill.

```text
/vet-companies:dd-report 某某科技有限公司 供应商准入
/vet-companies:risk-scan 供应商名单.txt
```

## Components

**Agent** — `agents/vet-companies.md` acts as a credit and transaction-diligence
associate: it picks the work mode, enforces the data-source priority order, and applies
the output guardrails below.

| Command | What it does |
| --- | --- |
| `/vet-companies:dd-report` | Full company due-diligence report — registry, ownership, risk records, media |
| `/vet-companies:related-parties` | Map related parties — ownership chain, brother companies, supply-chain links |
| `/vet-companies:risk-scan` | Fast risk-record screen (失信/涉诉/处罚/质押/担保/舆情), single or batch |

| Skill | Role |
| --- | --- |
| `dd-report` | Assembles the full report: entity resolution, registry profile, ownership and related parties, industry-chain position, risk records, adverse media, issuer financial red flags |
| `related-party-map` | Shareholders, outbound investments, brother companies, supplier/customer and funding-chain links, as a structured relationship map |
| `risk-scan` | Severity-ranked screen for 失信被执行 / 终本案件 / 限制高消费 / 涉诉 / 行政处罚 / 股权质押与冻结 / 对外担保 / 破产重整 / 司法拍卖, plus adverse media |
| `report-render` † | Paginated PDF or editable DOCX deliverables with correct CJK rendering, density-sized charts, clickable `[n]` citations, and a mandatory render-and-inspect gate |
| `xlsx-author` † | Professional `.xlsx` workbooks with formula-construction rules and a mandatory recalc / error-check step before delivery |

† Shared authoring skills, generated upstream from a single source and vendored into
every finance plugin. See [`UPSTREAM.md`](./UPSTREAM.md).

## Data sources and authentication

| MCP server | Data |
| --- | --- |
| `tianyancha` | 天眼查 — company registry, ownership, litigation and risk records, supplier/customer relations |
| `hexin-bond` | 同花顺 iFinD — bond and issuer data |
| `wind-docs` | Wind — filings and research documents |

All three are **remote HTTP MCP servers on ZCode's own gateway** (`${ZCODE_BASE_URL}`),
declared in [`.zcode-plugin/plugin.json`](./.zcode-plugin/plugin.json). Identity is
injected per tool call by the host (`auth: {type: zcode_official, provider: jwt_token}`).

**There is no API key, token, or vendor account for you to configure.** The plugin never
contacts a data vendor directly, and it carries no credentials.

This plugin is marked `requiresPaidPlan`: the registry, bond, and filings data behind
those servers is licensed commercial data, not a free tier.

## What it does on your machine

| | |
| --- | --- |
| Hooks | none — the plugin installs no hooks and does not intercept your tools |
| Network | only `${ZCODE_BASE_URL}`, the host gateway. No third-party endpoints |
| Writes files | report and workbook deliverables (`.pdf`, `.docx`, `.xlsx`) plus their build intermediates, in the working directory the skills pick per their own rules |
| Executes | `python3` for the two authoring skills; **headless LibreOffice (`soffice` / `libreoffice`)** for xlsx formula recalculation and DOCX→PDF verification; `fc-list` for font checks |
| Python packages | `report-render` needs `reportlab`, `matplotlib`, `pypdf`, `pypdfium2`, `pillow`, `fonttools` (see `skills/report-render/scripts/requirements.txt`); `xlsx-author` needs `openpyxl` |
| Degrades gracefully | without LibreOffice, `xlsx-author` reports `recalc_unavailable` and runs a static lint only — which it explicitly does **not** treat as a pass |

## Scope and review

Diligence output is **draft work product, staged for a qualified professional to review
and sign off**. It is not a credit decision, not a compliance clearance, and not
investment advice. Every material claim is source-tagged so a reviewer can check it;
findings that could not be sourced are reported as gaps rather than smoothed over.

Registry and litigation records reflect what the upstream data vendor had indexed at
query time. Absence of a record is not proof of absence.

## Provenance

Vendored from an upstream Z.ai project; `agents/`, `commands/` and `skills/` are produced
there and must not be edited here. The ZCode adaptation layer (manifests, this README,
the marketplace entry) is owned by this repository. Open publishing gates — unresolved
upstream licensing and a `+dirty` source commit — are recorded in
[`UPSTREAM.md`](./UPSTREAM.md).
