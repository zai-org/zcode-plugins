---
name: finance-bp-decision-support
description: Incremental profit-and-cash analysis of a business proposal against a modelled 「不做」 base — option comparison on one basis, peak funding requirement and payback, the condition under which the recommendation flips, and an open-items list scored by whether it would change the answer. Triggers on "这个项目要不要做", "上不上这条产品线", "投入产出怎么样", "方案比较", "财务 BP 支持", "business case", "投资回报测算", "要不要砍这条线", "降本方案哪个划算".
---

# Finance BP Decision Support

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A business partner's job is not to translate a proposal into three statements. It is to answer two questions: **how much cash does this make the company, over and above not doing it** — and **under what condition does that answer flip**. A memo that gives the first without the second cannot be weighted by the person reading it.

Every number in this deliverable is an **increment against a named alternative**, never an absolute.

The deliverable is a decision memo plus a workbook. **Its citation vehicle is a `来源` section in the memo and cell comments in the workbook.**

## Inputs and output

Minimum inputs are a clearly stated decision and deadline, mutually exclusive options including a modelled `不做` alternative, a common evaluation horizon, proposal economics by period, working-capital and capex timing, relevant capacity or funding constraints, and the source documents for material assumptions. If payback or IRR extends beyond the explicit forecast, require supported post-horizon cash flows, residual value, and working-capital release rather than mechanically extrapolating the last forecast period. A discount rate is optional; without one, NPV remains `n.d.（未提供）` rather than being inferred.

The output is one Chinese decision-support workbook and a Chinese decision memo containing the option basis, visible inclusions and exclusions, incremental profit and cash by period, peak funding, payback, comparison on one stated basis, counter-case and break-even, decision-sensitive open items, formula checks, and coverage limitations. It does not approve a proposal, derive a WACC, post an accounting entry, commit funding, or make the business decision.

## The lines with the other skills

Getting these wrong duplicates work that already exists and is better done elsewhere.

- **`cost-profitability`** cuts the **existing** book — which product line makes money once today's shared costs are allocated. This skill is **forward-looking and incremental**. An allocated existing cost is a real input there and, by default, not one here (Step 2).
- **`model-deals`** structures a **transaction** — a counterparty, consideration, financing, a pro-forma capital structure. The moment the proposal involves buying or selling a business, issuing equity, or raising acquisition debt, it goes there. This skill covers internal operating and investment decisions that move the company's own ledger and its own cash.
- **`write-research`'s `dcf-model`** derives a cost of capital and values a business. This skill **never derives a WACC** (Step 4).
- **`cash-forecast`** is the whole company's 13-week direct cash view. This skill produces the **incremental** cash profile of one proposal, over the proposal's own horizon. If the question is whether the company can fund the winner, run `cash-forecast` with the winner's profile loaded in — do not widen this analysis into a company-level forecast.
- **`scenario-analysis`** owns the mechanics of ranges, sensitivity, and break-even. Step 6 calls it rather than re-deriving it.

## Before anything else

Settle these, and write them at the top of the memo:

- **The decision, in one sentence**, and **who makes it and by when**. An analysis with no decision attached becomes a document nobody acts on and nobody withdraws.
- **The option list, including 「不做」** (Step 1).
- **The evaluation horizon**, and why it ends there (contract term, asset life, planning cycle).
- **The basis**: 利润口径 / 现金口径 / both, and whether it is management accounts or statutory.
- **The constraints** — funding headroom, capacity, headcount, covenant.

Read every non-empty Excel comment or note in the supplied proposal, ledger, plan, and constraint workbooks before analysing the values. Carry comments affecting scope, timing, approval, incremental treatment, capacity, funding, assumptions, exclusions, or review status into the relevant option, assumption, open item, or limitation. If the first parser exposes only values, use one that also exposes comments; do not conclude that none exist.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded proposal amount, baseline amount, date, constraint, rate, or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never derive it from an output row or copy an adjacent address.

## Workflow

### Step 1: The option list — mutually exclusive, comparable, and 「不做」 is modelled

One row per option: what it does, what it consumes, and when it starts to bite. Options must share the same horizon, the same basis, and the same price and cost assumptions — except where a difference *is* the option.

**「不做」 is not a column of zeros.** The status quo moves on its own: contracts expire, share erodes, costs drift up, an ageing asset needs maintenance. Modelling it as zero books the decay of the status quo as the proposal's achievement, which is the single most common way a business case overstates itself.

Preserve the option ownership stated by the source. A row explicitly labelled `「不做」情形`, `若不立项`, or equivalent belongs to the `不做` option by default; do not silently reclassify it as a common item affecting both options. A row labelled common to both options cancels only when the source actually says it occurs in both. If it is unclear whether the proposal avoids the downside, show two parallel cases (`仅不做发生` and `两方案均发生`) and make the attribution a decision-sensitive open item; do not choose the conservative or aggressive interpretation as the base without evidence.

Treat an explicit option label in the source row, header, or attached comment as ownership evidence, not as an unresolved hint. Missing repetition in the proposal narrative, lack of a second confirming document, or the analyst's doubt about the commercial rationale does **not** make that ownership ambiguous. Follow the labelled option in the base model and describe its economic importance without downgrading it to an unsupported assumption.

Parallel attribution cases are required only when the available sources are genuinely silent, use an unlabeled shared row, or conflict with one another. Record the exact silence or contradiction that creates the ambiguity. If the source ownership is explicit, an alternative attribution may appear only when the user asks for it or as a clearly labelled hypothetical sensitivity; it must not become a second base case, a blocking open item, or evidence that the sourced base is unreliable.

Where the real alternative is not "nothing" but "spend the same money on something else", say so and model that instead. A proposal that beats zero and loses to the obvious alternative has not been evaluated.

### Step 2: What counts as incremental — the step that decides the answer

**In:**

- New revenue and the variable cost that comes with it.
- Genuinely new fixed cost — headcount actually added, space actually leased, systems actually bought.
- **Opportunity cost.** Capacity, people, cash, or shelf space consumed by this option is unavailable to what it displaces; the displaced contribution is a real cost of this option.
- **Cannibalisation.** Volume taken from the company's own existing products is not incremental revenue. Net it, and state the assumed rate — it is `[测算]` and belongs in the assumptions block.

**Out:**

- **Sunk cost.** Money already spent — feasibility studies, equipment already bought, prior development. It cannot be changed by this decision, and including it converts a past mistake into a reason to make a second one.
- **Allocated existing overhead.** Redistributing today's management costs onto the proposal changes the company's cash by exactly nothing. Allocation changes how a report looks, not what a decision is worth. **The one exception:** where the proposal genuinely *increases* overhead (a new management layer, a new site's fixed services), the **increase** is incremental — entered at the increase, not at the allocated share.

Every judgement here is reviewable: the workbook carries a `增量口径` column marked 计入 / 不计入 / 部分计入 with the reason. Excluded items stay **visible on the sheet** — an exclusion the reader cannot see is indistinguishable from an omission.

### Step 3: Profit and cash are reported separately, by period

They differ, and an option can be profit-positive and cash-negative for long enough to be undoable. All four are required:

- **Incremental profit by period**, not only a horizon total. The first year is usually negative; the decision-maker needs to see where the trough is and how deep.
- **Incremental cash by period**, including working capital (new inventory, customer terms, supplier terms), capex timing, and tax.
- **Peak funding requirement and the period it occurs in.** Match the label to the data granularity. With monthly or quarterly cash flows, report the observed peak funding requirement. With annual-only cash flows, report `年度期末口径最大资金缺口`; do not call it the actual peak because within-year capex and working-capital timing can make the trough deeper.
- Funding requirement is a positive magnitude, separate from the signed cumulative-cash series: `资金缺口 = MAX(0, -MIN(累计增量现金范围))`. Test `资金缺口 ≤ 可用额度`, and calculate `剩余额度 = 可用额度 − 资金缺口`. Never compare a negative cumulative-cash balance directly with a positive facility limit or call that negative balance the funding requirement.
- Test every hard constraint independently. Passing a facility-headroom test does not prove compliance with a minimum-cash policy, covenant, capital-budget limit, capacity limit, or any other constraint. If the data required for one constraint is missing, report that constraint as `未验证硬约束`; do not infer its result from another constraint or count it as non-blocking merely because another test passes.
- **Payback**, on a cash basis, undiscounted, defined as the first period cumulative incremental cash turns positive. If cumulative cash does not turn positive within the supported horizon and supported post-horizon cash flows are absent, use the exact conclusion `评估期内未回收；期后能否及何时回收无法判断`. Do not write that recovery `will`, `should`, or `actually` occur after the horizon, name a future recovery year, or imply eventual recovery is certain.

### Step 4: NPV and IRR — different input requirements

Compute **NPV only when the user supplies the discount rate**. It is `[披露]`, with the person and date who supplied it in its cell comment.

IRR does **not** require a discount rate. Compute it only when the incremental cash-flow series is complete for the stated investment horizon, contains the required sign pattern, and includes any material terminal proceeds, decommissioning cash flow, residual value, and working-capital release. If those cash flows are missing, report `n.d.（现金流期限不完整）`; do not attribute the omission to a missing discount rate and do not force an IRR from a truncated series.

**Do not derive a WACC.** Deriving a cost of capital is valuation work and lives in `write-research`'s `dcf-model`. Picking 8% or 10% here because it looks reasonable makes the entire ranking turn on a figure nobody reviewed — and it will be quoted back later as though the finance function stood behind it.

With no supplied rate: report undiscounted cash, funding requirement, and payback status, and say in the coverage block precisely what is missing and who would have to provide it. IRR remains governed by cash-flow completeness, not by the discount-rate field.

### Step 5: The comparison table — one basis, and name it

| 方案 | 增量利润(分期/合计) | 增量现金(合计) | 峰值资金占用 | 回收期 | NPV(若已给定折现率) | 约束是否满足 |

Rank on the basis the decision-maker actually uses, and **say which basis it is**. Ranking by profit and ranking by peak funding routinely disagree; when they do, that disagreement is itself a finding and goes in the memo rather than being resolved silently by whichever column got sorted.

Grade findings by decision impact (🔴 高 / 🟡 中 / ⚪ 低·信息) — 🔴 is reserved for what changes the decision or breaches a constraint.

### Step 6: The counter-case — mandatory

For the leading option, give **the condition under which it turns negative**. Call `scenario-analysis` to solve the break-even on the variables that matter, then answer the question that matters: **is that condition realistic?**

Every break-even or flip condition shows the critical **absolute value**, the change from base in amount and percentage, the variables held fixed, and its feasible range. Change linked economics consistently: a volume change normally changes revenue, variable cost, working capital, capacity use, and sometimes fixed-step cost; a price change may affect volume or contract tiers where evidence supports that relationship. If the analysis deliberately holds a linked item fixed, state that simplifying assumption. Substitute each critical value back into the full profit/cash model, require the target to reconcile within tolerance, and retest funding, capacity, covenant, and other constraints at the critical point.

- 「售价需下跌 3% 结论翻转，而该品类近 24 个月均价波动区间为 ±9%」 — the conclusion is fragile, and the memo says so.
- 「销量需下跌 62% 结论翻转」 — the conclusion is robust, and the memo says that too.

Then state **the strongest argument for the opposite choice**. Not for balance — because the decision-maker will meet it in the room, and it is cheaper to meet it here. An analysis that survives its own counter-case is worth more than one that never ran it.

「存在不确定性」 is not a counter-case and does not satisfy this step.

### Step 7: Open items, scored by whether they flip the answer

| 待确认事项 | 谁能确认 | 影响哪个数或约束 | 状态 |

Use exactly three states:

- `是（阻断）` — the contrary value flips the preferred option, breaches a hard constraint, or invalidates the decision basis.
- `否（非阻断）` — a stated source range, mechanical limit, or conservative bound has been tested and cannot flip the answer. Show that bound or threshold; an unsupported judgement such as `量级不足` is not evidence.
- `无法判断（未验证）` — the required input is missing, so the effect cannot be bounded. A missing hard-constraint test appears separately as `未验证硬约束` in the summary and must not be counted among non-blocking items.

A flat list of twenty open items is not a list — it is a way of transferring the analyst's uncertainty to the reader without ordering it.

Do not create an open item merely to reconfirm an option assignment already stated by the source. An attribution item may be blocking only when the source is silent or contradictory and the alternative attribution flips the decision. A hypothetical sensitivity against an explicit source label remains sensitivity, not a data-quality or approval blocker.

### Step 8: Build, verify, hand over

Workbook through `xlsx-author`. Use these exact Chinese tab names and order: `决策摘要` → `方案输入` → `不做基准` → `增量利润` → `增量现金` → `峰值资金` → `方案比较` → `盈亏平衡` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. If an input needed for a tab is unavailable, retain the tab and state `n.d.（未提供）`, what is missing, and which comparison or conclusion remains unresolved.

Use Chinese for all user-facing workbook, memo, and handover text, including titles, headings, column names, statuses, findings, assumptions, and limitations. Preserve source identifiers, formulas, filenames, contract numbers, and unavoidable proper names as supplied. Name the workbook `财务BP决策支持_[事项]_[日期]_待复核草稿.xlsx`; where a PDF is required, name it `财务BP决策支持_[事项]_[日期]_待复核草稿.pdf`.

Hardcodes appear only on `方案输入` and `不做基准`, each with a cell comment:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

A business assumption names the plan document, its version, exact source tab and cell, and who supplied it (`Source: B产品线立项方案_v2.1.xlsx, 2026-07-22, 收入假设!F18, 产品部李某提供, 内部文件`). Ledger-derived figures name the file, exact source tab and cell, and the period. Formula cells carry no source comment; their inputs remain visible on `方案输入` or `不做基准`.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, included and excluded items distinguishable, blocking open items prominent, and long explanations readable.

`检查`页全部使用实时公式：

- 每个方案的增量 = 该方案绝对数 − 「不做」基准, by period, closing to zero
- 每个来源明确标为某一方案的事项仍归属于该方案;标签页正文、行标签或单元格批注任一明确归属即视为有依据,不得仅因缺少第二份确认而判为歧义。只有来源沉默或相互矛盾时才并列两种归属口径,并记录造成歧义的精确来源
- 利润与现金的差额桥 = 营运资金变动 + 资本开支 + 税 + 非付现项, closing to zero
- `资金缺口 = MAX(0,-MIN(累计增量现金))`, `资金缺口 ≤ 可用额度`, `剩余额度 = 可用额度 − 资金缺口`;三者均以正数口径显示并勾稽
- 每项硬约束单独列示为 `满足` / `不满足` / `未验证硬约束`;不得用授信、预算或其他约束的结果替代最低现金、契约、产能等独立约束
- 回收期 = 累计增量现金首次转正的期间
- 评估期内未转正且没有支持性期后现金流时显示 `评估期内未回收；期后能否及何时回收无法判断`;同时检查摘要和备忘录不得出现无依据的未来回收年份或必然回收表述
- 资金缺口名称与时间粒度一致:年度数据不得标为实际峰值
- 每条标 `不计入` 的成本在表上仍可见,且合计单独显示
- NPV仅在折现率单元格非空时计算(否则显示 `n.d.（未提供）`,不显示 0)
- IRR仅在现金流期限完整且符号结构有效时计算;否则显示缺失原因,不得因折现率为空而禁算或误算
- 每个盈亏平衡值回代完整模型后等于目标值,并重新测试相关约束
- 摘要和备忘录中的金额、比例、倍数及 `约占` 数字直接引用已计算单元格或由其公式计算;关键叙述性比例在检查页回代勾稽,不得手工重写

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill.

Render and visually inspect every workbook tab and every page of the memo before delivery — for a DOCX that is the LibreOffice conversion `report-render`'s verifier produces, and if it could not run, say the layout was not measured. Fix clipping, unreadable wrapping, narrow period columns, hidden exclusions or funding troughs, broken chart labels, and poor pagination. Use the evaluated workbook as the single numerical source for the memo; do not retype or independently recompute displayed amounts. Search workbook cells, headers/footers, memo text, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `公式重算校验`, `程序化版式审计`, `建议在Excel中翻页确认`, `视觉通道不可用`, or tool/runtime status and remove it.

The memo itself: a one-page comparison ships as Markdown; a full business case with appendices ships as a **DOCX** through `report-render`'s `DocxReport` — the decision memo is argued over and amended in the meeting it was written for, so the reader needs the file they can edit (the house formatting policy names this skill among the DOCX defaults). Give PDF instead when the decision is made and the memo is being filed as the record. Lead with the decision, the ranking and its basis, then the counter-case, then the numbers. **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
## 覆盖范围与局限
检索于: [timestamp] · 评估期间: [期间] · 口径/委托用途: 内部投入决策支持
决策事项: [一句话] · 决策人: [角色] · 基准: 「不做」已建模 / 替代方案 [名称]
方案清单: [N] 个(含「不做」) · 折现率: [已给定 X%,给定人/日期] / 未提供,未计算NPV · IRR: [已计算] / 未计算([现金流期限或符号原因])

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 「不做」基准建模 | 已建模(含现状衰减) / 按零处理([原因]) | 不做基准页 | [date] |
| 增量勾稽(方案 − 基准) | 逐期归零 | 检查页 | [date] |
| 利润—现金差额桥 | 归零 | 检查页 | [date] |
| 机会成本 | 已计入([项目]) / 检索范围内未发现可识别的占用 | 方案输入页 | [date] |
| 蚕食影响 | 已计入(假设 [X]%) / 经确认不适用 | 增量利润页 | [date] |
| 沉没成本剔除 | 已剔除 [金额],表上可见 | 方案输入页 | [date] |
| 分摊费用处理 | 仅计入实际新增部分 [金额] | 方案输入页 | [date] |
| 峰值资金占用与额度 | [金额]([期间]),额度 [金额] / 额度未提供 | 峰值资金页 | [date] |
| 翻转条件 | 已解出([变量]/[临界值]) / 未能解出([原因]) | 盈亏平衡页 | [date] |
| 业务方案文件 | 有记录([文件/版本]) / 源不可用 | [文件名] | [date] |

本次未能覆盖: [缺失的输入,以及它本应回答的问题]
待确认事项: 阻断项 [N] 条 · 非阻断 [M] 条 · 无法判断 [K] 条（其中未验证硬约束 [J] 条）

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

For an internal source, `一手` is the plan document or the ledger itself — name the file, the version, and who supplied it instead of a URL: `[1] 一手 · 产品部 · B 产品线立项方案 v2.1 · 2026-07-22(检索于 2026-07-25) · 内部文件,无 URL`. An external input (a market size, a published price, a peer's disclosed margin) is a normal entry with its provider and URL. Distinct `[n]` markers must equal the entry count.

## Guardrails

- **Everything is incremental against a modelled 「不做」.** A base case of zeros credits the proposal with the decay it merely avoided.
- **Do not rewrite source option semantics.** An item explicitly described as a `不做` outcome stays in that option unless contradictory evidence says it is common. An explicit source label is sufficient ownership evidence; lack of secondary confirmation is not ambiguity. Parallel cases are for source silence or conflict, while a user-requested hypothetical alternative remains sensitivity and never becomes a blocker.
- **Sunk costs stay out; opportunity cost and cannibalisation stay in.** Excluded items remain visible on the sheet with their reason.
- **An allocated existing overhead is not an incremental cost.** Only the genuine increase enters, at the increase.
- **Profit and cash are reported separately, by period, with peak funding named.** A horizon total conceals the trough that actually constrains the decision.
- **No WACC is derived here.** NPV appears only against a supplied rate, attributed to whoever supplied it. IRR depends on a complete valid cash-flow series, not on a discount rate.
- **Do not extrapolate payback mechanically.** If cumulative cash remains negative within the evaluation horizon and supported post-horizon cash flows are absent, say `评估期内未回收；期后能否及何时回收无法判断` and nothing stronger.
- **Match funding language to data granularity.** Annual-only data supports a year-end maximum deficit, not proof of the true intra-year peak.
- **Funding requirement is positive.** Derive it as `MAX(0,-MIN(cumulative cash))`; facility tests and headroom use that positive magnitude, never the signed cash balance.
- **Hard constraints are independent.** Facility headroom does not prove minimum cash, covenant, budget, capacity, or any other constraint. Missing constraint data is `未验证硬约束`, not a pass and not a non-blocking item.
- **Non-blocking requires a bound.** Mark an open item `否（非阻断）` only after a sourced range, mechanical limit, or conservative bound proves it cannot flip the answer; otherwise use `无法判断（未验证）`.
- **Narrative numbers tie to formulas.** Every amount, ratio, percentage, multiple, and approximation in summaries and memos comes from evaluated workbook cells and reconciles back to them.
- **The counter-case is mandatory**, with the flip condition solved and its realism assessed. 「存在不确定性」 does not discharge it.
- **Back-substitute every flip condition.** Show its absolute critical value, move linked economics consistently, and rerun constraints before calling it feasible.
- Do not invent a volume, a price, a market size, a synergy, or a start date. Missing inputs are `n.d.（未提供）`, named in the coverage block with what they would have changed.
- **This skill does not make the decision and does not recommend one.** It states what each option is worth under stated assumptions and what would change the answer; the business owner and the CFO decide. Where the analysis has a clear leader, say why on the numbers — not 「建议采纳」.
- Grade by decision impact, never by magnitude, and never as a verdict on a person or a team.
- Confidential, pre-release material. It stops for the controller and the CFO before it reaches a board, a lender, or anyone measured by it.
