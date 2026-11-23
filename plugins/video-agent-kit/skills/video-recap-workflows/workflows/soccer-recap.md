# Soccer Recap

Make a narrated recap that explains how a full football match developed. Read [match editing](../references/match-editing.md) for source preparation, narration, rendering and review. Soccer keeps the event-first workflow: establish the story, select event windows, then fit narration around the fixed action times.

## Story and Event Evidence

Read the full commentary axis and record the match's progression before choosing beats. Follow changes in pressure, goals, missed opportunities and the opposing response. Verify who scored, the score after each goal, dismissals and disputed decisions. Distinguish the on-field attempt, referee/VAR decision and confirmed score; celebration alone does not establish a valid goal.

Retain every confirmed goal from both teams in chronological order unless the user explicitly requests a narrower selection. Choose additional chances and decisions for their contribution to the match story. Before rendering, reconcile the goal list with the outline and `reel.json` using the existing evidence; disclose any goal whose action is missing from the supplied footage.

Register sources with `arrange_footage mode=match action=ingest sport=soccer`, then transcribe and build the commentary axis. Use `detect_shots` on each supplied part, with separate output files. Part ids refer to source files; a single continuous broadcast can be part 1. For unlabeled footage, observe the action and put its confirmed time directly in the outline.

## Outline and Footage Windows

An outline can use this shape:

```json
{"teams_cn":{"home":"Home","away":"Away"},"through_line":"Can the chasing side erase the deficit?","transition":"cut","beats":[
  {"idx":1,"kind":"goal","event":{"half":1,"t":65.1,"minute":18,"team":"home","score_after":"1-0"},"in_t":54.0,"out_t":78.0,"replays":0,"highlight":true,"summary":"The opening pressure becomes a lead","points":[{"text":"Confirmed opening goal","c":["C0018"]}]},
  {"idx":2,"kind":"ending","half":1,"in_t":5300.0,"whistle_t":5310.0,"out_t":5320.0,"summary":"The final result resolves the chase"}
]}
```

Use the actual source times and match identities. Beat kinds are `open`, `goal`, `chance`, `ending`. Existing labeled events can be cited through `event_id` instead of an inline `event`. `half` is the ordered source-part id; `minute` is the match-clock label. Each scoring beat carries the verified home-away `score_after`, including when less important footage is omitted.

Select the attack's setup and visible outcome. `in_t`/`out_t` explicitly bound a goal or chance when observed action boundaries are better than the default event window. `pre` adjusts the default lead-in. `replays` accepts 0, 1 or 2 and guides the legacy shot-based window extension; inspect the result before treating it as a confirmed replay selection. Use a repeat angle only when it explains something new. Choose `transition="dissolve"` for a suitable time transition; `cut` preserves the action without overlap.

A teaser is optional. When useful, add `cold_open.flashes:[{"half":1,"t":65.1}]` and an `open` beat; the title and optional `gap_card` accompany that opening. Verify that the teaser and narration respect any requested suspense. The ending needs an observed whistle/result, not an assumed 90-minute timestamp.

Arrange before writing the final narration:

```json
{"mode":"match","action":"arrange","match_path":"out/match.json","outline_path":"out/outline.json","shots_paths":{"1":"out/shots_1.json"}}
```

Read `reel.json` and `writing_brief.txt`. The brief estimates how much speech fits around each event. Use measured audio to make the final fit decision.

## Narration and Placement

Each script sentence carries its outline beat `idx` and may use `anchor`:

- `flow`: follow the preceding sentence.
- `event`: start at the selected action, plus optional signed `offset` in seconds.
- `bridge`: begin slightly before this beat's cut to connect the passage.
- `post`: explain the consequence after the event; highlighted goals reserve reaction time.

Use `hard:true` with `anchor:"event"` for short goal calls. Put necessary buildup before the call and interpretation after the visible result. Keep the full attack and outcome when shortening narration. A script beat can contain `{"text":"It is in!","tier":2,"anchor":"event","hard":true,"offset":0}`.

Synthesize with `synthesize_narration mode=match`, then render with `video_render kind=match`. Placement errors identify lines that overrun or push a hard call late; revise those lines and re-synthesize. Changing footage windows also requires re-arrangement. Use the shared bounded final review: retain the source checks for scorers, score changes and disputed decisions, then sample action-call timing, replay repetition and the ending together in one review. Only a concrete delivery error permits the one targeted repair/recheck; remaining uncertainty goes into the human-acceptance notes.
