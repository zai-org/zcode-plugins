# DCF Model Troubleshooting Guide

**When to read this file:** If recalc.py reports errors OR valuation results seem unreasonable OR case selector not working properly.

## Reading recalc.py's result

`../xlsx-author/scripts/recalc.py` (path relative to the dcf-model skill directory)
recalculates a **temporary copy** of the workbook — it does not overwrite the file
you pass it, so the cell comments carrying your source citations survive. Pass
`--write-back` only if you actually want the recalculated file; a `.bak` is
written first.

Its exit code is meaningful, so `&&` chains behave:

| Exit | Status | What it means |
|---|---|---|
| `0` | `success` | Every formula evaluated, no Excel errors. |
| `2` | `errors_found` | Formulas evaluated; at least one `#REF!`/`#DIV/0!`/… — see `error_summary`, fix, re-run. |
| `3` | `recalc_unavailable` | LibreOffice is missing. **No formula was evaluated** — only a static lint ran. This is NOT a pass. |
| `1` | `failed` | Usage error, missing file, timeout, or LibreOffice error. |

On exit `3`, do not deliver on the strength of the lint. Run `xlsx-author`'s
substitute protocol (re-open with openpyxl; verify every formula's references,
recompute derived values independently in Python, assert the model identities),
and state in the delivery message's `## Coverage and Limitations` block that the
formulas were not evaluated by a spreadsheet engine.

## Model Returns Error Values

### #REF! Errors
- Usually caused by formulas referencing wrong rows after headers were inserted
- Solution: Rebuild with correct row references, or start over following layout planning
- Prevention: Define all row positions BEFORE writing formulas

### #DIV/0! Errors
- Division by zero or empty cells
- Solution: Add IF statements to handle zeros: `=IF([Divisor]=0,0,[Numerator]/[Divisor])`

### #VALUE! Errors
- Wrong data type in calculation (text instead of number)
- Solution: Verify all inputs are formatted as numbers

## Valuation Seems Unreasonable

### Implied price far too high
- Check terminal value isn't >80% of EV
- Verify terminal growth < WACC
- Review if growth assumptions are realistic
- Consider if margins are too optimistic

### Implied price far too low
- Verify net debt vs net cash is correct
- Check if WACC is too high
- Review if projections are too conservative
- Consider if terminal growth is too low

## Case Selector Not Working

### Consolidation column not updating when switching scenarios
- Verify case selector cell contains 1, 2, or 3
- Check INDEX/OFFSET formulas reference correct row range and selector cell
- Ensure absolute references ($B$6) are used for selector
- Test by manually changing the selector cell and verifying projection values update
