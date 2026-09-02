---
description: Build a comparable company analysis with trading multiples
argument-hint: "[company name or ticker]"
---

Load the `comps-analysis` skill and build a peer valuation spread for the specified company. It owns the peer-set construction, the 口径 rules, outlier treatment, and whether the deliverable is an in-conversation 估值快照 or a workbook.

If a company is provided, use it. Otherwise ask for the subject and, if the user has one in mind, the peer set.
