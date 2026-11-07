---
description: Create a new note in Craft
argument-hint: [title | title + content | "from the conversation"]
---

Create a new note in Craft.

Arguments: $ARGUMENTS

Steps:

1. Follow the `craft` skill flow: load the env file and check the connection via
   `GET /connection`. If setup is missing, point to the README setup – don't guess.
2. Determine the content:
   - If $ARGUMENTS contains content, structure it as Markdown.
   - If only a title or "from the conversation" is given, prepare suitable content
     from the current conversation as Markdown. Don't invent anything, mark gaps.
3. Create the document via `POST /documents` **with title only**, then append the
   content as blocks using `pageId` = `items[].id` (form see skill, section 4 –
   the `content` field is ignored by the API). Then read back and verify the
   content against the intended text. On 4xx: show status and error message,
   calibrate, don't retry blindly.
4. Report success: title, location (folder/unsorted), document ID and deep link.
   Ask whether to open the note in Craft (`craftdocs://open`).
