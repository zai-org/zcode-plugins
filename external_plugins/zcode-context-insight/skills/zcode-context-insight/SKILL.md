---
name: zcode-context-insight
description: Use when the user asks what is in the context window, why the context is large, which tool results or injected reminders are consuming tokens, what a compaction removed, how much a session cost, or how the agent family is doing in ZCode. Explains and operates the zcode-context-insight panel/tool.
---

# zcode-context-insight

`zcode-context-insight` is a read-only local plugin that explains what a ZCode session sends to the model.
It never edits the session, never calls a model and never uses the network.

## Tool

The plugin exposes `get_context_report` (namespaced `mcp__context__get_context_report`) to the model.
Call it once for the current session when the user asks about context size or composition. The host
supplies the session identity; never pass or invent a session id. The report contains:

- current prompt tokens, context window and occupancy;
- category composition: system prompt, tool schemas, user messages, injected context, skills,
  assistant replies, tool results;
- turns, steps, tool calls, cache-hit rate and estimated cost;
- recent injections, compactions and model switches;
- a coverage warning when complete Model I/O retention is off.

If the tool is unavailable, the plugin is not installed or enabled. Do not guess the figures.

## Panel

The interactive surface is the **Context** panel, opened from the session's right-side panel
switcher (the `+` control → **Context**). It has three views:

- **Context**: current composition, per-request trend, request browser, context events and file
  activity. Selecting a trend bar pins that request; the browser shows what it carried and can
  compare it with the previous step or turn.
- **Fleet**: the current agent, its parents and every subagent, with billed tokens, estimated cost
  and context occupancy. The panel host does not expose session switching, so this view is
  informational.
- **Insights**: cross-session usage, a 7-day chart, an 8-week heatmap, token mix, aggregate
  composition and session cards.

## How to interpret it

- Category figures are heuristic estimates anchored to the provider-reported prompt total; the
  total and output count are exact. Context window occupancy uses the provider-configured window
  when available, then the bundled models.dev catalog, then the user's override.
- An **injected** item was added by the runtime, not written by the user: reminders, agent listings,
  background-task notices, skill loads or a compaction summary.
- A **compaction** replaces older messages with a summary. Its detail lists the summarized messages
  when they are still on the active branch.
- File activity is derived from Read/Write/Edit metadata; shell-derived operations are marked as
  estimates.
- If **Keep complete model I/O** is off in ZCode Settings → General, older request headers are
  approximated from the nearest recorded request. Message composition is still reconstructed from
  the complete session store. Enabling the setting only affects future requests; discarded records
  cannot be recovered.
