---
description: Segment profitability after shared-cost allocation — which product line / customer / channel makes money once fixed costs are distributed by a stated driver
argument-hint: "[主体] [报告期] [分段维度, e.g. 产品线/客户/渠道]"
---

Load the `cost-profitability` skill and analyse segment profitability for: $ARGUMENTS

Settle the segmentation dimension first (产品线 / 客户 / 渠道 / 区域 — one primary dimension per cut), then reconcile segment revenue and direct costs back to the whole-company total before allocating anything. For every shared-cost pool, name the driver chosen and run a second driver where the choice is contestable — a segment that flips sign under an alternative driver is the headline finding. Costs you cannot allocate from the file are `未分摊`, not guessed.
