# Formatting Standards Reference

## Font colours — four, not three

| Colour | Means | Example |
|--------|-------|---------|
| Blue `#0000FF` | A hardcoded input | a typed historical actual, an assumption driver |
| Black | A formula | `=D14*(1+Assumptions!$B$5)`, `=SUM(D10:D14)` |
| Purple `#800080` | A link on the **same** sheet with no calculation | `=B9`, `=D42` |
| Green `#008000` | A link to **another** sheet | `=Assumptions!$B$5`, `='Debt Schedule'!C12` |

Purple is the one most often dropped, and the audit checks for it: a cell that
merely restates another cell on the same tab computes nothing (so it is not
black) and is not typed in (so it is not blue).

| Element | Format |
|---------|--------|
| Hard-coded inputs | Blue font `#0000FF` |
| Formulas | Black font |
| Links on the same sheet, no calculation | Purple font `#800080` |
| Links to other sheets | Green font `#008000` |
| Check cells | Red if error, green if balanced |
| Negative values | Parentheses, not minus signs |
| Currency | No decimals for large figures, 2 decimals for per-share |
| Percentages | 1 decimal place |
| Headers | Bold, bottom border |
| Units row | Include units row below headers ($ millions, %, etc.) |

## Visual Separation Guidelines

- Thin vertical border between historical and projected columns
- Thick bottom border after section totals (e.g., Total Assets)
- Single bottom border for subtotals
- Double bottom border for grand totals

## Total and Subtotal Row Formatting

All total and subtotal rows must use **bold font formatting** for their numerical values to clearly distinguish aggregated figures from individual line items.

### Income Statement (P&L) Tab
| Row | Formatting |
|-----|------------|
| Gross Revenue | Bold |
| Total Cost of Revenue | Bold |
| Gross Profit | Bold |
| Total SG&A | Bold |
| EBITDA | Bold |
| EBIT | Bold |
| EBT | Bold |
| Net Profit After Tax | Bold |

### Balance Sheet Tab
| Row | Formatting |
|-----|------------|
| Total Current Assets | Bold |
| Total Non-Current Assets | Bold |
| Total Other Assets | Bold |
| Total Assets | Bold |
| Total Current Liabilities | Bold |
| Total Non-Current Liabilities | Bold |
| Total Equity | Bold |
| Total Liabilities and Equity | Bold |

### Cash Flow Statement Tab
| Row | Formatting |
|-----|------------|
| Cash Generated from Operations Before Working Capital Changes | Bold |
| Total Working Capital Changes | Bold |
| Net Cash Generated from Operations | Bold |
| Net Cash Flow from Investing Activities | Bold |
| Net Cash Flow from Financing Activities | Bold |
| Closing Cash Balance | Bold |

**Note:** This list is non-exhaustive. Apply bold formatting to any row that represents a total, subtotal, or summary calculation across the model.

## Balance Sheet Check Row Formatting

The Balance Sheet check row (below Total Liabilities and Equity) uses conditional number formatting that displays non-zero values in red. When the balance sheet balances correctly (check = 0), the values display in black or standard formatting.

| Check Value | Font Color |
|-------------|------------|
| = 0 (balanced) | Black (standard) |
| ≠ 0 (error) | Red |

**Implementation:** Apply custom number format `[Red][<>0]0.00;[Red][<>0](0.00);0.00` or use Excel conditional formatting with the rule "Cell Value ≠ 0" → Red font.

## Margin Row Formatting

| Element | Format |
|---------|--------|
| Margin % rows | Indent, italics, 1 decimal place |
| Positive trend | No special formatting (or subtle green) |
| Negative trend | Flag for review (subtle yellow) |
| Below peer average | Consider highlighting for discussion |

## Credit Metric Formatting

| Element | Format |
|---------|--------|
| Leverage multiples | 1 decimal with "x" suffix (e.g., 2.5x) |
| Percentages | 1 decimal with "%" suffix |
| Net Debt negative | Parentheses, indicates net cash position |
| Section header | Bold, "CREDIT METRICS" |
| Separator line | Thin border above credit metrics section |

## Status and threshold colour scales — the labelled exception

The workbook's fill palette is 3 blues + 1 grey + white, and greens/yellows/reds
are not available as decoration. The green/yellow/red scales below — credit
metric thresholds, check-tab pass/fail, margin reasonability flags — are the
deliberate exception: they encode a status or a magnitude, not a style choice.
Each grid that uses one **carries a legend** stating what the colours mean. A
coloured cell with no legend is decoration, and decoration goes back to the
standard palette.

## Credit Metric Threshold Colors

| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| Total Debt / EBITDA | < 2.5x | 2.5x-4.0x | > 4.0x |
| Net Debt / EBITDA | < 2.0x | 2.0x-3.5x | > 3.5x |
| Interest Coverage | > 4.0x | 2.5x-4.0x | < 2.5x |
| Debt / Total Cap | < 40% | 40%-60% | > 60% |
| Current Ratio | > 1.5x | 1.0x-1.5x | < 1.0x |
| Quick Ratio | > 1.0x | 0.75x-1.0x | < 0.75x |

## Conditional Formatting for Checks Tab

- Cell contains pass indicator → Green fill
- Cell contains fail indicator → Red fill
- Cell contains warning → Yellow fill
- Difference cells = 0 → Light green fill
- Difference cells ≠ 0 → Light red fill

## Margin Reasonability Flags

- Gross Margin < 0% → ERROR: Review COGS
- Gross Margin > 80% → WARNING: Verify revenue/COGS
- EBITDA Margin < 0% → FLAG: Operating losses
- EBITDA Margin > 50% → WARNING: Unusually high
- Net Margin < 0% → FLAG: Net losses (may be acceptable in growth phase)
- Net Margin > Gross Margin → ERROR: Formula issue
