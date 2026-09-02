---
name: 3-statement-model
description: Build or complete integrated 3-statement financial models (Income Statement, Balance Sheet, Cash Flow Statement) with proper linkages. Two entry points, both covered - populating an existing template (fill in, complete, or populate a partially filled IS/BS/CF framework, link statements within an existing structure), and building the three statements from scratch when no template exists (a 搭三表模型 request, or dcf-model's Step 4.5 asking for the projected statements behind a DCF). Owns the rules for the historical block, 口径 reconciliation, the IS-BS-CF tie-outs, and the fixed-asset roll-forward that produces D&A.
---

# 3-Statement Financial Model Template Completion

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

Complete and populate integrated financial model templates with proper linkages between Income Statement, Balance Sheet, and Cash Flow Statement.

## ⚠️ CRITICAL PRINCIPLES — Read Before Populating Any Template

**Environment:**
- Build the workbook with Python/openpyxl following the `xlsx-author` skill conventions. Write formula strings (`ws["D15"] = "=D14*(1+Assumptions!$B$5)"`), then run the recalc script (`../xlsx-author/scripts/recalc.py`, relative to this skill's directory) before delivery.
- The script recalculates a **temp copy** — your workbook is not overwritten, so the cell comments carrying its sources survive. Exit codes are meaningful: `0` clean, `2` errors found, `3` recalc unavailable (LibreOffice missing — static lint only, **NOT a pass**), `1` hard failure.

**Formulas over hardcodes (non-negotiable):**
- Every projection cell, roll-forward, linkage, and subtotal MUST be an Excel formula — never a pre-computed value
- When using Python/openpyxl: write formula strings (`ws["D15"] = "=D14*(1+Assumptions!$B$5)"`), NOT computed results (`ws["D15"] = 12500`)
- The ONLY cells that should contain hardcoded numbers are: (1) historical actuals **as retrieved** — a line item that came out of the filing or the data call, (2) assumption drivers in the Assumptions tab. A historical figure you *derived* from two retrieved ones is not a historical actual; see below.
- If you find yourself computing a value in Python and writing the result to a cell — STOP. Write the formula instead.
- Why: the model must flex when scenarios toggle or assumptions change. Hardcodes break every downstream integrity check silently.

**The historical columns are a model, not a paste.** `历史实际` licenses the lines
you retrieved; it does not license the lines you worked out from them. 毛利润,
毛利率, 营业利润/EBIT, 净利率, YoY 增长率 and every historical subtotal are formulas
in the historical columns for the same reason they are formulas in the projected
ones — the arithmetic is what ties the block back to the filing, and a reader who
cannot see `=B6-B7` cannot tell a transcription error from a real one. The tell
that this rule was missed is a float artifact: an observed 利润表 shipped
`毛利润 = 722.4499999999998` and `折旧摊销 = 490.1799999999999`, numbers no filing
prints and only Python produces. Two mechanical consequences:

- **A row does not change species at the border.** If 毛利率 is `=B8/B6` in the
  forecast columns it is `=B8/B6` in the historical ones too. Ten formulas on the
  right and four typed numbers on the left, in one row, is the signature of this
  defect rather than a layout choice.
- **A retrieved ratio does not become a formula — it becomes a second row.**
  同花顺 returns 销售毛利率 and 销售净利率 as fields, on the vendor's 口径 rather than
  yours. Overwriting a disclosed 4.20% with your own `=归母净利润/营业总收入` 4.06%
  restates a published figure silently: the 14–26bp wedge in the observed model was
  少数股东损益 — 全部净利润 vs 归母 — a real fact about the company that the "fix"
  would have deleted. Where a disclosed ratio and your computed one differ, keep
  both on adjacent rows labelled by 口径 (`净利率(全口径,披露)` / `净利率(归母,测算)`)
  and name the cause in the comment. Do not reach for a variance threshold here:
  `comps-analysis`'s `>10%` trigger is about two sources disagreeing, and a
  definitional gap can be 20bp and still be the whole point.
- **The direction is disclosed-absolute in, ratio out — never the reverse.** This
  rule has one failure mode and a run hit it: told that derived rows must be
  formulas, a model turned `营业成本` into `=收入×(1-毛利率)` and reconstructed a
  disclosed absolute from a four-decimal ratio, landing 3518.01 against a filed
  3518.16. 营业总收入, 营业成本, 营业利润, 所得税, 归母净利润, and every balance-sheet
  and cash-flow line are **inputs** in the historical columns; 毛利润, the margins,
  YoY and the subtotals are what comes *out*. If a formula in a historical column
  has a ratio on its right-hand side, it is pointing the wrong way.
- **A disclosed line you could not retrieve is `源不可用`, not an assumed ratio.**
  The same run wrote historical `EBIT = 收入×4.0%` and `所得税 = -利润总额×0.15`,
  both tagged `[测算]`, for periods whose 营业利润 and 所得税费用 are published. A
  historical actual replaced by an assumption is worse than the hardcode the rule
  was written to remove: the block no longer ties to the filing, so it has stopped
  being the self-check that justified the whole exercise. If the line did not come
  back, record it `源不可用` per the coverage policy, say what that costs
  downstream, and leave the cell `n.d.` — do not estimate a past you could have
  looked up. `利润总额(≈EBIT)` is the same move wearing a tilde: dropping 财务费用
  and 投资收益 to make two rows agree is an undisclosed restatement, not a
  simplification.

**Show your work as you go — do not stop to ask permission:**

Build end to end and deliver the workbook. Surface each stage in the running
message as you complete it, so a reviewer can follow how the numbers were
reached and challenge them on the finished model:

1. **After mapping the template** → which tabs/sections you identified
2. **After populating historicals** → the historical block, with values/periods tied to source data
3. **After building IS projections** → the projected IS with its subtotal checks run
4. **After building BS** → the balance check (Assets = L+E) for every period
5. **After building CF** → the cash tie-out (CF ending cash = BS cash)

- **Do not wait for a reply between stages.** The review gate is at the end,
  between the finished workbook and its use — not between the request and the
  build (the human-review guardrail). Judged inputs go into the
  assumptions block flagged `待确认` with the alternative considered, so the
  reviewer overturns them in one cell.
- The early-error worry is already handled by the formulas-over-hardcodes rule
  above: a model that flexes makes a wrong assumption a one-cell edit rather
  than a downstream rebuild. Structure solves it; asking does not.
- **Ask only when the subject itself is missing** — the template structure is
  genuinely unreadable, an entity resolves to several, a required statement is
  absent from the file. A value you could reasonably pick is never a reason to
  stop; a missing input blocks its own line, not the deliverable.

## Formatting — Professional Blue/Grey Palette (Default unless template/user specifies otherwise)

**Keep colors minimal.** Use only blues and greys for cell fills. Do NOT introduce greens, yellows, oranges, or multiple accent colors as decoration — a clean model uses restraint. The one exception is status or magnitude conditional formatting (check-tab pass/fail, credit-metric thresholds — see [references/formatting.md](references/formatting.md)), which is deliberate, must be confined to those grids, and must carry a legend saying what the colours mean.

| Element | Fill | Font |
|---|---|---|
| Section headers (IS / BS / CF titles) | Dark blue `#1F4E79` | White bold |
| Column headers (FY2024A, FY2025E, etc.) | Light blue `#D9E1F2` | Black bold |
| Input cells (historicals, assumption drivers) | Light grey `#F2F2F2` or white | Blue `#0000FF` |
| Formula cells | White | Black |
| Same-tab pass-through links (`=B9`, no calculation) | White | Purple `#800080` |
| Cross-tab links | White | Green `#008000` |
| Check rows / key totals | Medium blue `#BDD7EE` | Black bold |

**That's 3 blues + 1 grey + white.** If the template has its own color scheme, follow the template instead.

Font color signals *what* a cell is (input/formula/link). Fill color signals *where* you are (header/data/check).

**Four font colours, not three.** Blue = hardcoded input, black = formula, green = link to another sheet, purple = a link on the *same* sheet with no calculation. A cell that merely restates another cell on the same tab is purple — not black (it computes nothing) and not blue (it is not an input).

## Cell Comments — this skill's citation vehicle (`cell_comments`)

A completed template is a workbook, not prose, so its sourcing lives in cell comments rather than a Sources section.

- **Every hardcoded input cell** — every historical actual, every assumption driver — carries:
  `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`
  e.g. `Source: FY2024 10-K, 2025-02-01, Consolidated Balance Sheets, https://…`
- Write the comment **as the cell is populated**, not afterwards.
- **The unit of provenance is the fact — which is usually the row, not the cell.**
  Four report periods pulled by one `get_stock_financials` call are one retrieval on
  one restated basis, so one comment on the row naming the call **and the 报告期基准**
  (`四期同取自 2026-08-11 调用，最新披露口径，含追溯调整`) is better provenance than
  four identical copies of it. A cell that did **not** arrive with its row-mates —
  a different vendor, an original rather than a restated figure, a gap you filled by
  hand from the filing — carries its own comment, because that is a different fact.
  An assumption row held flat across the projection is likewise one judgement, one
  comment; split it only where the reasoning changes mid-row.
- **A hardcoded row with no comment anywhere on it is the failure this is aimed at.**
  In an observed 利润表, 销售费用/管理费用/研发费用/财务费用/其他收益/所得税 shipped with
  zero comments on any period, while the 资产负债表 beside it carried one per row
  throughout. Derived rows in that same sheet also had none, which was *correct* —
  what they were missing was formulas. So before delivering, list every row whose
  historical cells are hardcoded and check each has at least one comment: the rows
  that fail are either unprovenanced retrievals or hardcodes that should have been
  formulas, and the two need opposite fixes.
- **A calculated cell carries a formula instead of a source comment.** The formula is its own provenance — so a source comment on a calculated cell means a hardcode is hiding in it. Find it and replace it with the formula.
- An assumption you judged rather than retrieved is labelled `[测算]` in the comment **and** written into the Assumptions tab with its rationale. Never an unexplained hardcode.
- A figure you cannot source is not entered. If the template demands a value in the cell, write `n.d.`

## Model Structure

### Two entry points — a template to fill, or nothing to start from

Everything below about tabs, named ranges and preserving existing formulas assumes a
**template file exists**. Often it does not: `dcf-model`'s Step 4.5 loads this skill to
build 利润表 / 资产负债表 / 现金流量表 from scratch in a new workbook, and a user who says
「搭一个三表模型」 has handed you no template either. Take the branch explicitly and name
the one you took in the running message:

- **Template provided** → "Identifying Template Tab Organization" onward. Only edit
  input cells, preserve the existing formulas, respect the template's units and signs.
- **No template** → build the skeleton below, then rejoin at "Step 4: Quality Checks by
  Sheet". Skip the Excel-UI procedures (Trace Precedents, Name Manager, Paste Values):
  they describe reviewing someone else's file, and openpyxl cannot perform them anyway.
  Their intent — knowing which cells are inputs and which are formulas — is satisfied by
  building it yourself under the font-colour convention above.

**A-share 三表 skeleton (no template).** One sheet per statement, 报告期 across the
columns (historicals first, then 预测期, with a visible border between them), line items
down the rows in disclosure order. Every ratio row is a formula in **both** halves (the
historical-columns rule above), and every projected row reads the 假设 sheet:

```
利润表        营业总收入 / 营业成本 / 毛利润(=收入−成本) / 毛利率(=毛利润/收入)
              税金及附加 / 销售费用 / 管理费用 / 研发费用 / 财务费用
              其他收益 / 投资收益 / 公允价值变动损益 / 信用及资产减值损失
              营业利润 / 营业利润率 / 利润总额 / 所得税费用 / 有效税率(=所得税/利润总额)
              净利润(全口径) / 少数股东损益 / 归母净利润
              净利率(全口径,披露) / 净利率(归母,测算)      ← 口径并列，见上文
资产负债表    货币资金 / 交易性金融资产 / 应收账款 / 存货 / 合同资产 / 其他流动资产
              固定资产 / 在建工程 / 使用权资产 / 无形资产 / 长期股权投资 / 递延所得税资产
              短期借款 / 应付账款 / 合同负债 / 一年内到期非流动负债 / 长期借款 / 应付债券 / 租赁负债
              归母所有者权益 / 少数股东权益 / 负债和所有者权益合计
              营运资金(=应收+存货−应付) 及 应收/存货/应付周转天数
现金流量表    净利润 / 折旧摊销 / 减值 / 营运资金变动明细 / 经营活动现金流净额
              购建固定资产支付的现金(CapEx) / 投资活动现金流净额
              取得借款/偿还债务 / 分配股利 / 筹资活动现金流净额 / 现金净增加额 / 期末现金
支撑滚动表    固定资产滚动(期初 + CapEx − 折旧 = 期末)、有息负债滚动(期初 + 新增 − 偿还 = 期末)
```

固定资产滚动表不是可选项：它是 D&A 的来源，而 `dcf-model` 的 FCF 直接链接这一行（Step 4.5）。
折旧由目标折旧年限或历史折旧率驱动，**不用「收入 × 比率」** —— 那条路径会让 D&A 与资产负债表上的
固定资产各说各话。

### Identifying Template Tab Organization

Templates vary in their tab naming conventions and organization. Before populating, review all tabs to understand the template's structure. Below are common tab names and their typical contents:

| Common Tab Names | Contents to Look For |
|------------------|----------------------|
| IS, P&L, Income Statement | Income Statement |
| BS, Balance Sheet | Balance Sheet |
| CF, CFS, Cash Flow | Cash Flow Statement |
| WC, Working Capital | Working Capital Schedule |
| DA, D&A, Depreciation, PP&E | Depreciation & Amortization Schedule |
| Debt, Debt Schedule | Debt Schedule |
| NOL, Tax, DTA | Net Operating Loss Schedule |
| Assumptions, Inputs, Drivers | Driver assumptions and inputs |
| Checks, Audit, Validation | Error-checking dashboard |

**Template Review Checklist**
- Identify which tabs exist in the template (not all templates include every schedule)
- Note any template-specific tabs not listed above
- Understand tab dependencies (e.g., which schedules feed into the main statements)
- Locate input cells vs. formula cells on each tab

### Understanding Template Structure

Before populating a template, familiarize yourself with its existing layout to ensure data is entered in the correct locations and formulas remain intact.

**Identifying Row Structure**
- Locate the model title at top of each tab
- Identify section headers and their visual separation
- Find the units row indicating $ millions, %, x, etc.
- Note column headers distinguishing Actuals vs. Estimates periods
- Confirm period labels (e.g., FY2024A, FY2025E)
- Identify input cells vs. formula cells (typically distinguished by font color)

**Identifying Column Structure**
- Confirm line item labels in leftmost column
- Verify historical years precede projection years
- Note the visual border separating historical from projected periods
- Check for consistent column order across all tabs

**Working with Named Ranges**
Templates often use named ranges for key inputs and outputs. Before entering data:
- Review existing named ranges in the template (Formulas → Name Manager in Excel)
- Common named ranges include: Revenue growth rates, cost percentages, key outputs (Net Income, EBITDA, Total Debt, Cash), scenario selector cell
- Ensure inputs are entered in cells that feed into these named ranges

### Projection Period
- Templates typically project 5 years forward from last historical year
- Verify historical (A) vs. projected (E) columns are clearly separated
- Confirm columns use fiscal year notation (e.g., FY2024A, FY2025E)

## Margin Analysis

**Note: The following margin analysis should only be performed if prompted by the user or if the template explicitly requires it. If no prompt is given, skip this section.**

Calculate and display profitability margins on the Income Statement (IS) tab to track operational efficiency and enable peer comparison.

### Core Margins to Include

| Margin | Formula | What It Measures |
|--------|---------|------------------|
| Gross Margin | Gross Profit / Revenue | Pricing power, production efficiency |
| EBITDA Margin | EBITDA / Revenue | Core operating profitability |
| EBIT Margin | EBIT / Revenue | Operating profitability after D&A |
| Net Income Margin | Net Income / Revenue | Bottom-line profitability |

### Income Statement Layout with Margins

Display margin percentages directly below each profit line item:
- Gross Margin % below Gross Profit
- EBIT Margin % below EBIT
- EBITDA Margin % below EBITDA
- Net Income Margin % below Net Income

## Credit Metrics

**Note: The following Credit analysis should only be performed if prompted by the user or if the template explicitly requires it. If no prompt is given, skip this section.**

Calculate and display credit/leverage metrics on the Balance Sheet (BS) tab to assess financial health, debt capacity, and covenant compliance.

### Core Credit Metrics to Include

| Metric | Formula | What It Measures |
|--------|---------|------------------|
| Total Debt / EBITDA | Total Debt / LTM EBITDA | Leverage multiple |
| Net Debt / EBITDA | (Total Debt - Cash) / LTM EBITDA | Leverage net of cash |
| Interest Coverage | EBITDA / Interest Expense | Ability to service debt |
| Debt / Total Cap | Total Debt / (Total Debt + Equity) | Capital structure |
| Debt / Equity | Total Debt / Total Equity | Financial leverage |
| Current Ratio | Current Assets / Current Liabilities | Short-term liquidity |
| Quick Ratio | (Current Assets - Inventory) / Current Liabilities | Immediate liquidity |

### Credit Metric Hierarchy Checks

Validate that Upside shows the strongest credit profile:
- Leverage: Upside < Base < Downside (lower is better)
- Coverage: Upside > Base > Downside (higher is better)
- Liquidity: Upside > Base > Downside (higher is better)

**Check it on the exit year, and allow a near-term crossover.** A debt-funded growth
programme can leave the upside case *more* levered and *less* liquid in years 1-2 while
ending the forecast in the strongest position. Where that happens, say so with the year
it turns; a hierarchy check that fires on a coherent investment plan sends the model
back for the wrong reason.

### Covenant Compliance Tracking

If debt covenants are known, add explicit compliance checks comparing actual metrics to covenant thresholds.

## Scenario Analysis (Base / Upside / Downside)

Use a scenario toggle (dropdown) in the Assumptions tab with CHOOSE or INDEX/MATCH formulas.

**One workbook, one toggle.** When this skill is invoked from `dcf-model` (its Step 4.5),
that skill's vocabulary and selector win: Bear / Base / Bull, resolved at the single
`1/2/3` selector cell on the DCF sheet (B6 in its layout). Same three cases, different
names — read Upside as Bull and Downside as Bear, wire the statements to that cell with
cross-sheet links, and do not add a second dropdown on the Assumptions tab. Two toggles
produce an income statement sitting in the base case while the DCF sits in the bull case;
both halves are internally consistent, so nothing errors.

| Scenario | Description |
|----------|-------------|
| Base Case | Management guidance or consensus estimates |
| Upside Case | Above-guidance growth, margin expansion |
| Downside Case | Below-trend growth, margin compression |

**Key Drivers to Sensitize**: Revenue growth, Gross margin, SG&A %, DSO/DIO/DPO, CapEx %, Interest rate, Tax rate.

**Scenario Audit Checks**: Toggle switches all statements, BS balances in all scenarios, Cash ties out, Hierarchy holds (Upside > Base > Downside for NI, EBITDA, FCF, margins).

## SEC Filings Data Extraction

If the template specifically requires pulling data from SEC filings (10-K, 10-Q), see [references/sec-filings.md](references/sec-filings.md) for detailed extraction guidance. This reference is only needed when populating templates with public company data from regulatory filings.

## Completing Model Templates

This section provides general guidance for completing any 3-statement financial model template while preserving existing formulas and ensuring data integrity.

### Step 1: Analyze the Template Structure

Before entering any data, thoroughly review the template to understand its architecture:

**Identify Input vs. Formula Cells**
- Look for visual cues (font color, cell shading) that distinguish input cells from formula cells
- Common conventions: Blue font = hardcoded inputs, Black font = formulas, Purple font = same-tab links with no calculation, Green font = links to other sheets
- Use Excel's Trace Precedents/Dependents (Formulas → Trace Precedents) to understand cell relationships
- Check for named ranges that may control key inputs (Formulas → Name Manager)

**Map the Template's Flow**
- Identify which tabs feed into others (e.g., Assumptions → IS → BS → CF)
- Note any supporting schedules and their linkages to main statements
- Document the template's specific line items and structure before populating

### Step 2: Filling in Data Without Breaking Formulas

**Golden Rules for Data Entry**

| Rule | Description |
|------|-------------|
| Only edit input cells | Never overwrite cells containing formulas unless intentionally replacing the formula |
| Preserve cell references | When copying data, use Paste Values (Ctrl+Shift+V) to avoid overwriting formulas with source formatting |
| Match the template's units | Verify if template uses thousands, millions, or actual values before entering data |
| Respect sign conventions | Follow the template's existing sign convention (e.g., expenses as positive or negative) |
| Check for circular references | If the template uses iterative calculations, ensure Enable Iterative Calculation is turned on |

**Safe Data Entry Process**
1. Identify the exact cells designated for input (usually highlighted or labeled)
2. Enter historical data first, then verify formulas are calculating correctly for those periods
3. Enter assumption drivers that feed forecast calculations
4. Review calculated outputs to confirm formulas are working as intended
5. If a formula cell must be modified, document the original formula before making changes

**Handling Pre-Built Formulas**
- If formulas reference cells you haven't populated yet, expect temporary errors (#REF!, #DIV/0!) until all inputs are complete
- When formulas produce unexpected results, trace precedents to identify missing or incorrect inputs
- Never delete rows/columns without checking for formula dependencies across all tabs

### Step 3: Validating Formulas

**Formula Integrity Checks**

Before relying on template outputs, validate that formulas are functioning correctly:

| Check Type | Method |
|------------|--------|
| Trace precedents | Select a formula cell → Formulas → Trace Precedents to verify it references correct inputs |
| Trace dependents | Verify key inputs flow to expected output cells |
| Evaluate formula | Use Formulas → Evaluate Formula to step through complex calculations |
| Check for hardcodes | Projection formulas should reference assumptions, not contain hardcoded values |
| Test with known values | Input simple test values to verify formulas produce expected results |
| Cross-tab consistency | Ensure the same formula logic applies across all projection periods |

**Common Formula Issues to Watch For**
- Mixed absolute/relative references causing incorrect results when copied across periods
- Broken links to external files or deleted ranges (#REF! errors)
- Division by zero in early periods before revenue ramps (#DIV/0! errors)
- Circular reference warnings (may be intentional for interest calculations)
- Inconsistent formulas across projection columns (use Ctrl+\ to find differences)

**Validating Cross-Tab Linkages**
- Confirm values that appear on multiple tabs are linked (not duplicated)
- Verify schedule totals tie to corresponding line items on main statements
- Check that period labels align across all tabs

### Step 4: Quality Checks by Sheet

Perform these validation checks on each sheet after populating the template:

**Income Statement (IS) Quality Checks**
- Revenue figures match source data for historical periods
- All expense line items sum to reported totals
- Subtotals (Gross Profit, EBIT, EBT, Net Income) calculate correctly
- Tax calculation logic is appropriate (handles losses correctly)
- Forecast drivers reference assumptions tab (no hardcodes)
- Period-over-period changes are directionally reasonable

**Balance Sheet (BS) Quality Checks**
- Assets = Liabilities + Equity for every period (primary check)
- Cash balance matches Cash Flow Statement ending cash
- Working capital accounts tie to supporting schedules (if applicable)
- Retained Earnings rolls forward correctly: Prior RE + Net Income - Dividends +/- Adjustments = Ending RE
- Debt balances tie to debt schedule (if applicable)
- All balance sheet items have appropriate signs (assets positive, most liabilities positive)

**Cash Flow Statement (CF) Quality Checks**
- Net Income at top of CFO matches Income Statement Net Income
- Non-cash add-backs (D&A, SBC, etc.) tie to their source schedules/statements
- Working capital changes have correct signs (increase in asset = use of cash = negative)
- CapEx ties to PP&E schedule or fixed asset roll-forward
- Financing activities tie to changes in debt and equity accounts on BS
- Ending Cash matches Balance Sheet Cash
- Beginning Cash equals prior period Ending Cash

**Supporting Schedule Quality Checks**
- Opening balances equal prior period closing balances
- Roll-forward logic is complete (Beginning + Additions - Deductions = Ending)
- Schedule totals tie to main statement line items
- Assumptions used in calculations match Assumptions tab

### Step 5: Cross-Statement Integrity Checks

After validating individual sheets, confirm the three statements are properly integrated:

| Check | Formula | Expected Result |
|-------|---------|-----------------|
| Balance Sheet Balance | Assets - Liabilities - Equity | = 0 |
| Cash Tie-Out | CF Ending Cash - BS Cash | = 0 |
| Net Income Link | IS Net Income - CF Starting Net Income | = 0 |
| Retained Earnings | Prior RE + NI - Dividends - BS Ending RE | = 0 (adjust for SBC/other items as needed) |
| 口径对账 (historical periods) | disclosed ratio − ratio computed from the disclosed absolutes | = the 口径 wedge you named — a stated non-zero number per historical period. This row is a reconciliation, not a zero check |

**A check may not restate the formula of the cell it checks.** An observed Checks
tab carried `营业成本 = 收入×(1-毛利率)` as a validation row while 营业成本 *was*
that formula — the row can never read ✗, so it certifies nothing and reads to a
reviewer as a passed test. A check earns its place only when its two sides reach
the same quantity by **independent** routes: one from the model's own chain, the
other from a disclosed figure, a different statement, or an identity that must hold
by definition. If you cannot name the second route, delete the row.

**The 口径 reconciliation covers the historical periods, not just the forecast.**
`净利润 = 归母净利润 (预测期, 无少数股东)` is a fair assumption about the projection
and says nothing about the years that were filed. The wedge lives in the history,
so that is where the row belongs — one per historical period, tying the disclosed
ratio to the one your absolutes produce, with 少数股东损益 (or whatever the cause is)
carried as its own line rather than absorbed.

### Step 6: Final Review

Before considering the model complete:
- Toggle through all scenarios (if applicable) to verify checks pass in each case
- Review all #REF!, #DIV/0!, #VALUE!, and #NAME? errors and resolve or document
- Confirm all input cells have been populated (search for placeholder values)
- Verify units are consistent across all tabs
- Save a clean version before making any additional modifications

## Model Validation and Audit

This section consolidates all validation checks and audit procedures for completed templates.

### Core Linkages (Must Always Hold)

See [references/formulas.md](references/formulas.md) for all formula details.

| Check | Formula | Expected Result |
|-------|---------|-----------------|
| Balance Sheet Balance | Assets - Liabilities - Equity | = 0 |
| Cash Tie-Out | CF Ending Cash - BS Cash | = 0 |
| Cash Monthly vs Annual | Closing Cash (Monthly) - Closing Cash (Annual) | = 0 |
| Net Income Link | IS Net Income - CF Starting Net Income | = 0 |
| Retained Earnings | Prior RE + NI + SBC - Dividends - BS Ending RE | = 0 |
| Equity Financing | ΔCommon Stock/APIC (BS) - Equity Issuance (CFF) | = 0 |
| Year 0 Equity | Equity Raised (Year 0) - Beginning Equity Capital (Year 1) | = 0 |

### Sign Convention Reference

| Statement | Item | Sign Convention |
|-----------|------|-----------------|
| CFO | D&A, SBC | Positive (add-back) |
| CFO | ΔAR (increase) | Negative (use of cash) |
| CFO | ΔAP (increase) | Positive (source of cash) |
| CFI | CapEx | Negative |
| CFF | Debt issuance | Positive |
| CFF | Debt repayments | Negative |
| CFF | Dividends | Negative |

### Circular Reference Handling

Interest expense creates circularity: Interest → Net Income → Cash → Debt Balance → Interest

Enable iterative calculation in Excel: File → Options → Formulas → Enable iterative calculation. Set maximum iterations to 100, maximum change to 0.001. Add a circuit breaker toggle in Assumptions tab.

### Check Categories

**Section 1: Currency Consistency**
- Currency identified and documented in Assumptions
- All tabs use consistent currency symbol and scale
- Units row matches model currency

**Section 2: Balance Sheet Integrity**
- Assets = Liabilities + Equity (for each period)
- Formula: Assets - Liabilities - Equity (must = 0)

**Section 3: Cash Flow Integrity**
- Cash ties to BS (CF Ending Cash = BS Cash)
- Cash Monthly vs Annual: Closing Cash (Monthly) = Closing Cash (Annual)
- NI ties to IS (CF Net Income = IS Net Income)
- D&A ties to schedule
- SBC ties to IS
- ΔAR, ΔInventory, ΔAP tie to WC schedule
- CapEx ties to DA schedule

**Section 4: Retained Earnings**
- RE roll-forward check: Prior RE + NI + SBC - Dividends = Ending RE
- Show component breakdown for debugging

**Section 5: Working Capital**
- AR, Inventory, AP tie to BS
- DSO, DIO, DPO reasonability checks (flag if outside normal ranges)

**Section 6: Debt Schedule**
- Total Debt ties to BS (Current + LT Debt)
- Interest calculation ties to IS

**Section 6b: Equity Financing**
- Equity issuance proceeds tie to BS Common Stock/APIC increase
- Cash increase from equity = Equity account increase (must balance)
- Equity Raise Tie-Out: ΔCommon Stock/APIC (BS) = Equity Issuance (CFF) (must = 0)
- Year 0 Equity Tie-Out: Equity Raised (Year 0) = Beginning Equity Capital (Year 1)

**Section 6c: 亏损结转 / NOL Schedule — the rule is jurisdictional**

Shared, either jurisdiction:
- Beginning balance (Year 1 / Formation) = 0 (a new business starts with zero)
- The balance increases only when EBT < 0 (losses must be realized), and is non-negative
- DTA ties to BS (Schedule DTA = BS Deferred Tax Asset)
- Tax expense = 0 when taxable income ≤ 0

**US filers**: utilization ≤ 80% of taxable income (post-2017 federal limitation),
carried forward indefinitely.

**PRC issuers (A 股) — do not apply the 80% cap; it does not exist here.** 企业所得税
亏损弥补期为 **5 年**（高新技术企业与科技型中小企业 10 年，2018 年起），当期抵扣没有比例上限。
Applying the US rule to an A-share model understates the DTA and overstates near-term
tax. State which regime the schedule is built on, on the schedule.

**Section 7: Scenario Hierarchy**
- Absolute metrics: Upside > Base > Downside (NI, EBITDA)
- Margins: Upside > Base > Downside (GM%, EBITDA%, NI%)
- Credit metrics: Upside < Base < Downside for leverage (inverted)
- **FCF is not in this hierarchy, and a violation is not an error.** Faster growth
  consumes working capital and capex, so a genuine upside case can produce *lower*
  near-term free cash flow than the base — that is the cash cost of growth, not a broken
  model. Flag the crossover, name the year the ordering reverses, and explain it. Never
  "fix" it by quietly softening the upside case's investment.

**Section 8: Formula Integrity**
- COGS, S&M, G&A, R&D, SBC driven by % of Revenue (no hardcodes)
- Consistent formulas across projection years
- No #REF!, #DIV/0!, #VALUE! errors

**Section 9: Credit Metric Thresholds**
- Flag metrics as Green/Yellow/Red based on covenant thresholds
- Summary of any red flags

### Master Check Formula

Aggregate all section statuses into a single master check:
- If all sections pass → "✓ ALL CHECKS PASS"
- If any section fails → "✗ ERRORS DETECTED - REVIEW BELOW"

### Quick Debug Workflow

When Master Status shows errors:
1. Scroll to find red-highlighted sections
2. Identify which check category has failures
3. Navigate to source tab to investigate
4. Fix the underlying issue
5. Return to Checks tab to verify resolution

## Delivering the Model — Coverage Block

The workbook's sources live in its cell comments. The message that hands it over
states what those cells rest on. Close every delivery with this block, verbatim
heading, even when every check passed:

```
## 覆盖范围与局限
Retrieved: <timestamp>

- Historicals: <which statements and periods were populated, and from where —
  e.g. FY2022–FY2024 IS/BS/CF from the FY2024 10-K; segment detail from the
  FY2024 20-F; nothing retrieved for FY2021>
- Analyst assumptions (not retrieved data): <the drivers you judged rather than
  sourced — revenue growth, gross margin, DSO/DIO/DPO, CapEx %, tax rate,
  interest rate. Each is also `[测算]` in its cell comment and on the
  Assumptions tab>
- Formula evaluation: <one of> recalc.py evaluated all N formulas via
  LibreOffice, zero errors (exit 0) / recalc.py could NOT evaluate the formulas
  (exit 3, LibreOffice unavailable) — only a static lint plus the openpyxl
  reference/recompute/identity checks ran; the model is NOT verified and the
  user should confirm the balance check and cash tie-out on open
- Not covered: <sources that failed or were out of scope, schedules the template
  omits, and what they would have covered>
```

`recalc_unavailable` is not a pass — `xlsx-author`'s honesty protocol says so
explicitly. A model whose formulas were never evaluated says that here, in plain
words, and is never described as "verified" or "audited". A green
"✓ ALL CHECKS PASS" on the Checks tab is itself a formula result: if the formulas
were not evaluated, that cell proves nothing either.

