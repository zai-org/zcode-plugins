---
name: rolling-forecast
description: A rolling P&L reforecast off the company's own ledger — actuals-to-date plus a driver-based forecast for the remaining periods, reconciled to the approved budget and walked against the prior version. Triggers on "滚动预测", "全年预测", "重新预测", "reforecast", "预算调整后全年怎么样", "rolling forecast", "还能不能完成预算".
---

# Rolling P&L Reforecast

The question is **"given what has actually happened, where does the year land"** — and it
is the artifact the rest of this plugin already assumes. `budget-variance` asks the user
which budget version to compare against and offers 「第 N 版滚动预测」 as an answer, and it
grades a needed reforecast as a 🔴 action. This skill is what produces that version.

Two boundaries, both load-bearing:

- **`cash-forecast` is not this.** That is a 13-week **direct cash** forecast — receipts and
  disbursements, weekly, for treasury. This is a **P&L** reforecast over the remaining
  fiscal periods. They answer different questions, use different drivers, and must not be
  presented as one document. Where the user wants both, produce this and call
  `cash-forecast` for the cash section rather than reproducing it.
- **`budget-variance` looks backwards, this looks forwards.** Variance explains a closed
  period; the reforecast carries those learnings into the periods not yet closed. Run
  `budget-variance` first when both are wanted — its 量价 decomposition is the evidence base
  for the forecast drivers here.

## Inputs and output

Minimum inputs are actuals to date from the close package or trial balance and one explicitly selected approved budget version, both by fiscal period on a common entity, scope, currency, unit, sign, and account basis. Add the prior rolling-forecast version when one exists, plus operational drivers, signed commitments, seasonality history, assumption ranges, and approval records where available. The absence of a prior version makes this the first version; it does not justify inventing a revision walk.

The output is one Chinese rolling-forecast workbook and a matching Chinese written read: actuals and forecast periods remain visibly separate, remaining months are formula-driven, the full-year forecast reconciles to budget and the prior version, the range construction and assumptions are explicit, and unresolved inputs and model limitations remain visible. It is an internal management estimate, not an accounting entry, external guidance, commitment, or decision.

## The line that must never blur

**已实现 (actuals) and 预测 (forecast) are different data classes and are never summed into
an unlabelled total.** Every table separates them, every column header says which it is,
and the full-year figure states its composition explicitly:

> 全年预测 = 已实现 1–7 月（[披露]，关账状态 [初步/最终/已审计]）+ 预测 8–12 月（[测算]）

A full-year number that does not say how much of it already happened is the single most
misleading output this skill can produce.

## Workflow

### Step 1: Settle the frame, then parse and read back

Before any arithmetic, settle with the user — every number downstream depends on these:

- **Entity / consolidation scope**, **fiscal year and the periods already closed**,
  **close status** of the actuals (初步 / 最终 / 已审计), **unit and currency**.
- **Which budget version** is the reconciliation target (年初批准预算 / 上次上会版本), and
  **which prior reforecast version** this one supersedes. Number this version explicitly.

Then parse the files with Python (openpyxl / pandas) via Bash and **read back what you
parsed** — sheet names, header rows, account codes, period columns, sign convention —
before computing anything on it. Required inputs:

- **Actuals to date** — trial balance or close package for the closed periods.
- **The approved budget** — same account basis, full year by period.
- **The prior reforecast**, where one exists — needed for Step 5's walk.

**If a file is missing, ask for it.** Name exactly which file or tab would answer the
question, and say what the deliverable cannot contain until it arrives. Do not reconstruct
a ledger, and **never substitute a listed peer's financials for the company's own numbers.**

Read every non-empty Excel comment or note before analysing the values. Carry comments affecting budget approval, close status, versions, drivers, commitments, seasonality, ranges, restrictions, or review status into the relevant input, assumption, decision item, or limitation. If the first parser exposes values only, use one that also exposes comments; do not infer that the workbook has none.

Keep `单元格正文` and `单元格批注` distinct. Before writing each hardcoded actual, budget, prior-version value, driver, range, or source comment into the output, read that exact source cell back and verify its workbook, sheet, address, row/column label, value, and comment text. Cite only the source address actually read; never derive it from an output row or table pattern.

When more than one candidate budget or prior forecast exists, do not select the newest, largest, or most convenient version. Use only the version whose approval/status and date satisfy the stated comparison purpose; if the user has not selected among materially different candidates, keep the comparison blocked as `待确认` until they do.

Reconcile actuals to the ledger before forecasting on them: YTD revenue and each cost
block must tie to the trial balance. Record the tie-out; a forecast built on unreconciled
actuals inherits the break silently.

If an actual-to-ledger tie fails, show both values and the difference. Do not silently choose one side. The forecast may continue only as a clearly labelled `待复核草稿` on an explicitly named provisional basis, with every dependent full-year result and budget-achievability conclusion marked `待确认`; otherwise stop the affected lines until finance selects the basis.

### Step 2: Choose the forecast basis per line — and say which

Do **not** forecast the P&L as one growth rate. Per material line, state the basis and why:

- **Driver-based** — 量 × 价 for revenue lines where volume and price are separable
  (`budget-variance`'s decomposition gives the historical split). Preferred wherever the
  data supports it, because it is the only basis a reader can argue with.
- **Run-rate** — annualise the recent actual run-rate, stated over how many periods and why
  that window (a run-rate over a seasonal trough forecasts a bad year).
- **Committed / contracted** — order book, signed contracts, lease and debt schedules,
  payroll establishment. These are the most reliable lines; use them where they exist.
- **Budget-retained** — the budget figure is kept because nothing has changed. This is a
  legitimate choice and must be **labelled as a choice**, not left looking like a forecast.
- **Seasonality** — where a line is seasonal, apply the prior-year monthly shape and say so;
  a straight-line remainder on a seasonal line is a known error, not a simplification.

Every forecast input is `[测算]` and belongs in the assumptions block with its basis. An
assumption a reader cannot reproduce from disclosed inputs is not documented.

Normalize units before applying any driver formula. For every material `数量 × 单价 × 期间 × 汇率` calculation, keep the source unit, reporting unit, period basis, and an explicit conversion factor in visible assumption cells; formulas must reference that factor rather than relying on a label such as `万件`, `千吨`, or `百万元`. Reconcile the normalized driver result to the forecast line and perform a dimensional reasonableness check against a relevant actual or budget run-rate. If either check fails, show both readings and the difference, keep the driver `待确认`, and do not use it as a resolved basis for ranges or decisions.

Record a confirmation status for each material assumption: `已确认` only with an explicit owner and date; otherwise `待确认`. A dependent forecast line, subtotal, margin, budget gap, decision item, or range endpoint cannot have a stronger status than its weakest material assumption. Keep unresolved outputs out of definitive decision conclusions.

Apply that status lineage in both tables and prose. If a material driver is unreconciled or `待确认`, label every dependent range endpoint and budget-achievability statement `待确认` or `基于暂定口径`; do not write an unqualified conclusion such as “高端可达预算”. Record the unresolved driver beside the affected output so a reviewer can see what must be confirmed before the conclusion can be used.

### Step 3: Build the remaining periods

- Forecast **by period**, not as a single remainder block — a full-year total with no monthly
  path cannot be tracked next month, which defeats the purpose of a rolling forecast.
- Carry the P&L through to the line management actually decides on (毛利 / 经营利润 /
  EBITDA / 净利润 — whichever the reporting package uses), and keep the bridge visible.
- Whenever the deliverable reports a gross-profit, contribution-profit, operating-profit, or net-profit gap, include a visible formula-driven attribution bridge in both the workbook and the PDF. For gross profit, one acceptable two-step bridge is `收入影响=(预测收入−比较收入)×比较毛利率` and `毛利率影响=预测收入×(预测毛利率−比较毛利率)`; their sum must equal `预测毛利−比较毛利`. Use an equivalent auditable bridge where the business uses another profit measure. Never assign the entire profit gap to revenue when margin also changed, never leave “其余” unquantified, and do not omit the bridge merely because an earlier attribution was unreliable. If the comparison basis is unavailable, show `n.d.（比较口径未取得）` instead of inventing a bridge.
- **Preserve identities**: 毛利率 > 经营利润率 > 净利率 where the structure implies it;
  segment totals tie to the consolidated total; YoY arithmetic ties. If they do not tie, say
  so rather than picking the number that reads better.
- Where a macro or industry driver genuinely moves a line, pull it from
  `wind-economic.query_economic_indicator_data` (the window goes in the `beginDate`/`endDate` parameters (or `observation` for the last N periods), not in the sentence) and cite the resolved indicator name and its `code`. Optional and
  minimal: a macro series that does not change a number does not belong in the deliverable.

Identify every forecast line or product with no actual history in the realised periods. Show its forecast amount separately and name it in `模型局限`; do not let a new line disappear inside a consolidated total or describe its forecast as history-supported.

### Step 4: Reconcile to the budget — and state whether it is achievable

The reader's actual question is usually 「还能不能完成预算」. Answer it as arithmetic, not
as an opinion:

- Full-year forecast vs budget, by line, in amount and %.
- **The gap to budget for the remaining periods**, expressed as what would have to be true:
  「剩余 5 个月需月均收入 X（较已实现月均高 Y%）方可达预算」. That framing is falsifiable;
  「预计有一定压力」 is not.
- Classify each variance driver **timing vs permanent** — a timing shift still lands in the
  year, a permanent one does not. This is the same classification `budget-variance` uses;
  keep it consistent.

### Step 5: Walk it against the prior version — the step that makes it *rolling*

A reforecast with no comparison to its predecessor is just a forecast. Produce a **revision
walk** from the prior version to this one:

```
上版全年预测  →  ±已实现好于/差于预期  →  ±驱动假设调整  →  ±新增或取消事项  →  本版全年预测
```

- Each step is a named, quantified reason. "Refined the model" is not a reason.
- **A line revised in the same direction for three consecutive versions is itself a
  finding** — either the driver is misunderstood or the budget was never achievable. Say
  which you think it is, labelled `[推断]`, with the basis.
- Where this is the first version, say so; there is no walk and the deliverable states that
  rather than fabricating a baseline.

### Step 6: Grade what the CFO has to decide

Per the severity policy. Grade **findings, never the business**.

- `🔴 高`（本期须决策）: 预算缺口需要现在采取的行动才可能补回、覆盖率或契约指标预计被击穿、
  某驱动连续三版同向修正、预测依赖尚未落地的重大假设。
- `🟡 中`（记录并跟踪）: 温和不利偏离且有缓解路径、时间性错期跨期但年内可回、
  单一客户或产品线集中度上升。
- `⚪ 低·信息`: 与预算基本一致、口径调整导致的表面差异。

Cap the front at **three 🔴**.

### Step 7: State the forecast as a range, not a point

A single full-year number reads as a commitment, and the reader will treat it as one. **The deliverable carries a range and says how it was constructed** — the two acceptable constructions, and nothing else:

1. **Driver bands.** Re-run the forecast at each key assumption's low and high (the values already in 「关键假设」's 敏感度 column, taken to the ends of a **stated** range rather than a reflexive ±10%), and report the resulting full-year band. State whether the drivers were moved together or one at a time — it changes the width by a lot, and a band with an unstated construction is not interpretable.
2. **Named scenarios.** Where the question is really 「最坏能到多少」 or 「涨价的话呢」, **do not build a second forecast here — call `scenario-analysis`.** That skill takes *this* version as its named base artifact, ties the base scenario back to it as its first check, and owns the parameter ranges, the impact ranking, and the break-even. Summarise its 基准/乐观/压力 into this report and cite it as the source; re-deriving scenarios inline would put two implementations of the same arithmetic in one plugin.

**A forecast is not a determination, and the deliverable says so on its face.** Alongside the range: the assumptions each figure rests on (「关键假设」), and the model's own limits in 「覆盖范围与局限」 — which lines are driver-based versus run-rate, which periods have no actuals behind them at all, and what the forecast cannot see (an unsigned contract, an unlaunched product, a pending price decision).

**No probabilities unless the user supplies them.** A driver band is not a confidence interval: it is the arithmetic consequence of the stated assumption ranges, with no distribution behind it. Do not label it 「90% 置信区间」, do not weight the scenarios, and do not compute an expected value — say 「基于所述假设区间的测算区间」 and let the reader supply their own judgement of likelihood.

A material driver supplied only as a management point estimate has no range by construction. Record its owner and date, state that it is held at the point value, and exclude it from the band unless the user supplies or approves a bounded range. Name that exclusion and its directional limitation in `关键假设`, `全年预测区间`, and `模型局限`; never create a default ± percentage.

### Step 8: Assemble

The deliverable is always a workbook (`xlsx-author`) plus a written read. **Cut the written
read on what it carries, which is what settles the short/long-form question**: a version that ships the 全年预测区间 and the 模型局限 block
— that is, the full template below — is past the short-form threshold by construction, so it
goes to a document via `report-render`. The range and its construction are what stop a full-year
number from being read as a commitment, and they have to travel with the number; pasted into
a chat window they do not.

Markdown in-session is right for one case only: a delta read against an already-delivered
version — 「上版之后收入驱动改了,全年动了多少」 — which cites that version rather than
replacing it. A first version, or one whose range or 口径 moved, is not a delta read.
State the choice in one clause. **Where a document is asked for, this one is DOCX rather than PDF** — a reforecast narrative is a draft finance and the business units keep writing, so it goes out through `report-render`'s `DocxReport` (same calls, editable styles). The house formatting policy names this skill among the DOCX defaults. A reforecast that has been signed off and is circulating unchanged is the PDF case; say which one you chose. **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

**Formulas over hardcodes — non-negotiable.** A reforecast exists to be re-run: the
controller changes one driver and reads the new full-year number off the same book. So
every derived cell is a live Excel formula, never a value computed in Python and written
as a number. 全年预测 = `=已实现+预测` (`=C16+D16`), 差异 = `=预测-预算` (`=E16-F16`), 月度合计,
毛利率, 达成率, and every walk-bridge row are formulas; the only hardcodes are the actuals
lifted from the close pack, the approved budget line, the prior version's numbers, and the
drivers on an assumptions block. A book where the full-year total is typed in is a
screenshot of a forecast, not a forecast — change the 收入增速 and nothing moves.

Include a **检查** tab that ties and surfaces TRUE/FALSE: 已实现 against the close pack's
科目余额表, 已实现+预测 against 全年预测, the walk from the prior version reconciling to the
version delta, 月度合计 against the annual row, each material driver after unit conversion against its forecast line, dimensional reasonableness, each profit-attribution bridge against the reported profit gap, and every material dependent output's status against its weakest driver. A known unresolved check is still a failed check: keep it in the overall model status and label the package `待复核草稿`; do not exclude it from an “all checks passed” formula. Distinguish `建模错误` from `输入/口径未决`, but neither may produce `全部通过`. Then run the recalc step
(`xlsx-author`), because openpyxl writes formula strings without evaluating them.

Use these exact Chinese workbook tab names and order: `预测摘要` → `实际输入` → `预算输入` → `上版预测` → `关键假设` → `按月预测` → `全年预测` → `版本修正桥` → `预测区间` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create substitute tabs. If this is the first version, retain `上版预测` and `版本修正桥`, mark them `n.d.（本版为首版）`, and do not fabricate a baseline.

Use Chinese for all user-facing workbook, document, and handover text, including titles, headings, column names, statuses, findings, assumptions, and limitations. Preserve source identifiers, account codes, formulas, filenames, document numbers, and unavoidable proper names as supplied. Follow the input workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette.

Use the evaluated workbook as the single numerical source for the document. Build every headline amount, range endpoint, percentage, bridge, chart label, decision item, and prose amount from workbook output cells; do not retype or independently recompute them. Before delivery, compare every displayed value, sign, period, status, and unit scale between the PDF and workbook.

```
**滚动预测（第 [N] 版）— [实体]**
编制于: [date] · 财年: [FY] · 已实现: [1–M 月, 关账状态 关账/初步/已审计] · 预测: [M+1–12 月]
对照预算版本: [名称与批准日] · 上版滚动预测: [第 N-1 版, 日期]
单位: [万元/亿元]（全表一致）

**结论**
全年预测 [金额] = 已实现 [金额]〔披露〕+ 预测 [金额]〔测算〕;较预算 [±金额 / ±%]
达成预算所需条件: 剩余 [k] 个月需月均 [X]（较已实现月均 [±Y%]）

**一、全年预测与预算对照**
| 科目 | 已实现 1–M〔披露〕 | 预测 M+1–12〔测算〕 | 全年预测 | 预算 | 差异 | 差异% | 预测基础 |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  | 量价/运行率/已签约/沿用预算/季节性 |

**一之二、利润差异归因**（仅在报告利润差异时；必须与利润差异归零）
| 归因项 | 金额 | 公式/依据 | 状态 |
|---|---|---|---|
| 收入/规模影响 |  |  |  |
| 毛利率/单位利润影响 |  |  |  |
| 其他可复算影响 |  |  |  |
| 合计 |  | = 报告利润差异 | 通过/不符 |

**二、按月路径**（预测部分逐月，不给单一余额块）
| 科目 | M+1 | M+2 | … | 12 月 |
|---|---|---|---|---|

**三、版本修正走桥**（上版 → 本版）
| 步骤 | 金额 | 说明 |
|---|---|---|
| 上版全年预测 |  |  |
| 已实现好于/差于预期 |  | [测算] |
| 驱动假设调整 |  | [测算]，逐条具名 |
| 新增/取消事项 |  |  |
| 本版全年预测 |  |  |

**四、关键假设**（每条可复算）
| 假设 | 取值 | 区间(低—高) | 依据 | 敏感度(区间两端对全年利润的影响) | 标签 |
|---|---|---|---|---|---|
|  |  |  |  |  | [测算] |

**四之二、全年预测区间**
| | 低端 | 本版 | 高端 |
|---|---|---|---|
| 营业收入 |  |  |  |
| 净利润 |  |  |  |

区间构造方式: 驱动区间(各驱动 [同时/逐个] 移动至所述区间两端) / 情景法(取自 `scenario-analysis`,见 [n])
**本区间为基于所述假设区间的测算区间,不是置信区间;未赋予概率,不得加权求期望。**

**五、需要决策的事项**（至多 3 条 🔴）
| 级别 | 事项 | 影响金额 | 需要的决策 | 时点 |
|---|---|---|---|---|

## 覆盖范围与局限
编制于: [date] · 口径/用途: [如 管理层月度滚动预测]

| 检查项 | 结论 | 源 | 日期 |
|---|---|---|---|
| 已实现数与总账勾稽 | 已勾稽 / 差异 [金额]（已说明） | [文件名与页签] | [date] |
| 预算版本 | 有记录 | [文件名, 批准日] | [date] |
| 上版滚动预测 | 有记录 / 本版为首版（无走桥） | [文件名] | [date] |
| 宏观或行业驱动 | 有记录 / 未使用 | 万得 wind-economic.query_economic_indicator_data [解析后的指标名/code, 报告期] [n] | [date] |
| 同业参照（如使用） | 仅用于外部参照，未用于填补内部数 | 同花顺 hexin-stock.get_stock_financials [n] | [date] |
| 全年预测区间 | 已给出（构造方式: 驱动区间 / 情景法）| 关键假设表 / `scenario-analysis` 交付物 | [date] |
| 模型局限 | 已列示（驱动法与运行率法分别覆盖的科目、无已实现数支撑的期间）| 本节 | [date] |

未取得的输入: [缺失文件及其本应支撑的科目]
模型局限: [哪些科目为驱动法、哪些为运行率法、哪些期间完全无已实现数支撑、
预测看不到的事项(未签合同、未上线产品、未定价格决策)]
区间说明: 本版区间为**基于所述假设区间的测算区间,不是置信区间**;未赋予概率,不得加权求期望
本预测为管理层用途的内部测算，非承诺、非指引、非对外披露信息;
已实现与预测部分在上表中分列，全年数不得脱离该分解单独引用。

## 来源
[n] 〔一手〕内部文件名 · 页签或科目 · 日期(关账日; 编制于) — 内部文件，无 URL
[n] 〔一手〕万得 EDB 宏观经济数据库 · 解析后的指标名与 code · 报告期 [date];检索于 [timestamp]
外部源用 `[n]` 标记并在此列出;内部台账的逐格来源写在单元格批注里,两者不混用。
```

## Citing inside the workbook

Every hardcoded input cell carries a comment in the form:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

For an internal input, name the file, the tab, exact source cell, and the period —
`Source: 结账包 示例_结账包_YYYYMM.xlsx, 2026-08-05, 试算平衡表!H18 6001「主营业务收入」1–7月累计, 内部文件` ·
`Source: 批准预算 示例_批准预算_FYxx.xlsx, 2026-01-15, 收入!D12:O12 按月, 内部文件` ·
`Source: 上版滚动预测 示例_上版滚动预测_FYxx.xlsx, 2026-07-08, 全年预测!F16「经营利润」, 内部文件`.
For an external driver, name the system and the retrieval —
`Source: Wind EDB, 中国:社会融资规模存量:同比 (指标代码与口径读自返回体), 报告期 2026-06, 检索于 2026-08-07`.
**只写这次调用实际返回的字段。** 指标名与 `code` 从 `meta` 读回（`macro-dashboard`、`asset-allocation`、`curve-spread` 都是这个约定）；序列自带的时点字段叫什么、有没有，以本次返回为准 —— 返回里没有发布/更新时点就只写 `检索于`（按引用约定:终端查询无发布日时仅带 `检索于`）。不要凭记忆写 Wind 码型的 EDB 代码（`M` 或 `S` 加一串数字那种形式），也不要凭记忆写一个字段名（例如 Wind 侧的 `updateDate`）：`wind-economic` 是否返回同名字段未经实测，写一个它不返回的字段等于伪造可追溯性。

**A forecast cell is not an input.** Formula cells carry no `Source:` comment; instead the
assumption driving them carries one, in the assumptions block, pointing at whatever
evidences it (a signed contract, a run-rate window, a prior-version figure). A hardcoded
number in a forecast period with no comment is indistinguishable from a guess.

Render and visually inspect every workbook tab and every page of the document before delivery — for a DOCX that is the LibreOffice conversion `report-render`'s verifier produces, and if it could not run, say the layout was not measured. Fix clipping, unreadable wrapping, narrow columns, chart labels, page breaks, and inconsistent values. Severity must remain readable as Chinese text (`高` / `中` / `低`) even if symbols or emoji are unavailable; symbols are optional decoration, never the only label. Search workbook cells, headers/footers, PDF text, and handover text for internal process wording such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, `视觉通道不可用`, or tool/runtime status and require zero matches; do not replace it with another process caveat. If every tab and page has not actually been inspected, do not issue the PDF as a finished deliverable.

## Guardrails

- **Never sum 已实现 and 预测 into an unlabelled total.** Every full-year figure states its
  composition.
- **A forecast is a range with stated limits, not a point.** Every version carries the
  full-year band, how the band was constructed, the assumptions behind it, and what the model
  cannot see. **The band is not a confidence interval** — it is the arithmetic consequence of
  the stated assumption ranges, with no distribution behind it. No probabilities, no
  weighting, no expected value unless the user supplies the probabilities.
- **Multi-scenario work goes to `scenario-analysis`, not inline.** That skill takes this
  version as its named base artifact and owns the parameter ranges, the impact ranking, and
  the break-even; summarise its output and cite it rather than re-deriving scenarios here.
- **This is not guidance.** No external commitment, no market guidance, no forward-looking
  statement for disclosure. It is an internal management estimate, and the deliverable says
  so. The material is unpublished financial information and stays in this session.
- **Do not fill an internal line with market data.** A peer's disclosed revenue is not this
  company's revenue, however plausible it looks in a table. Market data appears only as
  external reference or as a macro driver, labelled as such.
- **No accounting determinations.** Where the forecast depends on a treatment genuinely in
  question — revenue cut-off, capitalisation vs expense, an accrual's adequacy — flag it for
  the controller with the specific accounts and amounts at stake. Do not assert the rule.
- Every assumption is `[测算]` with its basis and appears in the assumptions block; a
  causal read is `[推断]`; a third-party forecast is `[预期]` with the provider named.
  Management's own approved budget quoted as-is is `[披露]`.
- Stop for human review before this reaches a board, a lender, an auditor, or the market.
  The controller and the CFO decide.
- Do not invent example figures — every value above is a placeholder.
