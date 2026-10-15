---
description: Find live job openings that match a description, using Employed by Guaq AI
argument-hint: "[role, level, place, e.g. new-grad backend India remote]"
---

Find live job openings for: $ARGUMENTS

Use the `employed` MCP tools and follow the `employed-jobs` skill. If no arguments were given, ask what role, seniority and location the user wants.

1. Call `api_meta` if you are unsure of a filter value.
2. Turn the request into filters, run `count_jobs`, then `search_jobs` with 25 rows.
3. Show a table: title, company, location, work mode, seniority, apply link.
4. State which filters you used and offer to narrow, broaden, or save the shortlist with the `application-tracker` skill.
