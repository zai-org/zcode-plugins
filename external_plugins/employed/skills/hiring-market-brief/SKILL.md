---
name: hiring-market-brief
description: Produce a short hiring-market brief from Employed by Guaq AI data. Use when the user asks about demand for a skill, role or city, which employers are hiring most, how a technology or sector is trending, hiring in Indian GCCs, quant, IT services or semiconductors, or wants labor-market numbers for a report, newsletter, or decision.
license: MIT
metadata:
  author: Guaq AI
  version: "1.2.0"
---

# Hiring market brief

Needs the `employed` MCP tools (see the `employed-jobs` skill). `market_signal` needs an organisation plan; everything else works on a normal plan.

## Steps

1. **Pin the question**: skill, role family, city or country, seniority, and time window. If missing, pick sensible defaults and say what you chose.
2. **Size it** with `count_jobs` for the headline filter, then split it with a few more counts (by `location_scope`, `role_type`, `work_mode`, `visa`). Keep each count's filters visible in the brief so it can be reproduced.
3. **Name the employers** with `list_companies` using the same filters. Report the top 10 with counts and the share of the total they hold.
4. **Add signals if the plan allows**: `market_signal` with `overview`, `technologies`, `flow`, `india`, `gcc`, `quant`, `it_services`, `semis`, `sector` or `function_mix`. If refused, say the plan does not include it and continue without.
5. **Write the brief**: a headline number, 3 to 5 findings, a small table, and a limits section. Offer an `export_jobs` file only if the user wants the raw rows and approves the path.

## Limits to state every time

- The index covers verified postings on roughly 5,000 employer boards. It is not every job in the economy, and employers using other channels are under-represented.
- Counts are a snapshot of live postings on the day of the query, not hires or vacancies filled.
- Say which counts are inferred (for example `visa=likely`).
- Never present a number you did not retrieve in this conversation.
