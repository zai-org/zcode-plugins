# Film Evidence

The dialogue axis only shows what was said. Hidden evidence, silent deaths, exchanged looks, prop close-ups, moves between locations and montages are blank there; they exist only in the pictures. The coarse observation gives the whole film a scene-level visual index for choosing the story; the picture check confirms, after arrangement, what each sentence actually plays over.

## Evidence ids

| Id | Source | Proves |
| --- | --- | --- |
| `D0001` | Dialogue axis (`dialogue_index.json`) | Who said what, and when |
| `V0001_e001` | `visual_index.json` event entries | That an event is indexed at a film time; a unit-level summary |
| `F<frame>` | `visual_frames.jsonl`, one per observed frame with source time and `shot_id` | What is visible in that frame, with its uncertainties |

Specific actions must be traced to F records or dialogue. A V summary alone does not prove the whole action, and a frame sample does not prove what happened between frames. Outline points, draft notes and the fact review all rest on these ids; `writing_packet.json` carries the exact text of every cited source.

## Coarse observation

```bash
python3 -B "$VE_RECAP_DIR/container_recap.py" plan
python3 -B "$VE_RECAP_DIR/container_recap.py" observe
python3 -B "$VE_RECAP_DIR/container_recap.py" status
```

- `plan` reads `out/shots.json` and `out/dialogue_index.json`, picks one representative frame per cluster of shots (`out/sampling_plan.json`), extracts them and freezes chronological eight-frame units with the dialogue spoken around them in `out/visual_review/plan.json`. Frames an earlier run could not use stay unavailable and become a stated gap. An existing plan is reused while its inputs are unchanged.
- `observe` groups the units into at most six observer tasks of about 32 images each and returns `awaiting_subagent`; follow [native-reviews.md](native-reviews.md) and rerun. Once every task is accepted it exports `visual_index.json`, `visual_frames.jsonl`, `visual_coverage_gaps.json` and `visual_characters.json` and returns `completed` or `completed_with_gaps`.
- Each frame gets one visible fact or an explicit uncertainty; events group frames of the same happening; character observations carry `identity_status` (`unknown`, `tentative`, `confirmed`) with name evidence from that unit only. The tool adds shot ids, times and event ids and checks every reference; a report that invents a frame or names a character without evidence is rejected and answered again by the same role.
- `status` reads progress without validating; `recap_script.py packet` refuses to build while the observation is incomplete or its exports are stale (`initial_observations_incomplete`).

A coarse frame is a sample of its cluster, not of every shot in it. The index tells you who is on screen, where a scene is and what visibly happens, enough to choose the story and cite V and F ids. It does not establish a whole action, a motive or a named identity, and nothing waits for detailed observation before writing.

Every interval in `visual_coverage_gaps.json` stays a gap: none of its `shot_id`s may be used as a picture, and the story may not claim visual facts there. The story can still rely on other observed frames and on dialogue. If the full story cannot be told from the available evidence, report the exact gap rather than inventing it.

Read the evidence selectively: one unit's events, or the F records for the shot ids and time range you are working on. Do not dump the whole index into the session.

## Identity

Name characters from sourced forms of address, appearance and context together. A similar look across units is not an identity confirmation, and "a man" in one unit is not a named character until dialogue or adjacent events tie them together. `visual_characters.json` merges observations only through explicit reviewed links; unlinked observations stay separate. Keep an uncertain identity as an open question with a safe description ("the gang leader", "the male lead").

## The picture check

Detail is checked only where the edit actually uses footage. After the narration is voiced and the whole film is arranged on that audio, `prepare-production` gives every sentence with `visual_claim: true` one contact sheet: one to three frames sampled inside each exact source window that plays while it is spoken (the middle frame for a window up to 4 s, start and end up to 8 s, start, middle and end beyond; carry-overs under one second are listed, not sampled). The sheets of the whole film go to a few observer tasks at once. Each sentence gets one verdict:

- `match`: the frames show what the sentence presents.
- `neutral`: the frames neither confirm nor contradict it. Accepted; a still cannot show a motive, a whole action or a name.
- `contradiction`: the frames show something incompatible. Only this acts: one equal-length footage swap, then soften or drop.

`out/window_check.json` keeps each sentence's windows, frames, sheet, verdict and the recorded swaps and resolutions; that report is the visual evidence for the sentence in the delivery report. Sentences without a visual claim are listed as `not_checked`. Details of swaps and resolutions: [production.md](production.md).
