---
description: Reconcile two populations down to the transactions that explain the difference, each classified by cause with a trail back to the voucher
argument-hint: "[勾稽对象, e.g. 总账 vs 应收明细账] [主体] [报告期]"
---

Load the `ledger-reconciliation` skill and reconcile: $ARGUMENTS

Name the two populations and align the basis first — 时点、范围、含税与否、币种与汇率、权责或收付 — and say which alignments you verified against the files and which you took on the user's word. A tax-inclusive operational log against a tax-exclusive ledger explains more false "differences" than any real error does.

State the matching rules, the date window, and the amount tolerance, and report tolerance matches separately from exact matches. Amount alone is never a matching key. Classify every unmatched item as 时间性 / 口径 / 错账 / 遗漏 / 未查明, and make the bridge close to zero as a live formula — 未查明 holds only what you genuinely could not locate, never a plug. Never net unrelated differences into a smaller one.

Treatments are drafts with 状态=待复核. A difference is marked 已解释, never 已调整.
