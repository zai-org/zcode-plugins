---
name: cost-profitability
description: Segment profitability after shared-cost allocation — which product line, customer, channel, or region actually makes money once fixed and common costs are distributed by a stated driver, with the allocation arithmetic shown and every segment that flips negative under allocation flagged. Triggers on "哪个产品线赚钱", "客户盈利分析", "分摊后盈利", "产品线利润", "渠道利润", "SKU盈利", "成本动因分摊", "segment profitability", "product-line P&L", "customer profitability", "cost allocation".
---

# Cost & Profitability Analysis

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A whole-company P&L says the firm is profitable; it does not say which segment bears the shared-cost pools. This skill answers that: after distributing shared and fixed costs to segments by a **stated driver**, which segments remain profitable, which change sign, and how much of that conclusion depends on the allocation choice.

The work is **allocation**, and allocation is a choice. Every number below the direct-margin line depends on a driver someone picked, so the driver is named on every line and its consequence is shown — never hidden inside a "fully-loaded cost" that reads as fact.

## What this skill does not do

It does not close the books, post allocations to the GL, or sign off a transfer-price policy. It prepares an analysis for the finance function to review; the controller and segment owners decide whether the drivers and the resulting numbers are the ones to manage on.

## Inputs and output

Minimum inputs are the whole-company ledger or close-package totals, segment-level revenue and direct-cost detail for one stated primary dimension, identifiable shared-cost pools, and any existing allocation rules. Add operational allocation bases such as headcount, orders, weight, floor area, or hours where available. All inputs must share the same entity, period, currency, unit, sign convention, and consolidation scope.

The output is one Chinese profitability workpaper showing the source populations, segment and account mapping, direct margin before allocation, each cost pool and allocation driver, fully loaded profitability, alternative-driver sensitivity, sign-flip findings, formula checks, and coverage limitations. It does not post allocations, change management-account definitions, set transfer prices, or decide whether a segment should be retained, repriced, or exited.

## Before anything else — the file

The primary source is the user's own ledger or close package at a granularity below the whole company: a **cost-centre extract, a product-line P&L, a customer-revenue file, a channel breakdown, an AR or sales-detail file**, plus any **cost-allocation schedule** the company already uses. **If none was provided, ask for it**, naming what would answer the question (「按产品线/客户/渠道的收入与直接成本明细」、「成本中心费用表」、「现有分摊规则表(若有)」). Do not reconstruct segment data from memory, and do not substitute a peer's disclosed segment margins for this company's own.

Settle before computing, because every segment margin depends on them: **entity / consolidation scope**, **报告期**, **the segmentation dimension** (产品线 / 客户 / 渠道 / 区域 — one primary dimension per analysis; a second dimension is a separate cut), **close status** (初步 / 最终 / 已审计), and **unit and presentation scale** (万元 or 亿元, one per column).

## Workflow

### Step 1: Parse, read back, reconcile

Load the workbook(s) with Python (openpyxl / pandas) through Bash. Then **read back what you parsed before computing on it**: sheet names, the header row, the segment column, the account-code or line-item column, which columns are 收入 / 直接成本 / 期间费用 / 共同成本, and the sign convention (costs positive or negative in this extract?). A sign read wrong inverts every margin.

Read every non-empty Excel comment or note before analysing the values. Carry comments affecting segment definitions, direct/common classification, cost-pool mapping, allocation drivers, exclusions, scope, assumptions, or review status into the relevant mapping, driver, finding, or limitation. If the first parser exposes only values, use one that also exposes comments; do not infer that the workbook has none.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded revenue, cost, pool balance, driver base, or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never derive it from the output row or table pattern.

Reconcile the segment detail back to the whole-company total from the ledger before allocating anything:

| 核对项 | 测试 |
|---|---|
| 收入合计 | 各分段收入合计 = 利润表营业收入 |
| 直接成本合计 | 各分段直接成本合计 = 利润表营业成本(直接部分) |
| 共同/固定成本 | 未分摊的共同成本合计 = 利润表中未直接归属的费用项 |
| 分段完整性 | 收入与成本的分段覆盖同一组主体,无遗漏无重叠 |

If a tie fails, **stop and report the gap** — both figures, the difference, where you think it enters — rather than allocating on a base that does not foot. An allocation built on an unreconciled base distributes the error into every segment.

### Step 2: Direct margin — before any allocation

Per segment: 收入 − 直接成本 = **直接毛利**, and 直接毛利率. This is the contribution before shared-cost allocation; it is **not** a lower bound on profit. Direct costs are those the segment exclusively incurs (its own materials, its own headcount, its own direct overhead). Everything else is a candidate for allocation, not a fact about the segment.

State explicitly which costs you treated as direct and which as common — the boundary is a judgement and it drives everything below.

### Step 3: Choose the allocation drivers — and state each one's consequence

For each pool of shared or fixed cost, pick a driver and **show what changes if the driver changes**. This is the step that makes the analysis honest rather than mechanical.

Common pools and the driver choices that actually matter:

| 成本池 | 常见动因 | 动因选择的后果 |
|---|---|---|
| 销售费用 / 渠道费用 | 收入占比 vs 订单数 vs 客户数 | 按收入分摊让大客户显得便宜;按订单数让小单密集的客户显得贵 |
| 管理费用 / 总部费用 | 收入占比 vs 人数 vs 利润占比 | 按利润分摊惩罚高利润段(越赚越背);按收入更中性 |
| 仓储 / 物流 | 收入 vs 体积/重量 vs 订单行数 | 按收入让轻货值大单占便宜;按体积才反映真实占用 |
| 研发费用 | 收入 vs 工时占比 vs 不分摊(作为期间费用) | 研发服务于未来,分摊到当期各段都是武断的 |

For every pool, record: the driver chosen, the base total, each segment's share of that base, and the resulting allocation. Where two reasonable drivers give materially different answers, run **both** and show the spread — a segment that is profitable under one driver and not under another is the most decision-relevant finding in the report.

A driver you could not derive from the file (no headcount by segment, no order counts) is reported as `未分摊`, not guessed. Guessing a driver produces a precise number with no basis, which is worse than an honest gap.

**A pool the file gives only as a total is still workable — do not stop for it.** Where 共同费用 arrives as one line and the analysis needs it split across 销售/管理/研发, apply the mapping the file *does* support (成本中心, 科目段, or the 期间费用 ratio in the prior period), state that mapping and its basis in the assumptions block, run the sensitivity of the segment conclusion to it, and deliver. Flag it `待确认` so the controller can replace it with the real split in one cell. If you can name a defensible mapping, you can build with it — proposing one and then waiting produces nothing to review (the human-review guardrail). Reserve the question for the case where the subject is missing, not the case where a basis is arguable.

### Step 4: Fully-loaded segment margin

Per segment, after allocation: 收入 − 直接成本 − 分摊的共同成本 = **完全分摊后净利**, and 净利率. Rank segments by net margin.

Flag every segment that **flips sign under allocation** — positive direct margin, negative fully-loaded. Describe this as `当前分摊口径下完全成本利润为负`, not automatically as `公司补贴`, `经济性亏损`, or `应退出`. Allocation tells where shared cost is assigned; it does not show which shared costs disappear if the segment is repriced, reduced, or exited.

For every sign-flip segment, add an **avoidable-cost bridge** where the source permits it: contribution before shared cost, shared cost that is demonstrably avoidable, shared cost that remains, one-off exit/restructuring cost, and the resulting incremental impact of the proposed action. If avoidability is not evidenced, show `n.d.（未提供）` and keep any retain/reprice/exit statement as a management question rather than a financial conclusion.

### Step 5: Sensitivity and the decision

State how the ranking shifts under the alternative drivers from Step 3. A segment that survives every reasonable driver is robustly profitable under the tested allocation bases; one that only survives under one driver is allocation-sensitive, not automatically uneconomic.

Any break-even or remediation claim (price increase, order reduction, weight reduction, volume increase, or cost reduction) must be solved from the **same fully-loaded model**, with all other variables and allocation shares treated consistently. Report the critical absolute value, change from base, what is held fixed, and whether the solution is feasible. Substitute the critical value back into the model and require the target profit to reconcile to zero within tolerance. If no non-negative value of one driver can reach break-even because the other allocated pools already exceed contribution, report `单独调整该变量无法达到保本`; do not publish an impossible positive threshold.

When the proposed action changes a **driver base** inside a fixed pool, recalculate the denominator and every segment's share; never hold the old per-unit allocation rate fixed. For segment `i`, a fixed pool allocated by driver `x` remains `Pool × x_i / Σx`, so solving a driver break-even must use the changed `Σx`. A reduced order count, weight, headcount, or hours normally reallocates the unchanged pool to other segments; it does not reduce company cost unless there is separate evidence that the pool itself is avoidable. Show both effects distinctly:

- `分段保本`: the target segment's allocated result after recomputing all shares;
- `公司利润影响`: incremental revenue minus incremental avoidable cost. Pure reallocation sums to zero at company level; a price increase with unchanged volume/cost increases company profit, while reducing an allocation driver alone does not.

Close with the decision questions the analysis raises — retain, reprice, redesign service levels, or test exit economics. A retain/reprice/exit conclusion requires the avoidable-cost bridge above; without it, state what evidence is missing. Tag each management implication `[推断]`, not as a number the ledger produced.

## Provenance

Line items and segment totals taken from the file are `[披露]`. Every allocation, every margin, every driver share, and every sensitivity is `[测算]` and shows its arithmetic. A cause claim ("客户 A 亏损主要因订单碎片化导致物流成本高") is `[推断]` unless an order-level record in the file supports it.

The deliverable is a workbook, built through `xlsx-author` as a **Class A** model workbook. **Its citation vehicle is cell comments** — segment data and cost pools come from internal documents, and the comment names which file, tab, and period each figure came from. An allocated cell's comment additionally names the driver and the base total, because the allocation is the analysis. The comment form is:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

For an internal source, name the file, source tab and exact source cell, and the period — `Source: 结账包 示例_试算平衡_YYYYMM.xlsx, 2026-07-05, 成本中心费用表!H42 6601「销售费用」2026年6月, 内部文件`. The allocation-driver input separately names its evidence, for example `Source: 订单明细 Orders_202606.xlsx, 2026-06-30, 订单汇总!D12:D48 各产品线订单数, 内部文件`. A calculated or allocated cell carries a formula instead; its driver and base remain visible on `成本池与动因`, rather than being hidden in a source comment.

## Build and verify the workbook

Use `xlsx-author`. Use these exact Chinese tab names and order: `盈利摘要` → `输入数据` → `分段映射` → `成本池与动因` → `直接毛利` → `完全成本盈利` → `敏感性分析` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. If a driver or segment source is unavailable, retain the relevant tab and show `n.d.（未提供）`, the unallocated amount, and what evidence would resolve it.

Use Chinese for all user-facing workbook and handover text, including titles, headings, column names, classifications, driver names, statuses, findings, and limitations. Preserve account codes, source identifiers, formulas, filenames, and unavoidable proper names as supplied. Name the file `成本与盈利分析_[主体]_[报告期]_待复核草稿.xlsx`.

Every margin, allocation, sensitivity, subtotal, and reconciliation is a live formula referencing the input, mapping, and driver tabs. Hardcoded source values live on `输入数据` or `成本池与动因` and carry exact-cell source comments. `检查` includes at least: source segment revenue and direct costs tie to the company total; shared-cost pools tie to the unallocated ledger population; every mapped account resolves once without overlap; every driver share sums to 100%; each allocated pool is fully allocated or its unallocated residual is shown; segment totals plus `未分摊` tie to the company result; alternative-driver scenarios reconcile to the same cost-pool totals; and every published break-even value, when substituted back into the full model, reproduces the target profit. For a changed allocation driver, the check also recomputes `Σx`, all segment shares and full-pool allocation, and verifies company profit changes only by incremental revenue/avoidable cost rather than by reallocation. An infeasible single-variable break-even is checked and labelled as such rather than forced into a numeric answer.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, direct and allocated margins visually distinct, sign-flip segments prominent, and long driver explanations readable.

Run `../xlsx-author/scripts/recalc.py`, fix everything it lists, then audit at **model** scope against `audit-xls`. Render and visually inspect every workbook tab before delivery. Fix clipping, unreadable wrapping, narrow columns, hidden `未分摊` rows or sign-flip findings, and broken pagination. Search workbook cells, headers/footers, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and remove it. If every tab has not actually been inspected, the workbook is not ready to deliver.

## Coverage

Close with the coverage block, headed `覆盖范围与局限` in the delivery message and repeated on the workbook's `说明与局限` sheet. The check items are the reconciliation tests from Step 1 plus the allocation pools and avoidable-cost evidence for any proposed action, each carrying `有记录` / `检索范围内未发现` / `源不可用`. An unallocated pool (driver not derivable) is `未分摊` with what that leaves uncovered — a fully-loaded margin that omits a material pool is not fully-loaded, and the gap is named rather than buried.
