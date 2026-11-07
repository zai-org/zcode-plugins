---
description: Search and read Craft notes
argument-hint: [search term or question]
---

Search the user's Craft notes and report the hits.

Arguments: $ARGUMENTS

Steps:

1. Follow the `craft` skill flow: load the env file and check the connection.
2. Derive a solid search term from $ARGUMENTS (don't throw the whole sentence as a
   phrase; with multiple terms search individually and merge the hits).
3. Run `GET /documents/search?include=…`; set `location=` if needed
   (default: all locations except trash).
4. Read the up to five most relevant documents individually via
   `GET /blocks?id=…` with `Accept: text/markdown`.
5. Report: per hit title, location (section/quote), deep link and relevance. Quote
   verbatim where the exact wording matters. No hits → say so openly and suggest
   alternative search terms, don't invent them.
