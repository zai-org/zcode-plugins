# Episode, takes and review details

## episode.json fields

`render.py render <build>` reads `<build>/episode.json`. Build directories are named `screen_demo` or `screen_demo-<slug>`.

| Field | Required | Notes |
| --- | --- | --- |
| `voice` | yes | edge-tts voice, e.g. `zh-CN-YunxiNeural`, `en-US-AndrewNeural` |
| `rate` | no | speech rate, default `+5%`, format `+N%` or `-N%` |
| `title` | no | heading of the generated delivery note; never drawn on screen |
| `layout` | no | episode-level. `fullbleed` (default) scales the recording onto the 1920x1080 canvas — a 1080p take maps 1:1 — with the chip and subtitles overlaid on a backing box. `banded` fits it into a smaller content box above a dark subtitle band |
| `evidence` | no | version facts carried into `delivery.generated.md` and bound with the episode: an object whose values are strings, numbers or lists of them, e.g. `{"git_sha": "…", "environment": "staging", "tickets": ["T-1001"]}` |
| `intent` | no | `delivery` (default) or `feedback`; feedback requires the `issue` block |
| `issue` | for feedback | defect report metadata, see below |
| `segments` | yes | non-empty array with unique `id`s (two ids that differ only by case are duplicates); every segment is a shot (default) or a card |
| `segments[].id` | yes | ASCII id used as a file stem: letters, digits, `_`, `-`, starting with a letter or digit |
| `segments[].kind` | no | `shot` (default) or `card` |
| `segments[].case` | no | acceptance-case chip shown top-left, e.g. `D-02`; recommended when the video covers 2+ cases |
| `segments[].phase` | for feedback | `context`, `repro`, `actual`, `expected` or `impact`; becomes the second chip |
| `segments[].label` | shots | short top-left label; optional on cards |
| `segments[].shot` | shots | recording file relative to the build directory. It must stay inside it and out of the renderer's own files (`screen_demo.mp4`, `tts/`, `review/`, `clips/`, `quality_gate/`); this is judged by where the file really lives, so `CLIPS/x.mp4` and a symlink into `clips/` count as `clips/` |
| `segments[].start` | shots | range start in the source, seconds |
| `segments[].end` | shots | range end; must exceed `start` and not run past the take |
| `segments[].source` | shots | `browser` requires `<shot-stem>.evidence.json`; `demo-stage` requires headless-stage evidence; window recordings may say `window` or omit |
| `segments[].crop` | shots | `[x, y, w, h]` in source pixels. Absent = the full frame is shown (recommended for window/browser takes); an explicit crop is bounds-checked against the real source pixels and fails loud. Never rely on a silent default to hide sensitive regions — crop on purpose or cut the take |
| `segments[].title` | cards | the large text on the card, about 40 spoken characters at most; wrapped automatically |
| `segments[].duration` | silent cards | 1–8 seconds, default 2.5; only for a card without `text` |
| `segments[].text` | shots: yes; cards: no | one continuous narration line, no newlines; preflight warns past about 50 spoken characters. Subtitles light up character by character |

### Cards

A card is drawn by the renderer: dark canvas, an accent bar, the `title` in large type and the usual chips. With `text` the card is narrated like any shot and lasts as long as its narration; when the text differs from the title it also runs as a subtitle. Without `text` the card is silent for `duration`. A card must not carry `shot`, `start`, `end`, `source` or `crop`.

The gate treats a card's interval as allowed to be still and silent: those intervals are cut out of the black, freeze and silence scans, they are listed in the report under `exempt`, and `T304` is measured against the remaining footage. Cards may not carry the demo: `C301` fails a video whose cards exceed 25% of its length, or 8 seconds in a shorter video, and any video whose cards run longer than its real footage. A narrated opening and a closing card of up to 8 seconds together are fine in a short video. A closing card is a result state when its title states the result.

### Feedback issues

`intent: "feedback"` turns the artifact into a defect report while keeping the same recording and gate rules.

| Field | Required | Notes |
| --- | --- | --- |
| `issue.title` | yes | one sentence naming the wrong behaviour |
| `issue.severity` | yes | `blocker`, `critical`, `major` or `minor` |
| `issue.expected` | yes | what a correct build must show |
| `issue.actual` | yes | what this build actually shows |
| `issue.id` | no | ticket or case id |
| `issue.environment` | no | build, environment, account or data |
| `issue.repro` | no | up to 12 steps, one string per step |

At least one segment must use `phase: "actual"`. `render.py` writes `feedback.json` with the
issue, the segment phases and the artifact SHA256; `verify_delivery.py` treats a missing or
misbound report as a failure, and the gate report binds `episode.json`, `timeline.json`, a
normalized hash of the report fields plus the exact `feedback.generated.md` bytes, so editing
any of them after rendering fails the gate. Delivery episodes without `intent` keep the
original contract.

During `phase: "repro"` segments the renderer also draws the first five `issue.repro` steps in
the top-right corner; the full list stays in the generated markdown. The severity becomes the
first on-screen chip and the phase the second, so a viewer can tell repro from symptom without
narration. A feedback video reports what the current build does: never mix in footage from an
older build, claim a fix, or hide a passing case to make the defect look worse. A `phase` on a
delivery episode is rejected, so the two modes cannot be mixed by accident.

### Generated files

| File | Contents |
| --- | --- |
| `delivery.generated.md` | delivery episodes: artifact facts and SHA256, the `evidence` block, one row per segment with in-video range, source range and playback speed, gate warnings, retime notes |
| `feedback.json` | feedback episodes: machine-readable issue, segment phases and artifact SHA256 |
| `feedback.generated.md` | feedback episodes: ticket-ready draft with expected/actual, numbered repro steps, per-segment timing, source range and playback speed, artifact hash and gate result |

The generated markdown is rewritten on every render and bound into the gate report — edit a
copy or keep additions in a separate note. The feedback draft deliberately does not claim a
fix, a root cause or coverage of other environments.

### Case list (recommended, not enforced)

Only for a video covering two or more cases: write one row per case — case id, what it proves, entry, precondition/data, expected observable result — and reuse the same ids in take names, `episode.json` and the delivery note. Keep it in the target project beside the build directory, never in the plugin; template: `examples/cases.example.md`.

### Choosing time ranges

- Leave 0.3–0.8s before the action starts so the entry reads.
- Success feedback, read-back and key states must fall inside the range.
- The last segment must be a result, not a waiting state.
- A stretch of static frames longer than ~2s inside a take means cut it: idle time makes the whole video feel stuck (`T301` fires on a ≥2s frozen span, `T304` when frozen frames reach 20% of the footage).
- You may cut waiting gaps, but never merge pieces of different runs into one success.
- Playback speed lands between 0.3x and 3x by construction; below 0.3x the action is too slow or the narration too short, above 3x the narration overruns the range — split or trim instead of forcing. Outside 0.7x–1.5x the render calls the segment out and the generated note discloses it.
- Aim for 15–35 characters per narration segment; important results get their own segment.
- In a multi-case video, keep one result segment per case and follow the execution order, so the viewer can tell where one case ends and the next begins.

### Browser recording evidence

Browser segments carry a `<shot-stem>.evidence.json` beside the take; the full contract (allowed `kind`s, required fields, 1920x1080 size, 0.2s duration tolerance) is in [recording.md](recording.md).

### Demo-stage evidence

Segments with `source: "demo-stage"` come from a headless scripted-stage tool. The evidence must show `kind: "demo-stage-recording"`, `status: "passed"`, all self-checks passed, `capture.headless: true`, `capture.window_visible: false`, and a `video` block with matching sha256/fps/frames/duration. A visible window during recording fails — the stage must not steal focus.

### Narration cache

Narration is cached by content at `tts/<segment-id>.<key>.mp3` + `tts/<segment-id>.<key>.json`, where `key` is derived from the text, the voice and the rate. A cached pair is reused only for exactly that combination; change any of the three and the line is synthesized again — nothing has to be deleted. Both halves are written atomically, so an incomplete pair is a plain cache miss. Files named `tts/<id>.mp3` or `tts/<id>.json` without a key come from older versions: they are ignored, and preflight lists them once so they can be deleted.

All narration is synthesized, and every segment's speed checked, before the first frame is rendered: a segment that cannot be timed fails there, together with every other bad segment, and costs no render time.

## What a render writes

| File | Contents |
| --- | --- |
| `screen_demo.mp4` | the artifact: 1920x1080, 30fps, h264, narrated, loudness-normalized. Written under a staging name and renamed once complete, so an interrupted re-render leaves the previous artifact intact |
| `timeline.json` | per segment: kind, in-video range, label and case; shots add the source file, source range, playback speed, the take's SHA256 and, for an evidence-backed take, the evidence file's SHA256; cards add the title |
| `cover.png` | the frame at 2s |
| `clips/` | the per-segment clips and the assembly files (named with a leading `_`); safe to delete |
| `review/frames/<id>-start\|mid\|end.png` | full-resolution first, middle and last frame of every segment |
| `review/sheet_NN.png` | contact sheets, six segments per page, captioned with range and playback speed |
| `review/critic.draft.json` | skeleton of the visual review, bound to the artifact SHA256 |
| `delivery.generated.md` | delivery episodes; feedback episodes write the two feedback files instead |
| `quality_gate/report.json` | gate result, checks and bindings |

## visual-critic.json

The record that the frames were looked at. Start from `review/critic.draft.json`, keep only the frames actually reviewed, score the dimensions, name the reviewer, and save the result as `visual-critic.json` at the build root. The renderer never writes that file.

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
    {"time_s": 0.6, "segment": "01-entry", "frame": "review/frames/01-entry-start.png"},
    {"time_s": 8.0, "segment": "01-entry", "frame": "review/frames/01-entry-mid.png"},
    {"time_s": 11.2, "segment": "03-result", "frame": "review/frames/03-result-end.png"}
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

`verify_delivery.py` requires the file and checks it: `status` is `pass`, `critical` is empty, `video_sha256` is the current artifact, `reviewer` is named, each of the five dimensions is a number from 0.8 to 1 (a `pass` with a lower score is a contradiction — record the problem under `critical` instead), a `frame` path, when given, still exists, every segment has a reviewed frame inside its range, and the first and the last second were each reviewed. For an external delivery the reviewer must be someone who has not seen the maker's conclusions — a second model or window working from the packet.

## Reading the quality report

`quality_gate/report.json` (`profile: delivery-v1`) — the important parts:

- `status` is `pass` and `hard_failures` is empty.
- `score.total` plus the per-check details; don't judge by the total alone.
- `warnings` — actionable anomalies such as `E301` (long silence); keep them visible.
- `notices` — advisory measurements (e.g. bitrate density). They do not reduce the score; the gate-code table in [SKILL.md](../SKILL.md) says what to do with each code.
- `exempt` — the card intervals left out of the black, freeze and silence scans.
- The bindings: `video_sha256`, `episode`, `timeline` and `delivery` (or `feedback`). `verify_delivery.py` recomputes every one of them and fails when `episode.json`, `timeline.json`, a take, a take's evidence file or the generated note changed after rendering; it also re-applies the preflight evidence rules to every evidence-backed take. A report without the `episode` and `timeline` bindings — from an older version or from the attachment gate — fails too, as does a delivery report without its `delivery` binding.

For an attachment gate on an arbitrary mp4, run `render.py gate --video <mp4> --work <dir>` — it writes its own report; add `--timeline <build>/timeline.json` when that video contains cards.

## delivery.md

The generated `delivery.generated.md` already holds the artifact facts, the version evidence, the segment table with playback speeds, gate warnings and retime notes. `delivery.md` adds what only the maker knows:

````markdown
# <Feature> delivery demo

## Running version

- Environment: <env>
- Frontend/backend/local version: <SHA or release>
- Verification entry: <probe/start command>

## Real evidence

- <ticket/request id/page read-back/db bounds>
- The video covers <page operations>; <database consistency/concurrency/full regression> is covered by <evidence>.

## Case results (optional, recommended for multi-case videos)

| Case | Result | Evidence | Video range |
| --- | --- | --- | --- |
| <F-01> | PASS / FAIL / OBS | <take or page evidence> | <start–end in the artifact> |

## Artifact

- File: <absolute path>
- Duration/resolution/fps/codec: <...>
- SHA256: <...>
- Recipe: <episode.json absolute path>
- Takes: <directory>
- Gate: <report.json absolute path>, PASS, <score>
- Attachment gate: <report for the posted file>, PASS, profile delivery-v1, uploaded SHA256 <...>
- Visual review: <visual-critic.json path>

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
| `recording speed outside 0.3x..3x` | shorten narration, widen the range or split the segment; every such segment is listed before anything renders |
| `recording ends after N of M frames` | the take is truncated — its header promises more than the file holds; re-record it or end the segment earlier |
| `shot … is a file the renderer writes` | the take sits where the renderer writes; move it out of `tts/`, `review/`, `clips/`, `quality_gate/` or away from `screen_demo.mp4` |
| `refusing to render: these outputs would overwrite a take` | the renderer's own last check found a take under a file it is about to write; move the take |
| `L102` | the loudness measurement itself failed; the message carries the ffmpeg error |
| `… below the 0.8 pass floor` | the review scored a dimension under 0.8 and still said pass; fix the material or list it under `critical` |
| `narration synthesis failed for <id>` | the TTS service or the network failed; finished segments stay cached, so rerun |
| `corrupt TTS clock cache` | delete the named file; the line is synthesized again |
| `legacy TTS cache files are ignored` | files from an older version; delete them |
| Large black areas in a take | window off-screen or occluded during recording; re-record |
| Subtitles clipped or covering controls | adjust `crop` or shorten the narration |
| `C301` static cards cover too much | shorten the cards or record more of the feature |
| Gate hard failure | open `report.json`, fix the material per the highest-severity item; never touch thresholds |
| `missing visual review` | look at `review/sheet_NN.png` and the frames, complete `review/critic.draft.json`, save it as `visual-critic.json` |
| `… was edited after rendering` | `episode.json`, `timeline.json`, a take or the generated note changed since the render; re-render |
| Final duration mismatch | re-render from scratch; do not trim the artifact by hand |
| Portrait need | this pipeline is 16:9 landscape by design; use a portrait-dedicated recipe instead of hard-cropping |
