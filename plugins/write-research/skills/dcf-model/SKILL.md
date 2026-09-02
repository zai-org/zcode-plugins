---
name: dcf-model
description: Real DCF (Discounted Cash Flow) model creation for equity valuation. Retrieves financial data from SEC filings and analyst reports, builds comprehensive cash flow projections with proper WACC calculations, performs sensitivity analysis, and outputs professional Excel models with executive summaries. Use when users need to value a company using DCF methodology, request intrinsic value analysis, or ask for detailed financial modeling with growth projections and terminal value calculations.
---

# DCF Model Builder

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

## Overview

This skill creates institutional-quality DCF models for equity valuation following investment banking standards. Each analysis produces a detailed Excel model: an 假设 tab, three projected statements, the DCF build off them, WACC, and a Checks tab — with the sensitivity tables at the bottom of the DCF sheet.

## Tools

- Default to using all of the information provided by the user and MCP servers available for data sourcing.

## Critical Constraints - Read These First

These constraints apply throughout all DCF model building. Review before starting:

**Environment:**
- Build the workbook with Python/openpyxl following the `xlsx-author` skill conventions, then run the recalc script (`../xlsx-author/scripts/recalc.py`, relative to this skill's directory) before delivery.

**Formulas Over Hardcodes (NON-NEGOTIABLE):**
- Every projection, margin, discount factor, PV, and sensitivity cell MUST be a live Excel formula — never a value computed in Python and written as a number
- When using openpyxl: `ws["D20"] = "=D19*(1+$B$8)"` is correct; `ws["D20"] = calculated_revenue` is WRONG
- The only hardcoded numbers permitted are: (1) raw historical inputs **as retrieved** — a line item that came out of the filing or the data call, never one you derived from two of them, (2) assumption drivers (growth rates, WACC inputs, terminal g), (3) current market data (share price, debt balance)
- **`raw historical` covers what you fetched, not what you worked out from it.** 历史列的
  YoY 增长率, 折旧摊销合计, 毛利润 and every historical margin are formulas, exactly as
  their projected counterparts are. An observed DCF sheet shipped
  `YoY增长率 = 0.4203499024904436` and `折旧摊销 = 490.1799999999999` — Python arithmetic
  wearing this exemption. The full rules for a historical block, including what to do
  when the vendor publishes a ratio on a different 口径 than the one you would compute,
  belong to `3-statement-model`, which builds sheets 1–3 (Step 4.5). Follow them there
  rather than re-deriving them here.
- If you catch yourself computing something in Python and writing the result — STOP. The model must flex when the user changes an assumption.

**Show Your Work In Stages — But Do Not Stop To Ask Permission:**

Build end to end and deliver the workbook. As you go, surface each stage's
output in the running message so a reviewer can see how the number was reached:
the raw inputs block (revenue, margins, shares, net debt), then the projected top
line and growth rates, then the FCF schedule, then the WACC derivation and its
inputs, then the equity bridge (EV → equity value → per share), then the
sensitivity tables. That is the audit trail, and it is written *alongside* the
build rather than as a gate in front of it.

- **Do not hold the build waiting for an assumption to be confirmed.** Choose the
  assumption, note it, build with it. Every judged input — beta basis, ERP,
  terminal g, the debt items you included in net debt — goes into the assumptions
  block flagged `待确认` with the alternative you considered, so the reviewer can
  overturn it in one cell. Delivering a model with five flagged assumptions is
  reviewable; delivering a message with five questions and no model is not.
- The rebuild worry this used to guard against is already handled by the
  formulas-over-hardcodes rule above: if the model flexes, a wrong margin
  assumption costs one cell edit, not a downstream rebuild. Structure solves it;
  asking does not.
- **Ask only when the subject itself is missing** — the ticker resolves to
  several companies, the entity has no retrievable financials at all. A range you
  could reasonably pick is never a reason to stop (the human-review
  guardrail).
- Where retrieval left a genuine hole (no analyst coverage for the forecast year,
  a debt schedule that is not broken out), build the rest, write `n.d.` in the
  cell, and name the hole in the coverage block. One missing input blocks its own
  line, not the model.

**Sensitivity Tables:**
- **Use an ODD number of rows and columns** (standard: 5×5, sometimes 7×7) — this guarantees a true center cell
- **Center cell = base case.** Build the axis values so the middle row header and middle column header exactly equal the model's actual assumptions (e.g., if base WACC = 9.0%, the middle row is 9.0%; if terminal g = 3.0%, the middle column is 3.0%). The center cell's output must therefore equal the model's actual implied share price — this is the sanity check that the table is built correctly.
- **Highlight the center cell** with the medium-blue fill (`#BDD7EE`) + bold font so it's immediately visible which cell is the base case.
- Populate ALL cells (typically 3 tables × 25 cells = 75) with full DCF recalculation formulas — via the compact `SUMPRODUCT` engine in "Sensitivity Analysis", not a thousand-character formula copied 75 times
- Use openpyxl loops to write formulas programmatically
- NO placeholder text, NO linear approximations, NO manual steps required
- Each cell must recalculate full DCF for that assumption combination

**Cell Comments (this skill's citation vehicle — `cell_comments`):**
- Add cell comments AS each hardcoded value is created
- Format, on **every hardcoded input cell**, no exceptions:
  `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`
- Every blue input must have a comment before moving to next section
- **One comment per fact, and an assumption row is one fact.** A driver held flat
  across the projection — 收入增长率, 毛利率, CapEx/收入, 三项周转天数, 合同负债/收入 —
  is one judgement per scenario: one comment on the row, per scenario, is complete
  provenance. Do not copy it into 30 cells; three scenarios × ten years of identical
  notes is noise, not sourcing. Retrieved historical rows are the opposite case and
  follow `3-statement-model`. What is never acceptable either way is a hardcoded row
  with no comment anywhere on it.
- **A calculated cell carries a formula instead of a source comment** — the formula is its own provenance. If you find yourself writing a source comment on a calculated cell, a hardcode is hiding in it: replace it with a formula.
- Do not defer to end or write "TODO: add source"
- Never write an unexplained hardcode. A number you assumed rather than retrieved is `[测算]`, and it also gets an entry in the model's assumptions block. A number you cannot source is not written at all — if the cell must hold something, write `n.d.`

**Model Layout Planning:**
- Define ALL section row positions BEFORE writing any formulas
- Write ALL headers and labels first
- Write ALL section dividers and blank rows second
- THEN write formulas using the locked row positions
- Test formulas immediately after creation

**Formula Recalculation:**
- Run `python3 ../xlsx-author/scripts/recalc.py model.xlsx 30` (path relative to this skill's directory) before delivery
- The script recalculates a **temp copy** — your workbook is not overwritten, so the cell comments carrying your sources survive
- Exit codes are meaningful: `0` clean, `2` errors found, `3` recalc unavailable (LibreOffice missing — static lint only, **NOT a pass**), `1` hard failure
- Fix ALL errors until status is "success"
- Zero formula errors required (#REF!, #DIV/0!, #VALUE!, etc.)

**Scenario Blocks:**
- Create separate blocks for Bear/Base/Bull cases
- Show assumptions horizontally across projection years within each block
- **Resolve the selected case exactly once, in a consolidation column.** `=INDEX(B10:D10, 1, $B$6)` is the recommended form; a nested IF *at that same single consolidation cell* — `=IF($B$6=1,[Bear cell],IF($B$6=2,[Base cell],[Bull cell]))` — is equally acceptable and does the same job.
- What is **not** acceptable is repeating either pattern inside every projection row. The defect the `<correct_patterns>` section warns about is the conditional's *location*, not the IF function itself: one selector cell is auditable, fifty scattered copies are not.
- Verify the consolidation formulas reference the correct scenario block cells

## DCF Process Workflow

### Step 1: Data Retrieval and Validation

Fetch data from MCP servers, user provided data, and the web.

**Data Sources Priority:**
1. **MCP Servers** — name the tool, not just the server:
   - A shares: `hexin-stock.get_stock_financials` (三表 + 盈利/杠杆指标, 报告期口径).
     **Ask for several 报告期 in one call** — `<名称> 在2026-03-31和2025-12-31和2025-09-30的…`
     returns the quarters together, which is how Step 2's 单季 series is built; a
     query naming only `2024-12-31` gets you an annual-only model. Segment tables
     (主营业务构成 分行业/分产品/分地区) are asked for the same way at the latest annual or
     half-year 报告期; if they do not come back, fall through to the filing via
     `wind-docs.get_company_announcements` before concluding `源不可用`, `get_stock_shareholders` (diluted share count), `get_stock_summary` / `get_stock_performance` (price for the equity bridge), `get_risk_indicators` (**beta** — do not take beta from the web when this returns it, and read back which index and window it was computed against).
   - HK/US: `hexin-global-stock.global_stock_financial` (三表 + 估值 + 盈利预测), `global_stock_quotes` (price and beta/波动率).
   - US filings: `sec-search.sec_full_text_search` where the form type or filing date matters.
   - Cross-check only: `wind-stock.get_stock_fundamentals` on the headline lines that enter the model(只核对影响估值的那几行).
2. **User-Provided Data** - Historical financials from their research
3. **Web Search/Fetch** — only for what the MCP tools do not carry (a credit spread, a country risk premium, a peer's ADR structure). Price, beta, debt and cash all come from the tools above; pulling them from the web when a tool answers is how an undated number enters a model.

**Validation Checklist:**
- Verify net debt vs net cash (critical for valuation)
- Confirm diluted shares outstanding (check for recent buybacks/issuances)
- Validate historical margins are consistent with business model
- Cross-check revenue growth rates with industry benchmarks
- Verify the tax rate against **the issuer's own jurisdiction**: 有效税率 = 所得税费用 / 利润总额, read beside the statutory rate (PRC 25%, 高新技术企业 15%, US federal+state ~21-26%). `21-28%` is the US band and is not a test an A-share model must pass — a 15% 高新 effective rate is correct, not an error. What needs explaining is the *gap* and where it goes in the terminal year (Step 5's two-rate rule)

### Step 2: Historical Analysis — quarterly, and by segment

**Pull the 分季度 series, not just fiscal years.** Earnings arrive one quarter
at a time, so a model whose most recent input is last year's annual report is up
to four quarters stale on the day it is built. `get_stock_financials` takes
several 报告期 in one call — `<名称> 在2026-03-31和2025-12-31和2025-09-30和2025-06-30的
营业收入、归母净利润、扣非归母、毛利率` returns them together. Take **最近 8 个季度** where they exist, and derive:

- the latest **单季 run-rate** (annualised, and the trailing four quarters) — this,
  not the last completed fiscal year, is where the forecast starts;
- **seasonality**: each quarter's share of its fiscal year, so a Q1-anchored
  forecast is not silently extrapolating a seasonal peak or trough;
- whether margins are trending **within** the year or only between years.

A 单季 figure is often not disclosed directly — it is the cumulative period minus
the prior cumulative one. State that it is `[测算]` and show the subtraction; a
cumulative number presented as a single quarter is a real and common error.

**Then split revenue by segment.** A blended growth rate on a multi-segment
company models a company that does not exist: BYD's 汽车及相关产品, 手机部件及组装 and
二次充电电池及光伏 carry different growth and different margins, and one number for
all three hides both. Two retrieval routes, **in this order, and only these two**:

1. `hexin-stock.get_stock_financials` for 主营业务构成 — 分行业 / 分产品 / 分地区 营业收入、
   营业成本、毛利率 at the latest 报告期 (segment tables are disclosed annually and at
   half-year, rarely quarterly).
2. The 年报 / 半年报 itself via `wind-docs.get_company_announcements` — the 主营业务分行业 table is
   a standard section, and reading it out of the filing is `[披露]` citable.

**A web search is not a segment source.** It returns a news summary or a broker
PDF abstract, which carries the segment *names* and none of the 收入/成本/毛利率 the
build needs — and a segment table assembled from an abstract is not `[披露]`. Run
both routes above before concluding anything; if the first returns nothing, the
filing route is not optional.

If **both** routes come back empty, the split is `源不可用`, and three things
follow, all of them required:

- model on the consolidated line, and say so in the delivery message;
- record `源不可用` in the coverage block **with what it changes** — usually the
  margin path, because mix shift is invisible without it, and the terminal margin
  is then an assumption with no structural support;
- put the segment *names and revenue shares* in the assumptions block if a filing
  gave you those even without the margins, flagged `待确认` — a 98%-of-revenue
  single product line and three roughly equal segments call for different amounts
  of caution, and the reader cannot tell which they have otherwise.

Never assemble a split from an impression of the business, and never let silence
stand in for the coverage entry — a consolidated model that does not say it is
consolidated reads as a segment model that found no differences.

Whatever you get, **勾稽 it**: the segments must sum to the reported
营业总收入, and a residual belongs in an explicit 其他/未分配 row rather than being
spread silently.

Analyze and document, per segment where the split exists and consolidated otherwise:
- **Revenue growth trends**: CAGR and the quarterly path, identify drivers
- **Margin progression**: gross margin, EBIT margin, FCF margin
- **Capital intensity**: D&A and CapEx as % of revenue
- **Working capital efficiency**: 应收/存货/应付 turnover days (see Step 3.5), not
  only NWC as % of revenue growth
- **Return metrics**: ROIC, ROE trends

Create summary tables showing:
```
Historical Metrics:
              FY2022A  FY2023A  FY2024A   25Q3   25Q4   26Q1   TTM
Revenue         X        X        X        X      X      X      X
  YoY           —        X%       X%       X%     X%     X%     X%
Gross margin    X%       X%       X%       X%     X%     X%     X%
EBIT margin     X%       X%       X%       X%     X%     X%     X%
D&A % rev       X%       X%       X%                            X%
CapEx % rev     X%       X%       X%                            X%

Segment (FY2024A):        营业收入    占比    毛利率   YoY
  汽车及相关产品              X        X%      X%      X%
  手机部件及组装              X        X%      X%      X%
  二次充电电池及光伏           X        X%      X%      X%
  其他/未分配                X        X%      —       —
  合计（勾稽 = 营业总收入）      X       100%
```

### Step 3: Build Revenue Projections — segment by segment

**Methodology:**
1. Start from the **latest quarterly run-rate** established in Step 2, not the
   last completed fiscal year. State which quarter anchors the forecast.
2. Project **each segment separately**, then sum to total revenue. The total is a
   formula over the segments, never an independently typed number.
3. Show both amounts AND calculated growth %, per segment and in total.

**Per-segment driver framework.** Pick the pair the business is actually run on
and say which you chose:

| 业务形态 | 驱动对 |
|---|---|
| 制造/整车/消费品 | 销量 × 单价（ASP） |
| 服务/订阅 | 客户数 × ARPU |
| 项目制/工程 | 在手订单 × 转化率 × 周期 |
| 无量价可得 | 增速直接假设 — 标注为最弱的一档假设 |

Where volume and price are separable, model them separately: a 15% revenue
decline made of −5% 销量 and −10% 价格 has a different margin consequence than the
same decline made of −15% 销量 alone, and a blended growth rate cannot express it.

**Growth Rate Framework** (applied per segment, not to the consolidated line):
- Year 1-2: near-term visibility — anchored to the quarterly run-rate and 在手订单
- Year 3-4: gradual moderation toward that segment's industry average
- Year 5+: approaching terminal growth

**Formula structure:**
- Segment revenue(Year N) = Segment revenue(Year N-1) × (1 + Segment growth)
- Total revenue(Year N) = SUM(segment rows) — a formula, never a typed total
- Growth %(Year N) = Total(Year N) / Total(Year N-1) - 1
- Mix% (Year N) = Segment(Year N) / Total(Year N) — show it; mix shift is half the
  margin story and it is invisible unless displayed

**Three-scenario approach:** scenarios differ **per segment**, because a downturn
does not hit every segment equally. A single revenue growth rate switched across
three cases is the pattern this step exists to replace.
```
Bear Case: Conservative growth (e.g., 8-12%)
Base Case: Most likely scenario (e.g., 12-16%)
Bull Case: Optimistic growth (e.g., 16-20%)
```

### Step 4: Operating Expense Modeling

**Fixed/Variable Cost Analysis:**

Operating expenses should model realistic operating leverage:
- **Sales & Marketing**: Typically 15-40% of revenue depending on business model
- **Research & Development**: Typically 10-30% for technology companies
- **General & Administrative**: Typically 8-15% of revenue, shows leverage as company scales

**Key principles:**
- ALL percentages based on REVENUE, not gross profit
- Model operating leverage: % should decline as revenue scales
- Maintain separate line items for S&M, R&D, G&A
- Calculate EBIT = Gross Profit - Total OpEx

**Margin expansion framework:**
```
Current State → Target State (Year 5)
Gross Margin: X% → Y% (justify based on scale, efficiency)
EBIT Margin: X% → Y% (result of revenue growth + opex leverage)
```

### Step 4.5: Tie the forecast through the three statements

**This step's output is three projected statements plus a Checks tab, in the same
workbook.** Build them by **loading the `3-statement-model` skill** — with the Skill
tool, actually loading it, not working from what you already know about three-statement
models. It owns the mechanic (template structure, the IS→BS→CF wiring, the balance and
cash tie-outs, the credit-metric hierarchy, and the rules governing the historical
block), so this step does not restate it and instead specifies the drivers the DCF
additionally needs. Skipping the step is not an option the delivery allows: a DCF
workbook with only a DCF tab and a WACC tab has not been through it.

**Reading this paragraph is not loading the skill, and the difference is visible in
the output.** Two runs of the same request, same version of this file, differed only
in whether `3-statement-model` was loaded: the one that loaded it delivered 870
formulas, 381 sourced inputs and no unprovenanced rows; the one that built the three
statements from general knowledge delivered 664 formulas, 47 sourced inputs, 22 rows
with no provenance at all, and four historical cells holding Python arithmetic. Every
rule that prevented the second outcome lives in that file and reaches you only when
it is loaded. So: load it, and **name it in the running message** when you do — one
clause, so the trace shows which of the two runs this is.

Why it is not optional: a DCF built only on ratios is unfalsifiable. `CapEx = 6%
of revenue` and `ΔNWC = 1% of Δrevenue` can be tuned to any answer and nothing in
the workbook objects. Running the same forecast through an income statement, a
balance sheet and a cash-flow statement makes the assumptions argue with each
other — an implausible receivable path shows up as a balance sheet that will not
balance, and that is the point.

**一个工作簿只有一个情景开关。** `3-statement-model` 的情景术语是 Base / Upside / Downside，本技能
是 Bear / Base / Bull —— 同样的三档，两套叫法，不是两组情景。在同一个工作簿里以**本技能的术语和
那一个选择格为准**（DCF 页 B6，本文所有 INDEX 示例指向的就是它），三表以跨表链接读同一个格子，
不再自建 dropdown；那边的情景层级校验（Upside > Base > Downside）按 Bull > Base > Bear 读。两个开关
的工作簿会出现利润表停在基准、DCF 停在乐观的静默错配，而两张表各自都自洽，所以没有任何检查会报错。

What the DCF needs from those statements, and what to feed back into Step 5:

| DCF 行 | 由三表哪里来 | 驱动 |
|---|---|---|
| EBIT | 利润表 | Step 3 的分部收入 × 分部毛利率 − 费用 |
| D&A | 现金流量表附注 / 固定资产滚动 | 期初固定资产 + CapEx − 折旧，而不是 收入×比率 |
| CapEx | 现金流量表投资活动 | 产能规划或 固定资产/收入 的目标水平 |
| Δ营运资金 | 资产负债表 | **周转天数**：应收账款周转天数、存货周转天数、应付账款周转天数 |
| 净债务（股权桥用） | 资产负债表 | 有息负债 − 货币资金，取最新报告期 |

**营运资金用周转天数驱动，而不是「占收入变动的百分比」。** 天数是业务语言，能和披露值对照，也能被质疑：
```
应收账款 = 营业收入 × 应收账款周转天数 / 365
存货     = 营业成本 × 存货周转天数 / 365
应付账款 = 营业成本 × 应付账款周转天数 / 365
营运资金 = 应收 + 存货 − 应付
Δ营运资金 = 本期营运资金 − 上期营运资金        ← 这才是 FCF 里那一行
```
历史三年的实际天数先算出来（`[测算]`，用披露的余额和收入/成本），预测期的天数是**明示假设**并落在假设块里。一个把应收天数从 60 天压到 40 天的预测，是在假设账期谈判成功，这话应该被写出来而不是藏在一个 1% 的比率里。

**Checks 页（勾稽校验）是这一步的交付要求**（`xlsx-author` 的 Class A 约定）。分两类，**写清楚
每一行是哪一类**，因为它们能捕到的东西不同（`3-statement-model` Step 5 的反同义反复规则）：

**A 类 · 恒等式与断链探测**（两边形式上必然相等，但模型搭错时会真的读 FALSE，或链接被覆盖后会
读 FALSE）——阻断项：
- 资产 = 负债 + 所有者权益，逐期
- 现金流量表期末现金 = 资产负债表货币资金，逐期
- 未分配利润滚动：期初 + 净利润 − 分红 = 期末，逐期
- 利润表净利润 = 现金流量表 CFO 起点净利润，逐期（这一行抓的是**链断了或被手工数覆盖**，不是算错）

**B 类 · 两条独立路径**（一边来自模型链条，一边来自披露值或另一张表）——阻断项：
- **历史期**分部收入合计 = 披露的营业总收入（预测期的合计是 SUM 公式，两边同源，不构成校验）
- **历史期**固定资产滚动：期初固定资产 + CapEx − 折旧 = **披露的期末固定资产**（这才是 D&A 与
  CapEx 的真校验；拿 DCF 里那两行去对三表是链接对自己，永远为真）
- 历史期口径对账：披露毛利率/净利率 − 由披露绝对值算出的同名比率 = 你命名的口径楔

**C 类 · 提示项**，FALSE 时在批注里写出原因，但不阻断交付：
- 毛利率 > 营业利润率 > 净利率，逐期 —— **A 股经常不成立，而且完全正常**：其他收益、政府补助、
  投资收益、公允价值变动、递延所得税变动都能让净利率高于营业利润率。把它当阻断项会枪杀正确的
  模型；它的价值在于逼你说出那部分利润来自哪里，以及它在预测期是否可持续。
- 预测期三项周转天数落在历史区间 ±30% 内 —— 越界不是错，是一个必须在假设块里写明理由的假设
  （把应收从 60 天压到 40 天就是在假设账期谈判成功）。

### Step 5: Free Cash Flow Calculation

**Build FCF in proper sequence:**

```
EBIT                              ← 利润表 (Step 4.5)
(-) Taxes (EBIT × 有效税率本年)      ← 法定税率 in the terminal year
= NOPAT (Net Operating Profit After Tax)
(+) D&A                           ← 固定资产滚动表 (期初 + CapEx − 折旧), 不是 收入×比率
(-) CapEx                         ← 资本开支计划 / 固定资产滚动表 (历史区间通常 收入的 4-8%, 作参照不作驱动)
(-) Δ NWC                         ← 资产负债表上由 应收/存货/应付周转天数 得到的营运资金余额之差
= Unlevered Free Cash Flow
```

**Which tax rate — the model needs two, not one.** `Tax Rate` above is unspecified,
and an observed run silently applied a flat 15% for ten years plus the terminal
value. State both, as separate assumption rows:

- **Near-term: 有效税率**, computed from the historical block as
  `所得税费用 / 利润总额` over the last 2-3 years, `[测算]`, with the reason for any
  gap from statutory named (高新技术企业 15%, 西部大开发, 研发费用加计扣除, 递延所得税
  变动, 以前年度亏损弥补).
- **Terminal: 法定税率** (25% for a standard PRC issuer), because a preferential
  rate is a qualification that is re-certified periodically, not a perpetuity. Show
  the convergence path — hold the effective rate through the explicit forecast and
  step to statutory in the terminal year, or ramp it; either way it is visible.

A model that discounts a perpetuity at a preferential rate is claiming a tax status
in year 30 that the company has not been granted for year 4.

**Working Capital Modeling:**
- Driven by turnover days per Step 4.5 — 应收/存货/应付 天数, then Δ of the
  resulting balance.
- **The `% of Δrevenue` shorthand is not a choice.** It applies only when the
  三项余额 (应收账款/存货/应付账款) **could not be retrieved** — recorded as `源不可用` in
  the coverage block, naming the query that failed. If you computed the turnover
  days, you have the balance sheet detail and the days are what the model uses;
  "为了工作簿干净" and "for a 10-year DCF this is pragmatic" are not the stated
  condition, and labelling the shortcut does not license it. A run that derived
  AR/Inv/AP days and then modelled ΔNWC as a percentage of Δrevenue has taken the
  fallback without meeting its condition.
- Typical range (fallback only): -2% to +2% of revenue change
- Negative number = source of cash (working capital release)
- Positive number = use of cash (working capital build)

**Maintenance vs Growth CapEx:**
- Maintenance CapEx: Sustains current operations (~2-3% revenue)
- Growth CapEx: Supports expansion (additional 2-5% revenue)
- Total CapEx should align with company's growth strategy
- Both feed the 固定资产 roll-forward in Step 4.5, so D&A follows from CapEx
  rather than being an independent ratio

### Step 6: Cost of Capital (WACC) Research

**CAPM Methodology for Cost of Equity:**

```
Cost of Equity = Risk-Free Rate + Beta × Equity Risk Premium
```

Each of the three inputs is a decision with a stated basis, not a lookup. The user
who asks 「beta 从哪来、无风险利率取哪个、风险溢价怎么定」 is asking for exactly this,
and it is the part a reviewer overturns.

**Risk-free rate.** The 10-year sovereign yield in the model's currency — for a CNY
model, 10年期国债到期收益率 via `wind-economic.query_economic_indicator_data`, dated. **When Rf sits at a
historical extreme, saying so is not the same as handling it.** An observed run wrote
「10Y国债1.70%处历史低位，WACC偏低」 into the workbook and then discounted at that rate
anyway, which leaves the reader holding a valuation the model itself doubts. Take one
of two routes and name it: use the spot rate and make **Rf an axis of the sensitivity
table** with a stated plausible range, or use a normalized Rf (e.g. the 5-year or
10-year average, or 长期通胀 + 实际利率) with the spot rate shown beside it and the
gap quantified in per-share terms. Either is defensible; discounting at a rate you
have called wrong is not.

**Beta.** Two methods, and which one you use follows the company:
- **Retrieved or own regression** — `hexin-stock.get_risk_indicators` returns BETA on a
  **默认最近 24 个月** window, not 5 years. Two honest options: take it and label it
  `24 个月，[index]`, noting that a 2-year beta is noisier and cycle-dependent; or run
  your own 5-year monthly regression off the retrieved price series and label it
  `[测算]` with its start date. What is not allowed is carrying the 24-month figure
  under a "5Y monthly" label — a beta whose window is misstated cannot be reproduced.
  Either way the index is part of the number: 沪深300 and 中证全指 do not give the same
  beta, so state the index, the window, and whether the figure is raw or Blume-adjusted
  (`0.67 × β + 0.33`).
- **Comparable-company unlevered beta, relevered** — the right method when the
  company's own history is short, its listing thin, or its business mix has changed
  (a segment-diverse issuer is not the company its 5-year beta describes).
  `β_unlevered = β_equity / (1 + (1−t)·D/E)` per comp, take the median, then
  relever at **the same capital structure the weights below use** — current
  market-value D/E by default, or a stated target structure *only if the weights use
  that same target*. Relevering at a target while weighting at today's market values
  makes Ke and WACC describe two different companies.
  A multi-segment company can also carry a segment-weighted beta — say so if you do.

Whichever you use, the other one is worth a sentence: two betas a long way apart is
information about the business, not noise.

**Equity risk premium.** `5.0-6.0%` is the US market convention and does not
transfer. For an A-share model, derive it or cite it — never both silently:
- **Derived (`[测算]`)**: 指数股息率 + 长期名义增长 − Rf, or the index's implied ERP
  from a dividend-discount inversion. Show the inputs.
- **Cited (`[披露]`/`[推断]`)**: a named published estimate with its date and market
  scope. A vendor's figure is `[测算]` with the vendor's 口径 named — it is their
  calculation, not a disclosure.

Either way the number carries a source comment and a `[标签]`. `5.14%` appearing with
no derivation and no citation is an unexplained hardcode wherever it came from.

**Cost of Debt Calculation:**

```
After-Tax Cost of Debt = Pre-Tax Cost of Debt × (1 - Tax Rate)

Determine Pre-Tax Cost of Debt from:
- Credit rating (if available)
- Current yield on company bonds
- Interest expense / Total Debt from financials
```

**Capital Structure Weights:**

```
Market Value Equity = Current Stock Price × Shares Outstanding
Total Debt = 有息债务 (短期借款 + 一年内到期非流动负债 + 长期借款 + 应付债券 + 租赁负债)

Equity Weight = E / (D + E)          ← D is GROSS interest-bearing debt
Debt Weight   = D / (D + E)

WACC = (Cost of Equity × Equity Weight) + (After-Tax Cost of Debt × Debt Weight)
```

**Gross debt is the default, and the alternative has a condition.** Weighting by
**net** debt (`净债务 / EV`) is a recognized practitioner convention — it treats cash
as a non-operating asset financing nothing — but it is a different framework, not a
simplification, and using it obliges you to say so in the WACC sheet. For a
cash-heavy issuer the two are far apart: 比亚迪's 带息债务 1295.37 against 货币资金
754.25 makes the debt weight's numerator either 1295 or 541, a factor of 2.4. Pick
one, label it, and keep Step 9's bridge consistent with the choice.

**The weights and the beta relevering use the same structure.** Whichever basis you
pick — current market values or a stated target — it is the basis for both. This is
the single most common way a WACC sheet ends up internally inconsistent.

**A negative debt weight is not a result, it is a broken formula.** If cash exceeds
debt and you are weighting by net debt, the expression produces a negative weight on
a positive cost of debt, which values borrowing as if it paid you. Switch to gross
debt (where the weight is always in [0,1]) and let the net cash do its work in the
equity bridge, which is where it belongs. If the company genuinely has no debt,
`WACC = Cost of Equity` — that is the whole adjustment.

**Special Cases:**
- **No Debt**: WACC = Cost of Equity

**Typical WACC Ranges:**
- Large Cap, Stable: 7-9%
- Growth Companies: 9-12%
- High Growth/Risk: 12-15%

### Step 7: Discount Rate Application (5-10 Year Forecast)

**Mid-Year Convention:**
- Cash flows assumed to occur mid-year
- Discount Period: 0.5, 1.5, 2.5, 3.5, 4.5, etc.
- Discount Factor = 1 / (1 + WACC)^Period

**Present Value Calculation:**
```
For each projection year:
PV of FCF = Unlevered FCF × Discount Factor

Example (Year 1):
FCF = $1,000
WACC = 10%
Period = 0.5
Discount Factor = 1 / (1.10)^0.5 = 0.9535
PV = $1,000 × 0.9535 = $954
```

**Projection Period Selection:**
- **5 years**: Standard for most analyses
- **7-10 years**: High growth companies with longer runway
- **3 years**: Mature, stable businesses

### Step 8: Terminal Value Calculation

**Perpetuity Growth Method (Preferred):**

```
Terminal FCF = Final Year FCF × (1 + Terminal Growth Rate)
Terminal Value = Terminal FCF / (WACC - Terminal Growth Rate)

Critical Constraint: Terminal Growth < WACC (otherwise infinite value)
```

**Terminal Growth Rate Selection:**
- Conservative: 2.0-2.5% (GDP growth rate)
- Moderate: 2.5-3.5%
- Aggressive: 3.5-5.0% (only for market leaders)

**Do not exceed**: Risk-free rate or long-term GDP growth

**But the band is where you start, not where you stop — g has to be paid for.**
Perpetual growth requires perpetual reinvestment, and the model already contains
the arithmetic that prices it:

```
g = ROIC(terminal) × 再投资率(terminal)
再投资率 = (CapEx − D&A + ΔNWC) / NOPAT
```

Write both cells on the DCF sheet as formulas off the terminal-year rows, and put
the implied figure next to the g you chose. A terminal year where CapEx ≈ D&A and
ΔNWC ≈ 0 has zero net reinvestment, so it supports **g = 0** — pairing it with 3%
is not conservative or aggressive, it is arithmetically impossible, and it is the
single most common reason a DCF is dismissed on sight. If the implied g and your
chosen g disagree, change one of them and say which: either raise terminal CapEx
to fund the growth, or lower g to what the reinvestment buys. Never leave both
numbers in the workbook without reconciling them.

**Normalize the terminal year before you grow it.** `Final Year FCF × (1 + g)`
inherits whatever happened to be true in year 10. A terminal year is a *steady
state* by definition, so before it becomes the base of a perpetuity:

- **CapEx converges to D&A** plus the increment the reinvestment rate above
  requires. A capex-peak year 10 perpetuated is a permanent capital programme
  nobody assumed.
- **ΔNWC scales with g**, not with the year-10 revenue jump.
- **The tax rate is the statutory rate**, not a near-term preferential one — see
  Step 5. A 15% 高新技术企业 rate is a qualification that is re-certified, not a
  perpetuity.
- Margins sit at the mid-cycle level, not the last forecast year's peak or trough.

State each normalization as its own line in the assumptions block with the
unnormalized value beside it, so a reviewer sees what was adjusted and by how much.

**Exit Multiple Method — a cross-check, not an alternative.** Compute both and
reconcile them; do not pick one:

```
Terminal Value = Final Year EBITDA × Exit Multiple      (8-15x typical, from comps
                                                         or precedent transactions)
隐含退出倍数 = TV(永续法) / 终值年 EBITDA                 ← always compute this
倍数法隐含g  = WACC − 终值年FCF×(1+g) / TV(倍数法)         ← if you led with a multiple
可支持的g   = ROIC(终值) × 再投资率(终值)                  ← the reinvestment constraint above
```

**Three different quantities, three labels — do not merge them into one row called
「隐含永续增长率」.** 可支持的g is what your own terminal reinvestment pays for and it
*constrains* the g you type; 倍数法隐含g is what the market's exit multiple implies and
it is a *cross-check*. A workbook with one ambiguous row cannot tell a reviewer which
of the two it failed.

**The implied exit multiple is a required output**, on the DCF sheet as a formula,
next to the comps range it is being judged against. It is the only thing that makes
a terminal growth rate legible: 3.0% is an abstraction, `隐含 11.4x EV/EBITDA vs 同业
7-9x` is a finding. Where the implied multiple sits outside the comparable range,
say so and say which input you are standing behind — the perpetuity assumption or
the market's multiple. Two methods that disagree by a factor is a result, not an
error to average away.

**Present Value of Terminal Value — and the convention has to be declared.**
```
PV of Terminal Value = Terminal Value / (1 + WACC)^Final Period
```

Gordon 增长法算出的 TV 是**第 n 年末**的价值，与年中折现的显性期现金流不在同一时点，所以 Final Period
不是一个可以随手填的数。两种约定都在实务中使用，差异也不小 —— 9% WACC 下半年折现约 4.3%，而终值常占
EV 六成以上：

- **末年末口径**（与 Gordon 公式自洽，推荐）：Period = n（5 年模型 5.0，10 年模型 10.0）
- **全程年中口径**（视永续现金流同为年中分布）：Period = n − 0.5（5 年模型 4.5）

在 DCF 页写一行 `终值折现期约定: [末年末 n / 年中 n−0.5]`，并让敏感性表用同一约定。一个没有写出约定的
4.5 是一个没人能复核的 4% 差异。

**Terminal Value Sanity Check** — one band, used identically in the final checklist:
- **50-75% of Enterprise Value** is the normal range
- **>75%**: over-reliant on terminal assumptions — say what would have to be true, or lengthen the explicit forecast
- **<40%**: check whether the terminal assumptions are too conservative

### Step 9: Enterprise to Equity Value Bridge

**Valuation Summary Structure:**

```
(+) Sum of PV of Projected FCFs = $X million
(+) PV of Terminal Value = $Y million
= Enterprise Value = $Z million

(-) Net Debt [or + Net Cash if negative] = $A million
= Equity Value = $B million

÷ Diluted Shares Outstanding = C million shares
= Implied Price per Share = $XX.XX

Current Stock Price = $YY.YY
Implied Return = (Implied Price / Current Price) - 1 = XX%
```

**Critical Adjustments:**
- **Net Debt = Total Debt - Cash & Equivalents**
  - If positive: Subtract from EV (reduces equity value)
  - If negative (Net Cash): Add to EV (increases equity value)
- **少数股东权益 is deducted whenever the model is consolidated, and that is not an
  "if applicable".** The FCF you discounted was generated by the consolidated
  entity, so part of the resulting value belongs to other shareholders and must come
  out before you divide by *your* share count. For 比亚迪 the wedge was ~11 亿/年 of
  net profit — around 3% of 归母, which is larger than most of the assumptions this
  model agonizes over. Deduct it at the more defensible of: 少数股东权益账面价值
  (default, `[披露]`), or 少数股东损益 capitalized at the same multiple the DCF
  implies for the whole (`[测算]`, when minorities sit in a business whose economics
  differ from the parent's). Write the choice and its basis in the bridge. A bridge
  with no 少数股东 line is asserting the group has none — check the balance sheet
  before making that claim, and if it is genuinely zero, say `无少数股东权益[披露]`
  rather than leaving the line out.
- **A-share bridge items that are routine, not exotic** — walk this list explicitly
  and mark each 有/无/`源不可用`, because silently omitting one reads identically to
  it being zero: 少数股东权益, 长期股权投资/对联营合营企业投资 (equity-method holdings
  produce no FCF in the model, so their value is added separately), 永续债与其他权益
  工具 (equity in accounting, debt-like in economics — state which side you put them
  on), 受限资金 (not available to shareholders, so not part of the cash you net),
  其他非经营性资产 (投资性房地产, 交易性金融资产).
- **Use Diluted Shares — each dilutive instrument has a *method*, not just a share count.**
  **回购库存股 must be deducted**, since treasury shares are not outstanding — the one
  that is routinely missed. Take 总股本 from the latest disclosure and reconcile it to
  the diluted count line by line; a share count off by the treasury block moves the
  per-share answer by exactly that percentage. For the two instruments that *add*
  shares, the method matters more than the number:
  - **可转债 — if-converted, both legs or neither.** Adding the conversion shares while
    the same bond still sits inside 净债务 (应付债券) charges the equity twice for one
    instrument. Either add the shares **and** remove that bond's principal from net
    debt, or keep it in net debt and add no shares. Convert only what is in the money,
    and state which leg pair you used.
  - **股权激励 / 期权 / 认股权证 — 库存股法 (treasury-stock method).** Net new shares
    = 潜在股数 − 行权价款 / 现价, not the gross unexercised count; out-of-the-money
    grants add nothing. Adding gross potential shares overstates dilution and is the
    mirror image of forgetting them.
  (`options, RSUs` are the US framing of the same idea and apply to overseas listings.)
- **Other adjustments** (if applicable):
  - Pension liabilities
  - Operating lease obligations

**Then check the answer against something outside the model.** A DCF that ends at
`Implied Upside` has not been tested — it has only been computed. Three comparisons,
all as formulas on the DCF sheet:

- **隐含 PE 与 EV/EBITDA**, on the target price, against the company's own historical
  band and against the peer set. A target price implying a multiple the stock has
  never traded at needs a reason stated in words.
- **The implied exit multiple** from Step 8, against comps — already required there.
- **数据商一致预期**, where retrievable: your forecast revenue and margin for the next
  two years beside consensus. This means the **data vendor's aggregated** consensus
  (Wind / 同花顺 一致预期, LSEG), not a named peer 券商's own forecast — the aggregate
  is the market's expectation and is citable; an individual competitor's numbers are
  not an input to our model. Being above or below is fine and is the interesting
  part; being unaware of it is not. Not retrievable → `检索范围内未发现`.

Where the DCF is one input to a report, `research-report` owns the 估值桥接 across
methods; the checks above are what a standalone DCF deliverable owes on its own.

**Valuation Output Format:**
```csv
Valuation Component,Amount ($M)
PV Explicit FCFs,X.X
PV Terminal Value,Y.Y
Enterprise Value,Z.Z
(-) Net Debt,A.A
Equity Value,B.B
,,
Shares Outstanding (M),C.C
Implied Price per Share,$XX.XX
Current Share Price,$YY.YY
Implied Upside/(Downside),+XX%
```

### Step 10: Sensitivity Analysis

**Scenarios and sensitivities answer different questions, and mixing them prices the
same change twice.** Fix the division of labour before building either:

- **Scenarios (Bear/Base/Bull) move the operating drivers** — 分部收入增速, 毛利率,
  费用率, CapEx 强度. These are views about the business, and they are internally
  coherent: a bear case lowers volume *and* price *and* utilization together.
- **Sensitivity tables move the valuation parameters** — WACC and terminal growth,
  around the **base** case. These are not views; they are the reader's own dial.

So the bear case does **not** also carry a lower terminal g. If it did, the g column
of the sensitivity table and the bear scenario would be reporting the same downside
twice, and a reader comparing them would double-count it. Terminal g belongs to the
company's steady state, not to a three-year operating view — and per Step 8 it is
constrained by reinvestment, so moving it by hand in a scenario breaks that tie-out.
Where a scenario genuinely implies a different steady state, change the terminal-year
**reinvestment** and let g follow from the formula, and say that is what you did.

Build **three sensitivity tables** at the bottom of the DCF sheet showing how valuation changes with different assumptions:

1. **WACC vs Terminal Growth** - Shows enterprise value sensitivity to discount rate and perpetuity growth
2. **Revenue Growth vs EBIT Margin** - Shows impact of top-line growth and operating leverage
3. **Beta vs Risk-Free Rate** - Shows sensitivity to cost of equity components; this is
   also where a spot Rf at a historical extreme gets its range (Step 6)

**Implementation**: These are simple 2D grids (NOT Excel's "Data Table" feature) with formulas in each cell. Each cell must contain a full DCF recalculation for that specific assumption combination. See Critical Constraints section for detailed requirements on populating all 75 cells programmatically using openpyxl.

<correct_patterns>

This section contains all the CORRECT patterns to follow when building DCF models.

### Scenario Block Selection Pattern - Follow This Approach

**Assumptions are organized in separate blocks for each scenario:**

**CRITICAL STRUCTURE - Three rows per section header:**

```csv
BEAR CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),12%,10%,9%,8%,7%
EBIT Margin (%),45%,44%,43%,42%,41%

BASE CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),16%,14%,12%,10%,9%
EBIT Margin (%),48%,49%,50%,51%,52%

BULL CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),20%,18%,15%,13%,11%
EBIT Margin (%),50%,51%,52%,53%,54%
```

**Each scenario block MUST have a column header row** showing the projection years (FY2025E, FY2026E, etc.) immediately below the section title. Without this, users cannot tell which assumption value corresponds to which year.

**How to reference assumptions - Create a consolidation column:**
1. Case selector cell (e.g., B6) contains 1=Bear, 2=Base, or 3=Bull
2. Create a consolidation column with INDEX or OFFSET formulas to pull from the correct scenario block
3. Projection formulas reference the consolidation column (clean cell references)
4. Each scenario block contains full set of DCF assumptions across projection years

**Recommended consolidation column pattern (using INDEX):**
`=INDEX(B10:D10, 1, $B$6)`

A nested IF **in that same single consolidation cell** —
`=IF($B$6=1,[Bear block cell],IF($B$6=2,[Base block cell],[Bull block cell]))` — is
equally acceptable. It resolves the case once, in one auditable place, exactly as
the INDEX does.

**NOT this — the same conditional pasted into every projection row:**
`Revenue: =E29*(1+IF($B$6=1,$B$10,IF($B$6=2,$C$10,$D$10)))`, repeated down the
whole projection block.

The IF function is not the defect; the *scattering* is. One selector cell can be
read in a second; fifty embedded copies mean a reviewer must open every row to
learn which scenario it reads, and a scenario block that moves breaks all fifty.
The consolidation column approach centralizes logic and makes the model easier to audit.

### Correct Revenue Projection Pattern

**Create a consolidation column with INDEX formulas, then reference it in projections:**

**Step 1 - Consolidation column for FY1 growth:**
`=INDEX([Bear FY1 growth]:[Bull FY1 growth], 1, $B$6)`

**Step 2 - Revenue projection references the consolidation column:**
`Revenue Year 1: =D29*(1+$E$10)`

Where:
- D29 = Prior year revenue
- $E$10 = Consolidation column cell for FY1 growth (contains INDEX formula)
- $B$6 = Case selector (1=Bear, 2=Base, 3=Bull)

**This approach is cleaner than embedding a conditional in every projection formula** and makes it much easier to audit which scenario assumptions are being used. (The conditional itself is fine where it belongs — in the single consolidation cell.)

### Correct FCF Formula Pattern

**Use consolidation columns with INDEX formulas, then reference them in FCF calculations:**

**Consolidation column approach:**
```csv
Item,Formula,Reference
D&A,=E29*$E$21,$E$21 = consolidation column for D&A %
CapEx,=E29*$E$22,$E$22 = consolidation column for CapEx %
Δ NWC,=(E29-D29)*$E$23,$E$23 = consolidation column for NWC %
Unlevered FCF,=E57+E58-E60-E62,E57=NOPAT E58=D&A E60=CapEx E62=Δ NWC
```

**Each consolidation column cell contains an INDEX formula** that pulls from the appropriate scenario block based on case selector. This keeps projection formulas clean and auditable.

Before writing formulas, confirm scenario block row locations and set up consolidation columns.

### Correct Cell Comment Format

**Every hardcoded value needs this format:**

`Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`

**Examples:**
```csv
Item,Source Comment
Stock price,"Source: 同花顺 iFinD 行情数据, Retrieved 2025-10-12, 最新成交价"
Shares outstanding,"Source: 10-K FY2024, 2025-02-01, p.45 Note 12, https://…"
Historical revenue,"Source: 10-K FY2024, 2025-02-01, p.32 Consolidated Statements of Operations, https://…"
Beta,"Source: 同花顺 iFinD 风险指标, Retrieved 2025-10-12, BETA(24 个月)"
Consensus estimates,"Source: Q3 2024 earnings call, 2024-10-31, management guidance, https://…"
```

**A calculated cell gets no source comment** — it carries a formula, and the
formula is the provenance. A source comment sitting on a calculated cell is the
signature of a hardcode in disguise; find it and replace it with the formula.

**Assumptions are not exempt.** An input you judged rather than retrieved is
labelled `[测算]` in its comment and also appears in the model's assumptions
block with its rationale — never an unexplained hardcode. An input you cannot
source at all does not get written: if the cell must hold something, write `n.d.`

### Correct Assumption Table Structure

**CRITICAL: Each scenario block requires THREE structural elements:**

1. **Section header row** (merged cells): e.g., "BEAR CASE ASSUMPTIONS"
2. **Column header row** showing years - THIS IS REQUIRED, DO NOT SKIP
3. **Data rows** with assumption values

**Structure:**
```csv
BEAR CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,

BASE CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,

BULL CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,
```

**WITHOUT the column header row showing projection years (FY2025E, FY2026E, etc.), users cannot tell which assumption value corresponds to which year. This row is MANDATORY.**

**Then create a consolidation column** (typically the next column to the right) that uses INDEX formulas to pull from the selected scenario block based on the case selector. This consolidation column is what your projection formulas reference.

### Correct Row Planning Process

**1. Write ALL headers and labels FIRST:**
```csv
Row,Content
1,[Company Name] DCF Model
2,Ticker | Date | Year End
4,Case Selector
7,KEY ASSUMPTIONS
26,Assumption headers
27-31,Growth assumptions
...,...
```

**2. Write ALL section dividers and blank rows**

**3. THEN write formulas using the locked row positions**

**4. Test formulas immediately after creation**

**Think of it like construction:**
- Good: Pour foundation, then build walls (stable structure)
- Bad: Build walls, then pour foundation (walls collapse)

**Excel version:**
- Good: Add headers, then write formulas (formulas stable)
- Bad: Write formulas, then add headers (formulas break)

### Correct Sensitivity Table Implementation

**IMPORTANT**: These are NOT Excel's "Data Table" feature. These are simple grids where you write regular formulas using openpyxl. Yes, this means ~75 formulas total (3 tables × 25 cells each), but this is straightforward and required.

**Programmatic Population with Formulas:**

Each sensitivity table must be fully populated with formulas that recalculate the implied share price for each combination of assumptions. **Do not use Excel's Data Table feature** (it requires manual intervention and cannot be automated via openpyxl).

**Implementation approach - CONCRETE EXAMPLE:**

**Table Structure — 5×5 grid (ODD dimensions, base case centered):**

If the model's base WACC = 9.0% and base terminal growth = 3.0%, build the axes symmetrically around those values:

```csv
WACC vs Terminal Growth,  2.0%,  2.5%,  3.0%,  3.5%,  4.0%
              8.0%,       [fml], [fml], [fml], [fml], [fml]
              8.5%,       [fml], [fml], [fml], [fml], [fml]
              9.0%,       [fml], [fml], [★  ], [fml], [fml]   ← middle row = base WACC
              9.5%,       [fml], [fml], [fml], [fml], [fml]
             10.0%,       [fml], [fml], [fml], [fml], [fml]
                                   ↑
                          middle col = base terminal g
```

**★ = the center cell.** Its formula output MUST equal the model's actual implied share price (from the valuation summary). Apply the medium-blue fill (`#BDD7EE`) and bold font to this cell so the base case is visually anchored.

**Rule for axis values:** `axis_values = [base - 2*step, base - step, base, base + step, base + 2*step]` — symmetric around the base, odd count guarantees a center.

**Formula Pattern - Cell B88 (WACC=8.0%, Terminal Growth=2.0%):**

The formula in B88 should recalculate the implied price using:
- WACC from row header: `$A88` (8.0%)
- Terminal Growth from column header: `B$87` (2.0%)

**Recommended approach:** Reference the main DCF calculation but substitute these values.

**Example formula structure:**
`=([SUM of PV FCFs using $A88 as discount rate] + [Terminal Value using B$87 as growth rate and $A88 as WACC] - [Net Debt]) / [Shares]`

**CRITICAL - Write a formula for EVERY cell in the 5x5 grid (25 cells per table, 75 cells total).** Use openpyxl to write these formulas programmatically in a loop. Do NOT skip this step or leave placeholder text.

**Python implementation pattern:**
```python
# Pseudocode for populating sensitivity table
for row_idx, wacc_value in enumerate(wacc_range):
    for col_idx, term_growth_value in enumerate(term_growth_range):
        # Build formula that uses wacc_value and term_growth_value
        formula = f"=<DCF recalc using {wacc_value} and {term_growth_value}>"
        ws.cell(row=start_row+row_idx, column=start_col+col_idx).value = formula
```

**The sensitivity tables must work immediately when the model is opened, with no manual steps required from the user.**

</correct_patterns>

<common_mistakes>

This section contains all the WRONG patterns to avoid when building DCF models.

### WRONG: Simplified Sensitivity Table Approximations or Placeholder Text

**Don't use linear approximations:**

```
// WRONG - Linear approximation
B97: =B88*(1+(0.096-0.116))    // Assumes linear relationship

// WRONG - Division shortcut
B105: =B88/(1+(E48-0.07))      // Doesn't recalculate full DCF
```

**Don't leave placeholder text:**
```
// WRONG - Placeholder note
"Note: Use Excel Data Table feature (Data → What-If Analysis → Data Table) to populate sensitivity tables."

// WRONG - Empty cells
[leaving cells blank because "this is complex"]
```

**Don't confuse terminology:**
- ❌ "Sensitivity tables need Excel's Data Table feature" (NO - that's a specific Excel tool we can't use)
- ✅ "Sensitivity tables are simple grids with formulas in each cell" (YES - this is what we build)

**Why these shortcuts are wrong:**
- Linear approximation formulas don't actually recalculate the DCF - they just apply simple math adjustments
- The relationships are not linear, so the results will be inaccurate
- Placeholder text requires manual user intervention
- Model is not immediately usable when delivered
- Not professional or client-ready
- Empty cells = incomplete deliverable

**Common rationalization to REJECT:**
"Writing 75+ formulas feels complex, so I'll leave a note for the user to complete it manually."

**Reality:** Writing 75 formulas is straightforward when you use a loop in Python with openpyxl. Each formula follows the same pattern - just substitute the row/column values. This is a required part of the deliverable.

**Instead:** Populate every sensitivity cell with formulas that recalculate the full DCF for that specific combination of assumptions

### WRONG: Missing Cell Comments

**Don't do this:**
- Create all hardcoded inputs without comments
- Think "I'll add them later"
- Write "TODO: add source"
- Leave blue inputs without documentation

**Why it's wrong:**
- Can't verify where data came from
- Fails xlsx-author skill requirements
- Not audit-ready
- Wastes time fixing later

**Instead:** Add cell comment AS EACH hardcoded value is created

### WRONG: Formula Row References Off

**Symptom:**
The FCF section references wrong assumption rows:
`D&A:  =E29*$E$34    // Should be $E$21, but referencing wrong row`
`CapEx: =E29*$E$41   // Should be $E$22, but row shifted`

**Why this happens:**
1. Formulas written first
2. Then headers inserted
3. All row references shifted
4. Now formulas point to wrong cells → #REF! errors

**Instead:** Lock row layout FIRST, then write formulas

### WRONG: Single Row for Each Assumption Across Scenarios

**Don't structure assumptions like this:**
```csv
Assumption,Bear,Base,Bull
Revenue Growth FY1,10%,13%,16%
Revenue Growth FY2,9%,12%,15%
```
This vertical layout makes it hard to see the progression across years within each scenario.

**Why it's wrong:**
- Makes it difficult to see assumptions evolving across years within each scenario
- Harder to compare scenario assumptions across full projection period
- Less intuitive for reviewing scenario logic

**Instead:**
- Create separate blocks for each scenario (Bear, Base, Bull)
- Within each block, show assumptions horizontally across projection years
- This makes each scenario's assumptions easier to review as a cohesive set

### WRONG: No Borders

**Don't deliver a model without borders:**
- No section delineation
- All cells blend together
- Hard to read and unprofessional

**Why it's wrong:**
- Not client-ready
- Difficult to navigate
- Looks amateur

**Instead:** Add borders around all major sections

### WRONG: Wrong Font Colors or No Font Color Distinction

**Don't do this:**
- All text is black
- Only use fill colors (no font color changes)
- Mix up which cells are blue vs black

**Why it's wrong:**
- Can't distinguish inputs from formulas
- Auditing becomes impossible
- Violates xlsx-author skill requirements

**Instead:** Blue text for ALL hardcoded inputs, black text for ALL formulas, purple for same-sheet pass-through links (`=B9`), green for links to another sheet

### WRONG: Operating Expenses Based on Gross Profit

**Don't do this:**
`S&M: =E33*0.15    // E33 = Gross Profit (WRONG)`

**Why it's wrong:**
- Operating expenses scale with revenue, not gross profit
- Produces unrealistic margin progression
- Not how businesses actually operate

**Instead:**
`S&M: =E29*0.15    // E29 = Revenue (CORRECT)`

### TOP 5 ERRORS SUMMARY

1. **Formula row references off** → Define ALL row positions BEFORE writing formulas
2. **Missing cell comments** → Add comments AS cells are created, not at end
3. **Simplified sensitivity tables** → Populate all cells with full DCF recalc formulas, not approximations
4. **Scenario block references wrong** → Ensure the consolidation column pulls from the correct Bear/Base/Bull block, and that no projection row carries its own copy of the conditional
5. **No borders** → Add professional section borders for client-ready appearance

In addition, be aware of these errors:

### WACC Calculation Errors
- Mixing book and market values in capital structure
- Using equity beta instead of asset/unlevered beta incorrectly
- Wrong tax rate application to cost of debt
- Incorrect risk-free rate (must use current 10Y Treasury)
- Failure to adjust for net debt vs net cash position

### Growth Assumption Flaws
- Terminal growth > WACC (creates infinite value)
- Projection growth rates inconsistent with historical performance
- Ignoring industry growth constraints
- Revenue growth not aligned with unit economics
- Margin expansion without operational justification

### Terminal Value Mistakes
- Using wrong growth method (perpetuity vs exit multiple)
- Terminal value >80% of enterprise value (suggests over-reliance)
- Inconsistent terminal margins with steady state assumptions
- Wrong discount period for terminal value

### Cash Flow Projection Errors
- Operating expenses based on gross profit instead of revenue
- D&A/CapEx percentages misaligned with business model
- Working capital changes not properly calculated
- Tax rate inconsistency between years
- NOPAT calculation errors

**These errors are the most common. Re-read this section before starting any DCF build.**

</common_mistakes>

## Excel File Creation

**This skill uses the `xlsx-author` skill for all spreadsheet operations.** The xlsx-author skill provides:
- Standardized formula construction rules
- Number formatting conventions
- Automated formula recalculation via its bundled `scripts/recalc.py`
- Comprehensive error checking and validation

All Excel files created by this skill must follow xlsx-author skill requirements, including zero formula errors and proper recalculation.

## Quality Rubric

Every DCF model must maximize for:
1. **Realistic revenue and margin assumptions** based on historical performance
2. **Appropriate cost of capital calculation** with proper CAPM methodology
3. **Comprehensive sensitivity analysis** showing valuation ranges
4. **Clear terminal value calculation** with supporting rationale
5. **Professional model structure** enabling scenario analysis
6. **Transparent documentation** of all key assumptions

## Input Requirements

### Minimum Required Inputs
1. **Company identifier**: Ticker symbol or company name
2. **Growth assumptions**: Revenue growth rates for projection period (or "use consensus")
3. **Optional parameters**:
   - Projection period (default: 5 years)
   - Scenario cases (Bear/Base/Bull growth and margin assumptions)
   - Terminal growth rate (default: 2.5-3.0%)
   - Specific WACC inputs if not using CAPM

## Excel Model Structure

### Sheet Architecture

Create **seven sheets** (see "Deliverables Structure" for what each carries):

1. **假设** — the home of every input that is a *judgement*: the three scenario blocks of operating drivers, 永续增长率 g, 法定税率, the terminal-year normalizations with their unnormalized values beside them, and every `待确认` flag with the alternative considered. This is the sheet a reviewer overturns you on, so it exists even when it is short.
2. **利润表** / 3. **资产负债表** / 4. **现金流量表** — the projected statements, built via `3-statement-model` (Step 4.5)
5. **DCF** - Main valuation model with sensitivity analysis at bottom
6. **WACC** - Cost of capital calculation
7. **Checks** - the Step 4.5 tie-outs, TRUE/FALSE

**「假设」不是「所有硬编码值的收容所」，规则是「一个数字只有一个家」.** Three kinds of
input legitimately live elsewhere, and moving them to 假设 would make things worse:

- **历史实际值住在三表**（定义上如此），带各自的 `Source:` 批注；
- **资本成本输入住在 WACC 页**（Rf、beta、ERP、税前债务成本、有息债务、货币资金）—— 那一页
  *就是* 这个计算的输入区，蓝字加来源批注的约定见 "WACC Sheet Structure"；
- **市场数据住在 DCF 页 Section 2**（股价、股本、净债务），紧贴使用它的股权桥。

真正的硬规则只有两条：**同一个数字不得在两张表上各手打一遍**——重复出现的那一份是绿色跨表
链接（例如情景块镜像到 DCF 页顶部时）；以及**任何输入都不得只存在于公式里**。

**CRITICAL**: Sensitivity tables go at the BOTTOM of the DCF sheet (not on a separate sheet). This keeps all valuation outputs together — it is a rule about where the *sensitivity tables* live, **not** a licence to ship a workbook whose only sheets are DCF and WACC.

### Formula Recalculation (MANDATORY)

After creating or modifying the Excel model, **recalculate all formulas** using the recalc script bundled with the `xlsx-author` skill:

```bash
python3 ../xlsx-author/scripts/recalc.py [path_to_excel_file] [timeout_seconds]
```

Example:
```bash
python3 ../xlsx-author/scripts/recalc.py AAPL_DCF_Model_2025-10-12.xlsx 30
```
(Paths relative to this skill's directory.)

The script will:
- Copy the workbook to a temp directory and recalculate there — **your file is not overwritten**, so the cell comments carrying your sources are safe (LibreOffice's OOXML round-trip is lossy and can drop them)
- Recalculate all formulas in all sheets using LibreOffice
- Scan ALL cells for Excel errors (#REF!, #DIV/0!, #VALUE!, #NAME?, #NULL!, #NUM!, #N/A)
- Return detailed JSON with error locations and counts, and a meaningful exit code: `0` clean, `2` errors found, `3` recalc unavailable, `1` hard failure

**Expected output format:**
```json
{
  "status": "success",           // or "errors_found"
  "total_errors": 0,              // Total error count
  "total_formulas": 42,           // Number of formulas in file
  "error_summary": {}             // Only present if errors found
}
```

**If errors are found**, the output will include details:
```json
{
  "status": "errors_found",
  "total_errors": 2,
  "total_formulas": 42,
  "error_summary": {
    "#REF!": {
      "count": 2,
      "locations": ["DCF!B25", "DCF!C25"]
    }
  }
}
```

**Fix all errors** and re-run recalc.py until status is "success" before delivering the model.

**If status is `"recalc_unavailable"` (exit 3)**, LibreOffice is missing and **no formula was evaluated** — only a static lint ran. That is not a pass. Follow `xlsx-author`'s substitute protocol (re-open with openpyxl; check every formula's references, recompute the derived values independently, assert the model identities), and then say so explicitly in the coverage block of the delivery message.

### Formatting Standards

**IMPORTANT**: Follow the xlsx-author skill for formula construction rules and number formatting conventions. The DCF skill adds specific visual presentation standards.

**Color Scheme - Two Layers**:

**Layer 1: Font Colors (MANDATORY from xlsx-author skill) — four colours, not three**
- **Blue text (`#0000FF`)**: ALL hardcoded inputs (stock price, shares, historical data, assumptions)
- **Black text (`#000000`)**: ALL formulas and calculations
- **Green text (`#008000`)**: Links to **another sheet** (WACC sheet references, e.g. `=WACC!B12`)
- **Purple text (`#800080`)**: A link on the **same sheet** with no calculation (`=B9`) — a pass-through, not a calculation and not an input

The fourth colour is easy to forget and audits check for it: if a cell just
echoes another cell on the same sheet, it is purple, not black and not blue.

**Layer 2: Fill Colors — Professional Blue/Grey Palette (Default unless user specifies otherwise)**
- **Keep it minimal** — use only blues and greys for fills. Do NOT introduce greens, yellows, oranges, or multiple accent colors as decoration. A model with too many colors looks amateurish.
- **The one exception**: a magnitude colour scale on a sensitivity table (see "Sensitivity Analysis" below). That is deliberate conditional formatting, not decoration, and it must carry a legend saying what the scale means. Nothing else in the workbook gets a non-palette fill.
- **Default fill palette:**
  - **Section headers**: Dark blue (RGB: 31,78,121 / `#1F4E79`) background with white bold text
  - **Sub-headers/column headers**: Light blue (RGB: 217,225,242 / `#D9E1F2`) background with black bold text
  - **Input cells**: Light grey (RGB: 242,242,242 / `#F2F2F2`) background with blue font — or just white with blue font if you want maximum minimalism
  - **Calculated cells**: White background with black font
  - **Output/summary rows** (per-share value, EV, etc.): Medium blue (RGB: 189,215,238 / `#BDD7EE`) background with black bold font
- **That's it — 3 blues + 1 grey + white.** Resist the urge to add more.
- User-provided templates or explicit color preferences ALWAYS override these defaults.

**How the layers work together:**
- Input cell: Blue font + light grey fill = "Hardcoded input"
- Formula cell: Black font + white background = "Calculated value"
- Same-sheet pass-through: Purple font + white background = "This is just cell X, restated"
- Sheet link: Green font + white background = "Reference from another sheet"
- Key output: Black bold font + medium blue fill = "This is the answer"

**Font color tells you WHAT it is (input/formula/link). Fill color tells you WHERE you are (header/data/output).**

### Border Standards (REQUIRED for Professional Appearance)

**Thick borders** (1.5pt) around major sections:
- KEY INPUTS section
- PROJECTION ASSUMPTIONS section
- 5-YEAR CASH FLOW PROJECTION section
- TERMINAL VALUE section
- VALUATION SUMMARY section
- Each SENSITIVITY ANALYSIS table

**Medium borders** (1pt) between sub-sections:
- Company Details vs Historical Performance
- Growth Assumptions vs EBIT Margin vs FCF Parameters

**Thin borders** (0.5pt) around data tables:
- Scenario assumption tables (Bear | Base | Bull | Selected)
- Historical vs projected financials matrix

**No borders:** Individual cells within tables (keep clean, scannable)

**Borders are mandatory** - models without professional borders are not client-ready.

**Number Formats** (follows xlsx-author skill standards):
- **Years**: Format as text strings (e.g., "2024" not "2,024")
- **Percentages**: `0.0%` (one decimal place)
- **Currency**: `$#,##0` for millions; `$#,##0.00` for per-share - ALWAYS specify units in headers ("Revenue ($mm)")
- **Zeros**: Use number formatting to make all zeros "-" (e.g., `$#,##0;($#,##0);-`)
- **Large numbers**: `#,##0` with thousands separator
- **Negative numbers**: `(#,##0)` in parentheses (NOT minus sign)

**Cell Comments (MANDATORY for all hardcoded inputs)**:

Per the xlsx-author skill, ALL hardcoded values must have cell comments documenting the source. Format: `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`. Calculated cells get no such comment — they carry a formula, which is their provenance.

**CRITICAL**: Add comments AS CELLS ARE CREATED. Do not defer to the end.

### DCF Sheet Detailed Structure

(The layout of sheet 4. Sheets 1–3 follow `3-statement-model`; sheet 6 follows Step 4.5.)

**Section 1: Header**
```csv
Row,Content
1,[Company Name] DCF Model
2,Ticker: [XXX] | Date: [Date] | Year End: [FYE]
3,Blank
4,Case Selector Cell (1=Bear 2=Base 3=Bull)
5,Case Name Display (formula: =IF([Selector]=1"Bear"IF([Selector]=2"Base""Bull")))
```

**Section 2: Market Data (NOT case dependent)**
```csv
Item,Value
Current Stock Price,$XX.XX
Shares Outstanding (M),XX.X
Market Cap ($M),[Formula]
Net Debt ($M),XXX [or Net Cash if negative]
```

**Section 3: DCF Scenario Assumptions**

Create separate assumption blocks for each scenario (Bear, Base, Bull), laid out horizontally across projection years. Each block must include section header, column header row showing the projection years (FY1, FY2, etc.), and data rows. See `<correct_patterns>` section "Correct Assumption Table Structure" for the exact layout.

**What varies by scenario — the operating drivers only** (Step 10): 分部收入增速 (per segment, not one blended rate), 分部毛利率, 费用率 (S&M / R&D / G&A), CapEx 计划 or 固定资产/收入 目标, 应收/存货/应付周转天数, 有效税率.

**What does NOT vary by scenario**, because the sensitivity tables own it and a scenario copy prices the same downside twice: **WACC, 永续增长率 g, Rf, beta, ERP, 法定税率**. Each sits **once**, in the sheet that owns it — g and 法定税率 on 假设, the CAPM and cost-of-debt inputs on the WACC sheet — and all three cases read the same cell. Where a scenario genuinely implies a different steady state, move the terminal-year **reinvestment** and let g follow from `可支持的g` (Step 8).

**Two tax-rate rows, not one** (Step 5): `有效税率(预测期)` per scenario **per year** — it is a convergence path, not a constant — and `法定税率(终值年)` as a single non-scenario input.

**The driver form is not free either.** These rows are what the FCF build reads, so they carry the form Step 4.5 requires: turnover **days** for working capital, a CapEx **plan** feeding the 固定资产 roll-forward, and **no `D&A % of revenue` row at all** — D&A comes *out* of the roll-forward, so an input row for it would let two numbers disagree.

**Section 4: Historical & Projected Financials**

**Reference a consolidation column (e.g., "Selected Case") that pulls from scenario blocks**, not scattered IF formulas in every projection row.

```csv
Income Statement ($M),2020A,2021A,2022A,2023A,2024E,2025E,2026E
Revenue,XXX,XXX,XXX,XXX,[=E29*(1+$E$10)],[=F29*(1+$E$11)],[=G29*(1+$E$12)]
  % growth,XX%,XX%,XX%,XX%,[=E29/D29-1],[=F29/E29-1],[=G29/F29-1]
,,,,,,
Gross Profit,XXX,XXX,XXX,XXX,[=E29*E33],[=F29*F33],[=G29*G33]
  % margin,XX%,XX%,XX%,XX%,[=E33/E29],[=F33/F29],[=G33/G29]
,,,,,,
Operating Expenses:,,,,,,,
  S&M,XXX,XXX,XXX,XXX,[=E29*0.15],[=F29*0.14],[=G29*0.13]
  R&D,XXX,XXX,XXX,XXX,[=E29*0.12],[=F29*0.11],[=G29*0.10]
  G&A,XXX,XXX,XXX,XXX,[=E29*0.08],[=F29*0.07],[=G29*0.07]
  Total OpEx,XXX,XXX,XXX,XXX,[=E36+E37+E38],[=F36+F37+F38],[=G36+G37+G38]
,,,,,,
EBIT,XXX,XXX,XXX,XXX,[=E33-E39],[=F33-F39],[=G33-G39]
  % margin,XX%,XX%,XX%,XX%,[=E41/E29],[=F41/F29],[=G41/G29]
,,,,,,
Taxes,(XX),(XX),(XX),(XX),[=E41*E$24],[=F41*F$24],[=G41*G$24]
  Tax rate,XX%,XX%,XX%,XX%,[=E43/E41],[=F43/F41],[=G43/G41]
,,,,,,
NOPAT,XXX,XXX,XXX,XXX,[=E41-E43],[=F41-F43],[=G41-G43]
```

Row 24 is the **per-year** 有效税率 from the consolidation column — `E$24`, `F$24`,
`G$24`, not one `$E$24` constant — because Step 5 requires a visible convergence from
the effective rate to the statutory one. The terminal column reads `假设!法定税率`
instead. Historical 所得税 stays a disclosed hardcode and the historical `Tax rate` row
is the formula that divides it, which is how the effective rate gets computed in the
first place.

**Key Formula Pattern**:
- Revenue growth: `=E29*(1+$E$10)` where $E$10 is consolidation column for Year 1 growth
- NOT: `=E29*(1+IF($B$6=1,$B$10,IF($B$6=2,$C$10,$D$10)))`

This approach is cleaner, easier to audit, and prevents formula errors by centralizing the scenario logic.

**Section 5: Free Cash Flow Build**

**CRITICAL**: Verify row references point to the CORRECT assumption rows. Test formulas immediately after creation.

```csv
Cash Flow ($M),2020A,2021A,2022A,2023A,2024E,2025E,2026E
NOPAT,XXX,XXX,XXX,XXX,[=E45],[=F45],[=G45]
(+) D&A,XXX,XXX,XXX,XXX,[=现金流量表!E60],[=现金流量表!F60],[=现金流量表!G60]
    % of Rev（显示行，非驱动）,XX%,XX%,XX%,XX%,[=E58/E29],[=F58/F29],[=G58/G29]
(-) CapEx,(XX),(XX),(XX),(XX),[=-现金流量表!E72],[=-现金流量表!F72],[=-现金流量表!G72]
    % of Rev（显示行，非驱动）,XX%,XX%,XX%,XX%,[=-E60/E29],[=-F60/F29],[=-G60/G29]
(-) Δ NWC,(XX),(XX),(XX),(XX),[=-(资产负债表!E88-资产负债表!D88)],[=-(资产负债表!F88-资产负债表!E88)],[=-(资产负债表!G88-资产负债表!F88)]
    营运资金余额（三项周转天数驱动）,XXX,XXX,XXX,XXX,[=资产负债表!E88],[=资产负债表!F88],[=资产负债表!G88]
,,,,,,
Unlevered FCF,XXX,XXX,XXX,XXX,[=E57+E58-E60-E62],[=F57+F58-F60-F62],[=G57+G58-G60-G62]
```

**These three rows are green cross-sheet links, not `收入 × 比率`.** That is the whole
point of Step 4.5: D&A comes out of the 固定资产 roll-forward behind the cash-flow
statement (期初 + CapEx − 折旧), CapEx comes from the capex plan, and Δ营运资金 comes
from the balance-sheet 营运资金 line that the 应收/存货/应付 turnover days produced. The
two `% of Rev` rows stay because a reader wants to see capital intensity trend — they
are **display rows computed from the result**, and if either of them ever becomes the
driver, the formula is pointing the wrong way.

**The ratio form has exactly one licence**, and it is a condition, not a preference:
the 三项余额 (应收账款/存货/应付账款) could not be retrieved, recorded `源不可用` in the
coverage block with the query that failed. Then, and only then,
`Δ营运资金 = (本期收入 − 上期收入) × 比率`, with the ratio in the assumptions block and
tagged `[测算]`. If you computed turnover days, you had the balances, and this licence
does not apply (Step 5).

**Row reference examples** (based on layout planning):
- E$24 = 有效税率 for that year (consolidation column, row 24 — per year, not a constant)
- E29 = Revenue for year (row 29)
- E45 = NOPAT for year (row 45)
- 现金流量表!E60 / !E72 = D&A and CapEx for that year, from the statement built in Step 4.5
- 资产负债表!E88 = 营运资金 balance for that year (应收 + 存货 − 应付, days-driven)

There is deliberately **no** `D&A %` / `CapEx %` / `NWC %` assumption row in this list.
If your layout has one, Step 4.5 was skipped.

**Before writing formulas**: Confirm these row numbers match the actual layout. Test one column, then copy across.

**Section 6: Discounting & Valuation**
```csv
DCF Valuation,2024E,2025E,2026E,2027E,2028E,Terminal
Unlevered FCF ($M),XXX,XXX,XXX,XXX,XXX,
Period,0.5,1.5,2.5,3.5,4.5,
Discount Factor,0.XX,0.XX,0.XX,0.XX,0.XX,
PV of FCF ($M),XXX,XXX,XXX,XXX,XXX,
,,,,,,
Terminal FCF ($M),,,,,,,XXX
终值年正常化: CapEx vs D&A,,,,,,,XXX / XXX
终值年正常化: ΔNWC(按g缩放),,,,,,,XXX
终值年正常化: 税率(法定),,,,,,,XX%
终值折现期约定 (末年末 n / 年中 n−0.5),,,,,,,[n 或 n−0.5]
Terminal Value ($M),,,,,,,XXX
PV Terminal Value ($M),,,,,,,XXX
终值占EV比重 (正常带 50-75%),,,,,,,XX%
隐含退出倍数 (TV/终值年EBITDA),,,,,,,XX.Xx
  同业EV/EBITDA区间(对照),,,,,,,X.X-X.Xx
可支持的g (ROIC终值 × 再投资率终值),,,,,,,X.X%
  本模型采用的g(对账),,,,,,,X.X%
  倍数法隐含g(仅当也做了倍数法; 交叉验证),,,,,,,X.X%
,,,,,,
Valuation Summary ($M),,,,,,
Sum of PV FCFs,XXX,,,,,
PV Terminal Value,XXX,,,,,
Enterprise Value,XXX,,,,,
(-) Net Debt,(XX),,,,,
(-) 少数股东权益,(XX),,,,,
(+) 长期股权投资/联营企业,XX,,,,,
(+/-) 永续债与其他权益工具,(XX),,,,,
(-) 受限资金,(XX),,,,,
Equity Value,XXX,,,,,
,,,,,,
总股本 (M),XX.X,,,,,
(-) 回购库存股 (M),(X.X),,,,,
(+) 可转债转股 (if-converted: 同时从净债务剔除该债本金) (M),X.X,,,,,
(+) 股权激励/期权 (库存股法净增 = 潜在股数 − 行权价款/现价) (M),X.X,,,,,
稀释股本 (M),XX.X,,,,,
IMPLIED PRICE PER SHARE,$XX.XX,,,,,
Current Stock Price,$XX.XX,,,,,
Implied Upside/(Downside),XX%,,,,,
,,,,,,
回检: 隐含PE(目标价),XX.Xx,,,,,
  自身历史PE区间 / 同业PE(对照),X.X-X.Xx / X.Xx,,,,,
回检: 隐含EV/EBITDA(目标价),XX.Xx,,,,,
回检: 本模型 vs 数据商一致预期(未来两年收入/利润率),…,,,,,
```

Every bridge line above is present in the workbook even when it is zero — a line
reading `无少数股东权益[披露]` and a line that was never written look the same to a
reader, and only one of them is a claim you checked. Lines that could not be sourced
carry `源不可用` and appear in the coverage block.

### WACC Sheet Structure

The third column below is the **font-colour convention for that cell**, per
"Formatting Standards" above: blue = hardcoded input, black = formula, green =
link to another sheet, purple = same-sheet pass-through. It is not a fill.

```csv
COST OF EQUITY CALCULATION,,
Risk-Free Rate (10Y Treasury),X.XX%,[Blue: hardcoded input]
Beta (5Y monthly),X.XX,[Blue: hardcoded input]
Equity Risk Premium,X.XX%,[Blue: hardcoded input]
Cost of Equity,X.XX%,[Black: formula]
,,
COST OF DEBT CALCULATION,,
Credit Rating,AA-,[Blue: hardcoded input]
Pre-Tax Cost of Debt,X.XX%,[Blue: hardcoded input]
Tax Rate,XX.X%,[Green: link to DCF sheet]
After-Tax Cost of Debt,X.XX%,[Black: formula]
,,
CAPITAL STRUCTURE,,
Current Stock Price,$XX.XX,[Green: link to DCF sheet]
Shares Outstanding (M),XX.X,[Green: link to DCF sheet]
Market Capitalization ($M),"X,XXX",[Black: formula]
,,
Total Debt ($M),XXX,[Blue: hardcoded input]
Cash & Equivalents ($M),XXX,[Blue: hardcoded input]
Net Debt ($M),XXX,[Black: formula]
,,
Enterprise Value ($M),"X,XXX",[Black: formula]
,,
WACC CALCULATION,Weight,Cost,Contribution
Equity,XX.X%,X.X%,X.XX%
Debt,XX.X%,X.X%,X.XX%
,,
WEIGHTED AVERAGE COST OF CAPITAL,X.XX%,[Black bold formula on #BDD7EE fill — key output]
```

Every blue cell above carries its `Source:` comment. The green cells and the
black cells do not: a link and a formula each document themselves.

**Key WACC Formulas:**
```
Market Cap = Price × Shares(diluted, 扣库存股)
Total Debt = 有息债务合计
Net Debt = Total Debt - Cash          ← used by the Step 9 bridge, NOT by the weights
Equity Weight = Market Cap / (Total Debt + Market Cap)
Debt Weight   = Total Debt / (Total Debt + Market Cap)
WACC = (Cost of Equity × Equity Weight) + (After-tax Cost of Debt × Debt Weight)
```

Gross debt in the weights, per Step 6 — the net-debt convention is available but has
to be declared on this sheet, and it never produces a negative weight. Add a labelled
row stating which basis this workbook uses, so the sheet answers the question without
the reader reverse-engineering the formula.

**The three CAPM inputs each need their basis on this sheet, not just their value** —
one adjacent cell each, per Step 6: the Rf's date and whether it is spot or normalized
(and if spot at an extreme, that Rf is a sensitivity axis); beta's index, window, and
raw-or-adjusted, or the comp set it was relevered from; and the ERP's derivation or
citation with its `[标签]`. A WACC sheet whose Ke line is reproducible only by someone
who already knows the answer has documented nothing.

### Sensitivity Analysis (Bottom of DCF Sheet)

**TERMINOLOGY REMINDER**: "Sensitivity tables" = simple 2D grids with row headers, column headers, and formulas in each data cell. NOT Excel's "Data Table" feature (Data → What-If Analysis → Data Table). You will use openpyxl to write regular Excel formulas into each cell.

**Location**: Rows 87+ on DCF sheet (NOT a separate sheet)

**Three sensitivity tables, vertically stacked:**

1. **WACC vs Terminal Growth** (rows 87-100) - 5x5 grid = 25 cells with formulas
2. **Revenue Growth vs EBIT Margin** (rows 102-115) - 5x5 grid = 25 cells with formulas
3. **Beta vs Risk-Free Rate** (rows 117-130) - 5x5 grid = 25 cells with formulas

**Total formulas to write: 75** (this is required, not optional)

**Build them off a compact exact engine, not a 1KB formula per cell.** With a 10-year
explicit forecast, "recalculate the full DCF inside each cell" written out longhand
produces 75 thousand-character formulas, and the third table has to rebuild
Ke → WACC → every discount factor on top of that. That is unmaintainable rather than
rigorous, and it is where `#REF!` swarms come from. The compact form recomputes the
same chain exactly:

```
# 显性期 FCF 与折现期各铺一行（DCF 页本来就有）
$E$65:$N$65   10 年 unlevered FCF
$E$66:$N$66   折现期 0.5,1.5,… 或 1,2,…（按你在 Step 8 声明的约定）
$N$50         终值年 EBITDA
$N$65         终值年 FCF

# 每一格（行头 $B90 = 该行 WACC，列头 C$89 = 该列 g）：
=( SUMPRODUCT($E$65:$N$65, 1/(1+$B90)^$E$66:$N$66)
   + $N$65*(1+C$89)/($B90-C$89)/(1+$B90)^$终值折现期
   - $净债务 - $少数股东权益 + $其他桥接项净额 ) / $稀释股本
```

一格一行公式，行头与列头是唯一的相对引用，其余全绝对。**这不是线性近似** —— 它把同一条 DCF
链条完整算了一遍，只是没有把链条抄进公式里 75 次。

**三张表的引擎不同，因为它们扰动的位置不同 —— 这是最容易做错的地方：**

- **表 1（WACC × g）** 直接用上面那行：FCF 不随折现率变化，所以显性期 FCF 行可以整行复用。
- **表 2（收入增速 × EBIT 利润率）改的是 FCF 本身**，那一行不能复用，否则表 2 只是表 1 换了个
  轴标签、数字全错。在表旁边搭一条**紧凑重投影行**（每格引用它）：
  `收入_t = 收入_0×(1+行头增速)^t` → `EBIT_t = 收入_t×列头利润率` →
  `NOPAT_t = EBIT_t×(1−有效税率_t)` → `FCF_t = NOPAT_t + D&A_t − CapEx_t − Δ营运资金_t`，
  其中 D&A / CapEx / 营运资金 按**基准情景的强度**（占收入比）随新收入路径缩放 —— 这一步是敏感性
  表里唯一允许用比率的地方，因为它的目的就是「只动这两个轴、其余不动」，并在表下注明这一点。
- **表 3（Beta × Rf）** 在表旁先写一个 `WACC(β, Rf)` 辅助格阵 —— `Ke = Rf + β×ERP`，
  `WACC = Ke×E权重 + 税后债务成本×D权重`，权重与 WACC 页同源 —— 主格再引用它，公式仍是表 1 那一行。

三张表的中心格都必须等于模型实际的每股价值（见 "Critical Constraints"）。**这是验证引擎搭对了的
唯一办法**：表 2 的中心格若与表 1 的中心格不等，就是重投影行的强度假设与三表不一致。

**CRITICAL**: All sensitivity table cells must be populated programmatically with formulas using openpyxl. DO NOT use linear approximation shortcuts. DO NOT leave placeholder text or notes about manual steps. DO NOT rationalize leaving cells empty because "it's complex" - use a Python loop to generate the formulas.

**Table Setup:**
1. Create table structure with row/column headers (the assumption values to test)
2. Populate EVERY data cell with a formula that:
   - Uses the row header value (e.g., WACC = 9.0%)
   - Uses the column header value (e.g., Terminal Growth = 3.0%)
   - Recalculates the full DCF with those specific assumptions
   - Returns the implied share price for that scenario
3. All cells must contain working formulas when delivered
4. **Optional magnitude colour scale.** A green-to-red conditional-formatting scale across the grid (higher implied price greener, lower redder) is the single **deliberate, labelled exception** to the 3-blues-and-a-grey fill palette — it encodes magnitude, it is not decoration. If you apply it: apply it only inside the sensitivity grids, and put a one-line legend directly under the table saying what the scale means (e.g. "Colour scale: implied price per share, low → high"). Without the legend, drop the scale and leave the cells on the standard palette.
5. Bold the base case cell and give it the medium-blue fill (`#BDD7EE`)
6. Leave 1-2 blank rows between tables

**No manual intervention required** - the sensitivity tables must be fully functional when the user opens the file.

## Case Selector Implementation

**Three-Case Framework — operating drivers only.**

Per Step 10, the three cases are *views about the business*; **WACC, 永续增长率, Rf,
beta and ERP are not part of them** — they are the reader's dials and they live in the
sensitivity tables, once, around the base case. A bear case that also lowers g and
raises WACC reports the same downside three times, and the g column of the sensitivity
table then double-counts it.

### Bear Case
- Conservative revenue growth per segment (low end of the historical range)
- Margin compression or no expansion; 费用率 leverage does not arrive
- Higher CapEx intensity for the same volume, or 周转天数 deteriorating (应收 lengthening, 存货 building)
- 有效税率 at the less favourable end of its plausible path

### Base Case
- Consensus or management guidance revenue growth per segment
- Moderate margin expansion based on operating leverage
- CapEx per the stated plan; 周转天数 near the historical average
- 有效税率 per the computed 2-3 年历史值, converging to statutory by the terminal year

### Bull Case
- Optimistic revenue growth per segment (high end of projections)
- Significant margin expansion, with the mechanism named (mix, scale, 降本)
- Reduced capital intensity; 周转天数 improving, and the reason stated
- 有效税率 at the more favourable end of its plausible path

**Where a case genuinely implies a different steady state**, do not hand-edit g: change
the terminal-year **reinvestment** (CapEx, ΔNWC) and let `可支持的g = ROIC × 再投资率`
move, then reconcile the g you use to it (Step 8). That keeps the tie-out intact and
keeps the sensitivity table honest.

**Formula Implementation:**

**DO NOT use nested IF formulas scattered throughout.** Instead, create a consolidation column that uses INDEX or OFFSET formulas to pull from the appropriate scenario block.

**Recommended pattern (using INDEX):**
`=INDEX(B10:D10, 1, $B$6)` where `B10:D10` = Bear/Base/Bull values, `1` = row offset, `$B$6` = case selector cell (1, 2, or 3)

**Then reference the consolidation column** in all projections:
`Revenue Year 1: =D29*(1+$E$10)` where $E$10 is the consolidation column value for Year 1 growth.

This approach centralizes scenario logic, making the model easier to audit and maintain.

## Deliverables Structure

**File naming**: follow `xlsx-author`'s rule — **the filename is in the language of the
request**, with identifiers left as they are. A Chinese request gets
`比亚迪_002594_DCF模型_20260811.xlsx`; an English one gets
`BYD_002594_DCF_Model_2026-08-11.xlsx`. `002594_DCF_Model_2026-08-11.xlsx` answering
「帮我给比亚迪搭一个 DCF」 is half-translated output, and the filename is the first thing
the user sees.

**Seven sheets.** A workbook with only DCF and WACC has skipped Step 4.5 and is not
this deliverable:
1. **假设** — the judgement inputs: the three scenario blocks of operating drivers, g, 法定税率, terminal-year normalizations with their unnormalized values, and the `待确认` flags. Historical actuals stay on the statements, the CAPM and cost-of-debt inputs on the WACC sheet, market data on the DCF sheet, and the case-selector cell on the DCF sheet (B6 in the layout below, where every INDEX example points) — one number, one home (see "Sheet Architecture")
2. **利润表** — historical (annual + the 单季 series from Step 2) and projected, revenue built from the Step 3 segment rows
3. **资产负债表** — projected, 营运资金 driven by the 应收/存货/应付 turnover days of Step 4.5
4. **现金流量表** — projected, with the 固定资产 roll-forward that produces D&A and CapEx
5. **DCF** — FCF build off the statements above, Bear/Base/Bull cases + three sensitivity tables at the bottom of *this* sheet (WACC vs Terminal Growth, Revenue Growth vs EBIT Margin, Beta vs Risk-Free Rate)
6. **WACC** — cost of capital calculation
7. **Checks** — the tie-outs listed in Step 4.5, each TRUE/FALSE

Sheets 2–4 are built by invoking `3-statement-model`; this skill does not restate
that mechanic. Where a company's disclosure genuinely does not support a projected
balance sheet or cash-flow statement, say which line was missing and why in the
coverage block — the sheet is not silently dropped.

**Key features**: Case selector (1/2/3), consolidation column with INDEX/OFFSET formulas, color-coded cells, cell comments on all inputs, professional borders

### Coverage block (MANDATORY in the delivery message)

The workbook carries its sources in cell comments; the message that hands it over
carries the honesty. Close every delivery with this block, verbatim heading,
even when everything passed:

```
## 覆盖范围与局限
Retrieved: <timestamp>

- Historicals: <which statements/periods were retrieved, and from where — e.g.
  FY2020–FY2024 income statement and balance sheet via 同花顺 (headline lines cross-checked against Wind);
  share count from the FY2024 10-K>
- Analyst assumptions (not retrieved data): <list the inputs you judged rather
  than sourced — growth path, margin trajectory, terminal g, ERP, exit multiple.
  Each is also `[测算]` in its cell comment and in the assumptions block>
- Formula evaluation: <one of> recalc.py evaluated all N formulas via
  LibreOffice, zero errors (exit 0) / recalc.py could NOT evaluate the formulas
  (exit 3, LibreOffice unavailable) — only a static lint ran, plus the openpyxl
  reference/recompute/identity checks listed below; the model is NOT verified
  and the user should confirm the numbers on open
- Not covered: <sources that failed or were out of scope, and what they would
  have covered>
```

`recalc_unavailable` is **not** a pass — `xlsx-author`'s honesty protocol is
explicit about this. A model delivered without formula evaluation says so, in
this block, in plain words. Never describe such a workbook as "verified".

## Best Practices

### Model Construction
1. **Build incrementally**: Complete each section before moving to next
2. **Test as building**: Enter sample numbers to verify formulas
3. **Use consistent structure**: Similar calculations follow similar patterns
4. **Comment complex formulas**: Add notes for unusual calculations
5. **Build in checks**: Sum checks and balance checks where applicable

### Documentation
1. **Document all assumptions**: Explain reasoning behind key inputs
2. **Cite data sources**: Note where each data point came from
3. **Explain methodology**: Describe any non-standard approaches
4. **Flag uncertainties**: Highlight areas with limited visibility

### Quality Control
1. **Cross-check calculations**: Verify math in multiple ways
2. **Stress test assumptions**: Run sensitivity to ensure model is robust
3. **Peer review**: Have someone else check formulas
4. **Version control**: Save versions as work progresses

## Common Variations

### High-Growth Technology Companies
- Longer projection period (7-10 years)
- Higher initial growth rates (20-30%)
- Significant margin expansion over time
- Higher WACC (12-15%)
- Model unit economics (users, ARPU, etc.)

### Mature/Stable Companies
- Shorter projection period (3-5 years)
- Modest growth rates (GDP +1-3%)
- Stable margins
- Lower WACC (7-9%)
- Focus on cash generation and capital allocation

### Cyclical Companies
- Model through economic cycle
- Normalize margins at mid-cycle
- Consider trough and peak scenarios
- Adjust beta for cyclicality

### Multi-Segment Companies

Segment-level revenue and margin is **not** an advanced variation — it is Step 2
and Step 3 of the main flow, and this section only covers what goes beyond them:

- **Sum-of-parts valuation** — where segments deserve different multiples or
  different WACCs (a regulated utility arm beside a cyclical one), value each and
  sum, rather than discounting one blended stream. State the per-segment WACC and
  why it differs; a single WACC applied to differently-risky segments is the
  simplification SOTP exists to avoid.
- **Synergies or internal transfers between segments** — if segment revenue
  includes intra-group sales, the sum overstates the consolidated line. The
  reconciliation row in Step 2 is where that surfaces; name it 内部抵销 rather than
  letting it sit in 其他/未分配.
- One segment loss-making with a credible path to breakeven changes the terminal
  value more than the forecast period. Say which segment carries the terminal
  value.

## Troubleshooting

**If you encounter errors or unreasonable results, read [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed debugging guidance.**

## Workflow Integration

### At Start of DCF Build

1. **Gather market data** — from the tools, not the web:
   - Price for the equity bridge: `hexin-stock.get_stock_summary` / `get_stock_performance` (A shares), `hexin-global-stock.global_stock_quotes` (HK/US)
   - **Beta**: `hexin-stock.get_risk_indicators` — read back which index and window it was computed against (BETA defaults to 最近 24 个月). Do not web-source a beta when this answers.
   - Market/sector comparison: `hexin-index.index_data` / `sector_data`
   - `finance-search.finance_search` for what no tool carries, then web search/fetch only if the vertical index misses it too (a credit spread, a country risk premium)
   - Request from user if specific data is needed

2. **Gather historical financials**:
   - Check for available MCP servers (同花顺 for structured financials; Wind for headline cross-check; sec-search `sec_full_text_search` for SEC filings, etc.)
   - Request from user if not available via MCP
   - Manual extraction from 10-Ks if necessary

3. **Begin model construction** using the DCF methodology detailed in this skill

### During Model Construction

1. **Build Excel model** using openpyxl with formulas (not hardcoded values)
2. **Follow xlsx-author skill conventions** for formula construction and formatting
3. **Apply fill colors only if requested** by user or if specific brand guidelines are provided

### Before Delivering Model (MANDATORY)

1. **Verify structure**:
   - Scenario blocks for Bear/Base/Bull with assumptions across projection years
   - Case selector functional with formulas referencing correct scenario blocks
   - Sensitivity tables at bottom of DCF sheet (not separate sheet)
   - Font colors: Blue inputs, black formulas, purple same-sheet links, green cross-sheet links
   - Cell comments on ALL hardcoded inputs
   - Professional borders around major sections

1b. **Verify the valuation is falsifiable** — each of these is a cell on the DCF
    sheet, as a formula, or the model is not finished:
   - **隐含退出倍数** (`TV / 终值年EBITDA`) beside the comps range it is judged against
   - **可支持的g** from reinvestment (`ROIC × 再投资率`) beside the g actually used,
     and reconciled if they differ (and 倍数法隐含g too, if you ran the multiple method —
     three distinct labels, not one row)
   - **终值折现期约定** — 末年末 n or 年中 n−0.5, stated and used consistently
   - **Terminal-year normalization lines** — CapEx vs D&A, ΔNWC vs g, tax at statutory —
     each showing the unnormalized value beside the normalized one
   - **少数股东权益** as its own bridge line, with its basis, or `无少数股东权益[披露]`
   - **稀释股本 reconciliation** from 总股本, 库存股 deducted, 可转债 if-converted (both
     legs) and 股权激励 on the treasury-stock method
   - **隐含 PE / EV-EBITDA** on the target price vs the company's own band and peers
   - **WACC weight basis** stated (gross or net debt), no negative weight, and the beta
     relevering on that same basis
   - **两个税率** — 有效税率 per forecast year, 法定税率 in the terminal year
   - **Rf treatment** — spot with an Rf sensitivity range, or normalized with the spot
     shown and the gap quantified
   - Terminal value as a share of EV, with the 50-75% band and an explanation if outside

2. **Recalculate formulas**: Run `python3 ../xlsx-author/scripts/recalc.py model.xlsx 30`

3. **Check output**:
   - If `status` is `"success"` (exit 0) → Continue to step 4
   - If `status` is `"errors_found"` (exit 2) → Check `error_summary` and read [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for debugging guidance
   - If `status` is `"recalc_unavailable"` (exit 3) → no formula was evaluated; run `xlsx-author`'s substitute checks and record the limitation in the coverage block

4. **Fix errors and re-run recalc.py** until status is "success"

5. **Spot-check formulas**:
   - Test one FCF formula - does it reference the correct assumption rows?
   - Change case selector - does the consolidation column update properly?
   - Verify each projection row reads the consolidation column, and does not carry its own copy of the scenario conditional

6. **Deliver model** with the `## 覆盖范围与局限` block (see "Deliverables Structure")

### Available Data Sources

- **MCP servers**: 同花顺 primary + Wind cross-check / sec-search where configured (historical financials, market data, filings)
- **Web search/fetch**: Only for inputs no MCP tool carries (credit spread, country risk premium). Price and beta come from `hexin-stock` / `hexin-global-stock`.
- **User-provided data**: Historical financials, consensus estimates
- **Manual extraction**: SEC EDGAR filings as fallback

## Final Output Checklist

Before delivering DCF model:

**Required:**
- Run `python3 ../xlsx-author/scripts/recalc.py model.xlsx 30` until status is "success" (zero formula errors) — and if it returns `recalc_unavailable`, say so in the coverage block rather than calling the model verified
- Seven sheets: 假设, 利润表 / 资产负债表 / 现金流量表 (via `3-statement-model`), DCF (with sensitivity at bottom), WACC, Checks
- Font colors: Blue=hardcoded inputs, Black=formulas, Purple=same-sheet links (`=B9`), Green=links to another sheet
- Cell comments on ALL hardcoded inputs, in the form `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`; no source comments on calculated cells
- Sensitivity tables fully populated with formulas (and a legend if a magnitude colour scale is used)
- Professional borders around major sections
- `## 覆盖范围与局限` block in the delivery message

**Validation:**
- OpEx based on revenue (not gross profit)
- D&A, CapEx and Δ营运资金 are cross-sheet links to the three statements — **no `% of revenue` driver rows** (Step 4.5)
- Scenarios move operating drivers only; WACC and g are not scenario-varied (Step 10)
- Terminal value 50-75% of EV, or explained
- Terminal growth < WACC, and reconciled to `可支持的g = ROIC × 再投资率`
- 终值折现期约定 stated (末年末 n / 年中 n−0.5) and used identically in the sensitivity tables
- Two tax rates: 有效税率 per forecast year (computed, gap explained), 法定税率 in the terminal year — the `21-28%` band is US-only and is not the test
- File naming follows the language of the request (`xlsx-author`), identifiers unchanged