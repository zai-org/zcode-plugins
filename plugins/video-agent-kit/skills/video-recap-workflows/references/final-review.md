# Review and Delivery

`produce_film(render=true)` renders `out/final.mp4` and runs QC against `out/shots.json`, bound to the actual render record (`out/final.render_report.json`). To re-check separately, keep the same binding: `video_qc(kind="video", source="out/final.mp4", timeline_path="out/shots.json", output_json="out/final_qc_report.json")`. A missing render record means the provenance chain must be repaired. Delivery needs the script gate, the picture check, technical checks of the full output, selected final-video inspection and real listening. Visual sampling does not establish continuous full-film viewing.

## Sentence/picture review (`out/spot_review.json`)

Check the current EDL and full-length video. When a local fit is clearly wrong, locate it with the EDL or a local preview; once the full-length video exists, continue into the final review rather than re-running the text review for the same finding.

Use the picture-check verdicts per window: `match` (the picture supports the narration), `neutral` (no conflict, little help) and `contradiction` (the picture belongs to another part of the story or says the opposite).

Filter first, then look. The data is already in the artifacts:

1. The first sentence naming each character in `writer_script.json`.
2. Every `role=turn` and `role=payoff` sentence.
3. Every thread-switching `bridge` (it must show the new scene's establishing shot).
4. Sentences whose anchors missed: in `edl.json`, units whose `semantic_map` has no overlap between `anchor_shot_ids` and `selected_shot_ids`.
5. Tight segments (audio duration / reel seconds above 0.95).
6. Reuse the final plan's at most eight distributed sample locations; do not add a second random sample pass.

For each window, reuse the verdict in `out/window_check.json` and the final-review evidence that already cover the same picture and narration; the fit stays inside the checked windows, so a new look is needed only where `window_check_drift` moved footage or the meaning changed. Do not repeat a completed check merely to write a second report.

Gates:

- `contradiction`: collect all such findings, fix their anchors or wording together, run `prepare-production` and produce once, then re-check the affected segments. Persistent contradictions remain open after that follow-up; do not enter another automatic render/review loop.
- Key sentences (groups 1-3) follow the picture check: a key sentence with `visual_claim` needs a `match` or `neutral` verdict on its current windows; `contradiction` or a missing verdict fails it. A key sentence that makes no visual claim (a motive, a realisation, a bridge of reasoning) is judged by the script review, not by its picture, so it is not a picture gate here. Change the anchor or the wording only for a failing one.
- More than 30% `neutral` among key sentences with a visual claim: report the anchor-quality concern in the report. It does not block delivery by itself.
- More than 10% contradictions usually means the outline turned something a character said into something shown happening.
- The cold-open beat is exempt from film order, not from correspondence: its pictures must really be from that climax.

Write each window's verdict and the tally to `out/spot_review.json` with `script_sha256`, `edl_sha256` and `tts_sha256` of the current `writer_script.json`, `edl.json` and `script_tts.json`. `status: passed` is written only after the checks above actually pass and `citation_violations` is zero.

## Seams

The narrated render decodes the frames on both sides of every cut and reports `seam_scan` (`clean` or `residual_frames` with `bad_seams` listing output time, segment and whether the stray frame is before or after the cut). A residual frame is the visible flash; do not deliver it unreviewed. First confirm `out/shots.json` is `cover-all-v3-frame` (otherwise `detect_shots(force=true)` and fit again). For remaining seams, check whether the window ends on a `boundary_in: soft` boundary or inside a long shot, change the shot or cut point and render again; a seam that is actually fine needs `final_review.seam_review` with `status: passed`, evidence and a per-seam reason. Report "seam scan N/N clean", not a claim that problems were eliminated.

## Final-video review

```bash
python3 -B "$VE_RECAP_DIR/review_final_recap.py" plan --video out/final.mp4
python3 -B "$VE_RECAP_DIR/review_final_recap.py" run
python3 -B "$VE_RECAP_DIR/review_final_recap.py" status
python3 -B "$VE_RECAP_DIR/review_final_recap.py" check
```

`plan` needs the current passing `final_qc_report.json` and a render report with the measured actual timeline (windows, segment timings, subtitle hash). It writes `out/final_review/plan.json` and `listening_template.json`. `run` packs the selected images into reviewer tasks; on `awaiting_subagent`, follow [native-reviews.md](native-reviews.md) and rerun `run`. `status` and `check` read the state; `check` exports `out/final_review.json`.

One bounded pass: at most 96 distinct frames and at most eight distributed locations. Opening, ending, subtitle and technical warnings, located seam defects and previously failed items are always checked; key story and relationship moments are represented by samples, and the plan lists unselected risk items without claiming to have checked them. If the required checks alone exceed the bound, or defect locations are incomplete, the review stops with `out/final_review_manual_handoff.json`: a checklist bound to this render that `plan`, `run`, `status` and `check` return while the inputs are unchanged. Finish the report and stop automatic review; the handoff does not count as completed inspection or acceptance.

Coverage includes critical narration, actions, clues and reveal relationships, the ending, original-audio boundaries, technical warnings, important cuts and distributed samples. Related material is checked together. Unclear action or continuity stays `needs_review`; visual agents never claim actual listening.

After the one consolidated repair and a real new render, use `plan --new-version`: the finished review moves to `out/final_review_history/` and the new plan re-checks every failed item and the cuts next to it. Only one follow-up is allowed; a further attempt hands off the remaining items. Ordinary wording or minor composition preferences are report suggestions and do not justify another render. Sampling does not prove continuous playback.

## Listening and playback

Still frames and recognition cannot replace listening, and sampled frames cannot replace continuous viewing. These are human checks, recorded outside the agent session:

- `awaiting_listening`: the automatic review is complete; `out/final_review/listening_template.json` lists segments, joins, original-audio scenes, silences and subtitle items to listen to.
- `awaiting_playback`, `needs_visual_review`: some items need continuous viewing before they can pass; `check` writes `visual_resolution_template.json` for them.

When the review reaches one of these states, the full-length `out/final.mp4` is the review draft: finish `out/report.md` with the preview, the checklist and the open items, and stop automatic editing. Never write, fill in or import a listening or playback record yourself (`import-listening` / `import-visual` take records made by people), and never describe the film as accepted; a text model has not listened. Defects found by people come back as a new task.

## Bindings

Every acceptance record is bound to the bytes it checked (SHA-256 of the raw file):

- `script_gate.json`: `script_sha256` of `writer_script.json`, `draft_sha256`, `packet_id` and `review_sha256` of the composed review.
- `window_check.json`: `narration_sha256` of the production narration it checked.
- `spot_review.json`: `script_sha256`, `edl_sha256`, `tts_sha256`.
- `edl_qc.json`: `edl_sha256`, written by the fitting tools after their own checks.
- `final_review.json` (exported by `check`): `status`, `video_sha256`, `edl_sha256`, `tts_sha256`, the number of `visual_frames` actually sampled from the final video, and `evidence` paths that exist under `out/`. Source-film observations do not count as final-video inspection.
- `final.render_report.json`: output, EDL, TTS, source, audio, subtitle and font hashes, `subtitle_burned`, `seam_scan`, `original_audio_subtitles` (per original-audio scene: whether the source already carries Chinese subtitles and how many captions were added) and `subtitle_timing` (cues under the minimum on-screen time before and after the timing pass).

After any change to text, narration, edit or render, redo the affected checks. Never patch a hash, flip a status or copy an old conclusion.

## Report (`out/report.md`)

Write it in the task language. Include: target and actual duration; beat, sentence and character counts; V-index entries and outline `vis` citations; measured speaking rate; role distribution and what was cut; the story spine; review rounds and the main issues fixed; speech verification fail/warn; anchor hit rate; the verdict tally; rhythm from `edl_qc` (an average hold of 5.5-8 s is a whole-film reference only: 2-4 s cutting in climax beats and 8-12 s holds in emotional beats are normal, so read it per beat type); seam scan result; every source interval that could not be observed; every dropped or softened sentence with its original wording and reason (`out/sentence_resolutions.json`) and any footage that moved outside a checked window (`window_check_drift`); remaining risks.

Run `python3 -B "$VE_RECAP_DIR/recap_contract.py" --root .` last; it lists every remaining gap. The movie-recap contract is `out/final.mp4`, not a generic preview, so do not build a placeholder timeline to satisfy another contract.
