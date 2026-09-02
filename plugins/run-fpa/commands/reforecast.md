---
description: Rolling P&L reforecast — actuals to date plus driver-based forecast, vs budget, stated as a range with its construction and limits
argument-hint: "[entity] [fiscal year] [version number]"
---

Load the `rolling-forecast` skill and build a reforecast for: $ARGUMENTS

Ask for the actuals, the approved budget, and the prior reforecast version if they were
not provided. Never sum 已实现 and 预测 into an unlabelled total.

State the full-year figure as a **range**, and say how the range was built — driver bands (each key assumption taken to the ends of a *stated* range, saying whether the drivers moved together or one at a time) or named scenarios taken from `scenario-analysis`, which uses this version as its base artifact. Do not build a second forecast inline for the scenario case.

The range is **not a confidence interval**: it is the arithmetic consequence of the stated assumption ranges, with no distribution behind it. No probabilities, no weighting, no expected value unless the user supplies the probabilities. Alongside it, state the model's own limits — which lines are driver-based versus run-rate, which periods have no actuals behind them, and what the forecast cannot see.
