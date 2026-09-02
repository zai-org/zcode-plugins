---
name: cash-forecast
description: A 13-week rolling direct cash forecast — opening cash, AR-ageing-driven receipts, disbursements (payroll, AP, tax, debt service, capex), closing cash, and headroom against a covenant or minimum balance, with an explicit collection curve and DSO assumption and a downside case. Triggers on "13周现金流", "滚动资金预测", "资金计划", "现金流预测", "未来三个月资金够不够", "回款预测", "cash forecast", "13-week cash flow", "liquidity runway".
---

# 13-Week Rolling Cash Forecast

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A direct forecast: cash in, cash out, week by week, from the company's own receivables, payables, payroll, tax, and debt schedules. Not an indirect forecast derived from projected profit — the whole reason treasury builds this is that profit and cash diverge exactly when it matters.

The deliverable is a workbook. **Its citation vehicle is cell comments**, because a forecast's provenance is which internal document each input came from, not a bibliography.

## Inputs and output

Minimum inputs are an as-of-date opening bank or treasury balance, customer-level AR ageing, AP ageing or open purchase commitments, payroll and tax calendars, debt-service schedules, committed and planned capex, and any applicable facility or minimum-cash restrictions. Use the company's own schedules on a common entity, currency, tax basis, and cut-off date. A missing schedule limits only the affected line unless it prevents a usable receipts forecast or opening-cash anchor.

The output is one Chinese 13-week direct-cash workpaper containing the source populations, named assumptions, collection curve, weekly receipts and disbursements, base and downside cash paths, headroom and first-breach week, formula checks, and coverage limitations. It does not approve a payment, draw a facility, alter a schedule, compute a tax liability, or make a financing commitment.

## Before anything else — the files

Ask for what is missing rather than assuming it. The minimum set, and what each one drives:

| 文件 | 驱动 |
|---|---|
| 应收账龄表(按客户、按账龄段) | 回款(receipts) |
| 应付账龄表 / 未清采购订单 | 供应商付款 |
| 期初银行余额或资金日报 | week 0 opening cash |
| 薪酬发放日历(含社保公积金) | payroll disbursements |
| 税务日历(增值税、企业所得税、附加) | tax disbursements |
| 借款台账(本金、利息、到期日) | debt service |
| 资本开支计划(已签约 vs 计划) | capex |
| 授信合同的财务契约或最低现金余额要求 | headroom line |

**Without an AR ageing there is no receipts line worth building.** Say that plainly and ask, rather than forecasting collections off a revenue trend and presenting it as a cash forecast. If a schedule genuinely does not exist, model the line from what does exist, label the whole line `[测算]` with its basis, and carry it into the coverage block as a gap.

## Workflow

### Step 1: Parse, read back, anchor week 0

Parse the files with Python (openpyxl / pandas) through Bash and read back what you found — ageing bucket definitions (0-30/31-60/61-90/90+ or the company's own), customer count, currency, whether the ageing is 含税 or 不含税, and the as-of date of each schedule. An ageing table 含税 feeding a forecast built 不含税 understates receipts by the VAT rate and nothing downstream catches it.

Read every non-empty Excel comment or note before analysing the values. Carry comments affecting cut-off dates, collection status, disputed balances, payment dates, commitments, restrictions, assumptions, approvals, or review status into the relevant input, assumption, forecast line, or limitation. If the first parsing method exposes only values, use one that also exposes comments; do not conclude that none exist.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded balance, schedule amount, date, assumption, or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never infer it from the output row or copy an adjacent address.

Define the 13 weeks explicitly (week-ending dates), and anchor **week 0 opening cash to a source document** — the bank statement or the treasury daily report — not to the ledger's 货币资金 unless those are the same thing. State which, in the cell comment.

### Step 2: The collection curve and the DSO assumption — the heart of the forecast

This is where the forecast lives or dies, so it is an **input table on the assumptions tab, not a formula buried in the receipts block**.

Build a matrix: for each AR ageing bucket, the share of that balance expected to be collected in each of weeks 1..13, plus a residual marked uncollected-within-horizon.

| 账龄段 | 余额 | W+1 | W+2 | W+3 | W+4-8 | W+9-13 | 期内未回 |
|---|---|---|---|---|---|---|---|
| 未到期 | | | | | | | |
| 0-30 天 | | | | | | | |
| 31-60 天 | | | | | | | |
| 61-90 天 | | | | | | | |
| 90 天以上 | | | | | | | |

Every cell in that matrix is `[测算]`, and each one states its basis in its cell comment: the historical collection pattern derived from the file, the customer's contractual terms, or a treasury judgement. Alongside it, state the **implied DSO** and how it compares with the trailing actual DSO from the ledger — if the curve implies a DSO materially better than the company has ever achieved, the forecast is a wish and the reader must be told.

Also state, as named assumptions: which large customers were modelled individually versus by bucket, the treatment of disputed or provisioned balances, and whether new billings inside the horizon are included (they usually should be, from the order book or the revenue plan — and if they are, that plan is itself a named `[测算]` input).

### Step 3: Receipts

- AR collections, formula-driven off the Step 2 matrix. Never a hardcoded weekly number.
- New-billing collections, if in scope.
- Other receipts: 增值税留抵退税, 政府补助, 资产处置, 利息收入, financing draws under an existing facility (a facility that requires fresh approval is not a receipt — it is a downside mitigant, noted separately).

A `rolling-forecast` or `budget-variance` output may provide an operating assumption, but neither revenue nor profit is cash. Bring future billings into this forecast only after matching the same entity, scope, currency, version, and period, then converting the operating plan through documented order/contract milestones, invoice timing, tax basis, credit terms, and the collection curve. If that cash-conversion evidence is absent, exclude new-billing receipts from the base case and disclose the limitation; do not invent a recurring weekly receipt or convert monthly revenue directly into cash.

### Step 4: Disbursements

Each on its own row, driven by the schedule that governs it, never by a percentage of revenue:

- **Payroll** — on the actual pay dates from the calendar, with 社保/公积金 and any bonus or 年终奖 month shown separately. Payroll is the least flexible line in the forecast and the one most often smoothed by mistake.
- **AP** — by contractual terms off the payables ageing, with any negotiated stretch shown as an explicit assumption rather than baked into the timing.
- **Tax** — 增值税 on its filing calendar, 企业所得税 on its prepayment calendar, 附加税费 with the VAT. If a tax position is uncertain, forecast the scheduled payment and flag the uncertainty for the controller; there is no tax rule engine here and this skill does not compute a tax liability.
- **Debt service** — principal and interest from the loan schedule, by due date, with any maturity inside the horizon called out.
- **Capex** — 已签约 (committed) separately from 计划 (planned). Only the committed portion is a real outflow; the planned portion is a lever.
- **Other** — 租金, 保证金, 分红, one-off items.

### Step 5: Closing cash and headroom

```
期末现金(W) = 期初现金(W) + 收款合计(W) − 付款合计(W)
期初现金(W+1) = 期末现金(W)                        ← a formula, always
可用余量(W)  = 期末现金(W) − 最低现金余额要求
```

Add a **weeks-of-cover** row and mark the first week (if any) in which headroom turns negative. If the facility carries a financial covenant tested inside the horizon, add its test row with the threshold and the projected value from the file — quoting the covenant from the loan document, `[披露]`, with the document named in the cell comment. Do not paraphrase a covenant from memory.

Keep liquidity sources by approval state in both calculations and prose. Base cash and policy headroom exclude all undrawn facilities unless the user explicitly asks for a draw case. Any “available liquidity including facilities” metric may include only signed, currently drawable capacity. Capacity requiring fresh approval remains a contingent mitigant and must never be added to signed capacity to claim that a shortfall is covered, even with a caveat.

### Step 6: The downside case

A toggle on the assumptions tab (`CHOOSE` / `INDEX` off a scenario cell), not a second hardcoded sheet. Sensitise the levers that actually move this forecast, each as a named input:

- collections slip N weeks, or the curve shifts to the next-worse bucket profile;
- DSO +N days;
- the largest one or two receipts fail or slip past the horizon;
- a revenue-plan shortfall on new billings;
- (mitigants shown separately, never netted into the base) capex deferral, AP stretch, facility draw.

Report base and downside side by side for closing cash, headroom, and the first breach week. A forecast with no downside case has not told the treasurer anything about risk.

**Where the boundary with `scenario-analysis` sits.** This step is a **two-case liquidity stress on one horizon** — base and downside on the levers above, answering 「钱够不够、哪一周先破」. It stays here and is not delegated: the levers are this forecast's own (回款曲线、DSO、单笔大额、授信额度), and the answer is a week number.

Hand off to `scenario-analysis` when the question stops being liquidity and starts being **parameter structure**: three or more named scenarios, a ranking of which variable dominates, a two-way table, or a solved break-even. That skill requires a named base artifact and owns the ranges and the break-even; it does **not** re-do the 13-week cash view, and this skill does not grow a third and fourth scenario column. If both are wanted, run this for the liquidity answer and cite that skill's output for the parameter work — 不要在这里堆情景列,也不要在那边重建现金表.

### Step 7: Build the workbook

Through `xlsx-author`. Use these exact Chinese tab names and order: `预测摘要` → `关键假设` → `应收账龄` → `回款曲线` → `收款预测` → `付款预测` → `十三周预测` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. If a schedule is missing, retain the affected tab and state `n.d.（未提供）`, what is missing, and which forecast line remains provisional or uncovered.

Use Chinese for all user-facing workbook and handover text, including titles, headings, column names, scenario names, statuses, checks, conclusions, and limitations. Preserve source identifiers, account numbers, formulas, filenames, contract references, and unavoidable proper names as supplied. Name the file `十三周滚动现金预测_[主体]_[起始日]_待复核草稿.xlsx`.

Every derived cell is a formula. The only hardcodes are the schedule figures on the input tabs and the named assumptions, and **each carries a cell comment** in the schema:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

For an internal input, name the file, source tab and exact source cell, and the period — `Source: 应收账龄表 示例_应收账龄_YYYYMMDD.xlsx, 2026-07-25, 应收账龄!H28「31-60天」合计, 内部文件` · `Source: 借款台账 示例_借款台账_FYxx.xlsx, 2026-07-01, 借款明细!G16 某行流贷本金到期[日期], 内部文件` · `Source: 资金日报 示例_资金日报_YYYYMMDD.xlsx, 2026-07-25, 银行余额!F12 某行账户(尾号已脱敏)期末可用余额, 内部文件`. An assumption cell uses the same line for its basis plus the reasoning and the exact cells supporting it: `Source: [测算] 回款明细!J2:J846, 依据2025-07至2026-06实际回款分布, 31-60天段W+2回款率42%`.

A calculated cell carries a formula instead — a source comment on a calculated cell means a hardcode is hiding in it.

Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, base and downside paths distinguishable, breach weeks prominent, and long assumption or limitation text readable.

`检查`页以实时公式列示：

| 检查 | 测试 |
|---|---|
| 期初勾稽 | W1 期初现金 = 银行/资金表期末余额 |
| 滚动衔接 | 每周期初 = 上周期末(逐周) |
| 回款上限 | 各段回款合计 ≤ 该段应收余额(+ 期内新增开票) |
| 曲线完整 | 每一账龄段各周占比 + 期内未回 = 100% |
| 余量口径 | 可用余量 = 期末现金 − 最低余额要求 |
| 情景切换 | 切换情景后全表重算,且下行情景期末现金 ≤ 基准情景 |

### Step 8: Verify, then hand over

Run `../xlsx-author/scripts/recalc.py` before delivery and fix every error it lists. Then audit at **model** scope against `audit-xls`. A forecast whose formulas have not been evaluated and whose weekly roll-forward has not been exercised is not ready to deliver.

Render and visually inspect every workbook tab before delivery. Fix clipping, unreadable wrapping, narrow weekly columns, hidden breach indicators, broken chart labels, and poor pagination. Search workbook cells, headers/footers, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and remove it. If every tab has not actually been inspected, the workbook is not ready to deliver.

The handover message carries the assumptions block in plain words and closes with the coverage block, which also lives at the top of the `说明与局限` tab:

```
## 覆盖范围与局限
检索于: [timestamp] · 预测区间: [W1 起 — W13 止] · 口径/委托用途: 内部资金计划
期初现金取数: [文件/账户,及其日期] · 情景: 基准 / 下行(见关键假设页)

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 应收账龄 | 有记录([N] 家客户,[金额]) | [文件名] | [date] |
| 应付账龄 / 未清订单 | 有记录 / 检索范围内未发现 / 源不可用 | [文件名] | [date] |
| 期初银行余额 | 有记录([N] 个账户) | [对账单/资金日报] | [date] |
| 薪酬日历 | 有记录 / 源不可用 | [文件名] | [date] |
| 税务日历 | 有记录 / 源不可用 | [文件名] | [date] |
| 借款台账 | 有记录 / 源不可用 | [文件名] | [date] |
| 资本开支(已签约/计划) | 有记录 / 检索范围内未发现 | [文件名] | [date] |
| 契约与最低余额要求 | 有记录 / 检索范围内未发现 | [授信合同] | [date] |

本次未能覆盖: [未提供的账表,以及它本应回答的问题——例如:未提供未清采购订单,
供应商付款按账龄与账期推算,若存在大额未入账订单则本表低估付款]
关键假设(全部为 [测算],详见关键假设页): [回款曲线依据、隐含 DSO 与实际 DSO 的差、
是否含期内新增开票、账期展期假设、情景下行的具体杠杆]
```

## Guardrails

- **Every assumption is named, `[测算]`, and on the assumptions tab.** A forecast whose assumptions are buried in formulas cannot be challenged, and being challenged is the only thing a forecast is for.
- The implied DSO is stated next to the actual DSO, always. A curve that quietly assumes an improvement nobody has agreed to is the standard way this forecast goes wrong.
- Do not invent an ageing bucket, a payment date, a covenant threshold, or a bank balance. A missing schedule is `n.d.（未提供）` plus a coverage line saying what it would have changed.
- Committed and planned capex never share a row. Neither do contracted facility draws and facilities that would need fresh approval.
- This skill does not compute a tax liability, opine on an accounting treatment, or approve a payment. Where the timing of a tax or an accrual is genuinely uncertain, flag it for the controller with the amount at stake.
- Confidential, pre-release treasury material. It stays in this session; distribution to a lender or a board is the finance function's decision, not this skill's.
