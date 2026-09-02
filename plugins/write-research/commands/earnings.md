---
description: Analyze quarterly earnings and create an earnings update report
argument-hint: "[company name or ticker] [quarter, e.g. Q3 2024]"
---

Load the `earnings-analysis` skill and produce the earnings update for the specified company and quarter. It owns the beat/miss analysis, the estimate revisions, the report structure, the provenance chips, and the `## 来源` / `## 覆盖范围与局限` requirements; `report-render` builds the file. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页。

If a company and quarter are provided, use them. Otherwise ask which name and which quarter.

For a short same-day reaction to a 业绩预告 or 业绩快报, use `earnings-flash` instead; before the print, `earnings-preview`; for a first-time coverage deep dive, `/research-report`.
