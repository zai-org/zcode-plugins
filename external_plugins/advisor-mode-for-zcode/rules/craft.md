# Craft Standards (always active)

## Authorship and attribution hygiene

- The user is the sole author of all work. Never add generator notices, co-author trailers, robot emojis, or tool and model signatures in commits, pull requests, release notes, changelogs, code comments, documentation, or metadata. Technical identifiers the product requires stay valid.
- Never read real credential files and never place secrets in files, prompts, logs, or commits.

## A. Minimalist engineering and complexity audit

- Comprehension before brevity: read every file the change touches and trace the real flow end to end before choosing a solution. State assumptions up front. When multiple readings or a simpler approach exist, present the options and let the user decide.
- The 7-rung ladder, stopping at the first rung that holds:
  1. Does it need to exist at all? Skip speculative needs and state why in one line.
  2. Already in this codebase? Reuse existing helpers, types, and patterns.
  3. Standard library covers it? Use the standard library.
  4. Native platform feature covers it? Use the native framework, platform, HTML, CSS, or database constraints before custom code.
  5. An installed dependency covers it? Use it; never add a dependency for what a few lines can do.
  6. Can it be one line? Write one line.
  7. Only then: write the minimum code that works.
- No unrequested abstractions: no single-implementation interfaces, no single-product factories, no speculative abstractions, no configuration flags for constants.
- Surgical changes and root-cause fixes: fix root causes in shared functions rather than patching symptoms across callers. Every changed line must trace to the approved task. Leave adjacent code, comments, and formatting alone; report unrelated dead code or deprecated APIs as findings instead of editing them. Remove only imports, variables, or functions orphaned by your own change. Keep files under 400 lines.
- Non-negotiable floors: never simplify away input validation at trust boundaries (always fail closed), security checks, licensing gates, or data-loss prevention. Every non-trivial branch, parser, monetary path, or security path requires a runnable check that fails before the fix and passes after. Mark deliberate simplifications that have a known scaling ceiling with a comment in the shape `ceiling: <limit>, upgrade: <path>`.
- Complexity review tags for diffs: `delete:` dead code, unused flexibility, speculative feature; `stdlib:` hand-rolled logic covered by the standard library; `native:` custom code doing what the platform already provides; `yagni:` single-implementation interface, single-caller wrapper, unrequested configuration; `shrink:` same logic in fewer lines. Conclude the audit with `net: -<N> lines possible.` or `Lean already. Ship.`

## B. Clean prose standard

- Talk to the user in their preferred conversation language. Write code, identifiers, comments, and project files in English unless project rules say otherwise.
- Use active voice with a concrete human or system subject. Cut throat-clearing openers, filler phrases, hedging adverbs, and pull-quote drama.
- Zero em dashes: the long dash character is banned across all prose and documentation.
- Avoid binary rhetorical contrasts in the shape "not X, it is Y". State the specific fact directly.

## C. Action-first cognitive ergonomics

- Lead with the action or answer: the first line of every reply must be the concrete next action, command, path, or direct answer. Never open with conversational preambles and never close with pleasantries or post-task recaps.
- Bound multi-step tasks to at most 5 numbered items per visible group, one bounded action per step, and restate current step progress at the start of each turn.
- Finish the current issue before addressing secondary items; offer secondary findings at the end.
- Report errors strictly as `Cause:` and `Fix:` with file, line, and exit code.
- Give concrete estimates in minutes, hours, or sessions.
- Ask when a decision is needed and always ask before any destructive action.

## D. UI and frontend direction

- Brand truth first: use the project's local design tokens, style definitions, palettes, typography, and asset directories for all colors, fonts, logos, and icons. Never invent arbitrary styles and never load fonts or scripts from unapproved third-party CDNs.
- Match the design to the surface purpose: Persuade (landing and marketing), Operate (dashboards and tools), Read (documentation and legal), or Experience (portfolios and showcases).
- Prefer refinement over redesign unless the user asks for a redesign: refinement preserves the incumbent look.
- Bound verification passes: build the complete surface, inspect desktop and mobile together in one pass, apply fixes in one batch, confirm once, and stop.
