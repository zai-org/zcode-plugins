---
name: manager-profile
description: Profile a fund manager across all managed products and full career — track record by tenure, style, capacity, turnover of mandates. Triggers on "基金经理", "manager profile", "XX的管理业绩", "这个经理靠谱吗", "经理画像", "筛选基金经理".
---

# Fund Manager Profile

The unit of analysis is the manager, not any single fund. Records are stitched across products, strictly by tenure dates.

> Engine field 口径 traps that change conclusions — 「近N年年化」 is not
> geometric, 「规模」 is merged across share classes — are documented in
> `../fund-screen/references/fund-return-traps.md`. Recompute rather than
> quoting the field.

## Workflow

### Step 1: Identify and enumerate mandates

- Resolve the manager (disambiguate same-name managers by fund company).
- Enumerate managed products with **tenure dates**: `wind-fund.get_fund_info` per product, asking for 历任基金经理姓名和任职时间. **It returns a roster with closed date ranges — 离任日期 included.** Verified on a long-running 偏股混合型 product: the field came back as one composite string shaped `经理甲(20180102-20200615) 经理乙(20180102-20201130) 经理丙(20201201-20230228) 经理丁(20230301至今)` — several closed tenures and one open. An earlier note here claimed the field held 现任 managers and start dates only; that was wrong, and building every interval as `起始日 — 至今` on the strength of it would attribute a departed manager's fund performance to them for years after they left. Read the range as given: `至今` means current, an end date means it closed.
  - Ask for the roster explicitly. A bare `<fund> 基金经理` query returns only 证券代码/证券简称 — the roster arrives when the query names `历任基金经理`, and a query stuffed with extra field names (`任职日期 离任日期`) returned `查询结果为空`.
  - Where the roster is missing or a range is open when a departure is known, fall back to the 基金经理变更公告 (`wind-docs.get_company_announcements`), or record `检索范围内未发现` and say the interval is open-ended in our data. **Do not close one manager's interval with the next manager's start date** — the 公告 distinguishes 离任 from 增聘, and a product that went from solo to co-managed has no handover at all.
- Build the mandate table first: 产品 / 类型 / 任职起止 / 任职回报 / 同期基准. Everything else hangs off it.

### Step 2: Track record, tenure-true

- Per mandate: return over the exact tenure window vs the fund's benchmark over the same window.
- Career aggregate: report per-mandate records side by side. Do NOT blend returns across products into a single career number unless the user asks — and then label the blending method.
- Distinguish solo vs co-managed mandates (co-managed records are shared credit, label them).

**Corroborate every handover against the 公告.** 万得 `wind-fund.get_fund_info` 的 `历任基金经理姓名和任职时间` composite gives the 任职起止 dates (parse the composite string; a fund whose managers never changed returns only `至今` entries — that is not a missing 离任日期); `wind-docs.get_company_announcements` gives the **基金经理变更公告** itself — the date *and* the reason (离任/增聘/共同管理). Query per product over the tenure window.

- A handover date that the 历任 roster and the 公告 disagree on is reported as a discrepancy with both values, not silently reconciled to one.
- The 公告 distinguishes 离任 from 增聘 — a product that went from solo to co-managed is not a handover, and attributing the whole record to one manager afterwards is wrong. The 历任 date range alone cannot tell you which happened.
- 公告 found → `[披露]` + `[n]` citing it. Not found → `检索范围内未发现`, and the tenure rests on 万得 `历任基金经理姓名和任职时间` alone; say so.
- A departure reported only in media stays `[媒体]` until the 公告 appears.

### Step 3: Style and capacity

- Current flagship holdings (`hexin-fund.get_fund_portfolio`, with report date): sector tilts, concentration, cap size preference.
- Style consistency across time: compare holdings snapshots at 2-3 report dates; drift is a finding, not a judgment.
- Capacity: total AUM across mandates and its growth; performance before vs after major AUM jumps (state dates, avoid causal claims).

### Step 4: Assemble

Short-form by default: Markdown in-session, per the house formatting policy. If the user asked for a document, the profile goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. The mandate roster on its own goes to `.xlsx` via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# 基金经理画像: [姓名]([基金公司])
检索于: [date] · 从业: [起] · 在管规模: [X 亿元, 共 N 只]

## 管理产品一览(任职口径)
| 产品 | 类型 | 任职期间 | 任职回报 | 同期基准 | 超额 | 是否共管 |

## 投资风格(基于 [报告期] 持仓)
## 容量与规模变化
## 关注点(经理更替史、风格漂移、共管归因模糊等)

## 覆盖范围与局限
检索于: [date] · 报告期: [持仓所属报告期]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 在管产品枚举 | 有记录 / 检索范围内未发现 / 源不可用 | [系统] | [date] |
| 历史(已离任)产品 | ... | [系统] | [date] |
| 任职起止日期 | ... | [系统] | [date] |
| 各产品同期基准 | ... | [系统] | [date] |
| 旗舰持仓(多报告期) | ... | [系统] | [date] |

本次未能覆盖: [枚举不全的产品类别、无法取得的历史任职段,及失败的源]
数据滞后性: 持仓披露滞后 [X] 天(报告期 [date] ≠ 检索于 [date]);已离任产品的历史区间可能不完整。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

### Guardrails

- Tenure dates are the law: no return credited outside them.
- 同名经理 must be disambiguated before any data is presented.
- Style described from holdings evidence, not from fund names or marketing labels.
- No predictive language about future performance.
- Provenance: 任职起止、产品清单、规模、持仓 as disclosed are `[披露]`; 任职回报、超额、
  career aggregates and any AUM-growth arithmetic are `[测算]` (state the blending method);
  a style-drift or capacity judgement is `[推断]`; an unconfirmed departure or 老鼠仓 report
  is `[媒体]`. Those last three are never omitted.
- Sources entries: 定期报告、基金经理变更公告 and 同花顺 fields sourced from those are
  `一手` (name the system and `检索于`). A media article is `二手` and names what it relays.
  Distinct `[n]` markers must equal the entry count.
