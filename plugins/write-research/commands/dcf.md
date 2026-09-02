---
description: Build a DCF valuation model with comps-informed terminal multiples
argument-hint: "[company name or ticker]"
---

Load the `dcf-model` skill and build the model for the specified company. It owns the forecast build, the WACC derivation, terminal value, the equity bridge, and the sensitivity grid, and it delivers a live-formula workbook through `xlsx-author`.

If a company is provided, use it. Otherwise ask for the subject and the forecast horizon. Where the DCF is one section of a written report rather than the deliverable itself, use `/research-report` instead.
