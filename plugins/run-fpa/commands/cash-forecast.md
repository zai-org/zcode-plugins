---
description: 13-week rolling direct cash forecast with an AR-driven collection curve, minimum-balance headroom, and a downside case
argument-hint: "[主体] [起始周, e.g. 2026-W31] [最低现金余额或契约要求]"
---

Load the `cash-forecast` skill and build a 13-week rolling cash forecast for: $ARGUMENTS

If the AR ageing, opening bank balance, payroll and tax calendars, debt schedule, or capex plan have not been provided, ask for them first and say which line each one drives. Do not forecast collections off a revenue trend and call it a cash forecast.

Report base and downside side by side for closing cash, headroom, and the first breach week, driving both off one scenario cell rather than a second hardcoded sheet. Keep this to the **two-case liquidity stress** — 「钱够不够、哪一周先破」. If the question turns out to be about parameter structure (three or more named scenarios, which variable dominates, a two-way table, a solved break-even), that is `scenario-analysis`; hand it over rather than growing a third and fourth scenario column here.
