# Story Planning

Plan from the evidence, then arrange footage. The outline decides what is told; everything later follows it.

## Duration

Follow the latest explicit duration from the user and record it with `recap_script.py configure-duration --target-minutes <min> <max>` before planning; the target includes narration, original audio and holds.

## Speaking rate

`arrange_footage` budgets with `chars_per_sec` (default 3.4 characters per second for Chinese narration). When valid narration audio from the same voice and delivery already exists, measure the real rate (spoken characters divided by effective speech duration) and use it. Budgets include original-audio scenes and pauses; production re-checks pictures against the real audio and sentence timings anyway.

## Story spine (`out/story_spine.md`)

A short blueprint (about 300-500 characters for Chinese narration) that someone who has not seen the film understands in one reading: who the protagonist is, the starting situation, what they want, the event that breaks the situation, the main obstacles, the key actions, the midpoint turn, the biggest crisis, the climactic choice and the final outcome. One sentence of thematic judgment may help later choices, but it is not a line to be voiced and has no required number of mentions.

The spine is internal. It never enters the draft or the voice-over and is never used as an opening line. Every paragraph of the narration should hang on one link of the spine; when cutting, tick the links off one by one.

## Outline (`out/outline.json`)

```json
{"characters": [{"name": "Character name", "who": "one-line identity"}],
 "beats": [{"summary": "one line for this beat",
            "points": [{"text": "a fact the evidence supports", "dlg": ["D0012"]},
                       {"text": "a wordless plot point", "vis": ["V0031"]}],
            "editorial": {"story_change": "what changes for the characters here",
                          "audience_goal": "what the listener must understand or feel",
                          "keep": ["choice, cause, clue or result that must stay"],
                          "compress": ["preparation or repetition that one sentence can carry"],
                          "weight": 1.5, "budget_reason": "why this beat gets this share",
                          "depends_on_beats": [3]},
            "picture_plan": {"purpose": "event", "task": "what the picture must let the viewer see",
                             "withhold": []}}]}
```

Write `text` in the narration language even when the dialogue is in another language.

Rules:

- **Beat count.** Roughly 2.5 beats per target minute (about 32 for 13 minutes), within ±30%: the story structure decides, so do not split or merge to hit a number. Beats need not be even; a transition beat may have one point, a highlight beat four or five. Evenness is what makes a recap sound templated. Prefer fewer beats: when a new story unit arrives every dozen seconds, listeners cannot keep up.
- **Order.** Beats follow film time. Keep the main causal chain and the reversals; cut subplots by whole beats; never add what the film does not contain.
- **Cold open (optional, one beat at most).** Mark only the first beat `"cold_open": true` and cite evidence from the most intense conflict, usually at the climax. The tool pins that beat to the start with pictures from the climax scene, then replays the same shots normally when the story reaches them. The cold-open text raises the concrete conflict or predicament; it never reveals the outcome (who wins, who dies) and does not need a rhetorical question.
- **Story time vs. film order.** Beat order follows the footage, but narration must translate time. A flashback beat states where it sits in the story ("years earlier", "before this"). An inserted thread (an engagement, a past event) is either cut entirely or closed later; never open a thread you do not close. The connective sentences for structural devices (the cold-open payoff, the flashback reveal) are the listener's only signposts; mark them during planning.
- **Citations.** Every point cites real evidence. Dialogue points cite `dlg` D-ids close together in time (span at most 90 s). Wordless plot points cite `vis` V-ids; "there was no dialogue" is never a reason to leave an event out.
- **Names.** Infer names from dialogue. When a name cannot be established, use a safe description ("the male lead", "the gang leader").
- **Evidence boundary.** Pictures prove actions, not thoughts. "He said he would" is not "he did".

## Editorial and picture plan (per beat)

Fresh-source profiles require both objects on every beat; the script review reads them with the prose.

- `weight` (above 0, up to 10) is the beat's relative share of the film, not its amount of footage. Protect motives, key choices, reversals and emotional turns; compress repeated preparation. This is an editorial judgment about this film, not a template.
- `keep` lists at least one thing that must survive cutting; `compress` may be empty. `depends_on_beats` names the beats this one relies on; the targeted recheck of a changed beat also covers the beats that depend on it.
- `purpose` is one of `event`, `reaction`, `clue`, `establishing`, `transition`, `echo`. Optional `scene_id`, `event_id`, `time_relation`, `response_to` and `evidence_ids` record sourced context; a reaction shot needs `response_to` and `evidence_ids`, and the same face in another scene does not prove a reaction to this event.
- `withhold` keeps a shot back until its reveal: `{"shot_id": "shot_0030", "not_before_beat": 8, "not_before_sentence": 2, "reason": "revealed here"}`. Candidates, fitting, holds and render all honour it; rising source time alone does not prove there is no spoiler.
- A silent reaction after the last sentence uses `hold_after_seconds` (at most 3), `hold_reason` and `hold_audio: "silence"`; it counts toward the speech budget. Kept original sound belongs in a separately reviewed original-audio scene.

## Original-audio scenes (`out/original_audio.json`)

Reserve them before writing so the narration leaves room. Choose 2-4 complete scenes where the original dialogue or sound carries the moment better than narration: usually 6-12 s, up to 25 s when needed, never cutting a line of dialogue. The tool accepts 5-25 s excerpts.

```json
[{"after_seg_id": "s012", "start": 2710.4, "end": 2721.9, "reviewed": true,
  "reason": "The verdict line in her own voice; narration around it does not repeat it."}]
```

`reviewed: true` must rest on observed source evidence. Scenes follow film order and must not overlap shots the narration uses. Add `original_audio_path=out/original_audio.json` to `out/produce_args.json`. Narration around an original-audio scene sets it up and moves on; it does not restate the line before or after.

Optional `out/shot_ranges.json` (`{shot_id: {"start": s, "end": s, "reviewed": true}}`) records action-complete source ranges for shots whose action must not be cut short; pass it as `shot_ranges_path` only after checking the ranges against evidence.

## Arrange footage

```
arrange_footage(action="arrange", dialogue_index_path="out/dialogue_index.json", shots_path="out/shots.json",
                outline_path="out/outline.json", visual_index_path="out/visual_index.json",
                minutes=<target>, chars_per_sec=<rate>)
```

- `outline_invalid`: rewrite the outline from the listed issues and try again. `visual_index_required`: pass `visual_index_path` (needed whenever a point cites only V-ids).
- On success check `est_film_sec` against the target and `seams_per_beat` (should be at most about 2.5).
- The per-beat character counts in `writing_brief.txt` are soft. One beat slightly over is fine because pictures follow the real audio; the total character count is what sets the film length. At anchoring, an estimated length more than 20% off the target and a beat whose text likely exceeds its shot pool are reported as warnings; the picture preflight then reports real shortages per segment. Write to the budget without systematically filling every beat to the maximum.
