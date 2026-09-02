---
description: 管理口径 management report off a closed period — a multi-dimensional report on a stated metric dictionary, then the narrative (P&L walk, drivers, working capital, cash), reconciled to the ledger
argument-hint: "[主体/合并范围] [报告期, e.g. 2026-06] [结账状态, 初步/最终/已审计] [主维度, e.g. 产品线/区域]"
---

Load the `management-report` skill and produce a management report for: $ARGUMENTS

If no close package, trial balance, or GL extract has been provided, ask for it before doing anything else — name the file or tab that would answer the question. Do not reconstruct a ledger, and do not substitute a listed company's public financials for the user's own.

Build the report structure and the metric dictionary **before presenting any number**: pick one primary dimension (the one the business is actually managed on, not the one the data happens to carry), and give every metric a row stating its definition, formula, source accounts, 口径边界, and its difference from the 法定口径 counterpart where one exists. **A metric whose 口径 is undefined does not go in the report** — that is the point of the step, because 「毛利率」 computed two ways in two months is a failure no downstream check catches, since both months' arithmetic is correct.

Every additive metric must reconcile to the whole as a live formula; non-additive metrics (ratios, margins, per-unit figures) are marked as such and never summed down a column. Unallocated amounts sit in an explicit `未分摊` row rather than being spread on a driver invented for the occasion.

This is **管理口径**. The 法定口径 statements off the same ledger are `accounting-and-reporting`'s `financial-reporting` — never average across the two, and never adjust this report to make a line agree with the statutory set. If the five tie checks fail, report the gap and hand it to `ledger-reconciliation`; do not investigate it here.
