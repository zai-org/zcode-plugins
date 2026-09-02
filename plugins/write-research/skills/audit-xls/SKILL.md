---
name: audit-xls
description: Audit a spreadsheet for formula accuracy, errors, and common mistakes. Scopes to a selected range, a single sheet, or the entire model (including financial-model integrity checks like BS balance, cash tie-out, and logic sanity). Triggers on "audit this sheet", "check my formulas", "find formula errors", "QA this spreadsheet", "sanity check this", "debug model", "model check", "model won't balance", "something's off in my model", "model review".
---

# Audit Spreadsheet

Audit formulas and data for accuracy and mistakes. Scope determines depth — from quick formula checks on a selection up to full financial-model integrity audits.

## Step 1: Determine scope

If the user already gave a scope, use it. Otherwise **ask them**:

> What scope do you want me to audit?
> - **selection** — just the currently selected range
> - **sheet** — the current active sheet only
> - **model** — the whole workbook, including financial-model integrity checks (BS balance, cash tie-out, roll-forwards, logic sanity)

The **model** scope is the deepest — use it for DCF, LBO, 3-statement, merger, comps, or any integrated financial model before sending to a client or IC.

---

## Step 2: Formula-level checks (ALL scopes)

Run these regardless of scope:

| Check | What to look for |
|---|---|
| Formula errors | `#REF!`, `#VALUE!`, `#N/A`, `#DIV/0!`, `#NAME?` |
| Hardcodes inside formulas | `=A1*1.05` — the `1.05` should be a cell reference |
| Inconsistent formulas | A formula that breaks the pattern of its neighbors in a row/column |
| Off-by-one ranges | `SUM`/`AVERAGE` that misses the first or last row |
| Pasted-over formulas | Cell that looks like a formula but is actually a hardcoded value |
| **Retrieved values typed inside formulas** | The opposite direction, and easier to miss because the cell genuinely *is* a formula: `=6173.8194+1.1194`, `=收入*0.0865`. Each literal is a retrieved figure with no cell of its own — it cannot be coloured, cannot carry a source comment, and does not move when its input changes. Distinguish from **structural constants**, which a formula may hold: unit conversions (`/10000`), period counts (`/12`, `/4.33`), percentage-to-decimal (`/100`). The tell is a multi-decimal literal; structural constants are short and round. Fix by lifting each figure to an input cell with its own comment. |
| Derived historicals typed as inputs | A row that is a formula in the forecast columns and a typed number in the historical ones — 毛利润, 毛利率, 净利率, YoY 增长率, subtotals; and its sibling case, a scenario derived from the base case by a stated rule (下行 = 基准×0.7) typed out instead of referencing it. **The tell is a full-precision float in an uncommented cell**: `722.4499999999998`, `0.09799999999999999`. Read the **raw** value, not the displayed one — every observed instance sat behind a `#,##0.0` or `0.0%` format, which is exactly why none was ever noticed. A *commented* cell at that precision is a vendor field at native precision (`涨跌幅 = 3.357724446617073`) and is not this finding. |
| Disclosed ratio vs computable ratio | A retrieved 毛利率/净利率 sitting under the line items it could be computed from, differing by a fixed 口径 wedge (归母 vs 全口径, TTM vs 年报). This is not a variance to reconcile away and no percentage threshold catches it — a 20bp gap can be the entire finding. Flag it if the workbook shows one number where two 口径 exist. |
| Unprovenanced hardcoded rows | A row whose historical cells are all hardcoded and which carries **no** cell comment on any of them. Distinguish the two causes, because the fixes are opposite: a *retrieved* row is missing its source, a *derived* row is missing its formula and should have no comment at all. |
| Disclosed absolutes reconstructed from ratios | The reverse of the above and just as wrong: `营业成本 = 收入×(1-毛利率)`, `EBIT = 收入×4.0%`, `所得税 = -利润总额×0.15` in a **historical** column. A filed absolute rebuilt from a rounded ratio loses precision (3518.01 against a filed 3518.16); a filed absolute replaced by an assumed ratio means the block no longer ties to the filing at all, which is worse than the hardcode. Historical direction is absolutes in, ratios out. |
| Tautological checks | A Checks-tab row whose two sides are the same formula — `营业成本 = 收入×(1-毛利率)` validating the cell that *is* that formula. It can never read ✗, so it certifies nothing while reading as a passed test. Name the second, independent route or the row should not exist. |
| Circular references | Intentional or accidental |
| Broken cross-sheet links | References to cells that moved or were deleted |
| Unit/scale mismatches | Thousands mixed with millions, % stored as whole numbers |
| Hidden rows/tabs | Could contain overrides or stale calculations |

**Detecting formula errors requires evaluated values.** If the workbook has no cached results (freshly written by openpyxl) run `../xlsx-author/scripts/recalc.py` first. It does not modify the file — it recalculates a copy — and its exit code is meaningful (`0` clean, `2` errors found, `3` recalc unavailable). If it returns `recalc_unavailable`, no formula was evaluated — say so in the report and fall back to the independent verification in `xlsx-author` ("When recalc is unavailable"): assert every formula references the intended cells, recompute derived values in Python, and check the definitional identities. An audit run without evaluation must be labelled as such; never report "no errors found" when nothing was computed, and emit no severity levels at all for checks that never ran.

---

## Step 3: Model-integrity checks (MODEL scope only)

If scope is **model**, identify the model type (DCF / LBO / 3-statement / merger / comps / custom) and run the appropriate integrity checks below.

### 3a. Structural review

| Check | What to look for |
|---|---|
| Input/formula separation | Are inputs clearly separated from calculations? |
| Colour convention | Four colours, per the house formatting policy: blue=input, black=formula, green=link to another sheet, **purple=link on the same sheet with no calculation**. Applied consistently? A purple-less rule set cannot see the fourth case, which is how it went unaudited. |
| Tab flow | Logical order (Assumptions → IS → BS → CF → Valuation)? |
| Date headers | Consistent across all tabs? |
| Units | Consistent (thousands vs millions vs actuals)? |

### 3b. Balance Sheet

| Check | Test |
|---|---|
| BS balances | Total Assets = Total Liabilities + Equity (every period) |
| RE rollforward | Prior RE + Net Income − Dividends = Current RE |
| Goodwill/intangibles | Flow from acquisition assumptions (if M&A) |

If BS doesn't balance, **quantify the gap per period and trace where it breaks** — nothing else matters until this is fixed.

### 3c. Cash Flow Statement

| Check | Test |
|---|---|
| Cash tie-out | CF Ending Cash = BS Cash (every period) |
| CF sums | CFO + CFI + CFF = Δ Cash |
| D&A match | D&A on CF = D&A on IS |
| CapEx match | CapEx on CF matches PP&E rollforward on BS |
| WC changes | Signs match BS movements (ΔAR, ΔAP, ΔInventory) |

### 3d. Income Statement

| Check | Test |
|---|---|
| Revenue build | Ties to segment/product detail |
| Tax | Tax expense = Pre-tax income × tax rate (allow for deferred tax adj) |
| Share count | Ties to dilution schedule (options, converts, buybacks) |

### 3e. Circular references

- Interest → debt balance → cash → interest is a common intentional circ in LBO/3-stmt models
- If intentional: verify iteration toggle exists and works
- If unintentional: trace the loop and flag how to break it

### 3f. Logic & reasonableness

| Check | Flag if |
|---|---|
| Growth rates | >100% revenue growth without explanation |
| Margins | Outside industry norms |
| Hockey-stick | Projections ramp unrealistically in out-years |
| Compounding | EBITDA compounds to absurd $ by Year 10 |
| Edge cases | Model breaks at 0% or negative growth, negative EBITDA, leverage goes negative |

### 3g. Definitional identities — assert these, do not eyeball them

These must hold by definition, so they are checkable in Python against the
inputs even when no spreadsheet engine is available. Report a violation as 🔴.

| Identity | Test |
|---|---|
| Margin ordering | gross margin > operating margin > net margin |
| Balance sheet | Total Assets = Total Liabilities + Equity, every period |
| Sources & uses | sources = uses, exactly |
| Sum of parts | segment/product detail sums to the reported total |
| **Terminal growth vs discount rate** | terminal g **<** WACC. If g ≥ WACC the Gordon denominator is zero or negative: the model is not conservative, it is arithmetically invalid, and any implied value it prints is meaningless. |
| **WACC plausibility** | WACC outside 5–20% needs an explicit justification in the model, not a comment in the audit |
| **Terminal value share** | TV / EV **> 75%** → the valuation is mostly an assumption about perpetuity rather than a forecast. Flag 🟡 and say what share it is. |

The 75% threshold is single-sourced here on purpose. It previously existed as
70%, 75%, and 80% in three places — a prose checklist, a second prose checklist,
and an unreachable script — which meant the same model passed or failed depending
on which one you happened to read.

### 3h. Model-type-specific bugs

**DCF:**
- Discount rate applied to wrong period (mid-year vs end-of-year)
- Terminal value not discounted back
- WACC uses book values instead of market values
- FCF includes interest expense (should be unlevered)
- Tax shield double-counted

**LBO:**
- Debt paydown doesn't match cash sweep mechanics
- PIK interest not accruing to principal
- Management rollover not reflected in returns
- Exit multiple applied to wrong EBITDA (LTM vs NTM)
- Fees/expenses not deducted from Day 1 equity

**Merger:**
- Accretion/dilution uses wrong share count (pre- vs post-deal)
- Synergies not phased in
- Purchase price allocation doesn't balance
- Foregone interest on cash not included
- Transaction fees not in sources & uses

**3-statement:**
- Working capital changes have wrong sign
- Depreciation doesn't match PP&E schedule
- Debt maturity schedule doesn't match principal payments
- Dividends exceed net income without explanation

---

## Step 4: Report

Output a findings table:

| # | Sheet | Cell/Range | Severity | Category | Issue | Suggested Fix |
|---|---|---|---|---|---|---|

**Severity** — one scale, per the severity policy:
- **🔴 高** — a wrong output. BS doesn't balance, a formula is broken, cash doesn't tie, terminal g ≥ WACC. Resolve before the model is used to decide anything.
- **🟡 中** — risky but not wrong. Hardcodes, inconsistent formulas, edge-case failures, TV > 75% of EV. Note and track.
- **⚪ 低·信息** — style and best practice. Colour coding, layout, naming.

Grade findings, never the model as a whole beyond the summary line below. If more
than roughly a third of findings are 🔴, the scale is being used for emphasis
rather than triage.

For **model** scope, prepend a summary line:

> Model type: [DCF/LBO/3-stmt/...] — Overall: [Clean / Minor Issues / Major Issues] — [N] 🔴, [N] 🟡, [N] ⚪ — evaluated: [yes / no, static lint only]

**Don't change anything without asking** — report first, fix on request.

---

## Notes

- **BS balance first** — if it doesn't balance, everything downstream is suspect
- **Hardcoded overrides are the #1 source of silent bugs** — search aggressively
- **Sign convention errors** (positive vs negative for cash outflows) are extremely common
- If the model uses VBA macros, note any macro-driven calculations that can't be audited from formulas alone
