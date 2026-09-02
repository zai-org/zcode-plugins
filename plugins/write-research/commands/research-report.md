---
description: Build an integrated investment research report with industry context, financial analysis, comps, valuation, and sourced exhibits
argument-hint: "[company or ticker]"
---

# Investment Research Report Command

Load the `research-report` skill and follow it. It owns the workflow: which
sub-skills to run for each section, the valuation bridge between DCF and comps,
how the target price is derived, and how the rating follows from it.

If the user provided a company or ticker, use it. Otherwise ask for:

- Subject — a **company**. A sector or theme is `sector-overview`, not this.
- Whether this is 初次覆盖 or a deep-dive update on a name already covered
- The peer set, if the user has one in mind
- Audience and format (analyst draft / IC memo / client note)

Format, if unspecified: a research report is long-form, so PDF via
`report-render`, and say so in one clause. If the user asks for Word instead, the same
skill builds it (`DocxReport`). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
