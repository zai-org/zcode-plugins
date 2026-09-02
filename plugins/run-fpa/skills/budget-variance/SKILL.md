---
name: budget-variance
description: Actual against budget with attribution rather than description — price / volume / mix / FX on revenue, rate / usage on cost, every material variance classified 时间性 or 永久性, and graded by decision impact. Triggers on "预算执行", "预实差异", "预算对比分析", "为什么没达预算", "量价差分析", "budget variance", "actual vs budget", "variance bridge", "PVM analysis".
---

# Budget Variance Analysis

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A variance table that only shows the gap tells the reader nothing they did not already know — they can subtract. The work is **attribution**: how much of the miss is price, how much is volume, how much is mix, how much is FX; how much of a cost overrun is rate and how much is usage; and which of it reverses on its own.

The deliverable is a workbook. **Its citation vehicle is cell comments** — actuals and budget both come from internal documents, and the comment names which.

## Inputs and output

Minimum inputs are the actual results and the approved budget or named rolling-forecast version for the same entity, period, cumulative basis, currency, consolidation scope, and account basis. Include actual and budget quantities, unit prices/rates, FX rates, business dimensions, allocation rules, and the approval record where available. Quantity or operational detail is required only for the corresponding price/volume/mix or rate/usage decomposition; its absence creates a named `未分解` amount rather than permission to invent a driver.

The output is one Chinese budget-variance workpaper containing the two source populations, mapping and basis alignment, actual-versus-budget results, revenue and cost bridges, timing/permanent classification, decision-ranked findings, formula checks, and coverage limitations. It does not revise the budget, alter actuals, assign personal performance ratings, or execute a management action.

## Before anything else — the files

Two files, on the same basis: **actuals** (trial balance or close package) and **budget** (the approved version, or a named rolling forecast). Ask for both if either is missing.

Settle explicitly, because a variance computed across a mismatch is not a variance:

- **Which budget version** — 年初批准预算 / 第 N 版滚动预测 / 上次上会版本 — and its approval date. Comparing against the wrong version produces a real number describing nothing.
- **Same 报告期 and same cumulative basis** — 当月 vs 当月, 累计 vs 累计, never mixed in one column.
- **Same 科目口径** — the budget's account mapping against the ledger's. List every account present in one and not the other; unmapped accounts are named, never absorbed into 其他.
- **Same consolidation scope and same currency**, with the budget rate and the actual rate both stated if any of it is foreign-currency.
- **Close status** of the actuals (初步 / 最终 / 已审计).

For price/volume/mix you additionally need **quantities** — units, tonnes, hours, headcount, whatever the business sells and consumes, actual and budget. **If quantity data is not in the file, price and volume cannot be separated.** Say so, report that portion as 未分解, and **deliver the rest of the bridge anyway** — 汇率差, 结构差 where a mix basis exists, the cost-side rate/usage split, the 时间性/永久性 classification, and every variance you *can* attribute. Name the quantity detail you would need in the coverage block and in the delivery message, as the thing that would close 未分解. One missing input blocks its own line, not the deliverable: a bridge with a labelled 未分解 residual is usable, and a message asking for 数量明细 with no bridge attached is not. Do not back into a quantity from revenue over an assumed price and present the result as attribution.

## Workflow

### Step 1: Parse, read back, reconcile both sides

Parse with Python (openpyxl / pandas) through Bash. Read back the sheet, the header row, the account column, the period columns, and the sign convention on each file separately — actuals and budget files frequently disagree on whether costs are positive.

Read every non-empty Excel comment or note before analysing the values. Carry comments that affect versions, approval, period, mapping, quantity, allocation, FX, assumptions, restrictions, or classification into the relevant input, mapping, finding, or limitation. If the first parsing method exposes only values, use one that also exposes comments; do not conclude that none exist.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded source value or comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never infer it from the output row or copy an adjacent address.

Reconcile each side to its own total before comparing them: the actuals to the trial balance (see `management-report` Step 2), the budget to its approved bottom line. A budget file that does not sum to the number the board approved is the problem, and it is reported before any variance is.

Test comparability for every line and comparison pair. If period, scope, mapping, tax basis, classification/allocation basis, quantity unit, or currency basis differs, restate only where supplied detail supports a reproducible formula. Otherwise show both source readings, label the affected variance `不可比` or `n.d.（口径待确认）`, and keep it out of attribution and decision conclusions. Never select the more convenient side or silently force unmatched accounts into `其他`.

### Step 2: The variance table, at the level decisions are made

Report by the dimension the business is managed on — product line, customer segment, region, cost centre — not only by statutory caption. Each line: 实际 / 预算 / 差异额 / 差异率, actuals and budget `[披露]`, every variance `[测算]`.

Suppress the noise. A page of ±2% lines hides the three that matter.

### Step 3: Revenue decomposition — price / volume / mix / FX

Use one decomposition consistently and show the formulas on the sheet. Per product or segment `i`, with `Q` quantity, `P` unit price, subscript `a` actual and `b` budget:

```
数量差 (Volume)  = (Q_a,i − Q_b,i) × P_b,i
价格差 (Price)   = (P_a,i − P_b,i) × Q_a,i
```

Aggregated across the portfolio, split the total quantity effect into pure volume and mix:

```
总量差 (Volume) = (ΣQ_a − ΣQ_b) × P̄_b            P̄_b = 预算加权平均单价
结构差 (Mix)    = Σ[ Q_a,i − ΣQ_a × w_b,i ] × (P_b,i − P̄_b)
                  w_b,i = 预算下 i 的数量占比
汇率差 (FX)     = (R_a − R_b) × 外币实际金额        R = 记账汇率
```

**A residual row is mandatory**, and it is a live formula:

```
价格差 + 总量差 + 结构差 + 汇率差 + 未分解 = 收入差异合计
```

The check must close to zero. A bridge that does not close is not published — and `未分解` is an explicit named row, not a plug: it holds only what you deliberately could not attribute (a segment with no quantity data), and its size is stated in the commentary.

### Step 4: Cost decomposition — rate / usage

For variable cost, per input `j`, with `U` usage quantity and `R` unit rate:

```
用量差 (Usage) = (U_a,j − U_b,j) × R_b,j
价格差 (Rate)  = (R_a,j − R_b,j) × U_a,j
```

For cost that scales with output, separate the part explained by volume from the part that is genuinely efficiency: flex the budget to actual volume first (弹性预算), then split the remaining gap into usage and rate. Reporting a materials overrun as a cost problem when volume was 12% above budget is the most common error in this analysis.

For fixed cost and overhead: 支出差 against the phased budget, plus a note on any allocation key that changed between budget and actual. An allocation change is not performance and must never be presented as such.

Same mandatory residual row: `用量差 + 价格差 + 弹性调整 + 未分解 = 成本差异合计`, closing to zero.

### Step 5: Timing versus permanent — the classification that drives action

Every material variance carries one of two labels, with its basis:

| 类别 | 含义 | 必须写明 |
|---|---|---|
| 时间性 | 会自行反转 — 收入或成本的期间归属、跨期截止、应计冲回、预付、发货或验收延后、预算内的支出被推迟 | **反转的期间** |
| 永久性 | 不会自行反转 — 售价变化、客户流失、结构性成本上升、一次性损失、市场份额 | 对全年的影响 |

Where the classification is a judgement rather than a documented fact, it is `[推断]` and labelled as ours. "9 月订单延至 10 月发货，10 月回补" is `[推断]` unless an order record in the file confirms the shipment date.

A permanent variance of 3% usually outranks a timing variance of 15%. Ordering the report by absolute size and leaving the classification in a footnote defeats the analysis.

When this analysis feeds `rolling-forecast`, pass each material item as a structured handoff: closed-period impact, 时间性/永久性 classification, documented reversal period or remaining-year impact, evidence, and confirmation status. Do not copy the current-month variance mechanically into every remaining month. A timing item enters the forecast only in its stated reversal period; a permanent item extends only on a disclosed volume, price, rate, or contract basis; an unexplained or unmapped amount remains `待确认` rather than becoming a forecast driver.

### Step 6: Grade by decision impact

the severity policy, 🔴 高 / 🟡 中 / ⚪ 低·信息, assigned by **what the reader must do**, not by the size of the number:

- 🔴 高 — changes a decision that has to be made now: a reforecast, a price action, a hiring freeze, a covenant test, a cash call. A 2% variance that breaches a covenant is 🔴; a 40% variance on an immaterial account is not.
- 🟡 中 — material enough to track, does not by itself force a decision.
- ⚪ 低·信息 — context, or a timing item that reverses next period.

At most three 🔴 items up front; the rest live in the body. Severity attaches to a finding, never to a department or a manager.

### Step 7: Build the workbook

Through `xlsx-author`. Use these exact Chinese tab names and order: `实际输入` → `预算输入` → `科目映射` → `预实差异` → `收入差异桥` → `成本差异桥` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. Where decomposition detail was not provided, retain the relevant tab and show the attributable components plus a named `未分解` row and its missing evidence.

Use Chinese for all user-facing workbook and handover text, including titles, headings, column names, classifications, statuses, conclusions, and limitations. Preserve source identifiers, account codes, formulas, filenames, and unavoidable proper names as supplied. Name the file `预算差异分析_[主体]_[报告期]_待复核草稿.xlsx`.

Every variance and every bridge component is a formula referencing the input tabs. The only hardcodes are the actual and budget figures and the quantities, and **each carries a cell comment**:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Name the file, the source tab and exact source cell, and the period for both sides — `Source: 结账包 示例_试算平衡_YYYYMM.xlsx, 2026-07-05, 试算平衡表!F18 6001「主营业务收入」, 内部文件` · `Source: 2026年度预算 示例_批准预算_FYxx.xlsx, 2026-01-18, 分产品收入表!H12 A产品6月, 内部文件(经董事会批准,批准日[日期])`. A classification judgement gets its own comment stating the basis. A calculated cell carries a formula instead; a source comment on one means a hardcode is hiding there.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, unresolved items visually distinct, and long evidence or limitation text readable.

`检查`页以实时公式列示：收入差异桥归零 · 成本差异桥归零 · 实际合计与试算平衡表勾稽 · 预算合计与批准预算勾稽 · `科目映射`页中的每个科目在实际和预算两端均有明确处理 · 时间性项目按预计反转期间汇总一致。

### Step 8: Verify, then hand over

Run `../xlsx-author/scripts/recalc.py`, fix everything it lists, then audit at **model** scope against `audit-xls`. A bridge whose residual row was never computed proves nothing.

Render and visually inspect every workbook tab before delivery. Fix clipping, unreadable wrapping, narrow columns, hidden residuals or findings, and broken pagination. Search the workbook and handover for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and remove it. If every tab has not actually been inspected, the workbook is not ready to deliver.

The handover message leads with the decisions, then the bridge, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 口径/委托用途: 内部预算执行分析
预算版本: [名称/版本/批准日] · 实际结账状态: 初步 / 最终 / 已审计 · 累计口径: 当月 / 累计

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 实际数与试算平衡勾稽 | 有记录,已勾稽 | [文件名·标签页] | [date] |
| 预算数与批准版本勾稽 | 有记录,已勾稽 / 差异 [金额] | [文件名] | [date] |
| 科目映射 | [N] 个科目全部匹配 / [M] 个未匹配(已列示) | [科目映射页] | [date] |
| 数量数据(量价分解所需) | 有记录([覆盖的产品/分部]) / 检索范围内未发现 | [文件名] | [date] |
| 汇率(预算汇率与记账汇率) | 有记录 / 检索范围内未发现 | [文件名] | [date] |
| 收入桥残差 | 归零 / 未分解 [金额]([原因]) | 检查页 | [date] |
| 成本桥残差 | 归零 / 未分解 [金额]([原因]) | 检查页 | [date] |

本次未能覆盖: [缺失的明细,以及它本应回答的问题——例如:未提供分产品数量,
B 分部的价量无法拆分,该部分 [金额] 计入未分解]
分类依据: 时间性 [N] 项(合计 [金额],预计 [期间] 反转) · 永久性 [M] 项(合计 [金额],
全年影响 [金额][测算]) · 分类为判断的条目已标 [推断]
```

## Guardrails

- **Attribute, do not merely report.** A variance table with no price/volume/mix and no rate/usage has not done the work. Where the data does not permit attribution, the unattributed amount is an explicit named row with a reason.
- The bridge residual closes to zero, and the check is a formula on the sheet — not an assertion in prose.
- Do not invent a quantity, a budget line, or a unit price. Do not derive a quantity from revenue over an assumed price and call it volume.
- Compare like with like: same version, same period, same cumulative basis, same scope, same currency, same account mapping. Every one of these is stated in the coverage block.
- A variance is not a verdict on a person. Grade findings by decision impact; this skill issues no performance ratings.
- Where the actuals are a preliminary close, say so on the face of the analysis — variances against a moving actual move too.
- Confidential, pre-release material. It stops for the controller and the CFO before it goes to anyone who is measured by it.
