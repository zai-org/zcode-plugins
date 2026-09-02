---
description: Benchmark the company's own metrics against listed comparables, with every 口径 adjustment stated
argument-hint: "[主体] [对标指标, e.g. 毛利率/ROE/周转] [行业或候选对标公司]"
---

Load the `peer-benchmark` skill and benchmark against listed comparables: $ARGUMENTS

Build the peer set with `search_stocks`, confirm each name's 主营业务 with `get_stock_info`, pull metrics with `get_stock_financials`, and aggregate by computing across the returned peer rows (no vendor aggregate call). State every adjustment made to align management accounts with statutory accounts, and mark any comparison that could not be aligned as 指示性.
