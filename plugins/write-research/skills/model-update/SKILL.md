---
name: model-update
description: Update financial models with new data — quarterly earnings, management guidance, macro changes, or revised assumptions. Adjusts estimates, recalculates valuation, and flags material changes. Use after earnings, guidance updates, or when assumptions need refreshing. Triggers on "update model", "plug earnings", "refresh estimates", "update numbers for [company]", "new guidance", or "revise estimates".
---

# Model Update

## Workflow

### Step 1: Identify What Changed

Determine the update trigger:
- **Earnings release**: New quarterly actuals to plug in
- **Guidance change**: Company updated forward outlook
- **Estimate revision**: Analyst changing assumptions based on new data
- **Macro update**: Interest rates, FX, commodity prices changed
- **Event-driven**: M&A, restructuring, new product, management change

### Step 2: Plug New Data

#### After Earnings
Update the model with reported actuals:

| Line Item | Prior Estimate | Actual | Delta | Notes |
|-----------|---------------|--------|-------|-------|
| Revenue | | | | |
| Gross Margin | | | | |
| Operating Expenses | | | | |
| EBITDA | | | | |
| EPS | | | | |
| [Key metric 1] | | | | |
| [Key metric 2] | | | | |

**Segment Detail** (if applicable):
- Update each segment's revenue and margin
- Note any segment mix shifts

**Balance Sheet / Cash Flow Updates**:
- Cash and debt balances
- Share count (buybacks, dilution)
- Capex actual vs. estimate
- Working capital changes

### Step 3: Revise Forward Estimates

Based on the new data, adjust forward estimates:

| | Old FY Est | New FY Est | Change | Old Next FY | New Next FY | Change |
|---|-----------|-----------|--------|------------|------------|--------|
| Revenue | | | | | | |
| EBITDA | | | | | | |
| EPS | | | | | | |

**Key Assumption Changes:**
- What assumptions are you changing and why?
- Revenue growth rate: old → new (reason)
- Margin assumption: old → new (reason)
- Any new items (restructuring charges, one-time gains, etc.)

### Step 4: Valuation Impact

Recalculate valuation with updated estimates:

| Valuation Method | Prior | Updated | Change |
|-----------------|-------|---------|--------|
| DCF fair value | | | |
| P/E (NTM EPS × target multiple) | | | |
| EV/EBITDA (NTM EBITDA × target multiple) | | | |
| **Price Target** | | | |

### Step 5: Summary & Action

**Estimate Change Summary:**
- One paragraph: what changed, why, and what it means for the stock
- Is this a thesis-changing event or noise?

**Rating / Price Target** (draft opinion, pending analyst sign-off — never an issued view):
- Maintain or change rating? — stance is `[推断]`
- New price target (if changed) with methodology — target arithmetic is `[测算]`
- Upside/downside to current price

### Step 6: Output

- Updated Excel model (if user provides the existing model) — built through `xlsx-author` as a **Class A** model workbook: every revised blue input carries its `Source:` cell comment, and the Inputs and Checks tabs travel with it
- Estimate change summary (Markdown in-session by default for short-form; state the choice). If the user wants it as a document, `report-render` builds the PDF — never hand-roll one, because a hand-rolled PDF does not emit `[n]` as link annotations 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
- Updated price target derivation

### Step 7: Cite the Inputs in the Workbook

A model's citation vehicle is **cell comments**, not a Sources section. Every hardcoded input cell carries a comment in exactly this form:

```
Source: <System or Document>, <Date>, <Reference>, <URL>
```

e.g. `Source: FY2025 annual report, 2026-03-28, consolidated income statement "Revenue", https://…`
or `Source: 同花顺 iFinD 行情数据, retrieved 2026-07-25, [证券代码] 最新成交价` (headline financials cross-checked: `Source: 万得 上市公司财务数据, retrieved …, 营收 reconciled`).

- Every hardcoded number gets one — a reported actual you plugged in, a guidance midpoint, a consensus figure, an FX or rate assumption. No exceptions, including the ones you are sure are obvious.
- Name the provider for any consensus input; an unattributed consensus number does not exist.
- **A calculated cell carries a formula instead, and no source comment.** The formula is its own provenance. A source comment on a calculated cell means a hardcode is hiding inside it — go find it.
- Colour reinforces the same distinction: blue `#0000FF` for a hardcoded input, black for a formula, green `#008000` for a link to another sheet, purple `#800080` for a same-sheet reference with no calculation.
- Judgement assumptions (a growth rate you chose, a margin path) are `[测算]`: the comment states the basis and the cell is listed in the assumptions block, so the reader can see it was decided rather than retrieved.

In the accompanying estimate-change summary, tag each figure once: `[披露]` for the company's reported actuals, `[测算]` for your revised estimates and derived valuation, `[预期]` for the Street comparison with the provider named, `[推断]` for an attribution you are asserting without a record, `[媒体]` for anything resting on an uncorroborated report. One tag style per document.

### Step 8: Coverage and Limitations

Close the summary with a coverage block. It is written even when every input was retrieved, because a reader cannot otherwise tell an input we checked and could not find from one we never looked for:

```
## 覆盖范围与局限
Retrieved: <YYYY-MM-DD HH:MM TZ>  ·  Scope: <Company> (<ticker>) model, <what triggered the update>

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Reported quarterly actuals | 有记录 | <filing / release> | <date> |
| Segment detail | 检索范围内未发现 | <filing> (not broken out) | <date> |
| Forward guidance | 有记录 | <transcript / release> | <date> |
| Street consensus, post-print | 源不可用 | <provider> (out of quota) | <date> |

本次未能覆盖: <what failed, and which model inputs are therefore still stale>
Inputs left at prior values: <cells not refreshed, and why>
```

The three states are `有记录` / `检索范围内未发现` / `源不可用`. "检索范围内未发现" is a statement about our retrieval, not about the company — never write it as "the company does not disclose it" unless a disclosure explicitly says so.

## Important Notes

- Always reconcile your estimates to the company's reported figures before projecting forward
- Note any non-recurring items and whether your estimates are GAAP or adjusted
- Track your estimate revision history — it shows your analytical progression
- If the quarter was noisy, separate signal from noise in your estimate changes
- Check consensus after updating — how do your revised estimates compare to the Street?
- Share count matters — dilution from stock comp, converts, or buybacks can materially affect EPS
- A stale cell is a silent error: if a source was unavailable and an input kept its prior value, that belongs in the coverage block, not in your head
