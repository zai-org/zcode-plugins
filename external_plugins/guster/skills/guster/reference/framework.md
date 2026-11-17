# Guster Framework

## One principle

One fact has one home; one home tells one story; show it only when needed.

## Three laws

1. **Single home** — one canonical source per topic; other locations are
   pointers, generated copies or immutable evidence.
2. **Load on demand** — resident instructions only for rules that apply to
   every task in scope, change default behavior, and have costly failure.
3. **Layer isolation** — a container holds content with the same scope,
   authority, lifetime, sensitivity and load mode.

## Five sameness checks

- scope: global / workgroup / project / subdirectory / task / session
- authority: platform / instruction / code / runtime / knowledge / evidence
- lifetime: invariant / monthly / weekly / daily / hourly / one-shot
- sensitivity: public / internal / confidential / secret
- load: resident / run-start / triggered / retrieved / never

If one container mixes two values on any axis, split it.

## Eight planes

1. Truth: code, tests, build and runtime config.
2. Instruction: AGENTS.md and policies.
3. Capability: skills, tools, MCP, plugins, scripts.
4. Knowledge: durable principles, methods, business semantics, pitfalls.
5. State: project cards, handoffs, environment and port registries.
6. Evidence: reports, screenshots, videos, test output.
7. Runtime: sessions, caches, logs, temp files, browser profiles.
8. Secret: passwords, tokens, keys, cookies; references only.

## Placement tree

1. Secret? → 8.
2. Code/config? → 1.
3. Changes default behavior for all tasks? → 2.
4. Repeatable action/procedure? → 3.
5. Current status/next step? → 5.
6. Proof/artifact? → 6.
7. Durable understanding? → 4.
8. Temporary working data? → 7.

If content hits multiple planes, split it into conclusion + evidence + pointer.

## Conflict rules

- Safety: strictest wins.
- Fact: closest to runtime/code wins.
- Preference: most specific scope wins.
- Same level: do not guess; fix the missing canonical source.
