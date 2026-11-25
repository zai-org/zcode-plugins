# Movie Recap Workflow

Six steps: index, coarse observation, plan and write, script review, produce (voice, arrange, one picture check), final review and delivery. The outline and the spoken draft are written together and checked by one bounded script review. Each review runs once, allows one consolidated fix and at most one targeted recheck, and never loops on suggestions. Nothing stops the whole film: a sentence that stays unsupported is softened or dropped, and the decision is recorded for the report. Scripts run as `python3 -B "$VE_RECAP_DIR/<script>.py" ...`, default to `out/` in the project root and print one JSON line. Start by reading `out/production_profile.json` (title, source, target minutes, policies) and `out/produce_args.json`.

`$VE_RECAP_DIR` is this plugin's `recap/` directory; the session-start environment check prints it. If the variable is empty in your shell, use that printed path in its place.

When `out/production_profile.json` does not exist yet (no batch pipeline prepared this project), start the recap from the user's film:

```bash
python3 -B "$VE_RECAP_DIR/container_recap.py" init --video "<film path>" --title "<film title>" [--target-minutes 8 12]
```

`init` binds this project to that film and writes the profile; rerunning it with the same arguments resumes. One project holds one film: for another film use a new project directory, and change only the length with `recap_script.py configure-duration`.

`detect_shots`, `build_film_index`, `synthesize_narration` and `produce_film` are long jobs: collect the returned `job_id` with `job_action=status` before any dependent step.

Any stage can return `awaiting_subagent`: dispatch the listed tasks as described in [native-reviews.md](../references/native-reviews.md), then rerun the same command. Waiting is not a pass.

## Artifacts

All under `out/`: index (`film_index.json`, `shots.json`, `dialogue_axis.txt`, `dialogue_index.json`); coarse observation (`visual_index.json`, `visual_frames.jsonl`, `visual_coverage_gaps.json`, `visual_characters.json`); your plan and draft (`story_spine.md`, `outline.json`, `original_audio.json`, `draft_story.md`, `writer_script.json`); `arrange_footage` reel (`reel.json`, `plan.json`, `writing_brief.txt`); `writing_packet.json`; script review (`script_review.json`, `script_gate.json`); `sentence_resolutions.json`; preparation (`script_tts.json`, `window_check.json`, `production_ready.json`); production (`narration_script.json`, `edl.json`, `final.mp4` and its render and QC reports); delivery (`spot_review.json`, `final_review.json`, `report.md`). Subagent tasks and reports live in `out/<stage>/<batch>/`.

## 1. Index

`build_film_index(input_path=<film>, language=<"zh" for Chinese films, "auto" otherwise>)`. Never pass a concrete foreign language code: speaker labels exist only for empty/`auto`/Chinese settings. Products bound to the current input are reused; selected cut points are refined in production. A `sparse_dialogue` warning means dialogue gives few clues: state any gap where key plot cannot be verified.

## 2. Coarse observation

```bash
python3 -B "$VE_RECAP_DIR/container_recap.py" plan
python3 -B "$VE_RECAP_DIR/container_recap.py" observe
python3 -B "$VE_RECAP_DIR/container_recap.py" status
```

`plan` samples one representative frame per cluster of shots into eight-frame units with the dialogue around them. `observe` prepares four to six observer tasks (`awaiting_subagent`), then exports the visual index once every task is accepted: `completed`, or `completed_with_gaps` when a unit stayed unobserved. `status` shows `in_progress` or `exported`. Read the index with `dialogue_axis.txt` to choose the story; it is a scene-level index, not detail evidence, and it is the last look at the film before writing. Keep identity and causality doubts open and write them as doubts. Whether the picture under each sentence shows what the sentence says is checked after arrangement on exactly those frames (step 5), so looking at more frames now answers the wrong question. The only agents in a movie run are the tasks the stage commands return. Details: [evidence.md](../references/evidence.md).

## 3. Plan and write in one step

When the user's latest duration differs from the profile:

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" configure-duration --target-minutes 18 22
```

Write `out/story_spine.md` and `out/outline.json` (beats with `editorial` and `picture_plan`, points citing D/V ids), pick original-audio scenes, then arrange footage:

```
arrange_footage(action="arrange", dialogue_index_path="out/dialogue_index.json", shots_path="out/shots.json",
                outline_path="out/outline.json", visual_index_path="out/visual_index.json",
                minutes=<target>, chars_per_sec=<rate>)
```

Write from `dialogue_axis.txt`, `dialogue_index.json` and `visual_index.json`; nothing else about the film is read before the draft exists. Where the story needs a concrete visual detail, write the sentence with `visual_claim: true` and move on: the picture check after arrangement confirms it on the frames that will actually be on screen, or softens the sentence. Observing the film again now costs an hour and still looks at other frames than the final cut. Command results carry every number, option and rejection reason the next step needs; act on them rather than reconstructing the rules.

Then build the packet and write the whole story as natural speech in the same pass:

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" packet
python3 -B "$VE_RECAP_DIR/recap_script.py" import-draft --draft-file out/coordinator_draft.json
```

`packet` validates every D/V/F reference; rebuild it after the outline, evidence, original audio or duration change. Import the draft bound to the current `packet_id` (`--replace-draft` archives an old one), then place it into `out/writer_script.json`: every sentence carries `point`, `role`, `shots` and a boolean `visual_claim`. Settle identities, causality and reveal order as you write: a structural mistake costs the single fix. Rules: [story-planning.md](../references/story-planning.md), [writer-script.md](../references/writer-script.md).

## 4. Script review: one review, one fix, one recheck

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" review
python3 -B "$VE_RECAP_DIR/recap_script.py" check
```

`review` first checks the estimated length against the target (`draft_duration_outside_target` means shorten or extend before any review), then prepares one review round: a whole-manuscript readability task plus fact tasks of at most 45 sentences, dispatched together. It blocks only on unsupported or contradicted plot facts, wrong identities, broken main-line causality, wrong numbers and early reveals; the rest are suggestions. On `needs_revision`, fix every blocker in one consolidated draft, import it with `--replace-draft`, update `writer_script.json` and run `review` again: the single targeted recheck of changed beats, their direct dependents and neighbours. `passed` with suggestions is done. If blockers remain after the recheck, `review` returns `resolved`: each blocked sentence is dropped from the production narration and recorded. Do not rewrite the manuscript again; to keep a sentence, soften it to what the evidence supports:

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" resolve --sentence-id B011S003 --text "<softened wording>" --reason "<why>"
```

(`--drop` drops it explicitly.) Decisions change only the production narration, never the reviewed manuscript. Editing the manuscript after both reviews returns `blocked`: restore the reviewed wording and use `resolve`. `check` lists what is still open. Scope rules: [script-review.md](../references/script-review.md).

## 5. Produce: voice, arrange, check the exact windows

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" prepare-production
python3 -B "$VE_RECAP_DIR/recap_script.py" status
```

`prepare-production` anchors the manuscript, refines the shots it may use, confirms the script review is current, voices and verifies the narration (paragraph speech checked by recognition, the cache `produce_film` reuses), arranges the whole film on that real audio so every sentence gets its exact source windows, then runs one picture check: each sentence with `visual_claim` gets one contact sheet of frames sampled inside its windows, packed into a few observer tasks. Verdicts are `match`, `neutral` or `contradiction`; only a contradiction acts. Its footage is swapped once for other footage of the same length and only that sentence is looked at again; if no swap exists or it still contradicts, the sentence is softened to drop the contradicted claim (or dropped when nothing is left) and only its paragraph is voiced again. Results are in `out/window_check.json`.

Paused results: `awaiting_subagent` (dispatch and rerun), `audio_pending` (speech synthesis or its check incomplete), `needs_picture_plan` (a paragraph cannot be arranged as written: apply one option from its `fit` feedback), `needs_refinement`, `needs_revision`, `needs_attention`. `ready` writes `out/production_ready.json` and binds the version. `recap_script.py window-check` is a planning view of the windows, frames and tasks without voicing or checking.

Then call `produce_film` with every argument from `out/produce_args.json`, or run it synchronously:

```bash
python3 -B "$VE_RECAP_DIR/produce_recap.py" --project-dir . --args-file out/produce_args.json
```

It reuses the verified audio, fits pictures within the checked windows, inserts original audio, renders with subtitles and runs QC. Parameters and `failed_step` handling: [production.md](../references/production.md).

## 6. Final review and delivery

```bash
python3 -B "$VE_RECAP_DIR/review_final_recap.py" plan --video out/final.mp4
python3 -B "$VE_RECAP_DIR/review_final_recap.py" run
python3 -B "$VE_RECAP_DIR/review_final_recap.py" check
python3 -B "$VE_RECAP_DIR/recap_contract.py" --root .
```

The final review samples the rendered video once (capped, distributed), allows one consolidated correction and one follow-up plan on a new render (`plan --new-version`); QC runs automatically. Write `out/spot_review.json` and `out/report.md`; the report lists every dropped or softened sentence with its reason from `out/sentence_resolutions.json`. When only actual listening or continuous playback remains (`awaiting_listening` / `awaiting_playback`), the preview and its checklist are this run's delivery: stop editing; never write a listening or playback record yourself. Tiers and bindings: [final-review.md](../references/final-review.md).

## Resuming

Every step skips work still bound to its current inputs, and a stage paused on a subagent continues when you rerun it. `recap_script.py status` shows the observation, script review, picture check, preparation and final review at once.

## Common failures

- **Too little footage or too long.** Use the `fit` numbers and options in the result; re-select shots first, then shorten the affected text.
- **Wrong scene for a line.** A line said in scene A about scene B is reported speech, not shown action.
- **Patching paragraph after paragraph.** One fix, one recheck; collect every blocker first. After that, resolve sentences instead of rewriting.
