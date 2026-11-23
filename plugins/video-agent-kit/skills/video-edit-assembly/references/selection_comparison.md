# Compare a Questioned Selection

Use this when the brief permits alternatives and a passage's repeated attempts, static views or later returns may outweigh what they add. Compare a current selection with a viable tighter cut before polishing the entire film. Preserve required coverage, reference pacing, meaningful action and sound; a shorter candidate can lose.

## Prepare the Two Cuts

Gather the questioned activity's ranges from the existing selection record, including returns across files and chapters. The current cut should be the selection you would otherwise use. Build the tighter candidate around its defining action, result and reaction: consider omitting whole interchangeable attempts or views, not only trimming each shot's edges. Keep intended order and necessary context; do not combine separate attempts into a fabricated success or speed up footage merely to win a duration comparison.

The bundled [compare_selections.py](../scripts/compare_selections.py) creates native project timelines, an activity-duration table and source/output cut windows. It does not render, infer activity groups or choose a winner. Resolve the script relative to this skill directory:

```bash
python3 -B scripts/compare_selections.py --input selection_compare.json \
  --output-dir comparison_01
```

Use the actual canvas and fps. This example keeps an action and a later response in both candidates while reducing the first range:

```json
{
  "sequence": {"width": 1280, "height": 720, "fps": 30},
  "candidates": {
    "current": [
      {"source": "attempt.mp4", "start": 2, "end": 14,
       "activity": "balancing", "beat": "first visit", "reason": "Approach, attempt and landing"},
      {"source": "return.mp4", "start": 4, "end": 9,
       "activity": "balancing", "beat": "later visit", "reason": "A different response after the attempt"}
    ],
    "tighter": [
      {"source": "attempt.mp4", "start": 6, "end": 14,
       "activity": "balancing", "beat": "first visit", "reason": "Shorter approach, retaining attempt and landing"},
      {"source": "return.mp4", "start": 4, "end": 9,
       "activity": "balancing", "beat": "later visit", "reason": "Retain the distinct response"}
    ]
  }
}
```

Copy ranges from the current selection or timeline into these arrays; do not change original sources. Each clip needs `source`, `start`, `end` (or `duration`), `activity` and `reason`. Optional `beat` preserves the section label without splitting the activity totals. `speed` and `volume` default to 1; copy the intended values, including `volume: 0` when muted. Photos use `start: 0` and their hold duration. Source paths resolve relative to the manifest; `--source-root` can select the project directory instead. Outputs use absolute source paths. Choose a new output directory for a revision.

This is a sequential selection comparison: the helper rejects layout, transition and track fields instead of silently discarding them. Use native timelines directly when separate audio tracks, crossfades or composed layouts are essential to the comparison. A group assembled from later returns omits their intervening context; its preview is not the final film's pacing. Totals cover only supplied ranges and account for speed, not merely source seconds.

## Render, Inspect, Decide

1. Run `timeline_validate` on `current.timeline.json` and `tighter.timeline.json`, then render them with `video_render(kind="timeline", timeline_path=..., output_path=...)`. The existing renderer checks media bounds, preserves source sound at the chosen level and fits pictures to the canvas. The helper's arithmetic does not replace validation.
2. Inspect both MP4s with `video_observe` over their full durations at the same sampling fps. Equal frame counts per shot can disguise unequal screen time. The generated `cut_windows` locate boundaries, not semantic action bounds: expand them from setup through the last retained outcome and response. Consecutive frames and playback when available resolve motion; stills cannot establish audio quality.
3. Identify lost or preserved developments by source interval and what the viewer gains: understanding, emotion, required coverage or meaningful sound. If an outcome, response or caption setup is missing, restore its necessary interval rather than the whole discarded passage. Keep a long continuous take when its development needs that time. Record the chosen ranges, gain or loss, preview paths and actual observation coverage in the existing notes.

Carry the chosen ranges into the main timeline and update activity totals after additions or restorations. Judge final pacing in the assembled film, not by the candidate name or percentage removed, using the [audience review](editing_judgment.md#review-as-an-audience-member) to check context and visible outcomes.
