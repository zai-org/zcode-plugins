---
name: peer-benchmark
description: The company's own metrics against listed comparables — peer set built with search_stocks and confirmed with get_stock_info, metrics from get_stock_financials, aggregated to a median or weighted average with get_stock_financials, and every 口径 adjustment between management accounts and statutory accounts stated. Triggers on "同业对标", "跟同行比", "对标分析", "行业中位数", "我们的毛利率在行业什么水平", "peer benchmark", "industry median", "competitive benchmarking".
---

# Peer Benchmark

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

The user's own numbers set against listed comparables. The analysis is easy; **the 口径 problem is the whole difficulty**, and it is what this skill is actually for.

The user's management accounts and a listed company's statutory accounts are not the same basis. They differ in consolidation scope, in what sits above the gross-profit line, in whether 政府补助 and 股份支付 are in operating results, in whether head-office cost is allocated, in period (a management month against a peer's 年报 or TTM), and in 归母 versus 全口径. A benchmark table that ignores this produces a precise, confident, wrong answer — and the reader cannot see that it is wrong, because the arithmetic is fine.

So: **state every adjustment made to align the two bases. Where an adjustment was not possible, say the comparison is indicative (指示性) rather than presenting it as a like-for-like result.**

## Inputs and output

Minimum inputs are the user's own ledger, close package, or management accounts for the target metrics and period, together with the entity, consolidation scope, management/statutory basis, currency, unit, and ownership basis. Public peer data is then retrieved for a reproducible peer set and comparable reporting period. Internal figures may not be filled from peer data, and unavailable peer rows reduce the stated sample size.

The output is one Chinese peer-benchmark workpaper and a Chinese short read or PDF containing the peer-selection record, raw peer data, internal-to-peer basis adjustments, comparable metrics, median and weighted results, company position, formula checks, and coverage limitations. It does not value the company, apply trading multiples, issue a rating, or turn an indicative comparison into a conclusion.

## Before anything else — the user's own side

From the user's file (trial balance, close package, or management accounts), not from anywhere else. Ask for it if it is missing.

Read every non-empty Excel comment or note in the user's workbook before analysing the internal metrics. Carry comments affecting scope, period, metric definition, classification, allocation, tax basis, ownership basis, adjustments, restrictions, or review status into the relevant metric, adjustment, comparability conclusion, or limitation. If the first parser exposes only values, use one that also exposes comments; do not conclude that none exist.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded internal value or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never infer it from an output row or adjacent table pattern.

Record, for every internal metric that will appear in the comparison:

- **报告期** and whether it is a month, a quarter, 累计, or a full year — and whether it will be annualised (an annualisation is an assumption, `[测算]`, named).
- **合并范围** — which entities are in, and whether it matches the scope a peer's consolidated statement covers.
- **归母 vs 全口径** for any profit metric.
- **管理口径 vs 法定口径** — what the management accounts do differently: allocations, internal transfer pricing, provisions taken centrally, 政府补助 or 其他收益 treatment, R&D capitalisation policy, 股份支付.
- Currency, unit, and scale.

## Workflow

### Step 1: Build the peer set — `search_stocks`

Screen A-shares with `search_stocks` (hexin-stock) on the dimensions that make a peer a peer: industry, scale band (revenue or total assets, not market cap alone — the user is unlisted and has no market cap), and business model where the screen supports it. Aim for four to eight names. A set of three is thin and must be labelled as such; a set of twenty is a sector average wearing a benchmark's clothes.

State the screen criteria in the deliverable. A peer set nobody can reproduce is not evidence.

### Step 2: Confirm comparability — `get_stock_info`

For **every** candidate, pull `get_stock_info` (hexin-stock) and read its 行业分类与主营业务. Keep or reject on what the company actually does, and record the reason either way. A name matched by industry code but selling something else is the fastest way to a wrong median, and the code alone will never reveal it.

Reject and say why: a conglomerate whose relevant segment is a minority of revenue, a pure trading company against a manufacturer, a name whose business changed inside the comparison window. Better four defensible peers than eight convenient ones.

Classify selected names as `核心样本` or `扩展样本` when comparability is uneven. `核心样本` matches the business model and main product economics; `扩展样本` may sit upstream or downstream, cover only one product line, or have a materially different revenue mix. Do not describe an upstream input supplier, downstream converter, or structurally different materials company as a direct peer merely because an industry keyword overlaps. Show the aggregate for the core set first; show the expanded-set result separately only when it adds useful context, with its own N and limitation. If every selected name is genuinely comparable, one set is sufficient.

### Step 3: Pull peer metrics — `get_stock_financials`

`get_stock_financials` (hexin-stock), one code per call, for 盈利能力(毛利率、净利率、ROE、ROA)、资产负债表项目、利润表、现金流、同比增长率、杠杆乘数(权益乘数、有息负债) — whichever set the question needs.

Record for each peer: the **报告期** of every figure, whether a ratio came from the provider or was computed, and whether it is TTM or 年报. Per the cn market conventions, a provider's TTM ratio and a 年报 ratio are different periods and are never placed in one column without saying so; where both a published and a computable value exist and they disagree, show both, label each with its 口径, and explain the definitional cause rather than silently preferring one.

A peer whose data could not be retrieved is `源不可用`, is excluded from the aggregate, and **changes the N** — which is stated, not quietly absorbed.

### Step 4: Aggregate — `get_stock_financials`

Pull each peer's metrics via `get_stock_financials`; aggregate yourself — there is no single-call industry-median endpoint. Compute the median, the metric-appropriate weighted or pooled result, and the rank across the returned peer rows. State the denominator and weight for each metric; do not apply revenue weights to every percentage merely for table consistency.

Use the underlying numerator and denominator whenever available:

- Revenue margins and expense ratios: `sum(relevant profit or expense) / sum(revenue)`, equivalent to revenue weighting when definitions match.
- ROA: `sum(profit on the selected ownership basis) / sum(average assets)`, equivalent to average-asset weighting.
- ROE: `sum(profit on the selected ownership basis) / sum(average equity on the same ownership basis)`, equivalent to average-equity weighting.
- Leverage ratios such as 资产负债率: `sum(period-end liabilities) / sum(period-end assets)`, equivalent to period-end asset weighting.
- Growth rates: use a clearly stated base-period weight or compute `sum(current-period amount) / sum(base-period amount) - 1`.

If the required denominator is unavailable, omit that weighted result or mark it `源不可用`; never silently substitute revenue weighting. The median remains the primary reference because it is less sensitive to company scale and structural outliers.

If a peer's metric could not be retrieved, exclude that peer, state the changed N, and record in the coverage block which peers dropped out and why. Compute the median in the workbook as a live formula over the retrieved peer rows, labelled `[测算]`. Never present a remembered industry average.

Report the **median** as the primary reference and the metric-appropriate pooled or weighted result alongside it where scale matters. Never average across peers on two different 口径, and never average a percentage of percentages when the underlying amounts are available.

### Step 5: The 口径 alignment table — the core of the deliverable

One row per adjustment, and it is published, not footnoted:

| 指标 | 本公司(管理口径) | 调整项 | 调整后(可比口径) | 对标口径 | 可比性 |
|---|---|---|---|---|---|
| 毛利率 | [值][披露] | 运费从销售费用重分类至营业成本 [测算] | [值][测算] | 上市公司法定合并口径 | 可比 |
| 净利率 | [值][披露] | 归母口径不可得(无少数股东明细) | — | 归母 | 指示性 |
| ROE | [值][披露] | 期末权益改为平均权益 [测算] | [值][测算] | 平均权益 | 可比 |
| 期间费用率 | [值][披露] | 总部费用未分摊,无法还原 | — | 已分摊 | 指示性 |

Adjustments that commonly matter: 运费与仓储在成本还是费用, 政府补助/其他收益 in or out of operating profit, 股份支付, R&D capitalisation, 总部费用分摊, 关联交易定价, 期末 vs 平均余额 for a return metric, annualising a stub period, 含税 vs 不含税 revenue, and 归母 vs 全口径.

Every adjustment is `[测算]` and shows its arithmetic. **Where an adjustment could not be made, the row is marked 指示性 and the deliverable says what it would take to make it comparable** — a specific piece of data, named. A row marked 指示性 does not carry a conclusion.

Assign comparability conservatively:

- `可比`: period, consolidation scope, ownership basis, metric definition, classification, and material bridge are aligned; no material unexplained residual remains.
- `基本可比`: the metric definition is aligned and any remaining difference is identified and quantified, but the internal figure is unaudited or a non-critical bridge detail remains. State the limitation next to the conclusion; do not call it `口径一致`.
- `指示性`: a material adjustment, ownership split, classification detail, or reconciliation item is missing or cannot be quantified. Show the number only for context and do not use it in a directional conclusion.

Before marking a row `可比`, reconcile its numerator to the supplied components where those components exist. If a management subtotal differs from the visible bridge, show the residual and determine whether it is explained. A disclosed but unexplained residual is not `口径一致`; classify it as `基本可比` only when it is quantified and not decision-changing, otherwise as `指示性`. Do not invent the missing components merely to make the bridge close.

### Step 6: Present — position, not just level

For each comparable metric: the company's adjusted value, the peer median, the metric-appropriate pooled or weighted result, the peer range, and the company's position (above/below median, or a percentile where N supports one — with N of four, a percentile is theatre; say "3 of 5 peers are above" instead).

Where a gap is large, decompose it if the data allows (a margin gap into price, cost structure, and scale) — `[测算]` for the arithmetic, `[推断]` for the cause. Where it does not allow, say the gap is unexplained rather than narrating one.

Keep interpretation descriptive unless the evidence supports a driver. A lower R&D expense ratio does not by itself prove underinvestment or weak innovation; a higher leverage ratio does not by itself prove excessive risk; a higher margin does not by itself prove better operating efficiency. State the observed position first, then label any supported causal interpretation `[推断]` and name the evidence required to confirm it.

Do not turn a benchmark into a valuation or a trading view. This plugin does not price the user's equity off peer multiples, and peer share prices are not part of this comparison.

### Step 7: Deliver — a workbook plus a short read

Both vehicles, because the analysis has both an external-source side and a table side.

**Workbook**, through `xlsx-author`. Use these exact Chinese tab names and order: `对标摘要` → `本公司指标` → `同业样本` → `同业数据` → `口径调整` → `对标结果` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. Peer figures and internal figures are the only hardcodes; every ratio, adjustment, median, and gap is a formula. **Each hardcode carries a cell comment**:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Internal: `Source: 结账包 示例_试算平衡_YYYYMM.xlsx, 2026-07-05, 试算平衡表!F18 6001「主营业务收入」累计, 内部文件`. Peer: `Source: 同花顺 iFinD 上市公司财务数据, 检索于 2026-07-25, 600xxx.SH 2025年报毛利率, [本次返回的来源URL如有]`. Aggregate cells are live formulas over the cited peer rows and do not carry a source comment. A calculated cell carries a formula instead.

Use Chinese for all user-facing workbook, prose read, PDF, and handover text, including titles, headings, column names, statuses, adjustment descriptions, conclusions, and limitations. Preserve stock codes, source-system identifiers, formulas, filenames, and unavoidable proper names as supplied. Describe the group according to the evidence: use `核心可比公司` for direct peers and `相关材料扩展样本` for adjacent businesses; do not call the whole set direct peers when it contains upstream, downstream, or structurally different companies. Name the workbook `同业对标_[主体]_[报告期]_待复核草稿.xlsx`; where a PDF is required, name it `同业对标_[主体]_[报告期]_待复核草稿.pdf`.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, indicative rows visibly distinct, sample-size changes prominent, and long adjustment explanations readable. `检查`页以实时公式列示：本公司调整后数值与`口径调整`页逐项加总一致 · 中位数区间覆盖N与实际取数家数一致 · 各加权或汇总指标使用与其分母一致的权重且能回算至基础金额 · 毛利率 > 营业利润率 > 净利率 · 每个`指示性`行未参与任何结论单元格。

Run `../xlsx-author/scripts/recalc.py`, fix everything it lists, then audit at **model** scope against `audit-xls`.

Render and visually inspect every workbook tab and every PDF page before delivery. Use the evaluated workbook as the single numerical source for the prose read or PDF. Fix clipping, unreadable wrapping, narrow comparison columns, hidden indicative labels, chart labels, and poor pagination. Search workbook cells, headers/footers, prose/PDF text, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and remove it.

**Prose read** (Markdown in-session; PDF through `report-render` if it is going to a board): 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [主体] 同业对标 — [指标主题]
本公司口径: [合并范围] · 报告期: [期间] · 管理口径/法定口径: [说明]
对标组: [N] 家([代码与简称]) · 筛选条件: [screen criteria] · 检索于: [timestamp]
标签口径: [披露] 账面或对标公司披露原值 · [测算] 本文调整与推导 · [推断] 差距成因判断 · [预期] 具名第三方预期

## 一句话结论
[在可比口径下,本公司 [指标] 位于同业 [位置];不可比的部分见口径调整表]

## 一、口径调整
[Step 5 的表格;每行标注 可比 / 基本可比 / 指示性]

## 二、对标结果
| 指标 | 本公司(调整后) | 同业中位数 | 汇总/加权结果(分母或权重) | 区间(最低—最高) | N | 位置 | 可比性 |
|---|---|---|---|---|---|---|---|

## 三、差距解读
[能拆的拆,[测算];成因判断标 [推断];拆不动的直接说未解释]

## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: 内部同业对标

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 本公司台账取数 | 有记录 | [文件名·标签页] | [date] |
| 对标组筛选 | 有记录([N] 家入选,[M] 家因主营不可比剔除) | 同花顺 search_stocks | [date] |
| 主营业务确认 | 有记录([N] 家逐家确认) | 同花顺 get_stock_info | [date] |
| 对标公司财务指标 | 有记录 [N] 家 / 源不可用 [K] 家(已剔除,N 相应调整) | 同花顺 get_stock_financials | [date] |
| 行业聚合(中位数/加权) | 有记录 / 源不可用(改为表内公式计算 [测算]) | 同花顺 get_stock_financials | [date] |
| 口径对齐 | [P] 项可比 / [Q] 项基本可比 / [R] 项指示性(已标注) | 口径调整页 | [date] |

本次未能覆盖: [取不到的对标公司或指标,以及这对中位数与 N 的影响]
口径说明: 归母 vs 全口径 [如何处理] · TTM vs 年报 [各列分别是什么期间] ·
发布值 vs 自算值 [哪些比率取自发布、哪些自算,以及两者不一致时的差异原因]
数据滞后性: 上市公司定期报告披露滞后于报告期;本公司为管理口径未审数

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源` follows the citation policy. A peer's filed statement, or a 同花顺 field sourced from it, is `一手` and names the report and the retrieval date. **For the internal side, `一手` is the ledger or close package itself — name the file and the period rather than a URL**: `[1] 一手 · 财务部 · 结账包 示例_试算平衡_YYYYMM.xlsx / 管理口径利润表 · 报告期 2026-01至06(检索于 2026-07-25) · 内部文件,无 URL`. Distinct `[n]` markers must equal the entry count.

## Guardrails

- **State every adjustment; mark every unadjustable comparison 指示性.** An indicative row never carries a conclusion, and it is never quietly averaged into a gap.
- Do not mark a row `口径一致` while a material numerator bridge or reconciliation residual remains unexplained. Quantified, non-critical limitations are `基本可比`; unquantified or decision-relevant limitations are `指示性`.
- Match each weighted result to the metric's economic denominator. Use revenue for revenue margins, average assets for ROA, average equity for ROE, and period-end assets for leverage; omit the weighted result when the denominator is unavailable.
- Separate direct peers from adjacent or structurally different companies when needed. Show the core-set result first and never let an expanded sample silently redefine the peer group.
- Never fill a missing internal figure with a peer's number, or a missing peer's figure with the median. `n.d.（未提供）` / `源不可用`, and the N changes.
- Confirm every peer's 主营业务 with `get_stock_info` before it enters the set. Record the rejects and the reason.
- One 口径 per column. 归母 and 全口径 are never averaged; TTM and 年报 are never placed in one column unlabelled.
- State N everywhere, and never present a set of one or two as a level. Where a peer drops out, the N moves and the deliverable says so.
- The user's confidential numbers go into this comparison; the peers' public numbers do not come back out as a view on the user's securities. No valuation, no multiple applied to the user's earnings, no trading implication.
- Being below the peer median is a finding, not a verdict. Grade findings by decision impact; this skill issues no ratings.
