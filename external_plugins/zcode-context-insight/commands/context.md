---
description: Show what this session's context window currently carries, what changed, and its recent context events.
argument-hint: "[optional focus, e.g. tool results or compactions]"
---

Use the installed `zcode-context-insight` plugin to inspect this session's context. Call its read-only tool
`get_context_report` (namespaced as `mcp__context__get_context_report`) exactly once. The host
injects the current session identity; do not pass a session id.

Then answer the user directly with:

1. The current prompt size, the model's context window and the occupancy percentage.
2. A compact composition breakdown (system prompt, tool schemas, user messages, injected context,
   skills, assistant replies, tool results). Name the largest two categories and what they mean.
3. Session counts (turns, steps, tool calls, cache-hit rate) and the estimated cost when available.
4. The most relevant recent context events (injections, compactions, model switches).
5. Any coverage caveat from the report (for example, complete model-I/O retention is off), in one
   sentence rather than a lecture.

If the user asked for a specific focus, emphasize that part:
- $ARGUMENTS

Keep the answer to a few short paragraphs or a compact list. Do not invent figures the report does
not contain. For the interactive breakdown, trend, request browser, file activity and agent fleet,
tell the user to open the **Context** panel from the session's right-side panel switcher (the panel
is read-only and offline). If `get_context_report` is unavailable, say that the zcode-context-insight plugin
is not installed or enabled and do not guess at the context contents.
