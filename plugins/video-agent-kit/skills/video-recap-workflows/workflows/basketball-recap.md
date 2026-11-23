# Basketball Recap

Turn a full broadcast into a narrated account of the score swings and decisive possessions. Read [match editing](../references/match-editing.md) for shared preparation, synthesis and review. Use the same narration-first arrangement as the LoL workflow, with basketball-specific selection and terminology.

## Follow Possessions and Score Changes

Register a continuous full game or ordered quarters with `sport="basketball"`. Read all supplied commentary, including the trailing team's responses, runs, lead changes and closing possessions. Check named players, scores, assists and fouls against the broadcast. Distinguish a shot attempt from a confirmed basket and a whistle from its final ruling. An ASR cheer can lag the basket.

For a standard recap, retain every confirmed scoring play from both teams in chronological order, including made free throws. Select additional defensive possessions and failed attacks for their contribution to the match story. A highlights-only selection is appropriate when explicitly requested. An approximate duration target does not justify dropping scores.

Build the scoring list from the full commentary and scoreboard evidence before settling the outline. Record each scoring action's source window in `events.json` and represent it in a narrated beat: this branch does not create footage for a beat without narration. Keep gaps or unverified score changes explicit; a later scoreboard or a quarter summary does not replace the missing scoring action.

For each selected possession, retain enough buildup to understand the opportunity, the release or defensive action, the visible result and any necessary response. A scoring run should show why control changed; repeated isolated baskets can obscure this progression. Keep the closing possession through its result. Use replay identity and the scoreboard to avoid counting the same play twice.

## Outline and Script

```json
{"teams_cn":{"home":"Home","away":"Away"},"through_line":"The visitors answer the run and take the lead","beats":[
  {"idx":1,"kind":"run","game":1,"t":2100.0,"summary":"The lead shrinks"},
  {"idx":2,"kind":"score","game":1,"t":2184.2,"highlight":true,"summary":"A three-pointer changes the lead"},
  {"idx":3,"kind":"ending","game":1,"t":5400.0,"summary":"The final possession settles the result"}
]}
```

Basketball kinds are `score`, `possession`, `run`, `turning_point`, plus `open` and `ending`. Legacy `kill`, `objective`, `fight`, `tower` remain accepted for existing outlines. `game` is the source-part id: full game = 1, or quarter files = 1, 2, etc. All `t` values are seconds within that file, not the scoreboard's countdown clock.

Record action windows with a separately verified `event_t`:

```json
[{"game":"1","src_start":2179.0,"event_t":2184.2,"src_end":2188.0,"event":"The three goes in and the scoreboard confirms the lead change"}]
```

Write `writer_script.json` with the shared `beats`/`sentences` format. Each non-opening sentence gets its own `t`. Use short `hard:true` calls for the confirmed outcome, with factual buildup and consequences around them. Give the viewer time to read a score change. Read the full script for score continuity, player identity and causal clarity.

## Produce and Refine

Call `synthesize_narration mode=match`, then `arrange_footage mode=match action=arrange` with `match_path`, `outline_path`, the measured `script_path="out/script_tts.json"` and `events_path="out/events.json"`. Basketball shares the game placement kernel, while the match metadata and outline retain its own sport and terminology.

Before rendering, reconcile the scoring list with the source intervals in `reel.json`: every confirmed scoring action must retain its setup and visible result. Use the existing evidence and timeline for this check; it does not require another model review. The coverage report's speech percentage measures narration coverage, not how many scoring plays were included.

Inspect the coverage report for overlapping possessions and clipped follow-through. Preserve a complete last action. Render with `video_render kind=match`, then use the shared bounded final review once: sample action calls, quarter transitions and the ending, and reuse the existing evidence for concrete score claims. Select subtitle placement from actual frames so the ball, basket, players and score remain readable. Group any clear delivery errors into the single targeted repair/recheck round; optional pacing preferences and remaining uncertainty go into the report without repeated reviews.
