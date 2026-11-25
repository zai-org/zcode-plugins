# League of Legends Match Recap

Retell a full game or series through its turning points and their consequences. Read [match editing](../references/match-editing.md) for shared tools and review. Keep the narration-first workflow: understand the match, settle the outline, write source-timed narration, measure its audio, then arrange footage around the narration and confirmed action calls.

## Understand What Changed

Register full game videos with `sport="lol"` in series order. Read the complete commentary axis. Follow lane pressure, economy and objective trades, attempts to recover, decisive fights and the final push. A won fight does not by itself prove who took an objective. Verify the relevant banner, kill feed, team colors and following action in the source window.

Preserve the setup and outcome of a selected fight. Include the ensuing objective or push when it explains why the fight mattered. Avoid cutting at the first kill when the exchange is unresolved. Treat caster calls as approximate locators and verify the actual action. Keep live action and replay identity clear.

## Outline and Action Windows

The outline uses `teams_cn`, `through_line` and ordered `beats`:

```json
{"teams_cn":{"home":"Home","away":"Away"},"through_line":"A contested objective turns the lead","beats":[
  {"idx":1,"kind":"objective","game":1,"t":1200.0,"highlight":true,"summary":"The objective changes hands"},
  {"idx":2,"kind":"ending","game":1,"t":1850.0,"summary":"The winning push closes the game"}
]}
```

Kinds are `open`, `fight`, `kill`, `objective`, `tower`, `ending`. `game` identifies the source video; `t` is its local source time. The next game can restart its own time at zero. Optional `cold_open.flashes:[{"game":1,"t":1200.0}]` accompanies an `open` beat. Use teaser repetition only when it helps the story.

For a key event, record its complete action range and exact action time separately in `events.json`:

```json
[{"game":"1","src_start":1195.0,"event_t":1200.0,"src_end":1212.0,"event":"Objective secured; the follow-up fight resolves"}]
```

`event_t` comes from the observed action, not the range midpoint. Older ranges without it preserve the sentence's supplied action time when the range contains that time. Keep separate events separate; overlapping selected windows may need a combined beat or shorter narration rather than moving an action call.

## Write, Voice and Arrange

Write `writer_script.json` using the shared beat/sentence format. Every non-opening sentence has a source `t`; `hard:true` marks the short decisive call. Keep the setup near its payoff, and distinguish conclusions from facts visible at that moment. Read the script continuously for identity, causal gaps and missing opposition.

Synthesize first with `synthesize_narration mode=match`. Then:

```json
{"mode":"match","action":"arrange","match_path":"out/match.json","outline_path":"out/outline.json","script_path":"out/script_tts.json","events_path":"out/events.json"}
```

Read `coverage_report.txt` and inspect the planned cuts. Long gaps may contain meaningful action or crowd reaction; use the flagged passage in the consolidated review before shortening or adding words. If two nearby calls cannot fit without overlap, combine the passage or shorten the buildup while retaining the action. Render through `video_render kind=match`, then use the shared bounded final review once. Reuse the source evidence for claimed resource ownership and fight outcomes; sample hard-call timing, series transitions and the ending. Place subtitles where they leave the HUD and decisive action readable. Only a concrete delivery error opens the one targeted repair/recheck; unresolved ownership, unreadable HUD or unseen motion stays explicit for human acceptance.
