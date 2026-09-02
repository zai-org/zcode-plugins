---
name: scenario-analysis
description: What-if analysis off a named base case — 基准/乐观/压力 scenarios defined by parameter values rather than adjectives, single-variable sensitivity ranked by impact, a two-way table on the pair that dominates, and solved break-even points with their feasibility stated. Triggers on "情景分析", "敏感性分析", "压力测试", "盈亏平衡点", "如果涨价会怎样", "降本多少才能打平", "最坏情况下怎么样", "what-if", "scenario analysis", "sensitivity", "stress case", "break-even".
---

# Scenario and Sensitivity Analysis

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

Three columns of numbers under the headings 基准 / 乐观 / 压力 are the easy part, and on their own they tell the reader nothing they can act on. The work is **ranking** — which variable actually decides the outcome — and **the tipping point** — the value at which the answer changes sign. A scenario table with no ordering and no break-even is decoration.

The deliverable is a workbook. **Its citation vehicle is cell comments** — every parameter value came from somewhere, and the comment names where.

## Inputs and output

Minimum inputs are one named and dated base artifact, one primary target metric and threshold, a common scenario horizon, material variables with evidence-backed ranges, and the operating or financial constraints that determine feasibility. The base artifact may be an approved budget, a named rolling forecast, or a closed-period management report; it may not be silently rebuilt inside this Skill.

The output is one Chinese scenario-and-sensitivity workpaper containing the reproduced base, parameter ranges and their basis, named scenarios, one-variable and two-variable sensitivity, solved break-even points, feasibility tests, formula checks, and coverage limitations. It does not assign probabilities, compute an expected value, recommend a decision, or publish a scenario that breaches a stated constraint as feasible.

## Before anything else — the base case is a named artifact, not a new model

The 基准情景 must **reproduce an artifact that already exists and has a name**: a specific version of `rolling-forecast`, the approved budget, or a closed period from `management-report`. Record its name, its version, and its approval or issue date.

Read every non-empty Excel comment or note in the base artifact and supporting workbooks before analysing the values. Carry comments affecting versions, approval, parameter definitions, ranges, constraints, dependencies, assumptions, or review status into the relevant base input, assumption, scenario, feasibility result, or limitation. If the first parser exposes only values, use one that also exposes comments; do not conclude that none exist.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded base value, parameter, range endpoint, constraint, or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never infer it from an output row or copy an adjacent address.

**The base scenario must equal that artifact line-for-line on the target metric, and that tie is the first row of the `检查` tab — not a sentence in the commentary.** If it does not tie, you have built a second model, and every scenario difference now contains an unknown amount of modelling difference. Stop and report the gap with both numbers rather than proceeding.

Settle before building, because each one changes what the analysis means:

- **One primary target metric** — 全年营业利润 / 期末现金 / 毛利率 / EBITDA. Report secondary metrics if useful, but the ranking and the break-even attach to one metric, or they cannot be ordered.
- **The scenario horizon**, and whether it is 当年剩余期间 or a full forward year.
- **The variable list and where each range comes from** (Step 1).
- **The constraints** the business actually operates under (Step 3).

## Workflow

### Step 1: The variable list, and the basis for every range

| 变量 | 基准取值 | 区间 | 依据 | 标签 |

A range has one of exactly four bases, and it is stated:

- **历史波动** — name the window and the percentile (「近 24 个月月度环比，P10–P90」), computed from the user's own file or from `wind-economic` for an external driver.
- **合同条款** — name the contract and the clause (价格阶梯、最低采购量、账期、调价机制).
- **管理层给定** — name the person and the date they gave it.
- **外部驱动** — `wind-economic`, citing the **resolved** indicator name from `meta`, not the concept you typed.

**A range with no basis does not enter the model.** 「上下浮动 10%」 is not a basis; it is a default wearing the costume of an analysis, and it silently sets the ranking in Step 4 — because a variable's rank is a function of the range you gave it. Two variables both moved ±10% are ranked by nothing but their coefficients.

The base value is `[披露]` when it comes from the base artifact and `[测算]` when we derived it. A range is `[测算]`; a value management supplied is `[披露]` with the giver and date in its cell comment.

### Step 2: Scenarios are defined by parameter values, never by adjectives

Each scenario is a column of named parameter values:

| 参数 | 基准 | 乐观 | 压力 |

Then state, in the commentary and on `关键假设`, **which variables move together and why**. This is the step people skip and it is the one that decides whether anybody believes the output:

- Pushing N independently-worst values into one column produces a joint outcome nobody assigns a probability to — a "压力" case that is really a 1-in-500 case, which the reader discounts entirely and correctly.
- Pushing correlated variables to their separate worst values **double-counts the same shock** — if 销量 falls because 售价 rose, moving both adversely charges the business twice for one event.

Correlation is a judgement. It is `[推断]`, and it carries its basis.

Marginal ranges do not establish a joint scenario. Two variables having separate P10/P90 endpoints does **not** show that those endpoints occurred together or represent a plausible combined shock. A named joint `乐观` or `压力` scenario must be supported by at least one of: paired historical observations, an estimated or documented response relationship, contract mechanics, or explicit management-supplied joint values. Otherwise keep the combinations on `双因素敏感性` as exploratory grid points and label them `端点组合（非具名情景、无联合概率含义）`; do not promote P10×P10 or P90×P90 into a named scenario merely because the directions appear intuitive.

Apply that evidence test literally. An analyst-authored story such as `同属需求端冲击`, `方向符合直觉`, or `量价可能联动`, even when labelled `[推断]`, is **not** joint-scenario evidence. A source reference is required: identify the paired observations, the documented response equation or elasticity, the contract clause, or the management-supplied joint parameter set and date. Do not turn an unverified causal narrative into an `explicit assumption` merely by writing it on `关键假设`.

Before creating any named joint scenario, complete a visible evidence gate on `关键假设`:

| 联动变量 | 联合依据类型 | 精确来源 | 是否足以命名情景 |

Only the four evidence types above may produce `是`. Separate marginal percentile tables, same-direction signs, an agent inference, or the absence of contradictory evidence must produce `否`. When the result is `否`, the named-scenario path stops: retain the base case, run one-variable sensitivity and the exploratory two-way grid, and do not manufacture a second route that labels the grid corners as scenarios.

This is a structural rule, not a footnote. Without joint evidence, do **not** use `乐观` / `压力` as column headers, scenario-switch values, summary KPIs, or phrases such as `最坏情况`. Keep the switch at `基准` or omit it, and label the endpoints `下端组合(P10×P10)` / `上端组合(P90×P90)` only on `双因素敏感性`. Named scenario results may appear on `情景结果` only after their joint basis is recorded.

**Do not attach probabilities and do not weight.** 基准 / 乐观 / 压力 is not a distribution. Unless the user supplies probabilities, there is no expected value to compute, no weighted case to report, and no "大概率" to write. A weighted average of three arbitrary columns is a number with no referent.

### Step 3: Constraints — a scenario that breaks one is not a scenario

Capacity ceilings, contractual price tiers and minimum volumes, headcount limits, the minimum cash balance or covenant line, available facility headroom. Each becomes a row on `检查`, tested in **every** scenario.

A scenario that violates a stated constraint is not a stress case; it is an error. And where a scenario is only reachable by breaking a constraint, the finding is that **the scenario is infeasible** — which is more useful than the number it would have produced.

### Step 4: Sensitivity — one variable at a time, ranked

Move each variable alone across its Step 1 range, holding everything else at base, and record the swing in the target metric. **Order by absolute impact.** That ordering is the core of the deliverable: five variables usually contain two that explain most of the outcome, and the reader's attention should go there.

The ranking is only among variables whose transmission into the target metric is actually modelled. If a material variable has a range but lacks a cost share, exposure, elasticity, or other transmission coefficient, label the output `已量化变量范围内的暂定排序`, list the unquantified variables beside it, and do not call the leader the overall `决定性变量`.

Do not derive a transmission coefficient from changes between two forecast versions unless the source explicitly states that the versions differ **only** in that driver and the changed output. An unapproved or superseded draft may be mentioned as a source-status limitation, but its deltas do not enter calculations, alternative cases, or core findings unless the user explicitly authorizes that use and the causal bridge is evidenced.

Then take the top two and build a two-way table across their ranges. Do not build a five-dimensional grid — nobody reads it, and the pairwise interaction that matters is between the two that dominate.

Every sensitivity figure is `[测算]` and is a **formula** on the sheet. A hardcoded sensitivity cannot be re-run when a base value changes, and it will not be re-run.

### Step 5: Break-even — solved, and stated as feasible or not

For each variable that matters, solve for the value at which the target metric hits its threshold — usually zero, sometimes the covenant line or the budget figure — **holding the others at base**.

Report four things, and all four are required:

1. The critical value.
2. Its distance from base, absolute and percentage.
3. **Whether it falls inside that variable's Step 1 range.** A break-even outside the feasible range is reported as 「在给定区间内不可达」, and that is a stronger conclusion than any number: it says this variable cannot sink the case on its own.
4. **Which variables were held fixed while solving.** A break-even point with no stated ceteris paribus is unreadable — the same business has a different break-even price depending on whether volume is allowed to respond.

### Step 6: Build the workbook

Through `xlsx-author`. Use these exact Chinese tab names and order: `情景摘要` → `基准输入` → `关键假设` → `情景结果` → `单因素敏感性` → `双因素敏感性` → `盈亏平衡` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. If a range or constraint source is unavailable, retain the relevant tab and show `n.d.（未提供）`, the affected analysis, and why it was excluded.

Use Chinese for all user-facing workbook and handover text, including titles, headings, column names, scenario names, statuses, findings, and limitations. Preserve source identifiers, formulas, filenames, version numbers, and unavoidable proper names as supplied. Name the file `情景与敏感性分析_[主体]_[报告期]_待复核草稿.xlsx`.

**One switch, one set of formulas.** Scenarios are driven by a single scenario cell on `关键假设` through `CHOOSE` / `INDEX`, and the whole workbook recalculates — **not** a copied sheet per scenario (the same convention `cash-forecast` uses). Copied sheets diverge on the second edit, and divergence does not raise an error.

Hardcodes appear only on `基准输入` and in the parameter values on `关键假设`, and each carries a cell comment:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

A management-supplied value names the person, date, and exact source location (`Source: Q4提价方案.xlsx, 2026-07-18, 参数表!F12, 销售VP张某提供, 内部文件`). A historical range names the source cells, window, and percentile it came from. An external driver names the provider, the resolved 万得 EDB indicator and its code, and the retrieval date.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, infeasible scenarios and in-range break-even points visually distinct, and long range-basis explanations readable.

`检查`页全部使用实时公式：

- 基准情景目标指标 − 来源工件数值 = 0
- 三情景下 压力 ≤ 基准 ≤ 乐观 on the target metric — a breach means a parameter is signed backwards or a variable's direction was misread
- Every constraint from Step 3, tested in all three scenarios
- Every named multi-variable scenario has a visible joint-evidence row with an exact source reference. The check may return `有依据` only when an accepted evidence type and its source are both populated; `[推断]`, a narrative written by the analyst, or separate P10/P90 ranges must return `无联合依据`. Unsupported endpoint combinations remain sensitivity grid points, not named scenarios
- Σ 单变量敏感度 against the total scenario swing — **these need not be equal** (interaction terms are real), but the difference is displayed as its own row and explained, never left to vanish. Define `单变量合计 = Σ(Target_i − Target_base)`, `联合变化 = Target_joint − Target_base`, and `交互项 = 联合变化 − 单变量合计`; the live check is exactly `联合变化 − 单变量合计 − 交互项 = 0`
- Each break-even value substituted back reproduces the threshold

### Step 7: Verify, then hand over

Run `../xlsx-author/scripts/recalc.py`, fix everything it lists, then audit at **model** scope against the `audit-xls` skill.

Then **switch the scenario cell at least once and confirm the target metric moves.** A workbook whose switch was never exercised proves nothing, and a broken `CHOOSE` reference fails silently by returning the base case forever.

Render and visually inspect every workbook tab before delivery. Fix clipping, unreadable wrapping, narrow sensitivity tables, hidden infeasibility flags, chart labels, and poor pagination. Search workbook cells, headers/footers, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and remove it. If every tab has not actually been inspected, the workbook is not ready to deliver.

The handover leads with the ranking and the break-even points, then the three scenarios, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 情景期间: [期间] · 口径/委托用途: 内部情景测算
基准来源: [工件名称/版本/批准日] · 目标指标: [指标] · 基准结账状态: 初步 / 最终 / 已审计

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 基准情景与来源工件勾稽 | 差额归零 / 差异 [金额] | [文件名·标签页] | [date] |
| 变量区间依据 | [N] 个变量全部具依据 / [M] 个为管理层给定 | 关键假设页 | [date] |
| 变量相关性设定 | 已说明([N] 组联动) / 全部按独立处理 | 说明与局限页 | [date] |
| 约束条件测试 | [N] 条约束三情景下均未突破 / [M] 条在压力情景突破 | 检查页 | [date] |
| 敏感度与情景差异对账 | 交互项 [金额],已说明 | 检查页 | [date] |
| 盈亏平衡点可行性 | [N] 个落在区间内 / [M] 个在给定区间内不可达 | 盈亏平衡页 | [date] |
| 外部驱动数据 | 有记录([resolved 指标名]) / 检索范围内未发现 / 源不可用 | wind-economic | [date] |

本次未能覆盖: [未纳入的变量或约束,以及它本应回答的问题]
概率说明: 本分析未赋予情景概率,三情景不构成分布,不得加权求期望
```

## Guardrails

- **The base case reproduces a named artifact, and the tie is a formula.** A scenario model that starts from a freshly built base is measuring its own construction differences alongside the scenarios.
- **Every range has a stated basis.** ±10% on everything is not a sensitivity analysis; it is an assertion that all variables are equally uncertain, which is almost never true and silently determines the ranking.
- **No probabilities, no weighting, no expected value** unless the user supplies the probabilities. Do not describe a scenario as 大概率 / 小概率.
- **Say which variables move together and why.** Independent worst cases stacked into one column overstate the stress; correlated variables moved separately double-count one shock.
- **Do not infer a joint scenario from separate marginal percentiles.** P10×P10 and P90×P90 require paired evidence or an explicit joint assumption; without it they are exploratory combinations only.
- **Unsupported endpoint combinations are not scenarios.** Do not label them 乐观/压力, put them in the scenario switch, or call the lower endpoint the worst case.
- **Qualify incomplete rankings.** When material variables are unquantified, rank only the quantified set and call the result provisional.
- **Do not infer causality from version deltas.** A draft-to-approved change is not a marginal cost, elasticity, or transmission coefficient without a one-driver-only bridge.
- A scenario that breaches a stated constraint is reported as infeasible, not published as a stress case.
- **Break-even points state what was held fixed** and whether they are reachable inside the variable's own range.
- Do not invent a parameter, a capacity, a contract term, or a historical range. A variable the file cannot support is `n.d.（未提供）`, named in the coverage block with what it would have changed.
- This skill sizes outcomes under stated assumptions. It does not recommend a price, a headcount, or a plan — the business owner and the CFO decide.
- Confidential, pre-release material. It stops for the controller and the CFO before it goes anywhere else.
