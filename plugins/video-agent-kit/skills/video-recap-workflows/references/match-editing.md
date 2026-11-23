# Match Recap: Shared Method and Tool Contracts

Use this reference with the soccer, basketball or LoL workflow. Read [editing judgment](../../video-edit-assembly/references/editing_judgment.md) for selection, structure, cuts and audience review. Shared evidence and source/output time rules belong to [video-agent](../../video-agent/SKILL.md).

## Understand the Match Before Selecting Highlights

Read the commentary across every supplied part and form a short account of how the result developed. Track the leading side, the opponent's response and the decisive change. Mark uncertain names, scores and resource ownership for local observation. Commentary is a locating aid: a caster's reaction can lag the action, describe an earlier event or accompany a replay.

Use `video_observe` for candidate windows. Preserve setup, action, visible result and useful aftermath. Judge a replay using the replay marker, repeated action, clock and match state together; a missing scoreboard alone is inconclusive. A replay can clarify an action when identified as the same event. It must not become a second score or a new action in the narrative.

Choose each beat for the new information it contributes. Include meaningful replies and failed comeback attempts when they explain the result. Decide whether an opening teaser helps this particular story; a strong chronological opening is also valid. Vary pacing with information density and leave enough time to see the outcome. Use reaction or crowd sound when it carries meaning. A long narration gap is a prompt to inspect that passage, not an instruction to add filler speech.

When the user supplies no duration, let the complete selected events and measured narration determine the running time; do not invent a minute target. Keep the edit concise by trimming dead time, redundant replay and repeated commentary. Treat an approximate requested duration as a pacing target. Preserve the selected sport's required actions and report a longer cut when complete actions require it. Follow explicit user limits or selection preferences, and surface an incompatible fixed-duration request instead of silently omitting required events. Selection and coverage rules belong to the workflow; the user does not need to repeat them in each brief.

## Prepare Sources and Evidence

Match sources are full broadcasts, ordered by half, quarter or game. Split recordings remain one match. Short highlight compilations may lack the setup and source windows needed to fit new commentary; use the general editing workflow when the supplied material cannot support a full-match recap.

Register the actual supplied files:

```json
{"mode":"match","action":"ingest","sport":"basketball","home":"Home","away":"Away","parts":[{"name":"Q1","video":"q1.mp4"},{"name":"Q2","video":"q2.mp4"}]}
```

This is an `arrange_footage` call. Make it before starting the transcriptions, or after they finish: ingest takes the artifact directory exclusively and fails with `output is owned by another active job` while a `transcribe` job is writing into that directory. `sport` is given only here; the later actions read it from `out/match.json` and reject it as an argument. `sport` is `soccer`, `basketball` or `lol`. It writes `out/match.json`; `out_dir` changes the artifact directory. Part ids are `"1"`, `"2"`, etc., in the supplied order. Soccer can additionally read an existing event annotation file through `labels_path`. Verify those event times against the supplied broadcast.

Use `transcribe` for each full source, with separate `output_json` paths and `language="auto"` for mixed or foreign commentary. Build the commentary axis with:

```json
{"mode":"match","action":"dialogue","match_path":"out/match.json","transcript_paths":{"1":"out/transcript_1.json","2":"out/transcript_2.json"}}
```

The transcript mapping must cover every part. `commentary_axis.txt` and `commentary_index.json` retain C ids, part ids and source times. Keep the factual references in the outline's notes. Source seconds are different from the broadcast match clock, especially across pauses, halftime and replays.

## Write and Voice

Keep `outline.json` and `writer_script.json` as separate editable artifacts. The outline uses unique integer beat `idx` values; each script beat uses the same `idx`. The script shape is:

```json
{"beats":[{"idx":2,"sentences":[{"text":"They create space on the left.","tier":0,"t":62.0},{"text":"The shot is in!","tier":2,"t":65.1,"hard":true}]}]}
```

Write narration in the requested language. Keep names and pronunciations consistent. Tiers 0/1/2 convey increasing energy through delivery speed with one fixed voice. A `hard` sentence is an action call whose start must coincide with the reviewed action; make that sentence short enough that the relevant word is not buried after a long introduction. Use the placement report for all calls and sample their rendered placement in the consolidated final review.

Call `synthesize_narration` with `mode="match"`, `script_path="out/writer_script.json"` and, if chosen, `voice` and `rate` such as `"+0%"`. It writes `out/script_tts.json` containing measured per-sentence audio. `output_json` and `audio_dir` can change the destinations. Keep the same voice throughout the match. Shorten or split awkward lines and regenerate the affected stage; the shared request cache reuses unchanged speech.

## Render and Review

After arrangement and synthesis, use:

```json
{"kind":"match","reel_path":"out/reel.json","narration_path":"out/script_tts.json","outline_path":"out/outline.json","output_path":"out/final.mp4","subtitle_position":"lower"}
```

This is a `video_render` call. Review representative broadcast layouts before selecting `subtitle_position` (`top`, `middle`, `lower`, `bottom`). Protect the ball, players, scoreboard, kill feed and minimap. The current match renderer exports 1280×720 at 25 fps; assess small HUD text at delivery size.

The render writes `final.qc.json`, `final.placement.json` and `final.render_report.json` alongside the output. A failed attempt preserves the previous cut and reports; inspect any `final.failed.qc.json` and `final.failed.placement.json` returned by that attempt. Conflicting arrangements return `coverage_report.failed.txt` while preserving the previous reel and brief. Keep technical QC and the existing source/script fact checks. Add another technical check only for a concrete concern not covered by the render QC.

Prepare **one consolidated sampled final review** with `arrange_footage`:

```json
{"mode":"match","action":"review_prepare","render_report_path":"out/final.render_report.json"}
```

Read the returned request. It selects at most six output windows: opening, middle, ending, a flagged narration gap if present, and distributed hard calls. Check names, score progression and resource ownership against the evidence already recorded before rendering; do not repeat the source search for settled facts. Reuse current-output observations when available. Otherwise observe each requested window once, using at most six frames and `include_transcript=false`; this final review does not need a new transcription or review API. A single native reviewer may handle the whole request if available; do not create a reviewer per window. Keep the full action in playback when that capability exists. Sparse frames and a bounded window may leave motion or the full outcome unverified; report that limit rather than extracting ever-denser frames.

Write a local result following the request's `result_fields`, including every `sample_id`. Use `ok` only for actually observed samples; use `uncertain` or `not_checked` otherwise. Name concrete errors in `observations` and cite the actual image files or playback/listening record in `evidence_paths`. Set `visual` to `frames`, `playback` or `unverified`, and `audio` to `listened` or `unverified`. Frames and transcripts never establish listening. Import it with:

```json
{"mode":"match","action":"review_import","review_path":"out/spot_review_result.json"}
```

The tool writes the match's spot-review report (its path is returned as `review_report_path`) and keeps a review ledger per match, so several matches can be reviewed in one project. Never edit or delete the ledger. Only a clear **delivery error**—wrong score/team/outcome, missing decisive result, obstructed essential text, or broken sound/cut—opens **one targeted repair and recheck round**. Group the recorded errors into that one round. Repair the cause, re-synthesize changed speech, re-arrange basketball/LoL after speech changes, then render and run `review_prepare` again; it requests only the affected samples. Changed source, script or audio still invalidates downstream production bindings. Repeated prepare calls, a new output filename and another render never reset the review allowance.

After that recheck, or when only uncertainty/style preferences remain, stop automated review. Put unresolved issues and unverified motion/audio in `out/report.md` for human acceptance. Do not rewatch the whole cut, request extra dense grids, or start a third review round. `sampled_review_complete` describes the sampled scope, never whole-video approval. For older render reports without bound review sidecars, preserve the existing video and review notes and disclose the legacy review limit; do not re-render solely to obtain the new review record.
