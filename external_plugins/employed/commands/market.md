---
description: Write a short hiring-market brief for a skill, role, city or sector, using Employed by Guaq AI
argument-hint: "[topic, e.g. rust engineers in Bengaluru]"
---

Write a hiring-market brief for: $ARGUMENTS

Use the `employed` MCP tools and follow the `hiring-market-brief` skill. If no topic was given, ask for one.

1. Size the topic with `count_jobs` and split it by location, seniority and work mode.
2. Name the top employers with `list_companies`.
3. Add `market_signal` data only if the plan includes it; otherwise say so and continue.
4. Write a headline number, three to five findings, a small table, and a limits section. Show the filters behind every number.
