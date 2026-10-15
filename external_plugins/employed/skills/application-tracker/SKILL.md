---
name: application-tracker
description: Track the jobs the user saved or applied to in their Employed by Guaq AI tracker (the web app's Saved tab), update statuses, and review progress. Use when the user says "save these", "track my applications", "I applied to", "I got an interview", "what did I apply to", "remind me to follow up", or wants a shortlist exported as a table or CSV.
license: MIT
metadata:
  author: Guaq AI
  version: "1.2.0"
---

# Application tracker

The tracker lives in the user's Employed account, so it is the same list they see on the Saved tab at https://jobs.guaqai.me, on any device. This skill never submits applications.

## Tools

- `list_my_applications`: every tracked role with status, notes and history.
- `track_job`: save a role (`status: saved`) or record progress: `applied`, `oa`, `phone_screen`, `technical_interview`, `behavioral_interview`, `onsite`, `offer`, `rejected`, `withdrawn`, `ghosted`, `not_applied`. Optional `remarks`. Each change is added to the history, so earlier notes are kept.
- `untrack_job`: remove a role and its history. Only when the user asks.

## Workflows

- **Save results**: take the rows the user picked from a search or their feed and call `track_job` with each posting `id`. Confirm what was saved.
- **Update**: "I applied to the Stripe role", "I have an onsite with Wise on Friday": find the row with `list_my_applications`, say the change, then call `track_job` with the new status and the user's words as `remarks`.
- **Check still live**: for each `saved` or `applied` row, call `get_job` with the `job_id`; if the posting is gone, tell the user and offer to mark it `withdrawn` or remove it.
- **Review**: summarise counts by status, list roles waiting on a reply the longest, and suggest follow-ups the user can send themselves. Do not send messages for them.
- **Export**: a Markdown table in chat, or a CSV written only to a path the user approves.

## Rules

- Record only what the user said or the results contain. Do not invent contacts, deadlines or interview dates.
- Keep the user's notes verbatim in `remarks`.
- Ask before removing anything. A status change is reversible; `untrack_job` deletes the history.
