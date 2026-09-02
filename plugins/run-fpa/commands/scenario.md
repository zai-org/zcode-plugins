---
description: What-if off a named base case — 基准/乐观/压力 by parameter values, sensitivity ranked by impact, and solved break-even points with their feasibility
argument-hint: "[主体] [情景期间] [目标指标, e.g. 全年营业利润/期末现金] [要测的变量]"
---

Load the `scenario-analysis` skill and build the scenarios for: $ARGUMENTS

Name the base artifact first — a specific `rolling-forecast` version, the approved budget, or a closed period — and tie the base scenario back to it before building anything on top; if it does not tie, report the gap rather than proceeding. Every variable range needs a stated basis (历史波动/合同条款/管理层给定/外部驱动); 「上下浮动 10%」 is not a basis, and the range you pick determines the ranking. Say which variables move together and why, do not attach probabilities or weight the scenarios, and report every break-even point with what was held fixed and whether it is reachable inside that variable's own range.
