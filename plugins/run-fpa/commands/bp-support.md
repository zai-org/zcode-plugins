---
description: Incremental profit and cash for a business proposal against a modelled 「不做」 base, options compared on one basis, peak funding named, and the condition that flips the answer
argument-hint: "[决策事项] [方案清单] [评估期间] [决策人与时点]"
---

Load the `finance-bp-decision-support` skill and build the case for: $ARGUMENTS

Model 「不做」 as an actual option — the status quo decays on its own, and a base of zeros credits the proposal with decay it merely avoided. Keep sunk costs out and opportunity cost and cannibalisation in, with excluded items still visible on the sheet; an allocated share of existing overhead is not an incremental cost, only the genuine increase is. Report profit and cash separately by period and name the peak funding requirement and the period it falls in. Compute NPV/IRR only against a discount rate the user supplies — do not derive a WACC. Finish with the flip condition solved through `scenario-analysis` and an assessment of whether it is realistic, plus the open items scored by whether they would change the answer.

If the proposal turns out to involve a counterparty, consideration, or acquisition financing, stop and hand off to `model-deals` — that is a transaction, not an internal decision.
