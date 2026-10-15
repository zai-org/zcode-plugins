---
description: Show one employer's current hiring profile and open roles, using Employed by Guaq AI
argument-hint: "[company name]"
---

Research the hiring of this employer: $ARGUMENTS

Use the `employed` MCP tools and follow the `employer-research` skill. If no company was given, ask for one.

1. Call `company_profile`; if it does not resolve, call `list_companies` with `q` and ask which match is meant.
2. Summarise role mix, seniority mix, locations, technologies and recent posting flow.
3. List the 5 to 10 most relevant open roles with apply links.
4. End with the limits line: counts are live postings on the employer's ATS, not headcount.
