---
description: Pre-close sweep over the trial balance and close checklist — blockers vs warnings, abnormal balances, missing accruals, cut-off exposure, and draft entries
argument-hint: "[主体] [报告期] [结账状态, e.g. 未关账/初步]"
---

Load the `month-end-close-review` skill and run the close review for: $ARGUMENTS

Read back the sign convention and the account hierarchy level before computing anything — summing parent and child rows together double-counts, and a sign convention read wrong inverts every finding while every check still passes. Run the arithmetic checks first and stop if the trial balance does not foot; there is no point interpreting balances that do not tie. State the materiality threshold you used. Separate 阻断项 from 告警项 explicitly, and say which tests could not run for lack of a file rather than reporting them as clean.

Every proposed entry is a draft in a register with 状态=待复核. Nothing is posted, and no wording may suggest the ledger has already changed.
