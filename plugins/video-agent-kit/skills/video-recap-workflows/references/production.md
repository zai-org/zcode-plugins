# Production

Production turns the reviewed `writer_script.json` into the full-length film: fixed version, continuous narration, speech check, whole-shot picture fit on the real audio, original-audio inserts, subtitles, render and QC.

## Parameters (`out/produce_args.json`)

Keep the task's template. Defaults: `continuous_delivery=true, fit_mode=whole_shot, bed_volume=0, tail_volume=0, bgm=false, render=true`. One preset voice ID for the whole film; no voice cloning. With `continuous_delivery` each paragraph is synthesized as one take, aligned by speech recognition, loudness-normalized and padded.

Add as needed:

- `original_audio_path`: `out/original_audio.json` (reviewed original-audio scenes; they keep their own sound, nothing leaks through narration gaps). Required whenever that file lists scenes. When frames inside a scene's spoken lines already show the film's own Chinese subtitles, the render adds no caption of its own there; English-only or unclear cases keep the dialogue captions. The decision per scene is in `original_audio_subtitles` of the render report.
- `shot_ranges_path`: reviewed action-complete ranges per shot.
- `avoid_shot_ids`: shots excluded film-wide after a review found contradiction or irrelevance.
- `approve_segments` / `avoid_shot_ids_by_seg`: fit-review decisions (below).
- `render=false`: stop after the EDL to inspect it. Do not repeatedly render only an opening sample.

## Prepare the fixed version

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" prepare-production
python3 -B "$VE_RECAP_DIR/recap_script.py" status
```

`prepare-production` (reads `--args-file`, default `out/produce_args.json`) reuses every result still bound to its inputs and runs in this order; `step` in its result names where it stopped:

1. `anchor`: deterministic anchoring, with recorded soften/drop decisions (`out/sentence_resolutions.json`) applied to the production narration only.
2. `selected_refinement`: cut-point refinement of the shots any arrangement may use (writer choices and each paragraph's pool window) into `out/shots_refined.json`, same shot ids, and `out/source_edit_spans.json`, verified internal cuts inside long parents. `needs_refinement` lists shots that could not be refined.
3. `script_review`: the script gate must be `passed` or `resolved` for the current manuscript; otherwise the review task is prepared here.
4. `narration_audio`: narration voiced and verified first (whole paragraphs; recognition checks reading and alignment). `audio_pending` means voicing or its check is incomplete; windows are never checked on estimated timing.
5. `picture_check`: the whole film arranged on the real audio, every sentence given its exact source windows, then one picture check of those windows (verdicts and sampling in [evidence.md](evidence.md)). `awaiting_subagent` pauses here.
6. `ready`: `out/production_ready.json` binds text, decisions, windows and picture parameters.

On `awaiting_subagent`, collect the grouped tasks through [native-reviews.md](native-reviews.md) and rerun. On `audio_pending`, voicing or its ASR check is incomplete: windows are never checked on estimated timing. Voicing and its ASR check use the signed-in ZCode account, which only MCP tool calls carry; when a command returns `handoff` (with `audio_pending`, or as the error of `produce_recap.py`), call the MCP tool `handoff.mcp_tool` with exactly `handoff.arguments`, then rerun the same command — it reuses that audio and verification. Do not edit the arguments: they are the cache key.

Only a `contradiction` acts, and each contradicted sentence gets at most one swap:

- **Swap.** The sentence's windows are replaced by other footage of the same length from its paragraph's pool, so the audio and every other sentence's windows stay as they were; only the swapped sentence is checked again (`swapped` in `out/window_check.json`).
- **Soften or drop.** When no replacement exists or the swap still contradicts, the observer's `softened_text` (the sentence without the contradicted claim) is recorded as a resolution, or the sentence is dropped when nothing is left. Only that paragraph is voiced again; a softened sentence is never checked again.
- **Your own decision.** `recap_script.py resolve --sentence-id B011S003 --text "<softened>" --reason "<why>"` softens a sentence to what the evidence supports (`--drop` drops it); the same command settles sentences left blocked by the script review. Rerun `prepare-production` afterwards.
- **Fit feedback.** When a paragraph cannot be arranged as written, the result is `needs_picture_plan` with `blocked_segments`, and `out/window_check/arrangement.json` carries `fit` per sentence: speech seconds, own-shot seconds, shortage, and options (`extend_within_shot`, `split_sentence`, `shorten_sentence` by N characters, `pick_another_window` with candidate shots). The other paragraphs were checked. Apply one option; never simulate the arrangement with helper scripts.
- `needs_attention` with `picture_check_round_bound_reached` means the check could not settle in its rounds; read the report before changing anything.

`recap_script.py window-check` prints the windows, frame count and task plan from saved speech timing without voicing or checking (paragraphs without measured audio are marked estimated). After changing text, evidence or avoided shots, run `prepare-production` again.

## Run `produce_film`

Call `produce_film` with every argument from `out/produce_args.json` and collect the job result, or run it synchronously:

```bash
python3 -B "$VE_RECAP_DIR/produce_recap.py" --project-dir . --args-file out/produce_args.json
```

Order: production-ready check, anchoring, paragraph speech with recognition (cached from preparation), whole-shot fit on the real audio within the checked windows, fit review, original-audio insertion, render with burned subtitles, QC. It stops at the first actionable error with `failed_step`; fix the data and call again. Unchanged inputs reuse cached stages.

Subtitle lines break at punctuation or a word boundary, never inside a number or leaving one character on a line. Every cue stays on screen at least 0.85 s, and at least one second per 9 characters (capped at 4 s): a short cue extends into the following gap, starts slightly earlier, or joins the neighbouring line of the same scene; it never overlaps the next cue or runs more than 0.2 s past its scene's audio.

| `failed_step` or error | Meaning | Action |
| --- | --- | --- |
| `production_version_not_ready`, `production_version_invalid`, `production_inputs_changed` | No fixed version, or inputs changed since | Run `prepare-production`; read its reports |
| `resolutions`, `script_review` | Decisions or gate not valid for the current text | Resolve the listed issues and review again |
| `anchor` (`script_invalid`, `over_budget`), `duration` | Missing beats, text that cannot fit its footage, or total length outside the target | Fill the beats; shorten that beat by the cutting order |
| `picture_preflight` | A required picture is unavailable, footage is short, or timing conflicts | Apply one `fit` option |
| `tts` / `tts_verify` | Synthesis failed, or the audio does not say the script | Rewrite the failing sentence as plain narration (embedded quotes and onomatopoeia are the usual cause) |
| `tts_script_binding` | Audio no longer matches the script | Re-run with the current script; never reuse audio by hand |
| `fit_review` | Review decision not valid for the current chain | Re-read `out/fit_report.json` and decide on the current chains |
| `picture_fit` (`footage_shortage`, `duration_mismatch`, `cannot_fill`) | The event pool cannot cover the audio, the main shots overshoot it, or review rounds are exhausted | Change the sentence's cited shots or shorten that event's narration |
| `refit`, `anchor_refit`, `bind` (legacy fit only) | Beat audio exceeds its reel, or a sentence has no feasible picture | Shorten that beat or sentence |
| `render`, `qc` | Render gate or QC failed | Fix the reported cause; never deliver with a failing QC |

Ordinary recognition differences go to the listening checklist; a severe mismatch gets at most one automatic re-voice, and a worse repair is discarded. Changing only pictures reuses text and audio; a text change re-voices only affected paragraphs.

Never switch off speech verification or lower a requirement to get a success status. With `Name: "line"` the voice may drop the attribution or act the quote. While recognition is unavailable, verification stays pending; re-verify later instead of accepting a warning.

## Fit review (`status: needs_review`)

The fit stays inside the checked windows; footage that moved outside them is listed as `window_check_drift` in `out/fit_report.json` and needs review. Shots the tool adds to fill an event, and portions of long shots, are not final: `produce_film` returns them under `needs_review` with `out/fit_report.json` and a local preview `out/fit_preview.mp4`. Judge each event against the saved frame records for its shots and its narration. Verified internal boundaries establish where footage comes from, not its meaning. Fit approval binds the selected source frames and span identity.

- Accept: pass `approve_segments=[seg_id, ...]` (or `{seg_id: chain_fp}` for a specific chain) and call again.
- Reject: pass `avoid_shot_ids_by_seg={seg_id: [shot_id, ...]}`; the event is re-fit without them. After 3 rounds an event returns `cannot_fill`.

Approve specific chains you actually checked, never the whole batch unconditionally.

## Citation report

A successful result also reports `citations` and `citation_violations`: `out_of_order` checks film order, `consumed` whether a key picture was crowded out.

## Tools behind `produce_film`

For debugging a single stage, the same chain is available as separate tools: `arrange_footage action=anchor` (narration script and event graph), `synthesize_narration` (paragraph speech, `verify="asr"`, preset `voice`), `bind_narration` (`fit_mode=whole_shot` default, `legacy` is the tape binder after `arrange_footage action=refit`; emits `out/edl.json` and `out/edl_qc.json`), and `video_render(kind="narrated", source=<film>, edl_path="out/edl.json", shots_path="out/shots.json", narration_path="out/script_tts.json", output_path="out/final.mp4", burn_subtitles=true, subtitle_position="lower", bgm=false, bed_volume=0, tail_volume=0)`, then `video_qc(kind="video", source="out/final.mp4", timeline_path="out/shots.json", output_json="out/final_qc_report.json")`. `detect_shots(input_path=..., force=true)` rebuilds the frame-refined shot timeline. Delivery always comes from a full `produce_film` run.
