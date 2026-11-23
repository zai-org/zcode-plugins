# Fault modes at a glance (D1-D12, all measured)

> Learned from three real cases: a 37.8 s street-market scene (the whole v1-v6 fault chain), a music video and a stage performance.
> Each row = symptom → root cause → fix. Match the symptom first, then act; do not tune parameters blindly.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| D1 | Original face left in + the source's burned-in subtitles reproduced + slow motion (a "re-recorded" look) | The replacement binding failed: a position word with no referent, or a plot description that contradicts the video | Bind by **appearance** in the prompt (never "the person on the left"); describe the plot from what the footage shows, never from imagination |
| D2 | One shot inside a window is not replaced (the other shots are fine) | **That shot has no storyboard of its own** (it recurred twice: segment 6 of the street-market case, shot 42 of the music video) | Hard rule: every shot in a window gets its image; the preflight checks the shot list against the image list and stops on the first gap |
| D3 | A stretch of the timeline is not processed / silently skipped | Holes in the shot table (short segments filtered out, micro holes of 0.03-0.77 s) | Keep every cut and merge micro segments (<0.05 s) into the previous shot; group windows only after **the full-coverage assertion finds no hole** |
| D4 | Incoherent story, the action at the end of a segment is cut off | Padded duration (request longer than the window, so the model stretches into slow motion) + a hard cut at a fixed length | Request = window rounded up; trim the output **by frame count** back to the exact window; acceptance checks the cuts inside the window, not only the total length |
| D5 | Drift accumulates in the assembly | Each window rounded to seconds independently | **Shared 24 fps frame grid**: F=round(24·t), neighbouring windows share the boundary frame number, split by frame count (`-frames:v N`) |
| D6 | Limbs interpenetrate or float in body-contact shots | The generation model is weak at contact geometry (an inherently hard area of the material) | Several candidates + blind rating against a fixed rejection line; a contact-constraint sentence was tried and **pulled two windows in opposite directions, so it is not adopted**; do not pile on reference images indiscriminately |
| D7 | The face drifts or merges with a hand in motion | Quality inherent to re-performance | 2K tier + several candidates; **acceptance needs a human at original speed with the audio track** (a correct identity in still frames says nothing about motion quality) |
| D8 | The last frame of a window does not match the source's end state (9 of 10 windows) | The re-performance is free on the time axis | A known boundary (the ceiling of "faithful"); a sacrificial tail (source + 0.6 s) is an optional directional improvement; a seam that still reads as a normal cut is acceptable |
| D9 | True freeze (the source moves, the generation holds still for about 1 s) | The generation dropped the action (measured in the music video at 10.5 s and 26.5 s) | Redraw that window; **compare motion energy** (flag when the frame-difference ratio of the lower to the upper half is below 0.35) |
| D10 | Two cases perform very differently | Material difficulty comes in tiers (non-contact choreography = good; body contact = medium) | Set expectations by material type; for a new material type run a probe window before scaling up |
| D11 | The people in different storyboards "are not the same face" (drift between draws) | Each shot is generated independently, with its own variance | **Main defence = the character sheet** (make it once in S3a, look at it, attach it to every storyboard); safety net = the pairwise storyboard similarity check in `swap_verify` (threshold 0.12; the normal band for one person across scenes measured 0.14-0.30, do not raise it); regenerate outliers with the sheet |
| D12 | The prompt fights the reference image and causes drift | The text restated details the image already locks, slightly differently | **The sheet / anchor rides only as a reference image; the prompt always binds by pointer, "the person from image N"; appearance text stays out of the prompt** (a restatement that differs from the image causes drift); exception: for close-up shots add the appearance text |

## Character sheet discipline (S3a, from the plugin's character-card lifecycle)

- One 11-zone sheet per character (main portrait / full-body orthographic three-view front-side-back on white / four expressions in their own zone / hairstyle with side and back / wardrobe layers / color chips / profile); it **takes one reference slot of the video generation**
- Several characters in one video pass the **same-production difference check**: at least three of silhouette / shape language / main color / signature element clearly differ - hair color alone is not enough
- **Crop, do not regenerate**: take a local reference (such as the profile zone) from the sheet; regenerating a face opens the door to drift
- State changes (injured / wet / costume change) are registered in `cast[].states[]` and derived from the sheet, not started afresh
- Generate the sheet with `image_generate` (high quality + the signature ledger); **a successful decode or the automatic panel check is not content acceptance** - look at the image

## Final prompt form (three short editing sentences; in blind rating on two cases they beat the long F2VA text)

```
1. Edit reference video 1: replace <appearance of the original performer> throughout with <the target person> from image N… (keep the binding in single-person shots)
2. Preserve the source framing, camera movement, choreography, cut times and action timing exactly… (including microphone positions)
3. No on-screen text or lyrics.
```

- Do not use: the six-part long F2VA text (at 2K it lost to the short sentences in both cases, 6:4 and 4.7:4.0), timestamped beat tables, plot retelling
- Material binding follows `H3_NOTES` in `generators.py` (@Image N + the four retention levels)

## Acceptance gates (all required)

1. **Machine**: insightface identity check against four references (no strong hit of the original leads; close every weak hit by a human look - most are background musicians) + freeze detection + the zero-drift assembly assertion
2. **Human**: play at original speed with the audio track; rejection line = a visible face flash / a hand that keeps floating / interpenetration / a whole sentence of mismatched lip movement
3. **Discipline**: the verification round includes the hardest shots (close-up / head turn / body contact); easy segments must not vouch for the whole pipeline; when the identity scan's dependency is missing it degrades and the human review takes over

## Known residuals (on record; do not "fix" them as bugs)

- Two kinds of window stop `swap_plan` and are reported: an isolated short window (shorter than `min_window`, cannot merge with a neighbour) and a single shot longer than `max_window`+0.5 s (the planner never cuts inside a shot). The error names each one; choose `min_window` / `max_window` or edit the shot rows, then rerun
- For a 2K deliverable, generate at 2K directly rather than generating at 768P first and upscaling the result
- Task status is read per task id (`swap_generate` does this); a listing of recent tasks is never used to find a task
