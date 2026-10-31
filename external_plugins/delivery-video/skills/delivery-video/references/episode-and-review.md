# Episode, takes and review details

## episode.json fields

`render.py render <build>` reads `<build>/episode.json`. Build directories are named `screen_demo` or `screen_demo-<slug>`.

| Field | Required | Notes |
| --- | --- | --- |
| `voice` | yes | edge-tts voice, e.g. `zh-CN-YunxiNeural`, `en-US-AndrewNeural` |
| `rate` | no | speech rate, default `+5%`, format `+N%` or `-N%` |
| `title` | no | internal identification only |
| `segments` | yes | non-empty array, unique `id`s |
| `segments[].id` | yes | ASCII id, e.g. `01-entry` |
| `segments[].case` | no | acceptance-case chip shown top-left, e.g. `D-02` |
| `segments[].label` | yes | short top-left label, 2–10 chars |
| `segments[].shot` | yes | recording file relative to the build directory |
| `segments[].start` | yes | range start in the source, seconds |
| `segments[].end` | yes | range end, must exceed start |
| `segments[].source` | no | `browser` requires `<shot-stem>.evidence.json`; `demo-stage` requires headless-stage evidence; window recordings may say `window` or omit |
| `segments[].crop` | no | `[x, y, w, h]` in source pixels, default `[260, 64, 1340, 780]` |
| `segments[].text` | yes | one continuous narration line, no newlines; subtitles auto-break at punctuation |

### Choosing time ranges

- Leave 0.3–0.8s before the action starts so the entry reads.
- Success feedback, read-back and key states must fall inside the range.
- The last segment must be a result, not a waiting state.
- A stretch of static frames longer than ~8s inside a take means cut it: idle time makes the whole video feel stuck (the gate's `T301`/`T304` enforce this).
- You may cut waiting gaps, but never merge pieces of different runs into one success.
- Playback speed lands between 0.3x and 3x by construction; below 0.3x the action is too slow or the narration too short, above 3x the narration overruns the range — split or trim instead of forcing.
- Aim for 15–35 characters per narration segment; important results get their own segment.

### Browser recording evidence

Browser segments (recorded by a scripted screencast tool) carry `<shot-stem>.evidence.json` (`take-01.mp4` → `take-01.evidence.json`). Preflight checks:

- `kind` is `cdp-screencast` or `browser-demo`; `port`, when present, is a positive integer;
- `size` is `[1920, 1080]` and `sha256` matches the current mp4; `video_s` is within 0.2s of the measured duration; `frames` ≥ 1;
- a `source: "browser"` segment without evidence fails immediately.

### Demo-stage evidence

Segments with `source: "demo-stage"` come from a headless scripted-stage tool. The evidence must show `kind: "demo-stage-recording"`, `status: "passed"`, all self-checks passed, `capture.headless: true`, `capture.window_visible: false`, and a `video` block with matching sha256/fps/frames/duration. A visible window during recording fails — the stage must not steal focus.

### TTS cache contract

Narration is cached at `tts/<segment-id>.mp3` + `tts/<segment-id>.json`. The clock JSON records `{text, voice, rate, words[]}`; changing any of them without deleting the cache files fails the render with a mismatch. Editing narration = delete that segment's two cache files and re-render.

## visual-critic.json

An independent visual review, ideally by a second model or reviewer who has not seen the maker's conclusions. Schema:

```json
{
  "status": "pass",
  "critical": [],
  "dimensions": {
    "subtitle_legibility": 0.96,
    "subtitle_safe_margins": 0.98,
    "interface_legibility": 0.9,
    "composition": 0.92,
    "business_content_alignment": 0.97
  },
  "reviewed_frames": [
    {"time_s": 1.0, "scene": "entry"},
    {"time_s": 8.0, "scene": "key action"},
    {"time_s": 16.0, "scene": "result read-back"}
  ],
  "observations": [
    "Subtitles complete; no controls covered.",
    "Success message matches the narration."
  ],
  "limitations": [
    "Static frames only; does not prove full click ordering or database consistency."
  ],
  "reviewer": "independent-review",
  "video_sha256": "<artifact SHA256>"
}
```

`video_sha256` must match the current artifact, otherwise the review binds to nothing.

## Reading the quality report

`quality_gate/report.json` (`profile: delivery-v1`) — the important parts:

- `status` is `pass` and `hard_failures` is empty.
- `score.total` plus the per-check details; don't judge by the total alone.
- `warnings` — `E301` (long silence) and `E401` (no independent critic) do not auto-fail a technical-acceptance render, but state them honestly in the delivery note.

The gate binds to the artifact via `video_sha256`; after any re-render the gate re-runs automatically with `render.py render`. For an attachment gate on an arbitrary mp4, run `render.py gate --video <mp4> --work <dir>` — it writes its own report.

## delivery.md template

````markdown
# <Feature> delivery demo

## Running version

- Environment: <env>
- Frontend/backend/local version: <SHA or release>
- Verification entry: <probe/start command>

## Real evidence

- <ticket/request id/page read-back/db bounds>
- The video covers <page operations>; <database consistency/concurrency/full regression> is covered by <evidence>.

## Artifact

- File: <absolute path>
- Duration/resolution/fps/codec: <...>
- SHA256: <...>
- Recipe: <episode.json absolute path>
- Takes: <directory>
- Gate: <report.json absolute path>, PASS, <score>
- Attachment gate: <report for the posted file>, PASS, profile delivery-v1, uploaded SHA256 <...>
- Visual review: <visual-critic.json path or "not performed">

## Commands actually run

```bash
<key recording/render/gate commands>
```

## Boundaries

- Proven: <...>
- Not proven: <...>

## Status

Awaiting user review — not uploaded / not published.
````

## Common failures

| Symptom | Fix |
| --- | --- |
| `missing real recording` | `shot` path wrong or file not in the build directory |
| `invalid recording interval` | `start/end` beyond the source, or the cut lands mid-action |
| `recording speed outside 0.3x..3x` | shorten narration, widen the range or split the segment |
| Large black areas in a take | window off-screen or occluded during recording; re-record |
| Subtitles clipped or covering controls | adjust `crop` or shorten the narration |
| Gate hard failure | open `report.json`, fix the material per the highest-severity item; never touch thresholds |
| `M111` low bitrate (blurry text) | don't hand-shrink: cut duration first, re-encode at CRF, re-gate |
| `T301`/`T304` freeze-heavy | cut waiting ranges, raise range speed, add a real interaction |
| Final duration mismatch | re-render from scratch; do not trim the artifact by hand |
| Portrait need | this pipeline is 16:9 landscape by design; use a portrait-dedicated recipe instead of hard-cropping |
