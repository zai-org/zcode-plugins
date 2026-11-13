---
description: Read or append to today's Craft daily note
argument-hint: [entry – optional; without an argument the current note is shown]
---

Work with today's Craft daily note.

Arguments: $ARGUMENTS

Steps:

1. Follow the `craft` skill flow: load the env file and check the connection.
2. Read today's note: `GET /blocks?date=today` with `Accept: text/markdown`.
   Without an argument: present the content in a clear structure (tasks, notes,
   events).
3. With an argument: format the entry as Markdown and append it via `POST /blocks`
   with `position: {"date":"today"}` (form see skill). Report success or failure
   concretely; on 4xx calibrate instead of retrying blindly.
4. Afterwards offer to open the daily note in Craft
   (`craftdocs://openByQuery?query=today`).
